// LOCATION: app/api/v1/stores/[shopId]/processing-profiles/live/route.ts
// GET /api/v1/stores/{shopId}/processing-profiles/live
//
// Processing profiles = unique {processing_min, processing_max} combinations
// used across active listings. Etsy has no standalone "processing profiles"
// endpoint — these are derived by scanning active listings and deduplicating.
//
// NOTE: Production partners (external manufacturers) are a separate concept.
// See GET /stores/{shopId}/production-partners/live for those.

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

  // Fetch active listings to extract unique processing time combinations.
  // Etsy has no standalone "processing profiles" endpoint — we derive them.
  const res = await fetch(
    `${ETSY_BASE}/application/shops/${shopId}/listings/active?limit=100&fields=listing_id,processing_min,processing_max`,
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
    return NextResponse.json(
      {
        error: {
          code:    "UPSTREAM_ERROR",
          status:  502,
          message: `Etsy listings fetch failed (${res.status}).`,
          details: errBody,
        },
      },
      { status: 502 }
    );
  }

  const data     = await res.json();
  const listings = data.results ?? [];

  // Deduplicate processing time combinations
  const seen = new Set<string>();
  const profiles: {
    processing_profile_id: string;
    processing_min: number;
    processing_max: number;
    processing_days_display_label: string;
  }[] = [];

  for (const listing of listings) {
    const min = listing.processing_min ?? 1;
    const max = listing.processing_max ?? 3;
    const key = `${min}-${max}`;

    if (!seen.has(key)) {
      seen.add(key);
      profiles.push({
        // Synthetic ID — stable key for this min/max combination
        processing_profile_id:         key,
        processing_min:                 min,
        processing_max:                 max,
        processing_days_display_label:  min === max
          ? `${min} business day${min === 1 ? "" : "s"}`
          : `${min}–${max} business days`,
      });
    }
  }

  // Sort by processing_min
  profiles.sort((a, b) => a.processing_min - b.processing_min);

  return NextResponse.json({
    shop_id:             shopId,
    fetched_at:          new Date().toISOString(),
    count:               profiles.length,
    processing_profiles: profiles,
    note: "Derived from active listings. Use processing_min and processing_max when creating listings — Etsy does not have a standalone processing profiles endpoint.",
  });
}