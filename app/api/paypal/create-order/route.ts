// ─────────────────────────────────────────────
//  POST /api/paypal/create-order
//  Crea una orden de PayPal con el monto del plan
// ─────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebase-admin";
import { PLANS, PlanId } from "@/lib/plans";

const PAYPAL_BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

// ─── Get PayPal access token ─────────────────
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

// ─── Handler ─────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. Verify Firebase token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    getAdminApp();
    await getAuth().verifyIdToken(authHeader.slice(7));
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Validate plan
  const { planId } = await req.json();
  const plan = PLANS[planId as PlanId];
  if (!plan || plan.price === 0) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  // 3. Create PayPal order
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: plan.price.toFixed(2),
          },
          description: `JT Tools — Plan ${plan.name} (mensual)`,
          custom_id: planId, // guardamos el planId para usarlo en capture
        },
      ],
      application_context: {
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing?cancelled=1`,
        brand_name: "JT Tools",
        user_action: "PAY_NOW",
      },
    }),
  });

  const order = await res.json();

  if (!res.ok) {
    console.error("PayPal create-order error:", order);
    return NextResponse.json({ error: "PayPal error" }, { status: 500 });
  }

  // 4. Return order id + approval URL
  const approvalUrl = order.links?.find(
    (l: { rel: string }) => l.rel === "approve"
  )?.href;

  return NextResponse.json({ orderId: order.id, approvalUrl });
}