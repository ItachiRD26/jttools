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
//   Body: { products: [{ product_id, sku }, ...] }
//   OAuth-required (listings_w). Etsy demands the full inventory shape on
//   every PUT — this handler fetches current inventory, merges SKU updates
//   by product_id, and writes back. Consumer only sends the changes.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken, StoreNotConnectedError } from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

interface SkuUpdate {
  product_id: number;
  sku:        string;
}

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

  const validatedUpdates: SkuUpdate[] = [];
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i] as Record<string, unknown>;
    const pid = Number(u?.product_id);
    const sku = u?.sku;
    if (!Number.isInteger(pid) || pid <= 0) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", status: 400, message: `products[${i}].product_id must be a positive integer.` } },
        { status: 400, headers: corsHeaders() }
      );
    }
    if (typeof sku !== "string") {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", status: 400, message: `products[${i}].sku must be a string.` } },
        { status: 400, headers: corsHeaders() }
      );
    }
    validatedUpdates.push({ product_id: pid, sku });
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

  // Idempotency: drop no-op SKU updates. They don't count toward
  // productsUpdated and don't fail. If every update is a no-op, skip the
  // PUT entirely — saves an Etsy write call and protects against unrelated
  // inventory state drifting in between read and write.
  const currentSkuByProduct = new Map(current.products.map(p => [p.product_id, p.sku ?? ""]));
  const changingUpdates     = validatedUpdates.filter(u => currentSkuByProduct.get(u.product_id) !== u.sku);
  const skipped             = validatedUpdates.length - changingUpdates.length;

  if (changingUpdates.length === 0) {
    return NextResponse.json(
      {
        ok:              true,
        listing_id:      Number(listingId),
        productsUpdated: 0,
        skipped,
        note:            "All submitted SKUs already match — no Etsy write performed.",
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
  const skuByProduct = new Map(changingUpdates.map(u => [u.product_id, u.sku]));
  const mergedProducts = current.products.map(p => {
    const newSku = skuByProduct.has(p.product_id) ? skuByProduct.get(p.product_id)! : (p.sku ?? "");

    return {
      sku: newSku,
      property_values: (p.property_values ?? []).map(pv => ({
        property_id:   pv.property_id,
        property_name: pv.property_name,
        scale_id:      pv.scale_id ?? null,
        value_ids:     pv.value_ids ?? [],
        values:        pv.values   ?? [],
      })),
      offerings: (p.offerings ?? [])
        .filter(o => o.is_deleted !== true)
        .map(o => {
          const priceFloat = typeof o.price === "number"
            ? o.price
            : (o.price
                ? Number((o.price.amount / (o.price.divisor || 100)).toFixed(2))
                : 0);
          const offering: Record<string, unknown> = {
            price:      priceFloat,
            quantity:   o.quantity ?? 0,
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
