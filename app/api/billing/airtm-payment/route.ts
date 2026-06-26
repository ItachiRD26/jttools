// LOCATION: app/api/billing/airtm-payment/route.ts
// POST /api/billing/airtm-payment
// User uploads a screenshot of their AirTM payment. Stored privately in
// Firebase Storage, plan is activated immediately (no manual review).

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getAdminApp, getDb, Collections } from "@/lib/firebase-admin";
import { activatePlan } from "@/lib/billing";
import { getPlan, PLANS } from "@/lib/plans";
import { sendEmail } from "@/lib/mailer";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB — stay under Vercel's serverless body limit

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  let email: string;
  try {
    getAdminApp();
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    uid   = decoded.uid;
    email = decoded.email ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("proof");
  const planId = (formData?.get("planId") as string) || "pro";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing proof image" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Image too large (max 4MB)" }, { status: 400 });
  }
  if (!(planId in PLANS) || planId === "free") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.type.split("/")[1] || "jpg";
  const path = `payment_proofs/${uid}/${Date.now()}_${randomUUID()}.${ext}`;

  const bucket = getStorage().bucket();
  await bucket.file(path).save(buffer, { contentType: file.type });

  const newApiKey = await activatePlan(uid, planId, path, "airtm");

  const userSnap = await getDb().collection(Collections.USERS).doc(uid).get();
  const name = userSnap.data()?.name ?? email.split("@")[0];

  const plan = getPlan(planId);
  const nextBillingDate = new Date();
  nextBillingDate.setDate(nextBillingDate.getDate() + 30);
  await sendEmail({
    type:            "plan_activated",
    to:              email,
    name,
    planName:        plan.name,
    amount:          plan.price,
    nextBillingDate: nextBillingDate.toISOString(),
  });

  return NextResponse.json({ success: true, apiKey: newApiKey });
}
