// LOCATION: lib/billing.ts
// Billing helpers — plan activation, cancellation, downgrade

import { getDb, Collections } from "./firebase-admin";
import { createApiKey, revokeApiKey } from "./api-auth";
import { sendEmail } from "./mailer";
import { PLANS, getPlan } from "./plans";
import { FieldValue } from "firebase-admin/firestore";

export interface UserBillingDoc {
  email: string;
  name: string;
  planId: string;
  planStatus: "active" | "past_due" | "free" | "cancelled";
  nextBillingDate?: FirebaseFirestore.Timestamp;
  planActivatedAt?: FirebaseFirestore.Timestamp;
  apiKey?: string;
}

// ─── Activate plan after PayPal payment ──────────────────────────────────────
export async function activatePlan(uid: string, planId: string, orderId: string) {
  const db = getDb();
  const plan = getPlan(planId);

  // Revoke old keys
  const oldKeys = await db.collection(Collections.API_KEYS)
    .where("userId", "==", uid).where("active", "==", true).get();
  await Promise.all(oldKeys.docs.map((d) => revokeApiKey(d.id)));

  // New key
  const newApiKey = await createApiKey(uid, planId);

  // Next billing = 30 days from now
  const nextBillingDate = new Date();
  nextBillingDate.setDate(nextBillingDate.getDate() + 30);

  await db.collection(Collections.USERS).doc(uid).update({
    planId,
    planStatus: "active",
    apiKey: newApiKey,
    paypalOrderId: orderId,
    planActivatedAt: FieldValue.serverTimestamp(),
    nextBillingDate,
  });

  // Send confirmation email
  const userSnap = await db.collection(Collections.USERS).doc(uid).get();
  const user = userSnap.data() as UserBillingDoc;
  await sendEmail({
    type: "plan_activated",
    to: user.email,
    name: user.name ?? user.email,
    planName: plan.name,
    amount: plan.price,
    nextBillingDate: nextBillingDate.toISOString(),
  });

  return newApiKey;
}

// ─── Cancel plan (user triggered) ────────────────────────────────────────────
export async function cancelPlan(uid: string) {
  const db = getDb();
  const userSnap = await db.collection(Collections.USERS).doc(uid).get();
  const user = userSnap.data() as UserBillingDoc;
  const oldPlan = getPlan(user.planId);

  // Revoke current keys and create free key
  const oldKeys = await db.collection(Collections.API_KEYS)
    .where("userId", "==", uid).where("active", "==", true).get();
  await Promise.all(oldKeys.docs.map((d) => revokeApiKey(d.id)));
  const freeKey = await createApiKey(uid, "free");

  await db.collection(Collections.USERS).doc(uid).update({
    planId: "free",
    planStatus: "free",
    apiKey: freeKey,
    nextBillingDate: FieldValue.delete(),
    cancelledAt: FieldValue.serverTimestamp(),
  });

  await sendEmail({
    type: "plan_cancelled",
    to: user.email,
    name: user.name ?? user.email,
    planName: oldPlan.name,
  });
}

// ─── Downgrade to free (non-payment) ─────────────────────────────────────────
export async function downgradePlan(uid: string, reason: "non_payment" | "cancelled") {
  const db = getDb();
  const userSnap = await db.collection(Collections.USERS).doc(uid).get();
  const user = userSnap.data() as UserBillingDoc;

  const oldKeys = await db.collection(Collections.API_KEYS)
    .where("userId", "==", uid).where("active", "==", true).get();
  await Promise.all(oldKeys.docs.map((d) => revokeApiKey(d.id)));
  const freeKey = await createApiKey(uid, "free");

  await db.collection(Collections.USERS).doc(uid).update({
    planId: "free",
    planStatus: "free",
    apiKey: freeKey,
    nextBillingDate: FieldValue.delete(),
  });

  await sendEmail({
    type: "plan_downgraded",
    to: user.email,
    name: user.name ?? user.email,
    reason,
  });
}