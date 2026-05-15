// LOCATION: app/api/v1/stores/route.ts
// GET /api/v1/stores
// Returns all Etsy shops connected to this API key

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "stores/list");

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  if (!userId) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", status: 500, message: "Could not identify user." } },
      { status: 500 }
    );
  }

  const shopsSnap = await db
    .collection("etsyConnections")
    .doc(userId)
    .collection("shops")
    .get();

  const stores = shopsSnap.docs.map(doc => {
    const data = doc.data();
    const expiresAt: Date = data.expiresAt?.toDate?.() ?? new Date(0);
    return {
      shop_id:      data.shopId,
      shop_name:    data.shopName,
      etsy_user_id: data.etsyUserId,
      is_connected: true,
      token_valid:  expiresAt > new Date(),
      connected_at: data.connectedAt?.toDate?.()?.toISOString() ?? null,
    };
  });

  return NextResponse.json({
    count:  stores.length,
    stores,
  });
}