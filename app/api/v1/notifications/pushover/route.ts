// LOCATION: app/api/v1/notifications/pushover/route.ts
// POST /api/v1/notifications/pushover  — save credentials + test
// DELETE /api/v1/notifications/pushover — remove

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { sendPushover } from "@/lib/pushover";
import { FieldValue } from "firebase-admin/firestore";

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, DELETE, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, x-api-key" };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "notifications/pushover");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  const snap = await db.collection("pushoverConfig").doc(userId).get();
  if (!snap.exists) return NextResponse.json({ configured: false }, { headers: cors() });

  const data = snap.data()!;
  return NextResponse.json({
    configured: true,
    shops:      data.shops ?? [],
    // Never expose the full token
    app_token:  data.appToken ? data.appToken.slice(0, 4) + "..." : null,
  }, { headers: cors() });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "notifications/pushover");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  let body: { user_key: string; app_token: string; shop_ids?: string[] };
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", status: 400, message: "Invalid JSON." } }, { status: 400 });
  }

  if (!body.user_key || !body.app_token) {
    return NextResponse.json({
      error: { code: "VALIDATION_FAILED", status: 400, message: "user_key and app_token are required." }
    }, { status: 400, headers: cors() });
  }

  // Test notification
  const sent = await sendPushover(body.user_key, body.app_token, {
    title:   "JeterDev Tools connected ✓",
    message: "You'll receive sale notifications here.",
    sound:   "magic",
  });

  if (!sent) {
    return NextResponse.json({
      error: { code: "INVALID_REQUEST", status: 400, message: "Could not send test notification. Check your user_key and app_token." }
    }, { status: 400, headers: cors() });
  }

  await db.collection("pushoverConfig").doc(userId).set({
    userId,
    userKey:   body.user_key,
    appToken:  body.app_token,
    shopIds:   body.shop_ids ?? [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    success: true,
    message: "Pushover connected. A test notification was sent to your device.",
  }, { status: 200, headers: cors() });
}

export async function DELETE(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "notifications/pushover");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  await db.collection("pushoverConfig").doc(userId).delete();
  return NextResponse.json({ success: true }, { headers: cors() });
}