// LOCATION: app/api/webhooks/etsy/route.ts
// POST https://www.jeterdev.tools/api/webhooks/etsy
// Etsy sends order.paid events here.
// Verifies HMAC signature, finds the shop owner, sends Pushover notification.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { sendPushover, formatSaleNotification } from "@/lib/pushover";
import crypto from "crypto";

const SIGNING_SECRET = process.env.ETSY_WEBHOOK_SECRET!;

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !SIGNING_SECRET) return false;
  try {
    // Etsy uses HMAC-SHA256, signature is base64 encoded
    const hmac     = crypto.createHmac("sha256", SIGNING_SECRET);
    const expected = hmac.update(rawBody).digest("base64");
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody   = await req.text();
  const signature = req.headers.get("x-etsy-signature")
    ?? req.headers.get("svix-signature")  // some platforms use svix
    ?? "";

  // Verify signature — skip in dev if no secret set
  if (SIGNING_SECRET && !verifySignature(rawBody, signature)) {
    console.warn("[EtsyWebhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch {
    console.error("[EtsyWebhook] Invalid JSON");
    return NextResponse.json({ received: true });
  }

  const event  = (payload.event ?? payload.type ?? "") as string;
  const shopId = String(payload.shop_id ?? payload.shopId ?? "");

  console.log(`[EtsyWebhook] event=${event} shop=${shopId}`);

  // Only process paid orders
  if (!["order.paid", "ORDER_CHANGE", "RECEIPT_CHANGE"].includes(event)) {
    return NextResponse.json({ received: true });
  }

  // For RECEIPT_CHANGE, only fire on paid status
  if (event === "RECEIPT_CHANGE" || event === "ORDER_CHANGE") {
    const status = String(payload.status ?? payload.order_status ?? "");
    if (!["paid", "payment_complete", "completed"].includes(status.toLowerCase())) {
      return NextResponse.json({ received: true });
    }
  }

  if (!shopId) {
    console.warn("[EtsyWebhook] No shop_id in payload");
    return NextResponse.json({ received: true });
  }

  const db = getDb();

  // Find the user who owns this shop
  const connSnap = await db.collectionGroup("shops")
    .where("shopId", "==", shopId)
    .limit(1)
    .get();

  if (connSnap.empty) {
    console.warn(`[EtsyWebhook] No user found for shop ${shopId}`);
    return NextResponse.json({ received: true });
  }

  const shopDoc  = connSnap.docs[0];
  const userId   = shopDoc.ref.parent.parent!.id;
  const shopName = shopDoc.data().shopName ?? "My Shop";

  // Get Pushover config for this user
  const pushSnap = await db.collection("pushoverConfig").doc(userId).get();
  if (!pushSnap.exists) {
    console.log(`[EtsyWebhook] No Pushover config for user ${userId}`);
    return NextResponse.json({ received: true });
  }

  const push = pushSnap.data()!;

  // Extract sale details — handle both Etsy payload shapes
  const orderId   = payload.receipt_id ?? payload.order_id ?? payload.id ?? "?";
  const amount    = parseFloat(String(
    payload.grandtotal ?? payload.total_price ?? payload.amount ?? 0
  ));
  const currency  = String(payload.currency_code ?? payload.currency ?? "USD");
  const itemCount = parseInt(String(
    payload.transaction_count ?? payload.line_items_count ?? payload.item_count ?? 1
  ));
  const buyerCity = payload.buyer_city_name as string | undefined
    ?? payload.shipping_address?.city as string | undefined;

  const notification = formatSaleNotification({
    shopName, orderId, amount, currency, itemCount, buyerCity,
  });

  const sent = await sendPushover(push.userKey, push.appToken, notification);
  console.log(`[EtsyWebhook] Pushover ${sent ? "sent ✓" : "failed ✗"} for order ${orderId} shop ${shopName}`);

  return NextResponse.json({ received: true });
}

// Etsy may send a GET to verify the endpoint
export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "jeterdev.tools/api/webhooks/etsy" });
}