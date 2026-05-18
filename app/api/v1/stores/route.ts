// LOCATION: app/api/auth/etsy/stores/route.ts
// GET /api/auth/etsy/stores — returns all connected Etsy shops for the user
// Includes token_valid so dashboard can show reconnect button when expired

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

    // Token is valid if it expires more than 5 minutes from now
    const token_valid = expiresAt.getTime() - now.getTime() > 5 * 60 * 1000;

    return {
      shopId:      c.shopId,
      shopName:    c.shopName,
      etsyUserId:  c.etsyUserId,
      connectedAt: c.connectedAt,
      token_valid,
    };
  });

  return NextResponse.json({ stores });
}