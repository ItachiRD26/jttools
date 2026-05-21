// LOCATION: app/api/v1/stores/[shopId]/processing-profiles/live/route.ts
// GET /api/v1/stores/{shopId}/processing-profiles/live
//
// Fetches processing profiles directly from the Etsy API using the official
// GET /v3/application/shops/{shop_id}/readiness-state-definitions endpoint
// (tag: "Shop ProcessingProfiles", scope: shops_r — already in ETSY_SCOPES).
//
// These profiles exist independently of listings and represent the processing
// times configured in the seller's Etsy dashboard.
//
// Use readiness_state_id from the results as shops[0].processing_profile_id
// when creating listings. JeterDev Tools resolves it automatically on publish.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import {
  getValidAccessToken,
  StoreNotConnectedError,
  StoreTokenExpiredError,
} from "@/lib/etsy-oauth";

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
  } catch (err) {
    if (err instanceof StoreTokenExpiredError) {
      return NextResponse.json(
        {
          error: {
            code:              "STORE_TOKEN_EXPIRED",
            status:            403,
            message:           `Shop ${shopId} OAuth token has expired and could not be refreshed. Re-link the shop to restore access.`,
            connection_expired: true,
            hint:              "Re-connect the shop at jeterdev.tools/dashboard.",
          },
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      {
        error: {
          code:    "STORE_NOT_CONNECTED",
          status:  403,
          message: `Shop ${shopId} is not connected.`,
          hint:    "Connect the shop at jeterdev.tools/dashboard.",
        },
      },
      { status: 403 }
    );
  }

  // ── Hit the real Etsy endpoint for processing profiles ───────────────────
  const res = await fetch(
    `${ETSY_BASE}/application/shops/${shopId}/readiness-state-definitions?limit=100`,
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
    console.error(
      `[ProcessingProfiles] Etsy readiness-state-definitions failed for shop ${shopId} (${res.status}):`,
      errBody
    );
    return NextResponse.json(
      {
        error: {
          code:    "UPSTREAM_ERROR",
          status:  502,
          message: `Etsy returned ${res.status} when fetching processing profiles for shop ${shopId}.`,
          details: errBody,
          hint:    res.status === 401 || res.status === 403
            ? "OAuth scope may be missing (shops_r required). Reconnect the shop at jeterdev.tools/dashboard."
            : undefined,
        },
      },
      { status: 502 }
    );
  }

  const data     = await res.json();
  const profiles = (data.results ?? []) as Array<{
    readiness_state_id:            number;
    readiness_state:               string;
    min_processing_days:           number;
    max_processing_days:           number;
    processing_days_display_label: string;
    shop_id:                       number;
  }>;

  return NextResponse.json({
    shop_id:             shopId,
    fetched_at:          new Date().toISOString(),
    count:               profiles.length,
    processing_profiles: profiles,
    source:              "readiness_state_definitions",
    note:                "readiness_state_id is the real Etsy ID. Pass it as shops[0].processing_profile_id when creating listings.",
  });
}