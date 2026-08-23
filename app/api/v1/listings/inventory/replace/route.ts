// LOCATION: app/api/v1/listings/inventory/replace/route.ts
// PUT /api/v1/listings/inventory/replace?listing_id=X&shop_id=Y
//   Body: { variations: { properties, offerings }, base_price?, readiness_state_id? }
//
// FULL inventory replace — unlike PUT /listings/inventory (which merges price/sku/
// quantity onto EXISTING products by product_id), this rebuilds the entire product
// set from the caller's variation structure and writes it. Lets a caller RESTRUCTURE
// a published listing's variations (add a new axis, add/remove options, new SKUs).
//
// DESTRUCTIVE on Etsy: Etsy assigns new product_ids to every variation, and any
// option not present in `variations` is dropped. OAuth-required (listings_w).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken, StoreNotConnectedError } from "@/lib/etsy-oauth";
import { buildEtsyInventory } from "@/lib/listing-builder";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  };
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function PUT(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "listings/inventory/replace");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders() });

  const listingId = req.nextUrl.searchParams.get("listing_id");
  const shopId    = req.nextUrl.searchParams.get("shop_id");
  if (!listingId || !shopId) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "listing_id and shop_id are required." } },
      { status: 400, headers: corsHeaders() }
    );
  }

  let body: { variations?: { properties?: unknown[]; offerings?: unknown[] }; base_price?: number; readiness_state_id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "Invalid JSON body." } },
      { status: 400, headers: corsHeaders() }
    );
  }
  const variations = body?.variations;
  const props = Array.isArray(variations?.properties) ? variations!.properties : [];
  const offerings = Array.isArray(variations?.offerings) ? variations!.offerings : [];
  if (!props.length || !offerings.length) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "variations.properties and variations.offerings are required (this endpoint is for variation listings)." } },
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

  const etsyHeaders = { "x-api-key": API_KEY(), "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" };

  // Inherit the readiness/processing state from the CURRENT inventory so the new
  // offerings keep the listing's processing profile (Etsy 400s without one).
  let readiness = Number(body?.readiness_state_id) || 0;
  if (!readiness) {
    try {
      const readRes = await fetch(`${ETSY_BASE}/application/listings/${listingId}/inventory`, { headers: etsyHeaders });
      if (readRes.ok) {
        const cur = await readRes.json();
        for (const p of cur?.products ?? []) {
          const r = p?.offerings?.[0]?.readiness_state_id;
          if (Number(r) > 0) { readiness = Number(r); break; }
        }
      }
    } catch { /* fall through — offerings may carry their own processing_profile_id */ }
  }

  // Base price = fallback for offerings missing a price (each offering normally
  // carries its own). Prefer the caller's base_price, else the first offering's.
  const firstPrice = Number((offerings[0] as Record<string, unknown>)?.price);
  const basePrice = Number(body?.base_price) || (Number.isFinite(firstPrice) ? firstPrice : 0);

  let putBody: Record<string, unknown>;
  try {
    putBody = buildEtsyInventory({ properties: props, offerings } as never, basePrice, readiness);
  } catch (e) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: `Couldn't build inventory: ${(e as Error).message}` } },
      { status: 400, headers: corsHeaders() }
    );
  }

  const writeRes = await fetch(`${ETSY_BASE}/application/listings/${listingId}/inventory`, {
    method:  "PUT",
    headers: { ...etsyHeaders, "Content-Type": "application/json" },
    body:    JSON.stringify(putBody),
  });

  if (!writeRes.ok) {
    const errText = await writeRes.text();
    let errBody: unknown;
    try { errBody = JSON.parse(errText); } catch { errBody = errText; }
    const errStr = typeof errBody === "string" ? errBody : JSON.stringify(errBody);
    if ((writeRes.status === 401 || writeRes.status === 403) && /insufficient_scope/i.test(errStr)) {
      return NextResponse.json(
        { error: { code: "STORE_SCOPE_OUTDATED", status: 403, message: "This shop's Etsy connection is missing the inventory-write scope — reconnect it at jeterdev.tools/dashboard." } },
        { status: 403, headers: corsHeaders() }
      );
    }
    return NextResponse.json(
      { error: { code: "UPSTREAM_ERROR", status: 502, message: "Etsy rejected the inventory replace.", details: errBody } },
      { status: 502, headers: corsHeaders() }
    );
  }

  const result = await writeRes.json().catch(() => ({}));
  const productsWritten = Array.isArray((putBody as { products?: unknown[] }).products)
    ? (putBody as { products: unknown[] }).products.length
    : 0;
  return NextResponse.json(
    { ok: true, listing_id: Number(listingId), products_written: productsWritten, inventory: result },
    { status: 200, headers: corsHeaders() }
  );
}
