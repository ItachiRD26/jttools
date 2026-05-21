// LOCATION: app/api/auth/etsy/stores/route.ts
// GET /api/auth/etsy/stores — returns all connected Etsy shops for the user (dashboard use)
// Auth: Firebase ID token via Authorization: Bearer <idToken>
//
// token_valid        — false if the access token expires in < 5 min (auto-refresh fires on next API call)
// connection_expired — true if a refresh attempt has already failed; user MUST re-link
// expiredAt          — ISO timestamp of when the connection expired (for display/logging)

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebase-admin";
import { getAllStoreConnections } from "@/lib/etsy-oauth";

export async function GET(req: NextRequest) {
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

  const connections = await getAllStoreConnections(uid);
  const now         = new Date();

  const stores = connections.map(c => {
    const expiresAt = c.expiresAt instanceof Date
      ? c.expiresAt
      : (c.expiresAt as { toDate: () => Date })?.toDate?.() ?? new Date(0);

    const token_valid = expiresAt.getTime() - now.getTime() > 5 * 60 * 1000;

    // Resolve expiredAt to an ISO string if it's a Firestore Timestamp
    let expiredAt: string | null = null;
    if (c.expiredAt) {
      if (c.expiredAt instanceof Date) {
        expiredAt = c.expiredAt.toISOString();
      } else if (typeof (c.expiredAt as { toDate?: () => Date }).toDate === "function") {
        expiredAt = (c.expiredAt as { toDate: () => Date }).toDate().toISOString();
      }
    }

    return {
      shopId:             c.shopId,
      shopName:           c.shopName,
      etsyUserId:         c.etsyUserId,
      connectedAt:        c.connectedAt,
      token_valid,
      // When true, the refresh token is dead. Show a reconnect CTA in the dashboard.
      connection_expired: c.connection_expired ?? false,
      expiredAt,
    };
  });

  return NextResponse.json({ stores });
}