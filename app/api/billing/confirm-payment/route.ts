// LOCATION: app/api/billing/confirm-payment/route.ts
// Solo para usuarios con manualBilling: true — reinicia el ciclo 30 días

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getDb, Collections } from "@/lib/firebase-admin";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let uid: string;
  try {
    uid = (await getAuth().verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const userSnap = await db.collection(Collections.USERS).doc(uid).get();
  const user = userSnap.data();

  if (!user?.manualBilling) {
    return NextResponse.json({ error: "Not a manual billing account" }, { status: 403 });
  }

  const nextBillingDate = new Date();
  nextBillingDate.setDate(nextBillingDate.getDate() + 30);

  await db.collection(Collections.USERS).doc(uid).update({
    nextBillingDate,
    planStatus: "active",
  });

  return NextResponse.json({ ok: true, nextBillingDate: nextBillingDate.toISOString() });
}
