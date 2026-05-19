// LOCATION: app/api/cron/billing/route.ts
// Runs daily at 00:05 UTC via Vercel Cron
//
// Con suscripciones de PayPal, el cobro recurrente lo maneja PayPal
// automáticamente. Este cron solo actúa como red de seguridad para:
//   1. Recordatorio 2 días antes de la renovación
//   2. Downgrade si llevan más de 2 días en past_due
//      (past_due lo setea el webhook BILLING.SUBSCRIPTION.SUSPENDED)

import { NextRequest, NextResponse } from "next/server";
import { getDb, Collections } from "@/lib/firebase-admin";
import { downgradePlan } from "@/lib/billing";
import { sendEmail } from "@/lib/mailer";
import { getPlan } from "@/lib/plans";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const results = { reminded: 0, downgraded: 0, errors: 0 };

  // Solo usuarios pro activos o past_due
  const usersSnap = await db.collection(Collections.USERS)
    .where("planId", "==", "pro")
    .get();

  for (const doc of usersSnap.docs) {
    const user = doc.data();
    const uid = doc.id;

    try {
      // ── Recordatorio 2 días antes ──────────────────────────────────────────
      if (user.planStatus === "active" && user.nextBillingDate) {
        const nextBilling: Date = user.nextBillingDate.toDate();
        const daysUntil = Math.ceil(
          (nextBilling.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntil === 2) {
          const plan = getPlan(user.planId);
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
      }

      // ── Downgrade si lleva >2 días en past_due ─────────────────────────────
      // (PayPal ya suspendió la suscripción y lo notificó via webhook)
      if (user.planStatus === "past_due") {
        const pastDueSince: Date | null = user.pastDueSince?.toDate?.() ?? null;
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