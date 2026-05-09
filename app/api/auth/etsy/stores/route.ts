// LOCATION: app/api/auth/etsy/stores/route.ts
// GET /api/auth/etsy/stores — returns all connected Etsy shops for the user

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

  // Return only safe fields — never expose tokens to the client
  const stores = connections.map(c => ({
    shopId:     c.shopId,
    shopName:   c.shopName,
    etsyUserId: c.etsyUserId,
    connectedAt: c.connectedAt,
  }));

  return NextResponse.json({ stores });
}