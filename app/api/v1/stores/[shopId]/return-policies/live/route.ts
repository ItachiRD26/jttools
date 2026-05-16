// LOCATION: app/api/v1/stores/[shopId]/return-policies/live/route.ts
// GET /api/v1/stores/{shopId}/return-policies/live
// Etsy v3: GET /application/shops/{shop_id}/return-policies (new policy system)
// Falls back to /application/shops/{shop_id}/policies/return (legacy)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

async function fetchWithAuth(url: string, accessToken: string) {
  return fetch(url, {
    headers: {
      "x-api-key":     API_KEY(),
      "Authorization": `Bearer ${accessToken}`,
      "Accept":        "application/json",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  const { shopId } = await params;
  const apiKey     = req.headers.get("x-api-key");
  const auth       = await validateRequest(apiKey, "stores/return-policies/live");

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

  // Try the new return-policies endpoint first (Etsy v3 modern system)
  let res = await fetchWithAuth(
    `${ETSY_BASE}/application/shops/${shopId}/return-policies`,
    accessToken
  );

  // Fall back to the legacy single policy endpoint
  if (!res.ok) {
    res = await fetchWithAuth(
      `${ETSY_BASE}/application/shops/${shopId}/policies/return`,
      accessToken
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    let errBody: unknown;
    try { errBody = JSON.parse(errText); } catch { errBody = errText; }
    return NextResponse.json(
      {
        error: {
          code:    "UPSTREAM_ERROR",
          status:  502,
          message: `Etsy return policies fetch failed (${res.status}).`,
          details: errBody,
          hint:    "Verify the shop has return policies configured in Etsy Shop Manager → Settings → Policies.",
        },
      },
      { status: 502 }
    );
  }

  const data       = await res.json();
  // New endpoint returns { results: [...] }, legacy returns a single object
  const results    = data.results ?? (data.return_policy_id ? [data] : []);
  const fetched_at = new Date().toISOString();

  return NextResponse.json({
    shop_id:        shopId,
    fetched_at,
    count:          results.length,
    return_policies: results,
  });
}