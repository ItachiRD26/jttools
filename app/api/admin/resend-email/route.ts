// LOCATION: app/api/admin/resend-email/route.ts
// POST /api/admin/resend-email
// Resends a billing email to a user. Requires x-admin-secret header.
// Body: { uid: string, type: "plan_activated" | "welcome" }

import { NextRequest, NextResponse } from "next/server";
import { getDb, Collections } from "@/lib/firebase-admin";
import { sendEmail } from "@/lib/mailer";
import { getPlan } from "@/lib/plans";

function isAdmin(req: NextRequest): boolean {
  return req.headers.get("x-admin-secret") === process.env.ADMIN_SECRET;
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { uid, type = "plan_activated" } = await req.json();
  if (!uid) {
    return NextResponse.json({ error: "uid required" }, { status: 400 });
  }

  const db       = getDb();
  const userSnap = await db.collection(Collections.USERS).doc(uid).get();

  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const user = userSnap.data()!;
  const plan = getPlan(user.planId);

  let sent: boolean;

  if (type === "welcome") {
    sent = await sendEmail({ type: "welcome", to: user.email, name: user.name });
  } else {
    const nextBillingDate = user.nextBillingDate?.toDate?.()?.toISOString()
      ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    sent = await sendEmail({
      type:            "plan_activated",
      to:              user.email,
      name:            user.name,
      planName:        plan.name,
      amount:          plan.price,
      nextBillingDate,
    });
  }

  return NextResponse.json({ sent, email: user.email, type });
}
