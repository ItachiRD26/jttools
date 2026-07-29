// LOCATION: app/api/v1/listings/batch/route.ts
// GET /api/v1/listings/batch?listing_ids=1,2,3
//
// Fetches up to 100 listings in one call. Optional `includes` embeds
// related resources (Images, Inventory, Videos, Shipping, Translations,
// Shop, User, Personalization, BuyerPrice) — saves N follow-up calls
// per listing on sync.
//
// Optional `shop_id` upgrades the call to authenticated (uses the
// shop's OAuth token). Required for:
//   - Fetching draft listings (Etsy's public batch endpoint only returns
//     active listings without OAuth).
//   - Requesting `Inventory` or `Shipping` — Etsy removed these values
//     from the `includes` enum on July 29 2026 and moved them to
//     dedicated authenticated endpoints. This route absorbs that
//     migration internally so consumers keep passing the same
//     `includes=Inventory,Shipping` they always did; we fan out to
//     the new endpoints and merge results back per-listing.
//
// Removed includes (silently dropped from forwarded param, absorbed
// or ignored here):
//   - Inventory  → fanned out to GET /listings/batch/inventory
//   - Shipping   → fanned out to GET /listings/batch/shipping
//   - Manufacturers → dead in Etsy v3; silently stripped

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

// The `includes` enum on Etsy's getListingsByListingIds as of the
// July 29 2026 change. Anything else in the caller's includes list
// gets routed to a dedicated fetch (Inventory/Shipping) or dropped
// (Manufacturers — removed with no replacement).
const PASSTHROUGH_INCLUDES = new Set([
  "Images",
  "Shop",
  "User",
  "Translations",
  "Videos",
  "Personalization",
  "BuyerPrice",
]);

interface EtsyListing {
  listing_id: number;
  [k: string]: unknown;
}

interface BatchResponse {
  count?: number;
  results?: EtsyListing[];
}

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "listings/batch");

  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const idsParam = req.nextUrl.searchParams.get("listing_ids");
  if (!idsParam) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: "listing_ids parameter is required.",
          hint:    "Pass comma-separated listing IDs: ?listing_ids=123,456,789",
        },
      },
      { status: 400 }
    );
  }

  const ids = idsParam.split(",").map(id => id.trim()).filter(Boolean);

  if (ids.length > 100) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: "Maximum 100 listing IDs per request.",
        },
      },
      { status: 400 }
    );
  }

  // Split the caller's includes into (a) what Etsy still accepts on the
  // batch listings endpoint, and (b) what needs a dedicated fetch after
  // the July 29 2026 deprecation. Case-insensitive on parse so callers
  // passing "inventory" or "SHIPPING" don't quietly fall through.
  const rawIncludes = (req.nextUrl.searchParams.get("includes") || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const canonicalIncludes = rawIncludes.map(canonicalizeInclude);
  const passthroughIncludes: string[] = [];
  let needsInventory = false;
  let needsShipping  = false;
  for (const inc of canonicalIncludes) {
    if (inc === "Inventory") needsInventory = true;
    else if (inc === "Shipping") needsShipping = true;
    else if (inc === "Manufacturers") continue; // silently dropped — removed from v3
    else if (PASSTHROUGH_INCLUDES.has(inc)) passthroughIncludes.push(inc);
    // Anything else: silently drop rather than 400. Etsy would 400 on
    // it too, but we keep the request from failing outright when the
    // caller sends a mix of good + bad includes.
  }

  const shopId = req.nextUrl.searchParams.get("shop_id")?.trim() || undefined;

  // Inventory + Shipping need OAuth (listings_r). We need a shop_id to
  // resolve which shop's token to use. Reject early with a clear
  // message so a caller who used to pass includes=Inventory without
  // shop_id knows why it's now required.
  if ((needsInventory || needsShipping) && !shopId) {
    const which = [needsInventory && "Inventory", needsShipping && "Shipping"]
      .filter(Boolean)
      .join(" + ");
    return NextResponse.json(
      {
        error: {
          code:    "MISSING_SHOP_ID",
          status:  400,
          message: `shop_id is required when includes contains ${which}. Etsy moved these to dedicated authenticated endpoints on July 29 2026.`,
          hint:    "Pass ?shop_id=Y matching the listings' shop. Connected shops already have listings_r in the OAuth grant — no re-auth needed.",
          docs:    "https://jeterdev.tools/docs#store-connection",
        },
      },
      { status: 400 }
    );
  }

  // Resolve OAuth if shop_id was provided. Without it, the base batch
  // call is unauthenticated and Etsy returns active listings only.
  let accessToken: string | undefined;
  if (shopId) {
    const db      = getDb();
    const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
    const userId  = keySnap.data()?.userId as string | undefined;
    if (!userId) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", status: 401, message: "Could not identify user." } },
        { status: 401 }
      );
    }
    try {
      accessToken = await getValidAccessToken(userId, shopId);
    } catch (err) {
      const isNotConnected = err instanceof StoreNotConnectedError;
      const isExpired      = err instanceof StoreTokenExpiredError;
      const code   = isNotConnected ? "STORE_NOT_CONNECTED" : "STORE_TOKEN_EXPIRED";
      const status = isNotConnected ? 403 : 503;
      return NextResponse.json(
        {
          error: {
            code, status,
            message: isNotConnected
              ? `Shop ${shopId} is not connected to your account.`
              : "Store authorization expired. Re-link the shop at jeterdev.tools/dashboard.",
            details: isExpired ? undefined : (err instanceof Error ? err.message : undefined),
          },
        },
        { status }
      );
    }
  }

  // ── 1. Base batch call (Etsy-supported includes only) ────────────────────
  const upstream = new URL(`${ETSY_BASE}/application/listings/batch`);
  upstream.searchParams.set("listing_ids", ids.join(","));
  if (passthroughIncludes.length > 0) {
    upstream.searchParams.set("includes", passthroughIncludes.join(","));
  }

  const baseRes = await fetch(upstream.toString(), {
    headers: {
      "x-api-key": API_KEY(),
      "Accept":    "application/json",
      ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {}),
    },
  });

  if (!baseRes.ok) {
    const err = await baseRes.json().catch(() => ({}));
    return NextResponse.json(
      {
        error: {
          code:    "UPSTREAM_ERROR",
          status:  502,
          message: "Etsy API error.",
          details: err,
        },
      },
      { status: 502 }
    );
  }

  const baseBody = await baseRes.json() as BatchResponse;
  const results: EtsyListing[] = baseBody.results ?? [];

  // ── 2. Fan out to dedicated Inventory / Shipping endpoints ───────────────
  // Both are new on Etsy as of July 29 2026 and require OAuth. We call
  // them in parallel and merge the returned inventory/shipping objects
  // into the corresponding listing in `results` by listing_id.
  if (needsInventory || needsShipping) {
    const [invMap, shipMap] = await Promise.all([
      needsInventory
        ? fetchAssociationByListingId(ids, "inventory", accessToken!)
        : Promise.resolve(new Map<number, unknown>()),
      needsShipping
        ? fetchAssociationByListingId(ids, "shipping", accessToken!)
        : Promise.resolve(new Map<number, unknown>()),
    ]);

    for (const listing of results) {
      const inv = invMap.get(listing.listing_id);
      if (inv !== undefined) listing.inventory = inv;
      const ship = shipMap.get(listing.listing_id);
      if (ship !== undefined) listing.shipping = ship;
    }
  }

  return NextResponse.json({
    count:   baseBody.count ?? results.length,
    results,
  });
}

