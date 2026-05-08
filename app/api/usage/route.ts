// ─────────────────────────────────────────────
//  JT Tools — Public Usage Check
//  GET /api/usage
//  Returns current day usage for the provided API key
// ─────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getDb, Collections } from "@/lib/firebase-admin";
import { getPlan } from "@/lib/plans";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing x-api-key header" },
      { status: 401 }
    );
  }

  const db = getDb();
  const keySnap = await db.collection(Collections.API_KEYS).doc(apiKey).get();

  if (!keySnap.exists || !keySnap.data()?.active) {
    return NextResponse.json({ error: "Invalid or disabled API key" }, { status: 401 });
  }

  const { planId } = keySnap.data()!;
  const plan = getPlan(planId);

  const today = new Date().toISOString().slice(0, 10);
  const usageSnap = await db
    .collection(Collections.USAGE)
    .doc(apiKey)
    .collection("daily")
    .doc(today)
    .get();

  const used = usageSnap.exists ? (usageSnap.data()?.count ?? 0) : 0;
  const remaining = Math.max(0, plan.dailyLimit - used);

  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);

  return NextResponse.json({
    plan: plan.id,
    dailyLimit: plan.dailyLimit,
    used,
    remaining,
    resetsAt: midnight.toISOString(),
    allowedEndpoints: plan.allowedEndpoints,
  });
}