// ─────────────────────────────────────────────
//  POST /api/paypal/capture-order
//  Captura el pago y actualiza el plan en Firestore
// ─────────────────────────────────────────────
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
  // 1. Verify Firebase token
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

  const { orderId } = await req.json();
  if (!orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }

  // 2. Capture the PayPal order
  const token = await getAccessToken();
  const res = await fetch(
    `${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const capture = await res.json();

  if (!res.ok || capture.status !== "COMPLETED") {
    console.error("PayPal capture error:", capture);
    return NextResponse.json({ error: "Payment not completed" }, { status: 400 });
  }

  // 3. Extract planId and verify amount matches
  const planId: string =
    capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ?? "free";

  const capturedAmount = parseFloat(
    capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0"
  );

  const { PLANS } = await import("@/lib/plans");
  const expectedAmount = PLANS[planId as keyof typeof PLANS]?.price ?? 0;

  if (Math.abs(capturedAmount - expectedAmount) > 0.01) {
    console.error(`[PayPal] Amount mismatch: captured $${capturedAmount}, expected $${expectedAmount} for plan ${planId}`);
    return NextResponse.json({ error: "Payment amount mismatch" }, { status: 400 });
  }

  // 4. Activate plan — revokes old key, creates new key, sends email, updates Firestore
  const newApiKey = await activatePlan(uid, planId, orderId);

  return NextResponse.json({
    success: true,
    planId,
    apiKey: newApiKey,
  });
}