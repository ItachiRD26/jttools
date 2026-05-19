// LOCATION: app/api/paypal/create-subscription/route.ts
// Crea una suscripción de PayPal y devuelve el approvalUrl

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebase-admin";
import { PLANS, PlanId } from "@/lib/plans";

const PAYPAL_BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

// ─── PayPal plan IDs (en tu .env) ────────────────────────────────────────────
// PAYPAL_PLAN_ID_PRO=P-xxxxxxxxxxxxxxxxx
const PAYPAL_PLAN_IDS: Partial<Record<PlanId, string>> = {
  pro: process.env.PAYPAL_PLAN_ID_PRO!,
};

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

  // 2. Validar plan
  const { planId } = await req.json();
  const plan = PLANS[planId as PlanId];
  if (!plan || plan.price === 0) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const paypalPlanId = PAYPAL_PLAN_IDS[planId as PlanId];
  if (!paypalPlanId) {
    return NextResponse.json({ error: "PayPal plan not configured" }, { status: 500 });
  }

  // 3. Crear suscripción en PayPal
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      plan_id: paypalPlanId,
      custom_id: uid, // guardamos el uid para identificar al usuario en el webhook
      application_context: {
        brand_name: "JT Tools",
        locale: "en-US",
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        payment_method: {
          payer_selected: "PAYPAL",
          payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED",
        },
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?subscription_success=1`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing?cancelled=1`,
      },
    }),
  });

  const subscription = await res.json();

  if (!res.ok) {
    console.error("[PayPal] create-subscription error:", subscription);
    return NextResponse.json({ error: "PayPal error" }, { status: 500 });
  }

  const approvalUrl = subscription.links?.find(
    (l: { rel: string }) => l.rel === "approve"
  )?.href;

  return NextResponse.json({
    subscriptionId: subscription.id,
    approvalUrl,
  });
}