/**
 * Normalize a caller-supplied includes value to Etsy's canonical
 * casing. Etsy is strict about case — "inventory" errors, "Inventory"
 * works. Accept common variants to spare the caller a lookup.
 */
function canonicalizeInclude(raw: string): string {
  const lower = raw.toLowerCase();
  const map: Record<string, string> = {
    images:          "Images",
    inventory:       "Inventory",
    shipping:        "Shipping",
    shop:            "Shop",
    user:            "User",
    translations:    "Translations",
    videos:          "Videos",
    personalization: "Personalization",
    buyerprice:      "BuyerPrice",
    manufacturers:   "Manufacturers",
  };
  return map[lower] ?? raw;
}

/**
 * Fan out to one of the new July 29 2026 batch-association endpoints:
 *
 *   GET /v3/application/listings/batch/inventory?listing_ids=...
 *   GET /v3/application/listings/batch/shipping?listing_ids=...
 *
 * Both require OAuth (listings_r for inventory, same for shipping).
 * Returns a map of listing_id → the extracted association object
 * (`.inventory` or `.shipping` from each result row) so the caller
 * can merge back per-listing.
 *
 * Silent-on-error: if the fanout fetch fails or returns an empty
 * results array, the returned map is empty and the base listings
 * still come back to the client without the requested association.
 * That's better than a 502 for the whole batch when only the
 * inventory/shipping fanout is broken.
 */
async function fetchAssociationByListingId(
  ids: string[],
  which: "inventory" | "shipping",
  accessToken: string,
): Promise<Map<number, unknown>> {
  const map = new Map<number, unknown>();
  const url = new URL(`${ETSY_BASE}/application/listings/batch/${which}`);
  url.searchParams.set("listing_ids", ids.join(","));
  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key":     API_KEY(),
      "Authorization": `Bearer ${accessToken}`,
      "Accept":        "application/json",
    },
  });
  if (!res.ok) {
    // Log-only — don't fail the whole batch. Callers who really need
    // this data will notice the missing field.
    console.warn(
      `[listings/batch] ${which} fanout failed:`,
      res.status,
      await res.text().catch(() => ""),
    );
    return map;
  }
  const body = (await res.json().catch(() => ({}))) as BatchResponse;
  for (const row of body.results ?? []) {
    if (typeof row.listing_id !== "number") continue;
    // Each row in the response is a ShopListingWithAssociations that
    // has the requested association attached (`.inventory` for the
    // inventory endpoint, `.shipping` for the shipping endpoint). Pull
    // that specific field so the merge matches what callers used to
    // get with the old `?includes=` behavior.
    const value = (row as Record<string, unknown>)[which];
    if (value !== undefined) map.set(row.listing_id, value);
  }
  return map;
}
