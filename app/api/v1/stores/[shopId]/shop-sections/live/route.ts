// LOCATION: app/api/v1/stores/[shopId]/shop-sections/live/route.ts
// GET /api/v1/stores/{shopId}/shop-sections/live
// Always fetches fresh from Etsy — never cached

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
  const apiKey    = req.headers.get("x-api-key");
  const auth      = await validateRequest(apiKey, "stores/shop-sections/live");

  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, shopId);
  } catch {
    return NextResponse.json(
      { error: { code: "STORE_NOT_CONNECTED", status: 403, message: `Shop ${shopId} is not connected.`, hint: "Connect at jeterdev.tools/dashboard.", docs: "https://jeterdev.tools/docs#store-connection" } },
      { status: 403 }
    );
  }

  const res = await fetch(`${ETSY_BASE}/application/shops/${shopId}/sections`, {
    headers: {
      "x-api-key":     API_KEY(),
      "Authorization": `Bearer ${accessToken}`,
      "Accept":        "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: { code: "UPSTREAM_ERROR", status: 502, message: "Etsy API error.", details: err } },
      { status: 502 }
    );
  }

  const data      = await res.json();
  const results   = data.results ?? data ?? [];
  const fetched_at = new Date().toISOString();

  return NextResponse.json({
    shop_id:    shopId,
    fetched_at,
    count:      Array.isArray(results) ? results.length : 1,
    shop_sections: Array.isArray(results) ? results : [results],
  });
}