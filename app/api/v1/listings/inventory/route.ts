// LOCATION: app/api/v1/listings/inventory/route.ts
// GET /api/v1/listings/inventory?listing_id=X&shop_id=Y
//   OAuth-required (listings_r). Despite the original "public read" comment,
//   Etsy's /v3/application/listings/{id}/inventory endpoint requires
//   listings_r for every non-trivial response — empirically returns
//   401 "Access token is required for this request (requires scope:
//   listings_r)" when called with only an API key. So shop_id is required
//   here too, just like the PUT below, so the bridge can resolve which
//   shop's OAuth token to use.
//
//   A dedicated route file is required because the PUT below needs OAuth +
//   body-merge logic the generic catch-all proxy can't express. Next.js
//   prefers specific routes, so this file shadows the [...path] proxy for
//   /listings/inventory.
//
// PUT /api/v1/listings/inventory?listing_id=X&shop_id=Y
//   Body: { products: [{ product_id, sku?, price?, quantity? }, ...] }
//   OAuth-required (listings_w). Etsy demands the full inventory shape on
//   every PUT — this handler fetches current inventory, merges any of
//   {sku, price, quantity} changes by product_id, and writes back.
//   Consumer only sends the changes; every product row must include at
//   least one of the three optional fields.
//
//   Multi-offering products (e.g. per-region pricing): price + quantity
//   apply to the FIRST offering only, preserving the others' fields.
//   Callers needing per-offering control can hit Etsy directly through
//   the catch-all proxy.
//
//   Idempotent — submissions where every field already matches Etsy
//   return productsUpdated: 0 + skipped count without an Etsy write.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken, StoreNotConnectedError } from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

interface ProductUpdate {
  product_id: number;
  /** SKU rename. Undefined = leave the existing SKU alone. */
  sku?:       string;
  /** New per-unit price in the listing's currency (USD in the
   *  common case). Undefined = leave every offering's price alone.
   *  When set, applies to EVERY offering on the product — the vast
   *  majority of Etsy inventory has one offering per product, and
   *  the rare multi-offering case (per-region pricing) usually
   *  wants a uniform update anyway. */
  price?:     number;
  /** New stock quantity. Undefined = leave every offering's
   *  quantity alone. Applies to the first non-deleted offering
   *  (Etsy's canonical primary). Set to 0 to mark out of stock. */
  quantity?:  number;
}

/** Legacy alias for callers that only pass {product_id, sku}. */
type SkuUpdate = ProductUpdate;

type EtsyProduct = {
  product_id: number;
  sku?: string;
  property_values?: Array<{
    property_id:   number;
    property_name?: string;
    scale_id?:     number | null;
    value_ids?:    number[];
    values?:       string[];
  }>;
  offerings?: Array<{
    offering_id?:        number;
    price?:              { amount: number; divisor: number; currency_code: string } | number;
    quantity?:           number;
    is_enabled?:         boolean;
    is_deleted?:         boolean;
    readiness_state_id?: number;
  }>;
};

type EtsyInventoryResponse = {
  products?:             EtsyProduct[];
  price_on_property?:    number[];
  quantity_on_property?: number[];
  sku_on_property?:      number[];
};

// ─── GET ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "listings/inventory");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders() });
  }

  const listingId = req.nextUrl.searchParams.get("listing_id");
  const shopId    = req.nextUrl.searchParams.get("shop_id");
  if (!listingId) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "listing_id is required.", hint: "Pass ?listing_id=X" } },
      { status: 400, headers: corsHeaders() }
    );
  }
  if (!shopId) {
    return NextResponse.json(
      {
        error: {
          code:    "MISSING_SHOP_ID",
          status:  400,
          message: "shop_id is required (Etsy's inventory endpoint needs the listings_r OAuth scope).",
          hint:    "Pass ?shop_id=Y matching the listing's shop.",
          docs:    "https://jeterdev.tools/docs#store-connection",
        },
      },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Resolve userId + OAuth token (same pattern as the PUT below).
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
  } catch (err) {
    const isNotConnected = err instanceof StoreNotConnectedError;
    return NextResponse.json(
      {
        error: {
          code:    isNotConnected ? "STORE_NOT_CONNECTED" : "STORE_TOKEN_EXPIRED",
          status:  isNotConnected ? 403 : 503,
          message: isNotConnected
            ? `Shop ${shopId} is not connected to your account.`
            : "Store authorization expired. Re-link the shop at jeterdev.tools/dashboard.",
          hint:    "Reconnecting also grants any newly-added OAuth scopes.",
          docs:    "https://jeterdev.tools/docs#store-connection",
        },
      },
      { status: isNotConnected ? 403 : 503, headers: corsHeaders() }
    );
  }

  const res = await fetch(`${ETSY_BASE}/application/listings/${listingId}/inventory`, {
    headers: {
      "x-api-key":     API_KEY(),
      "Authorization": `Bearer ${accessToken}`,
      "Accept":        "application/json",
    },
  });
  const data = await res.json().catch(() => ({ error: "Non-JSON response from Etsy" }));
  return NextResponse.json(data, {
    status:  res.status,
    headers: { ...corsHeaders(), ...rateLimitHeaders(auth) },
  });
}

