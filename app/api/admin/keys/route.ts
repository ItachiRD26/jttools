// ─────────────────────────────────────────────
//  JT Tools — Admin API: Key Management
//  Routes under /api/admin/keys
//  Protected by ADMIN_SECRET env variable
// ─────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createApiKey, revokeApiKey, getDailyUsage } from "@/lib/api-auth";
import { getDb, Collections } from "@/lib/firebase-admin";
import { PLANS } from "@/lib/plans";

// ─── Admin auth guard ────────────────────────

function isAdmin(req: NextRequest): boolean {
  const secret = req.headers.get("x-admin-secret");
  return secret === process.env.ADMIN_SECRET;
}

// ─── POST /api/admin/keys — Create a new key ─

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId, planId } = await req.json();

  if (!userId || !planId) {
    return NextResponse.json(
      { error: "userId and planId are required" },
      { status: 400 }
    );
  }

  if (!PLANS[planId as keyof typeof PLANS]) {
    return NextResponse.json(
      { error: `Invalid planId. Valid plans: ${Object.keys(PLANS).join(", ")}` },
      { status: 400 }
    );
  }

  const apiKey = await createApiKey(userId, planId);

  return NextResponse.json({ apiKey, userId, planId }, { status: 201 });
}

// ─── GET /api/admin/keys?userId=… — List keys ─

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = req.nextUrl.searchParams.get("userId");
  const db = getDb();

  let query = db.collection(Collections.API_KEYS) as FirebaseFirestore.Query;
  if (userId) {
    query = query.where("userId", "==", userId);
  }

  const snap = await query.get();
  const keys = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data();
      const usage = await getDailyUsage(doc.id);
      const plan = PLANS[data.planId as keyof typeof PLANS];
      return {
        apiKey: doc.id,
        userId: data.userId,
        planId: data.planId,
        active: data.active,
        createdAt: data.createdAt?.toDate?.()?.toISOString(),
        todayUsage: usage,
        dailyLimit: plan?.dailyLimit ?? 0,
      };
    })
  );

  return NextResponse.json({ keys });
}