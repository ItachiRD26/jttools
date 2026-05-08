// LOCATION: app/api/auth/etsy/disconnect/route.ts
// POST /api/auth/etsy/disconnect

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebase-admin";
import { disconnectEtsy } from "@/lib/etsy-oauth";

export async function POST(req: NextRequest) {
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

  await disconnectEtsy(uid);

  // Update user doc
  const { getDb } = await import("@/lib/firebase-admin");
  await getDb().collection("users").doc(uid).update({
    etsyConnected: false,
    etsyShopId:    null,
    etsyShopName:  null,
  });

  return NextResponse.json({ success: true });
}