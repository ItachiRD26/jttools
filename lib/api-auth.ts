// ─────────────────────────────────────────────
//  JT Tools — Auth & Rate Limit
// ─────────────────────────────────────────────
import { getDb, Collections } from "./firebase-admin";
import { getPlan, isEndpointAllowed, Plan } from "./plans";
import { FieldValue } from "firebase-admin/firestore";

// ─── Types ──────────────────────────────────

export interface ApiKeyDoc {
  userId: string;
  planId: string;
  active: boolean;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface ApiError {
  code: string;
  status: number;
  message: string;
  hint?: string;
  docs?: string;
}

export type AuthResult =
  | { ok: true;  userId: string; plan: Plan; remaining: number }
  | { ok: false; status: 401 | 403 | 429; error: ApiError };

// ─── Main validate + rate-limit function ────

export async function validateRequest(
  apiKey: string | null,
  endpoint: string   // e.g. "listings/search"
): Promise<AuthResult> {
  const db = getDb();

  // 1. Require API key
  if (!apiKey) {
    return { ok: false, status: 401, error: {
      code: "MISSING_API_KEY",
      status: 401,
      message: "No API key provided.",
      hint: "Pass your key via the x-api-key header.",
      docs: "https://jeterdev.tools/docs#authentication"
    }};
  }

  // 2. Look up key document
  const keyRef = db.collection(Collections.API_KEYS).doc(apiKey);
  const keySnap = await keyRef.get();

  if (!keySnap.exists) {
    return { ok: false, status: 401, error: {
      code: "INVALID_API_KEY",
      status: 401,
      message: "Your API key is missing, invalid, or has been revoked.",
      hint: "Generate a new key at jeterdev.tools/dashboard.",
      docs: "https://jeterdev.tools/docs#authentication"
    }};
  }

  const keyDoc = keySnap.data() as ApiKeyDoc;

  if (!keyDoc.active) {
    return { ok: false, status: 403, error: {
      code: "API_KEY_DISABLED",
      status: 403,
      message: "This API key has been disabled.",
      hint: "Generate a new key at jeterdev.tools/dashboard.",
      docs: "https://jeterdev.tools/docs#authentication"
    }};
  }

  // 3. Resolve plan
  const plan = getPlan(keyDoc.planId);

  // 4. Check endpoint permission
  if (!isEndpointAllowed(plan, endpoint)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: "ENDPOINT_NOT_IN_PLAN",
        status: 403,
        message: `Endpoint '${endpoint}' is not available on the ${plan.name} plan.`,
        hint: `Upgrade to access this endpoint at jeterdev.tools/pricing.`,
        docs: "https://jeterdev.tools/docs#rate-limits"
      }
    };
  }

  // 5. Rate-limit: daily counter in Firestore
  const today = getTodayKey(); // "2025-01-15"
  const usageRef = db
    .collection(Collections.USAGE)
    .doc(apiKey)
    .collection("daily")
    .doc(today);

  const result = await db.runTransaction(async (tx) => {
    const usageSnap = await tx.get(usageRef);
    const currentCount: number = usageSnap.exists
      ? (usageSnap.data()?.count ?? 0)
      : 0;

    if (currentCount >= plan.dailyLimit) {
      return { allowed: false, count: currentCount };
    }

    tx.set(
      usageRef,
      { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { allowed: true, count: currentCount + 1 };
  });

  if (!result.allowed) {
    return {
      ok: false,
      status: 429,
      error: {
        code: "RATE_LIMIT_DAILY",
        status: 429,
        message: `Daily request limit reached (${plan.dailyLimit}/day).`,
        hint: "Limit resets at midnight UTC.",
        docs: "https://jeterdev.tools/docs#rate-limits"
      }
    };
  }

  return {
    ok: true,
    userId: keyDoc.userId,
    plan,
    remaining: plan.dailyLimit - result.count,
  };
}

// ─── Helpers ────────────────────────────────

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ─── API Key Management ──────────────────────

import { randomBytes } from "crypto";

/** Generates a new API key for a user and stores it in Firestore. */
export async function createApiKey(userId: string, planId: string): Promise<string> {
  const db = getDb();
  const key = "jt_" + randomBytes(24).toString("hex"); // e.g. jt_a3f...

  await db.collection(Collections.API_KEYS).doc(key).set({
    userId,
    planId,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  return key;
}

/** Revokes a key (soft delete). */
export async function revokeApiKey(apiKey: string): Promise<void> {
  const db = getDb();
  await db.collection(Collections.API_KEYS).doc(apiKey).update({ active: false });
}

/** Returns today's usage count for a key. */
export async function getDailyUsage(apiKey: string): Promise<number> {
  const db = getDb();
  const today = getTodayKey();
  const snap = await db
    .collection(Collections.USAGE)
    .doc(apiKey)
    .collection("daily")
    .doc(today)
    .get();
  return snap.exists ? (snap.data()?.count ?? 0) : 0;
}