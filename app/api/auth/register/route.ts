// LOCATION: app/api/auth/register/route.ts
// Creates the Firestore user doc for a newly registered account.
// Called from the client immediately after Firebase Auth account creation.

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminApp, getDb, Collections } from "@/lib/firebase-admin";
import { createApiKey } from "@/lib/api-auth";
import { sendEmail } from "@/lib/mailer";

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

  const body = await req.json().catch(() => ({}));
  const name = (body.name as string | undefined) ?? email.split("@")[0];

  const db      = getDb();
  const userRef = db.collection(Collections.USERS).doc(uid);
  const snap    = await userRef.get();

  if (snap.exists) {
    return NextResponse.json({ error: "already_registered" }, { status: 409 });
  }

  const apiKey = await createApiKey(uid, "free");

  await userRef.set({
    email,
    name,
    planId:     "free",
    planStatus: "free",
    apiKey,
    createdAt:  FieldValue.serverTimestamp(),
  });

  await sendEmail({ type: "welcome", to: email, name });

  return NextResponse.json({ success: true });
}
