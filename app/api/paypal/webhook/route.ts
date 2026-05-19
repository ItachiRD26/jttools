// LOCATION: app/api/paypal/webhook/route.ts
// Recibe eventos de PayPal y sincroniza el estado de suscripciones en Firestore
//
// Eventos manejados:
//   BILLING.SUBSCRIPTION.ACTIVATED   → activa / renueva plan
//   BILLING.SUBSCRIPTION.CANCELLED   → cancela plan
//   BILLING.SUBSCRIPTION.SUSPENDED   → marca past_due
//   PAYMENT.SALE.COMPLETED            → renueva nextBillingDate

import { NextRequest, NextResponse } from "next/server";
import { getDb, Collections } from "@/lib/firebase-admin";
import { activatePlan, cancelPlan, downgradePlan } from "@/lib/billing";
import { FieldValue } from "firebase-admin/firestore";

const PAYPAL_BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

// ─── Verificar firma del webhook ──────────────────────────────────────────────
async function verifyWebhookSignature(req: NextRequest, body: string): Promise<boolean> {
  // PayPal envía estos headers para verificación
  const transmissionId  = req.headers.get("paypal-transmission-id");
  const transmissionTime = req.headers.get("paypal-transmission-time");
  const certUrl         = req.headers.get("paypal-cert-url");
  const authAlgo        = req.headers.get("paypal-auth-algo");
  const transmissionSig = req.headers.get("paypal-transmission-sig");
  const webhookId       = process.env.PAYPAL_WEBHOOK_ID;

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig || !webhookId) {
    console.error("[Webhook] Missing PayPal signature headers");
    return false;
  }

  try {
    // Obtener access token para llamar a la API de verificación
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
          ).toString("base64"),
      },
      body: "grant_type=client_credentials",
    });
    const { access_token } = await tokenRes.json();

    const verifyRes = await fetch(
      `${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: webhookId,
          webhook_event: JSON.parse(body),
        }),
      }
    );

    const result = await verifyRes.json();
    return result.verification_status === "SUCCESS";
  } catch (err) {
    console.error("[Webhook] Signature verification error:", err);
    return false;
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.text();

  // Verificar firma (saltamos en desarrollo si no hay WEBHOOK_ID)
  if (process.env.PAYPAL_WEBHOOK_ID) {
    const valid = await verifyWebhookSignature(req, body);
    if (!valid) {
      console.error("[Webhook] Invalid signature — rejecting");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log(`[Webhook] Received: ${event.event_type} — resource: ${event.resource?.id}`);

  try {
    switch (event.event_type) {

      // ── Suscripción activada (primera vez o reactivación) ─────────────────
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        const sub = event.resource;
        const uid = sub.custom_id;
        const planId = getPlanIdFromPaypalPlanId(sub.plan_id);

        if (!uid) {
          console.error("[Webhook] ACTIVATED — missing custom_id");
          break;
        }

        await activatePlan(uid, planId, sub.id);
        console.log(`[Webhook] Plan activated for uid=${uid} plan=${planId}`);
        break;
      }

      // ── Pago mensual completado → renovar nextBillingDate ─────────────────
      case "PAYMENT.SALE.COMPLETED": {
        const sale = event.resource;
        const subscriptionId = sale.billing_agreement_id;

        if (!subscriptionId) break; // pago puntual, no de suscripción

        // Buscar usuario por subscriptionId guardado en Firestore
        const db = getDb();
        const snap = await db.collection(Collections.USERS)
          .where("paypalSubscriptionId", "==", subscriptionId)
          .limit(1)
          .get();

        if (snap.empty) {
          console.warn(`[Webhook] PAYMENT.SALE.COMPLETED — no user found for sub ${subscriptionId}`);
          break;
        }

        const uid = snap.docs[0].id;
        const nextBillingDate = new Date();
        nextBillingDate.setDate(nextBillingDate.getDate() + 30);

        await db.collection(Collections.USERS).doc(uid).update({
          planStatus: "active",
          nextBillingDate,
          lastPaymentAt: FieldValue.serverTimestamp(),
        });

        console.log(`[Webhook] Payment renewed for uid=${uid} next=${nextBillingDate.toISOString()}`);
        break;
      }

      // ── Suscripción cancelada por el usuario en PayPal ────────────────────
      case "BILLING.SUBSCRIPTION.CANCELLED": {
        const sub = event.resource;
        const uid = sub.custom_id;

        if (!uid) {
          console.error("[Webhook] CANCELLED — missing custom_id");
          break;
        }

        await cancelPlan(uid);
        console.log(`[Webhook] Plan cancelled for uid=${uid}`);
        break;
      }

      // ── Suscripción suspendida (pago fallido) → marcar past_due ──────────
      case "BILLING.SUBSCRIPTION.SUSPENDED": {
        const sub = event.resource;
        const uid = sub.custom_id;

        if (!uid) {
          console.error("[Webhook] SUSPENDED — missing custom_id");
          break;
        }

        const db = getDb();
        await db.collection(Collections.USERS).doc(uid).update({
          planStatus: "past_due",
          pastDueSince: FieldValue.serverTimestamp(),
        });

        console.log(`[Webhook] Plan suspended (past_due) for uid=${uid}`);
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.event_type}`);
    }
  } catch (err) {
    console.error(`[Webhook] Error processing ${event.event_type}:`, err);
    // Devolvemos 200 igualmente para que PayPal no reintente indefinidamente
    // Los errores internos se loguean y se pueden revisar en Vercel
  }

  return NextResponse.json({ received: true });
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource: {
    id: string;
    plan_id: string;
    custom_id: string;
    status: string;
    billing_agreement_id?: string; // para PAYMENT.SALE.COMPLETED
  };
}

/** Mapea un PayPal plan_id (P-xxx) al planId interno */
function getPlanIdFromPaypalPlanId(paypalPlanId: string): string {
  const map: Record<string, string> = {
    [process.env.PAYPAL_PLAN_ID_PRO!]: "pro",
  };
  return map[paypalPlanId] ?? "free";
}