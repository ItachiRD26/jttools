// LOCATION: app/api/v1/stores/[shopId]/processing-profiles/live/route.ts
// GET /api/v1/stores/{shopId}/processing-profiles/live
//
// Returns real readiness_state_id values scraped from active listings.
// Etsy v3 requires a shop-specific readiness_state_id on POST /listings create —
// it cannot be set inline via processing_min/max. The ID must exist on that shop.
//
// Use readiness_state_id from this response in shops[0].processing_profile_id.
// JeterDev Tools resolves it automatically when publishing.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  const { shopId } = await params;
  const apiKey     = req.headers.get("x-api-key");
  const auth       = await validateRequest(apiKey, "stores/processing-profiles/live");

  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, shopId);
  } catch {
    return NextResponse.json(
      { error: { code: "STORE_NOT_CONNECTED", status: 403, message: `Shop ${shopId} is not connected.` } },
      { status: 403 }
    );
  }

  // Fetch active listings to extract unique readiness_state_id values
  const res = await fetch(
    `${ETSY_BASE}/application/shops/${shopId}/listings/active?limit=100&fields=listing_id,readiness_state_id,processing_min,processing_max`,
    {
      headers: {
        "x-api-key":     API_KEY(),
        "Authorization": `Bearer ${accessToken}`,
        "Accept":        "application/json",
      },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    let errBody: unknown;
    try { errBody = JSON.parse(errText); } catch { errBody = errText; }
    console.error(`[ProcessingProfiles] Etsy listings fetch failed for shop ${shopId} (${res.status}):`, errBody);
    // Return the real error — do NOT silently fall back to placeholders
    // Placeholders cause "Could not find readiness_state_id" errors at publish time
    return NextResponse.json(
      {
        error: {
          code:    "UPSTREAM_ERROR",
          status:  502,
          message: `Etsy returned ${res.status} when fetching active listings for shop ${shopId}.`,
          details: errBody,
          hint:    res.status === 403
            ? "OAuth scope may be missing. Reconnect the shop at jeterdev.tools/dashboard."
            : "Check that the shop has at least one active listing — processing profiles are derived from listings.",
        },
      },
      { status: 502 }
    );
  }

  const data     = await res.json();
  const listings = data.results ?? [];

  // Deduplicate by readiness_state_id — these are the REAL Etsy IDs for this shop
  const seen = new Map<number, {
    readiness_state_id:            number;
    processing_min:                number;
    processing_max:                number;
    processing_days_display_label: string;
  }>();

  for (const listing of listings) {
    const id  = listing.readiness_state_id;
    const min = listing.processing_min ?? 1;
    const max = listing.processing_max ?? 3;
    if (id && !seen.has(id)) {
      seen.set(id, {
        readiness_state_id:            id,
        processing_min:                min,
        processing_max:                max,
        processing_days_display_label: min === max
          ? `${min} business day${min === 1 ? "" : "s"}`
          : `${min}–${max} business days`,
      });
    }
  }

  const profiles = Array.from(seen.values()).sort((a, b) => a.processing_min - b.processing_min);

  if (profiles.length === 0) {
    // No active listings — cannot derive real readiness_state_ids
    // Do NOT return placeholders — they fail at publish time
    return NextResponse.json({
      shop_id:             shopId,
      fetched_at:          new Date().toISOString(),
      count:               0,
      processing_profiles: [],
      source:              "active_listings",
      warning:             "No active listings found on this shop. Processing profiles are derived from active listings. Create at least one active listing on Etsy first, or pass processing_min/processing_max in your listing payload — JeterDev Tools will derive the readiness_state_id automatically.",
    });
  }

  return NextResponse.json({
    shop_id:             shopId,
    fetched_at:          new Date().toISOString(),
    count:               profiles.length,
    processing_profiles: profiles,
    note: "readiness_state_id is the real Etsy ID. Pass it as shops[0].processing_profile_id when creating listings.",
    source:              "active_listings",
  });
}