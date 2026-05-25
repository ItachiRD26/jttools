// LOCATION: app/api/cron/refresh-tokens/route.ts
// Runs hourly via Vercel Cron. Iterates every connected shop and proactively
// refreshes any access token that's within 90 minutes of expiry. Also retries
// a single recovery refresh on shops marked connection_expired if their last
// attempt was >1h ago — gives transient-failure-flagged shops a chance to
// self-heal without forcing the user to reconnect.
//
// Why proactive: on-demand-only refresh leaves tokens stale for shops that
// aren't actively being hit. Etsy refresh tokens expire after 90 days of
// disuse, so exercising them regularly keeps the connection alive even when
// the user isn't publishing. Also: a transient refresh failure parks the
// shop in connection_expired state until something pokes it — the cron is
// what pokes it, so the user doesn't have to.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

// Refresh anything expiring within this window. Cron runs hourly so we need
// at least 60min headroom; 90min gives a buffer for cron skew / late runs.
const PROACTIVE_REFRESH_WINDOW_MS = 90 * 60 * 1000;

export async function GET(req: NextRequest) {
  // Auth: only Vercel Cron (with CRON_SECRET) can hit this
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db    = getDb();
  const start = Date.now();

  const results = {
    checked:           0,
    refreshed:         0,
    skippedFresh:      0,  // token still has plenty of life
    skippedExpired:    0,  // marked expired AND cooldown not elapsed
    recoveryAttempted: 0,  // marked expired but cooldown elapsed → tried again
    recoverySucceeded: 0,
    failed:            0,
    failedShops:       [] as Array<{ userId: string; shopId: string; error: string }>,
  };

  // Walk every user's etsyConnections/{userId}/shops/* subcollection. The
  // top-level etsyConnections collection has one parent doc per user; we
  // iterate via listDocuments() rather than .get() so empty parent docs are
  // still discovered (per Firestore behavior).
  const userDocs = await db.collection("etsyConnections").listDocuments();

  for (const userDoc of userDocs) {
    const userId   = userDoc.id;
    const shopsSnap = await userDoc.collection("shops").get();

    for (const shopDoc of shopsSnap.docs) {
      const shopId = shopDoc.id;
      const data   = shopDoc.data();
      results.checked++;

      const expiresAt = data.expiresAt?.toDate?.() as Date | undefined;
      const timeToExpiry = expiresAt ? expiresAt.getTime() - Date.now() : -1;
      const isMarkedExpired = data.connection_expired === true;

      // Fresh enough — skip
      if (!isMarkedExpired && timeToExpiry >= PROACTIVE_REFRESH_WINDOW_MS) {
        results.skippedFresh++;
        continue;
      }

      // Marked expired AND last attempt < 1h ago — getValidAccessToken would
      // throw immediately; no point calling it. Counts as "skipped" for
      // observability (these are shops genuinely needing user reconnect).
      if (isMarkedExpired) {
        const lastAttempt = data.lastRefreshAttemptAt?.toDate?.() as Date | undefined;
        const sinceLast   = lastAttempt ? Date.now() - lastAttempt.getTime() : Infinity;
        if (sinceLast < 60 * 60 * 1000) {
          results.skippedExpired++;
          continue;
        }
        results.recoveryAttempted++;
      }

      try {
        await getValidAccessToken(userId, shopId);
        results.refreshed++;
        if (isMarkedExpired) results.recoverySucceeded++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.failed++;
        results.failedShops.push({ userId, shopId, error: errMsg });
        // Don't throw — keep iterating so one bad shop doesn't stop the cron
      }
    }
  }

  const elapsedMs = Date.now() - start;
  console.log(`[cron:refresh-tokens] done in ${elapsedMs}ms:`, results);

  return NextResponse.json({ ...results, elapsedMs });
}
