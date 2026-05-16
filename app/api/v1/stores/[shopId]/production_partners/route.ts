// LOCATION: app/api/v1/stores/[shopId]/production-partners/live/route.ts
// GET /api/v1/stores/{shopId}/production-partners/live
//
// Production partners = external manufacturers/dropshippers.
// Only relevant if the shop outsources production.
// Most shops have zero — empty array is the normal case.
//
// This is SEPARATE from processing profiles (shipping prep time).

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
  const auth       = await validateRequest(apiKey, "stores/production-partners/live");

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

  const res = await fetch(
    `${ETSY_BASE}/application/shops/${shopId}/production-partners`,
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
          message: `Etsy production partners fetch failed (${res.status}).`,
          details: errBody,
        },
      },
      { status: 502 }
    );
  }

  const data    = await res.json();
  const results = data.results ?? [];

  return NextResponse.json({
    shop_id:             shopId,
    fetched_at:          new Date().toISOString(),
    count:               results.length,
    production_partners: results,
    note: "Empty array is normal — most shops have no production partners configured.",
  });
}
