// LOCATION: app/api/paypal/activate-subscription/route.ts
// Verifica que la suscripción fue aprobada y activa el plan en Firestore
// Llamado desde el frontend después del redirect de PayPal

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebase-admin";
import { activatePlan } from "@/lib/billing";

const PAYPAL_BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function getAccessToken(): Promise<string> {
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
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
  const data = await res.json();
  return data.access_token;
}

export async function POST(req: NextRequest) {
  // 1. Verificar token Firebase
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    getAdminApp();
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { subscriptionId } = await req.json();
  if (!subscriptionId) {
    return NextResponse.json({ error: "subscriptionId required" }, { status: 400 });
  }

  // 2. Verificar estado de la suscripción en PayPal
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const subscription = await res.json();

  if (!res.ok) {
    console.error("[PayPal] get-subscription error:", subscription);
    return NextResponse.json({ error: "PayPal error" }, { status: 500 });
  }

  // La suscripción debe estar ACTIVE o APPROVAL_PENDING (ya aprobada por el usuario)
  const validStatuses = ["ACTIVE", "APPROVAL_PENDING"];
  if (!validStatuses.includes(subscription.status)) {
    console.error(`[PayPal] Subscription status invalid: ${subscription.status}`);
    return NextResponse.json({ error: "Subscription not approved" }, { status: 400 });
  }

  // 3. Verificar que la suscripción pertenece al usuario (custom_id)
  if (subscription.custom_id !== uid) {
    console.error(`[PayPal] custom_id mismatch: ${subscription.custom_id} vs ${uid}`);
    return NextResponse.json({ error: "Subscription does not belong to this user" }, { status: 403 });
  }

  // 4. Extraer planId desde el plan_id de PayPal
  // El webhook BILLING.SUBSCRIPTION.ACTIVATED hará el trabajo principal,
  // pero activamos aquí también para respuesta inmediata al usuario
  const planId = getPlanIdFromPaypalPlanId(subscription.plan_id);

  const newApiKey = await activatePlan(uid, planId, subscriptionId);

  return NextResponse.json({
    success: true,
    planId,
    apiKey: newApiKey,
  });
}

/** Mapea un PayPal plan_id (P-xxx) al planId interno ("pro", etc.) */
function getPlanIdFromPaypalPlanId(paypalPlanId: string): string {
  const map: Record<string, string> = {
    [process.env.PAYPAL_PLAN_ID_PRO!]: "pro",
  };
  return map[paypalPlanId] ?? "free";
}