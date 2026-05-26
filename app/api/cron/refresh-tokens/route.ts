// LOCATION: app/api/cron/refresh-tokens/route.ts
// Runs hourly via Vercel Cron. Refreshes every shop whose access token is
// within PROACTIVE_REFRESH_WINDOW_MS of expiry (or already expired), plus
// transient-failure shops that have served their recovery cooldown.
//
// Why proactive: on-demand-only refresh leaves tokens stale for shops that
// aren't actively being hit. Etsy refresh tokens expire after 90 days of
// disuse, so exercising them regularly keeps the connection alive even when
// the user isn't publishing. The cron also gives transient-failure-flagged
// shops a chance to self-heal without forcing a user reconnect.
//
// Scale: at 1500+ shops the original sequential per-user/per-shop loop would
// blow the Vercel function timeout. We now do a single collectionGroup query
// to fetch only candidates, then refresh in parallel batches of 8 (Etsy's
// per-app token endpoint is rate-limited at ~10 req/s, so 8 leaves headroom).

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

// Refresh anything expiring within this window. Cron runs hourly so we need
// at least 60min headroom; 90min gives a buffer for cron skew / late runs.
const PROACTIVE_REFRESH_WINDOW_MS = 90 * 60 * 1000;

// Max time a single shop should sit in connection_expired before the cron
// retries it. Matches EXPIRED_RECOVERY_INTERVAL_MS in lib/etsy-oauth.ts.
const RECOVERY_COOLDOWN_MS = 60 * 60 * 1000;

// Parallel batch size. Etsy's OAuth token endpoint is rate-limited per app
// at ~10 req/s; 8 leaves a small safety margin for clock skew + retries.
const BATCH_CONCURRENCY = 8;

// Vercel Pro max function duration. At ~500ms per shop refresh and 8-way
// parallelism, 300s covers ~4800 shops per run — well past current needs.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Auth: only Vercel Cron (with CRON_SECRET) can hit this
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db    = getDb();
  const start = Date.now();

  const results = {
    candidates:        0,  // total shops the query returned
    refreshed:         0,
    skippedExpired:    0,  // marked expired AND cooldown not elapsed
    recoveryAttempted: 0,  // marked expired but cooldown elapsed → tried again
    recoverySucceeded: 0,
    failed:            0,
    failedShops:       [] as Array<{ shopId: string; error: string }>,
  };

  // Single collectionGroup query — returns only shops within the refresh
  // window (already expired or expiring soon). Skips the N+1 per-user
  // listDocuments() iteration of the old code.
  //
  // Marked-expired shops have expiresAt in the past (their refresh failed
  // when the token was already near death), so this query catches them too.
  const cutoff = new Date(Date.now() + PROACTIVE_REFRESH_WINDOW_MS);
  const snap   = await db
    .collectionGroup("shops")
    .where("expiresAt", "<", cutoff)
    .get();

  results.candidates = snap.docs.length;

  // Build the work list, filtering out expired shops still in cooldown.
  type Candidate = { userId: string; shopId: string; wasExpired: boolean };
  const work: Candidate[] = [];

  for (const doc of snap.docs) {
    const data         = doc.data();
    const userId       = doc.ref.parent.parent?.id;
    const shopId       = doc.id;
    if (!userId) continue; // defensive — shouldn't happen given the path shape

    const isMarkedExpired = data.connection_expired === true;

    if (isMarkedExpired) {
      const lastAttempt = data.lastRefreshAttemptAt?.toDate?.() as Date | undefined;
      const sinceLast   = lastAttempt ? Date.now() - lastAttempt.getTime() : Infinity;
      if (sinceLast < RECOVERY_COOLDOWN_MS) {
        results.skippedExpired++;
        continue;
      }
      results.recoveryAttempted++;
    }

    work.push({ userId, shopId, wasExpired: isMarkedExpired });
  }

  // Process in parallel batches. Promise.allSettled so one bad shop doesn't
  // halt the batch; the for-loop bounds total in-flight to BATCH_CONCURRENCY.
  for (let i = 0; i < work.length; i += BATCH_CONCURRENCY) {
    const batch = work.slice(i, i + BATCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(c => getValidAccessToken(c.userId, c.shopId, { force: true })),
    );
    settled.forEach((res, idx) => {
      const c = batch[idx];
      if (res.status === "fulfilled") {
        results.refreshed++;
        if (c.wasExpired) results.recoverySucceeded++;
      } else {
        const errMsg = res.reason instanceof Error ? res.reason.message : String(res.reason);
        results.failed++;
        // Log shopId only — keeps failedShops scrubbed of userId so
        // Vercel logs don't carry tenant→shop linkage.
        results.failedShops.push({ shopId: c.shopId, error: errMsg });
      }
    });
  }

  const elapsedMs = Date.now() - start;
  console.log(`[cron:refresh-tokens] done in ${elapsedMs}ms:`, results);

  return NextResponse.json({ ...results, elapsedMs });
}
