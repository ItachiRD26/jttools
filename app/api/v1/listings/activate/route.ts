// LOCATION: app/api/v1/listings/activate/route.ts
// POST /api/v1/listings/activate?listing_id=X&shop_id=Y
//   Body: (none)
//
// Sets a listing's state to "active" on Etsy (PATCH the listing). Idempotent —
// setting active on an already-active listing is a no-op and does NOT relist or
// re-charge. Used to KEEP a listing published after an edit: editing a listing's
// inventory/variations can bump it to draft on Etsy, so callers assert "active"
// at the end of an update so an edit never leaves the listing unpublished.
// OAuth-required (listings_w).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken, StoreNotConnectedError } from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  };
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "listings/activate");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders() });

  const listingId = req.nextUrl.searchParams.get("listing_id");
  const shopId    = req.nextUrl.searchParams.get("shop_id");
  if (!listingId || !shopId) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "listing_id and shop_id are required." } },
      { status: 400, headers: corsHeaders() }
    );
  }

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string | undefined;
  if (!userId) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", status: 401, message: "Could not identify user." } },
      { status: 401, headers: corsHeaders() }
    );
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, shopId);
  } catch (e) {
    if (e instanceof StoreNotConnectedError) {
      return NextResponse.json(
        { error: { code: "STORE_NOT_CONNECTED", status: 403, message: `Shop ${shopId} is not connected.`, hint: "Connect at jeterdev.tools/dashboard." } },
        { status: 403, headers: corsHeaders() }
      );
    }
    return NextResponse.json(
      { error: { code: "AUTH_ERROR", status: 403, message: "Store authorization expired. Re-link the shop at jeterdev.tools/dashboard." } },
      { status: 403, headers: corsHeaders() }
    );
  }

  const res = await fetch(`${ETSY_BASE}/application/shops/${shopId}/listings/${listingId}`, {
    method:  "PATCH",
    headers: { "x-api-key": API_KEY(), "Authorization": `Bearer ${accessToken}`, "Accept": "application/json", "Content-Type": "application/json" },
    body:    JSON.stringify({ state: "active" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: { code: "ETSY_ERROR", status: res.status, message: `Couldn't activate listing: ${JSON.stringify(data).slice(0, 300)}` } },
      { status: res.status, headers: corsHeaders() }
    );
  }
  return NextResponse.json({ ok: true, listing_id: Number(listingId), state: data?.state ?? "active" }, { headers: corsHeaders() });
}