// ─── PUT ─────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "listings/inventory/update");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders() });
  }

  const listingId = req.nextUrl.searchParams.get("listing_id");
  const shopId    = req.nextUrl.searchParams.get("shop_id");

  if (!listingId) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "listing_id is required.", hint: "Pass ?listing_id=X" } },
      { status: 400, headers: corsHeaders() }
    );
  }
  if (!shopId) {
    return NextResponse.json(
      {
        error: {
          code:    "MISSING_SHOP_ID",
          status:  400,
          message: "shop_id is required for inventory updates (OAuth needed).",
          hint:    "Pass ?shop_id=Y matching the listing's shop.",
          docs:    "https://jeterdev.tools/docs#store-connection",
        },
      },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "Invalid JSON body." } },
      { status: 400, headers: corsHeaders() }
    );
  }

  const updates = (rawBody && typeof rawBody === "object")
    ? (rawBody as { products?: unknown }).products
    : undefined;

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: "Body must be { products: [{ product_id, sku }, ...] } with at least one item.",
        },
      },
      { status: 400, headers: corsHeaders() }
    );
  }

  const validatedUpdates: ProductUpdate[] = [];
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i] as Record<string, unknown>;
    const pid = Number(u?.product_id);
    if (!Number.isInteger(pid) || pid <= 0) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", status: 400, message: `products[${i}].product_id must be a positive integer.` } },
        { status: 400, headers: corsHeaders() }
      );
    }

    const rec: ProductUpdate = { product_id: pid };

    if (u?.sku !== undefined) {
      if (typeof u.sku !== "string") {
        return NextResponse.json(
          { error: { code: "INVALID_REQUEST", status: 400, message: `products[${i}].sku must be a string.` } },
          { status: 400, headers: corsHeaders() }
        );
      }
      rec.sku = u.sku;
    }

    if (u?.price !== undefined && u.price !== null) {
      const p = Number(u.price);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json(
          { error: { code: "INVALID_REQUEST", status: 400, message: `products[${i}].price must be a non-negative number.` } },
          { status: 400, headers: corsHeaders() }
        );
      }
      rec.price = Number(p.toFixed(2));
    }

    if (u?.quantity !== undefined && u.quantity !== null) {
      const q = Number(u.quantity);
      if (!Number.isInteger(q) || q < 0) {
        return NextResponse.json(
          { error: { code: "INVALID_REQUEST", status: 400, message: `products[${i}].quantity must be a non-negative integer.` } },
          { status: 400, headers: corsHeaders() }
        );
      }
      rec.quantity = q;
    }

    // Row must actually change SOMETHING. Otherwise we'd read+merge
    // for nothing and return "no changes" — but that's confusing at
    // the API surface. Reject with a clear message so the caller
    // realizes they forgot to send any field.
    if (rec.sku === undefined && rec.price === undefined && rec.quantity === undefined) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", status: 400, message: `products[${i}] must include at least one of: sku, price, quantity.` } },
        { status: 400, headers: corsHeaders() }
      );
    }

    validatedUpdates.push(rec);
  }

  // Resolve userId + OAuth token
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
  } catch (err) {
    const isNotConnected = err instanceof StoreNotConnectedError;
    return NextResponse.json(
      {
        error: {
          code:    isNotConnected ? "STORE_NOT_CONNECTED" : "STORE_TOKEN_EXPIRED",
          status:  isNotConnected ? 403 : 503,
          message: isNotConnected
            ? `Shop ${shopId} is not connected to your account.`
            : "Store authorization expired. Re-link the shop at jeterdev.tools/dashboard.",
          hint:    "Reconnecting also grants any newly-added OAuth scopes (e.g. listings_w).",
          docs:    "https://jeterdev.tools/docs#store-connection",
        },
      },
      { status: isNotConnected ? 403 : 503, headers: corsHeaders() }
    );
  }

  // ── Read current inventory ─────────────────────────────────────────────────
  const readRes = await fetch(`${ETSY_BASE}/application/listings/${listingId}/inventory`, {
    headers: {
      "x-api-key":     API_KEY(),
      "Authorization": `Bearer ${accessToken}`,
      "Accept":        "application/json",
    },
  });

  if (!readRes.ok) {
    const errBody = await readRes.json().catch(() => ({}));
    return NextResponse.json(
      {
        error: {
          code:        "UPSTREAM_ERROR",
          status:      502,
          message:     `Failed to read current inventory for listing ${listingId} from Etsy.`,
          etsy_status: readRes.status,
          details:     errBody,
        },
      },
      { status: 502, headers: corsHeaders() }
    );
  }

  const current = await readRes.json() as EtsyInventoryResponse;

  if (!Array.isArray(current.products) || current.products.length === 0) {
    return NextResponse.json(
      {
        error: {
          code:    "NO_INVENTORY",
          status:  404,
          message: `Listing ${listingId} has no inventory items to update.`,
        },
      },
      { status: 404, headers: corsHeaders() }
    );
  }

  // PRODUCT_NOT_FOUND: include submitted + actual for consumer-side diff.
  const actualIds = current.products.map(p => p.product_id);
  const validIds  = new Set(actualIds);
  const missing   = validatedUpdates.filter(u => !validIds.has(u.product_id));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: {
          code:      "PRODUCT_NOT_FOUND",
          status:    404,
          message:   `These product_ids are not on listing ${listingId}: ${missing.map(m => m.product_id).join(", ")}`,
          submitted: validatedUpdates.map(u => u.product_id),
          actual:    actualIds,
          hint:      "Use GET /listings/inventory?listing_id=X to see current product_ids.",
        },
      },
      { status: 404, headers: corsHeaders() }
    );
  }

  // Idempotency check. For each incoming update, compare each
  // requested field against the CURRENT value; if none differ, treat
  // the update as a no-op. When every incoming update is a no-op we
  // skip the Etsy PUT entirely — saves an API call AND protects
  // against unrelated inventory state drifting in between our read
  // and our write.
  const productLookup = new Map(current.products.map(p => [p.product_id, p]));
  const changingUpdates: ProductUpdate[] = [];
  for (const u of validatedUpdates) {
    const p = productLookup.get(u.product_id);
    if (!p) continue; // caught by PRODUCT_NOT_FOUND above
    const primary =
      p.offerings?.find(o => o.is_enabled && !o.is_deleted) ??
      p.offerings?.find(o => !o.is_deleted) ??
      p.offerings?.[0];
    const curPrice = primary?.price
      ? (typeof primary.price === "number"
          ? primary.price
          : Number((primary.price.amount / (primary.price.divisor || 100)).toFixed(2)))
      : null;
    const curQty  = primary?.quantity ?? null;
    const curSku  = p.sku ?? "";
    const skuChanges   = u.sku      !== undefined && u.sku      !== curSku;
    const priceChanges = u.price    !== undefined && u.price    !== curPrice;
    const qtyChanges   = u.quantity !== undefined && u.quantity !== curQty;
    if (skuChanges || priceChanges || qtyChanges) changingUpdates.push(u);
  }
  const skipped = validatedUpdates.length - changingUpdates.length;

  if (changingUpdates.length === 0) {
    return NextResponse.json(
      {
        ok:              true,
        listing_id:      Number(listingId),
        productsUpdated: 0,
        skipped,
        note:            "All submitted fields already match — no Etsy write performed.",
      },
      { status: 200, headers: { ...corsHeaders(), ...rateLimitHeaders(auth) } }
    );
  }

  // Build merged PUT body. Etsy's GET returns fields the PUT rejects
  // (product_id, offering_id, is_deleted) and prices as money objects;
  // PUT expects only the writable fields and prices as plain floats.
  // Per-offering readiness_state_id is preserved — without it Etsy returns
  // 400 "All offerings need readiness state" (same trap addressed in
  // lib/listing-builder.ts:932).
  const updateByProduct = new Map(changingUpdates.map(u => [u.product_id, u]));
  const mergedProducts = current.products.map(p => {
    const u = updateByProduct.get(p.product_id);
    const newSku = u?.sku ?? p.sku ?? "";

    // Filter to enabled/non-deleted offerings for the write. Etsy
    // preserves the deleted ones on its side; sending them back would
    // duplicate.
    const activeOfferings = (p.offerings ?? []).filter(o => o.is_deleted !== true);
    // If the caller sent price / quantity, apply to the FIRST offering
    // only (Etsy's canonical primary). Multi-offering per-region
    // pricing preserves other offerings' fields untouched. Callers
    // that need per-offering control can hit Etsy directly through
    // the catch-all proxy.
    let firstApplied = false;
    return {
      sku: newSku,
      property_values: (p.property_values ?? []).map(pv => ({
        property_id:   pv.property_id,
        property_name: pv.property_name,
        scale_id:      pv.scale_id ?? null,
        value_ids:     pv.value_ids ?? [],
        values:        pv.values   ?? [],
      })),
      offerings: activeOfferings.map(o => {
        const priceFloat = typeof o.price === "number"
          ? o.price
          : (o.price
              ? Number((o.price.amount / (o.price.divisor || 100)).toFixed(2))
              : 0);
        let outPrice = priceFloat;
        let outQty   = o.quantity ?? 0;
        if (u && !firstApplied) {
          if (u.price    !== undefined) outPrice = u.price;
          if (u.quantity !== undefined) outQty   = u.quantity;
          firstApplied = true;
        }
        const offering: Record<string, unknown> = {
          price:      outPrice,
          quantity:   outQty,
          is_enabled: o.is_enabled !== false,
        };
        if (o.readiness_state_id) offering.readiness_state_id = o.readiness_state_id;
        return offering;
      }),
    };
  });

  const putBody = {
    products:             mergedProducts,
    price_on_property:    current.price_on_property    ?? [],
    quantity_on_property: current.quantity_on_property ?? [],
    sku_on_property:      current.sku_on_property      ?? [],
  };

  // ── Write merged inventory back ────────────────────────────────────────────
  const writeRes = await fetch(`${ETSY_BASE}/application/listings/${listingId}/inventory`, {
    method:  "PUT",
    headers: {
      "x-api-key":     API_KEY(),
      "Authorization": `Bearer ${accessToken}`,
      "Accept":        "application/json",
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(putBody),
  });

  if (!writeRes.ok) {
    const errText = await writeRes.text();
    let errBody: unknown;
    try { errBody = JSON.parse(errText); } catch { errBody = errText; }

    // Scope sniff. OAuth 2.0 returns `insufficient_scope` when a token
    // lacks a scope the endpoint requires. Distinct code so consumers can
    // prompt a reconnect instead of treating it as a generic upstream 502.
    const errStr      = typeof errBody === "string" ? errBody : JSON.stringify(errBody);
    const looksScope  = (writeRes.status === 401 || writeRes.status === 403) &&
                        /insufficient_scope/i.test(errStr);

    if (looksScope) {
      return NextResponse.json(
        {
          error: {
            code:        "STORE_SCOPE_OUTDATED",
            status:      403,
            message:     `Shop ${shopId} was connected before the listings_w write scope was granted. Reconnect to enable inventory writes.`,
            hint:        "Disconnect and reconnect this shop at jeterdev.tools/dashboard — the new OAuth grant will include listings_w.",
            etsy_status: writeRes.status,
            details:     errBody,
            docs:        "https://jeterdev.tools/docs#store-connection",
          },
        },
        { status: 403, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      {
        error: {
          code:        "UPSTREAM_ERROR",
          status:      502,
          message:     "Etsy rejected the inventory update.",
          etsy_status: writeRes.status,
          details:     errBody,
          docs:        "https://jeterdev.tools/docs#errors",
        },
      },
      { status: 502, headers: corsHeaders() }
    );
  }

  return NextResponse.json(
    {
      ok:              true,
      listing_id:      Number(listingId),
      productsUpdated: changingUpdates.length,
      ...(skipped > 0 ? { skipped } : {}),
    },
    { status: 200, headers: { ...corsHeaders(), ...rateLimitHeaders(auth) } }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":   "*",
    "Access-Control-Allow-Methods":  "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers":  "Content-Type, x-api-key",
    "X-Content-Type-Options":        "nosniff",
  };
}

function rateLimitHeaders(auth: { plan: { dailyLimit: number; id: string }; remaining: number }) {
  const perSecond: Record<string, number> = { free: 1, pro: 10 };
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  return {
    "X-RateLimit-Limit-Day":        String(auth.plan.dailyLimit),
    "X-RateLimit-Remaining-Day":    String(auth.remaining),
    "X-RateLimit-Reset-Day":        String(Math.floor(midnight.getTime() / 1000)),
    "X-RateLimit-Limit-Second":     String(perSecond[auth.plan.id] ?? 1),
    "X-RateLimit-Remaining-Second": String(perSecond[auth.plan.id] ?? 1),
    "X-Plan":                       auth.plan.id,
  };
}
