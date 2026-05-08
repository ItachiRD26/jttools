// ─────────────────────────────────────────────
//  POST /api/dashboard/generate-key
//  Called by logged-in users from the dashboard.
//  Verifies Firebase ID token, creates key in Firestore.
// ─────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp, getDb, Collections } from "@/lib/firebase-admin";
import { createApiKey } from "@/lib/api-auth";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  // 1. Verify Firebase ID token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  let uid: string;

  try {
    getAdminApp();
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const db = getDb();

  // 2. Get user's current plan
  const userSnap = await db.collection(Collections.USERS).doc(uid).get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { planId = "free" } = userSnap.data()!;

  // 3. Check if user already has an active key — revoke it first
  const existingKeys = await db
    .collection(Collections.API_KEYS)
    .where("userId", "==", uid)
    .where("active", "==", true)
    .get();

  const batch = db.batch();
  existingKeys.docs.forEach((d) => batch.update(d.ref, { active: false }));
  await batch.commit();

  // 4. Create new key
  const apiKey = await createApiKey(uid, planId);

  // 5. Store key reference on user doc
  await db.collection(Collections.USERS).doc(uid).update({
    apiKey,
    keyGeneratedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ apiKey });
}