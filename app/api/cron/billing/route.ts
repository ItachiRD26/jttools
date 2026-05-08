// LOCATION: app/api/cron/billing/route.ts
// Runs daily at 00:05 UTC via Vercel Cron
// Checks for overdue payments and downgrades plans

import { NextRequest, NextResponse } from "next/server";
import { getDb, Collections } from "@/lib/firebase-admin";
import { downgradePlan } from "@/lib/billing";
import { sendEmail } from "@/lib/mailer";
import { getPlan } from "@/lib/plans";

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron (or our CRON_SECRET)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const results = { reminded: 0, downgraded: 0, errors: 0 };

  // Get all paid users
  const usersSnap = await db.collection(Collections.USERS)
    .where("planId", "in", ["starter", "pro"])
    .get();

  for (const doc of usersSnap.docs) {
    const user = doc.data();
    const uid = doc.id;
    const nextBilling: Date = user.nextBillingDate?.toDate?.() ?? null;

    if (!nextBilling) continue;

    const plan = getPlan(user.planId);
    const daysUntilBilling = Math.ceil((nextBilling.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    try {
      // ── 2 days before: send reminder ──────────────────────────────────────
      if (daysUntilBilling === 2 && user.planStatus === "active") {
        await sendEmail({
          type: "renewal_reminder",
          to: user.email,
          name: user.name ?? user.email,
          planName: plan.name,
          amount: plan.price,
          billingDate: nextBilling.toISOString(),
        });
        results.reminded++;
      }

      // ── Billing date passed: mark as past_due + send warning ──────────────
      if (daysUntilBilling <= 0 && user.planStatus === "active") {
        await db.collection(Collections.USERS).doc(uid).update({
          planStatus: "past_due",
          pastDueSince: now,
        });
        await sendEmail({
          type: "renewal_past_due",
          to: user.email,
          name: user.name ?? user.email,
          planName: plan.name,
          amount: plan.price,
        });
      }

      // ── 2 days past due: downgrade to free ────────────────────────────────
      if (user.planStatus === "past_due") {
        const pastDueSince: Date = user.pastDueSince?.toDate?.() ?? null;
        if (pastDueSince && pastDueSince <= twoDaysAgo) {
          await downgradePlan(uid, "non_payment");
          results.downgraded++;
        }
      }

    } catch (err) {
      console.error(`[Cron] Error processing user ${uid}:`, err);
      results.errors++;
    }
  }

  console.log(`[Cron] Billing run complete:`, results);
  return NextResponse.json({ ok: true, ...results });
}