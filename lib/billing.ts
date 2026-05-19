// LOCATION: lib/billing.ts
// Billing helpers — plan activation, cancellation, downgrade

import { getDb, Collections } from "./firebase-admin";
import { createApiKey, revokeApiKey } from "./api-auth";
import { sendEmail } from "./mailer";
import { getPlan } from "./plans";
import { FieldValue } from "firebase-admin/firestore";

export interface UserBillingDoc {
  email: string;
  name: string;
  planId: string;
  planStatus: "active" | "past_due" | "free" | "cancelled";
  nextBillingDate?: FirebaseFirestore.Timestamp;
  planActivatedAt?: FirebaseFirestore.Timestamp;
  apiKey?: string;
  paypalSubscriptionId?: string; // antes era paypalOrderId (pago único)
}

// ─── Activate plan after PayPal subscription approval ────────────────────────
export async function activatePlan(uid: string, planId: string, subscriptionId: string) {
  const db = getDb();
  const plan = getPlan(planId);

  // Revocar llaves activas anteriores
  const oldKeys = await db.collection(Collections.API_KEYS)
    .where("userId", "==", uid).where("active", "==", true).get();
  await Promise.all(oldKeys.docs.map((d) => revokeApiKey(d.id)));

  // Nueva API key
  const newApiKey = await createApiKey(uid, planId);

  // Próxima fecha de facturación = 30 días
  const nextBillingDate = new Date();
  nextBillingDate.setDate(nextBillingDate.getDate() + 30);

  await db.collection(Collections.USERS).doc(uid).update({
    planId,
    planStatus: "active",
    apiKey: newApiKey,
    paypalSubscriptionId: subscriptionId, // guardamos el subscriptionId (no el orderId)
    planActivatedAt: FieldValue.serverTimestamp(),
    nextBillingDate,
    // limpiar campos de estado anterior
    pastDueSince: FieldValue.delete(),
    cancelledAt: FieldValue.delete(),
  });

  // Email de confirmación
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

// ─── Cancel plan (user triggered or webhook CANCELLED) ───────────────────────
export async function cancelPlan(uid: string) {
  const db = getDb();
  const userSnap = await db.collection(Collections.USERS).doc(uid).get();
  const user = userSnap.data() as UserBillingDoc;
  const oldPlan = getPlan(user.planId);

  // Revocar llaves actuales y crear llave free
  const oldKeys = await db.collection(Collections.API_KEYS)
    .where("userId", "==", uid).where("active", "==", true).get();
  await Promise.all(oldKeys.docs.map((d) => revokeApiKey(d.id)));
  const freeKey = await createApiKey(uid, "free");

  await db.collection(Collections.USERS).doc(uid).update({
    planId: "free",
    planStatus: "cancelled",
    apiKey: freeKey,
    nextBillingDate: FieldValue.delete(),
    paypalSubscriptionId: FieldValue.delete(),
    cancelledAt: FieldValue.serverTimestamp(),
  });

  await sendEmail({
    type: "plan_cancelled",
    to: user.email,
    name: user.name ?? user.email,
    planName: oldPlan.name,
  });
}

// ─── Downgrade to free (non_payment after grace period) ──────────────────────
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
    paypalSubscriptionId: FieldValue.delete(),
  });

  await sendEmail({
    type: "plan_downgraded",
    to: user.email,
    name: user.name ?? user.email,
    reason,
  });
}