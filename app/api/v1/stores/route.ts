// LOCATION: app/api/debug/stores/route.ts
// TEMPORARY — remove after debugging
// GET /api/debug/stores?uid=USER_UID

import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getDb } from "@/lib/firebase-admin";
import { getAuth } from "firebase-admin/auth";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  getAdminApp();
  const db = getDb();

  // Get all users with etsy connections
  const connectionsSnap = await db.collection("etsyConnections").get();
  const results = [];

  for (const userDoc of connectionsSnap.docs) {
    const userId = userDoc.id;
    const shopsSnap = await db
      .collection("etsyConnections")
      .doc(userId)
      .collection("shops")
      .get();

    for (const shopDoc of shopsSnap.docs) {
      const data = shopDoc.data();
      const expiresAt = data.expiresAt?.toDate?.() ?? null;
      const now = new Date();

      results.push({
        userId,
        shopId:       data.shopId,
        shopName:     data.shopName,
        etsyUserId:   data.etsyUserId,
        hasAccessToken:  !!data.accessToken,
        hasRefreshToken: !!data.refreshToken,
        expiresAt:    expiresAt?.toISOString(),
        isExpired:    expiresAt ? expiresAt < now : null,
        expiresInMin: expiresAt ? Math.round((expiresAt.getTime() - now.getTime()) / 60000) : null,
        connectedAt:  data.connectedAt?.toDate?.()?.toISOString(),
      });
    }
  }

  // Also check apiKeys to verify userId mapping
  const apiKeysSnap = await db.collection("apiKeys")
    .where("active", "==", true).limit(5).get();
  const apiKeys = apiKeysSnap.docs.map(d => ({
    key:    d.id.slice(0, 10) + "...",
    userId: d.data().userId,
    planId: d.data().planId,
  }));

  return NextResponse.json({ stores: results, apiKeys });
}