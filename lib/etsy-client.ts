// ─────────────────────────────────────────────
//  JT Tools — Etsy v3 Client
//  Maps internal endpoint slugs → Etsy API URLs
// ─────────────────────────────────────────────

const ETSY_BASE = "https://openapi.etsy.com/v3";
// Etsy Commercial Access requires format: keystring:shared_secret
const API_KEY = `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;
// Each user passes their own shop_id per request — no server default needed
function requireShopId(id: string | undefined): string {
  if (!id) throw new Error("Missing required parameter: shop_id. Pass your Etsy shop ID in the query string.");
  return id;
}

// ─── Route Map ──────────────────────────────
// Maps "endpoint/slug" → function that builds the Etsy URL + params

type RouteHandler = (params: Record<string, string>, body?: unknown) => {
  method: string;
  url: string;
  body?: unknown;
};

const ROUTE_MAP: Record<string, RouteHandler> = {
  // ── Listings ──────────────────────────────
  "listings/search": ({ query, limit = "25", offset = "0", ...rest }) => ({
    method: "GET",
    url: buildUrl(`${ETSY_BASE}/application/listings/active`, {
      keywords: query,
      limit,
      offset,
      ...rest,
    }),
  }),

  "listings/get": ({ listing_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/listings/${listing_id}`,
  }),

  // Path is historical — the slug stays "listings/active" but accepts ?state=draft
  // as well as the default state=active. Rename can happen later if a third state
  // (inactive/expired/sold_out) ever lands; for now keep this stable to avoid
  // breaking existing consumers. Default limit bumped 25 → 100 because draft
  // shops can have 1000+ rows and the consumer wants to paginate in fewer hops.
  // Etsy returns { count, results, pagination } natively — we pass through as-is.
  // modified_since (unix seconds) is forwarded to Etsy's last_modified_tsz_min
  // for incremental syncs.
  //
  // URL bifurcation by state is deliberate:
  //   state=active → hit Etsy's dedicated /listings/active path (NO OAuth required,
  //                  public endpoint). Preserves backward compat for existing
  //                  consumers who call this slug without OAuth headers.
  //   state=draft  → hit Etsy's generic /listings?state=draft (REQUIRES OAuth,
  //                  listings_r scope). The dedicated /listings/draft path
  //                  doesn't exist on Etsy v3 — verified by probe (404 "Resource
  //                  not found"). Route handler upgrades auth conditionally for
  //                  this state; see app/api/v1/[...path]/route.ts.
  "listings/active": ({ shop_id, state, limit = "100", offset = "0", modified_since }) => {
    const sid = requireShopId(shop_id);
    const qs: Record<string, string | undefined> = { limit, offset };
    if (modified_since) qs.last_modified_tsz_min = modified_since;
    if (state === "draft") {
      qs.state = "draft";
      return {
        method: "GET",
        url: buildUrl(`${ETSY_BASE}/application/shops/${sid}/listings`, qs),
      };
    }
    // Default / state=active: keep the public path. Any other state value
    // (inactive/expired/sold_out) silently falls through to active — spec
    // explicitly excludes those from the consumer's catalog.
    return {
      method: "GET",
      url: buildUrl(`${ETSY_BASE}/application/shops/${sid}/listings/active`, qs),
    };
  },

  "listings/featured": ({ shop_id }) => ({
    method: "GET",
    url: buildUrl(`${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/featured`, {}),
  }),

  "listings/create": ({ shop_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings`,
    body,
  }),

  "listings/update": ({ shop_id, listing_id }, body) => ({
    // Etsy's `updateListing` requires BOTH:
    //   - shop-scoped path: /application/shops/{shop_id}/listings/{listing_id}
    //     (the bare /application/listings/{id} URL is GET-only)
    //   - PATCH method (PUT on this URL also returns 404 — only PATCH is
    //     wired up server-side for this resource)
    // Body is partial — Etsy keeps fields that aren't included as-is.
    method: "PATCH",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}`,
    body,
  }),

  "listings/delete": ({ shop_id, listing_id }) => ({
    // Same shop-scoped path requirement as updateListing — bare
    // `/application/listings/{id}` is GET-only.
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}`,
  }),

  "listings/images": ({ listing_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/listings/${listing_id}/images`,
  }),

  "listings/inventory": ({ listing_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/listings/${listing_id}/inventory`,
  }),

  "listings/properties": ({ listing_id, shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/properties`,
  }),

  // Per-variation image mapping — which image_id is bound to which
  // property_id/value_id combo on a listing (e.g. "Color=Black" → image_id 123).
  // Etsy endpoint requires OAuth (listings_r) and shop ownership; the consumer
  // pairs this with /listings/images to resolve image_id → URL.
  "listings/variation-images": ({ listing_id, shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/variation-images`,
  }),

  "listings/shipping": ({ listing_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/listings/${listing_id}/shipping`,
  }),

  // ── Search ────────────────────────────────
  "search/listings": ({ query, limit = "25", offset = "0", ...rest }) => ({
    method: "GET",
    url: buildUrl(`${ETSY_BASE}/application/listings/active`, {
      keywords: query,
      limit,
      offset,
      ...rest,
    }),
  }),

  // ── Shops ─────────────────────────────────
  "shops/get": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}`,
  }),

  "shops/listings": ({ shop_id, limit = "25", offset = "0" }) => ({
    method: "GET",
    url: buildUrl(`${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings`, {
      limit,
      offset,
    }),
  }),

  "shops/sections": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/sections`,
  }),

  "shops/reviews": ({ shop_id, limit = "25", offset = "0" }) => ({
    method: "GET",
    url: buildUrl(`${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/reviews`, {
      limit,
      offset,
    }),
  }),

  "shops/transactions": ({ shop_id, limit = "25", offset = "0" }) => ({
    method: "GET",
    url: buildUrl(`${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/transactions`, {
      limit,
      offset,
    }),
  }),

  "shops/orders": ({ shop_id, limit = "25", offset = "0" }) => ({
    method: "GET",
    url: buildUrl(
      `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/receipts`,
      { limit, offset }
    ),
  }),

  "shops/update": ({ shop_id }, body) => ({
    method: "PUT",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}`,
    body,
  }),

  "shops/production-partners": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/production-partners`,
  }),

  // ── Categories ────────────────────────────
  "categories/list": () => ({
    method: "GET",
    url: `${ETSY_BASE}/application/seller-taxonomy/nodes`,
  }),

  "categories/get": ({ taxonomy_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/seller-taxonomy/nodes/${taxonomy_id}`,
  }),

  "categories/properties": ({ taxonomy_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/seller-taxonomy/nodes/${taxonomy_id}/properties`,
  }),

  "categories/children": ({ taxonomy_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/seller-taxonomy/nodes/${taxonomy_id}`,
  }),

  // ── Users ─────────────────────────────────
  "users/me": () => ({
    method: "GET",
    url: `${ETSY_BASE}/application/users/me`,
  }),

  "users/get": ({ user_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/users/${user_id}`,
  }),

  "users/addresses": ({ user_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/users/${user_id}/addresses`,
  }),

  // ── Shipping ──────────────────────────────
  "shipping/profiles": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/shipping-profiles`,
  }),

  "shipping/profile": ({ shop_id, profile_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/shipping-profiles/${profile_id}`,
  }),

  "shipping/create": ({ shop_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/shipping-profiles`,
    body,
  }),

  "shipping/update": ({ shop_id, profile_id }, body) => ({
    method: "PUT",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/shipping-profiles/${profile_id}`,
    body,
  }),

  "shipping/delete": ({ shop_id, profile_id }) => ({
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/shipping-profiles/${profile_id}`,
  }),

  "shipping/destinations": ({ shop_id, profile_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/shipping-profiles/${profile_id}/destinations`,
  }),

  "shipping/upgrades": ({ shop_id, profile_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/shipping-profiles/${profile_id}/upgrades`,
  }),

  // ── Images & Media ────────────────────────
  "images/listing": ({ listing_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/listings/${listing_id}/images`,
  }),

  "images/upload": ({ shop_id, listing_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/images`,
    body,
  }),

  "images/delete": ({ shop_id, listing_id, listing_image_id }) => ({
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/images/${listing_image_id}`,
  }),

  // ── Shop Policies ─────────────────────────
  "policies/get": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies`,
  }),

  // ── Store Management ──────────────────────
  "store/receipt": ({ shop_id, receipt_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/receipts/${receipt_id}`,
  }),

  "store/receipt/update": ({ shop_id, receipt_id }, body) => ({
    method: "PUT",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/receipts/${receipt_id}`,
    body,
  }),

  "store/section/create": ({ shop_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/sections`,
    body,
  }),

  "store/section/update": ({ shop_id, shop_section_id }, body) => ({
    method: "PUT",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/sections/${shop_section_id}`,
    body,
  }),

  "store/section/delete": ({ shop_id, shop_section_id }) => ({
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/sections/${shop_section_id}`,
  }),

  // ── Images & Media (expanded) ─────────────
  "images/get": ({ listing_id, listing_image_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/listings/${listing_id}/images/${listing_image_id}`,
  }),

  "media/files": ({ shop_id, listing_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/files`,
  }),

  "media/file/upload": ({ shop_id, listing_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/files`,
    body,
  }),

  "media/file/delete": ({ shop_id, listing_id, listing_file_id }) => ({
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/files/${listing_file_id}`,
  }),

  "media/video": ({ listing_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/listings/${listing_id}/videos`,
  }),

  "media/video/upload": ({ shop_id, listing_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/videos`,
    body,
  }),

  // ── Listing Properties (expanded) ─────────
  "listings/property/update": ({ shop_id, listing_id, property_id }, body) => ({
    method: "PUT",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/properties/${property_id}`,
    body,
  }),

  "listings/property/delete": ({ shop_id, listing_id, property_id }) => ({
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/listings/${listing_id}/properties/${property_id}`,
  }),

  // ── Shop Policies (expanded to 14) ────────
  "policies/create": ({ shop_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies`,
    body,
  }),

  "policies/update": ({ shop_id }, body) => ({
    method: "PUT",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies`,
    body,
  }),

  "policies/delete": ({ shop_id }) => ({
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies`,
  }),

  "policies/privacy": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/privacy`,
  }),

  "policies/privacy/create": ({ shop_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/privacy`,
    body,
  }),

  "policies/privacy/update": ({ shop_id }, body) => ({
    method: "PUT",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/privacy`,
    body,
  }),

  "policies/privacy/delete": ({ shop_id }) => ({
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/privacy`,
  }),

  "policies/refund": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/refund`,
  }),

  "policies/refund/create": ({ shop_id }, body) => ({
    method: "POST",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/refund`,
    body,
  }),

  "policies/refund/update": ({ shop_id }, body) => ({
    method: "PUT",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/refund`,
    body,
  }),

  "policies/refund/delete": ({ shop_id }) => ({
    method: "DELETE",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/refund`,
  }),

  "policies/shipping": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/shipping`,
  }),

  "policies/payment": ({ shop_id }) => ({
    method: "GET",
    url: `${ETSY_BASE}/application/shops/${requireShopId(shop_id)}/policies/payment`,
  }),


};

// ─── Core proxy function ─────────────────────

export interface ProxyResult {
  ok: boolean;
  status: number;
  data: unknown;
}

export async function proxyEtsyRequest(
  endpoint: string,
  params: Record<string, string>,
  body?: unknown,
  accessToken?: string  // OAuth token for private endpoints
): Promise<ProxyResult> {
  const handler = ROUTE_MAP[endpoint];

  if (!handler) {
    return {
      ok: false,
      status: 404,
      data: { error: `Unknown endpoint: ${endpoint}` },
    };
  }

  const { method, url, body: routeBody } = handler(params, body);

  const headers: Record<string, string> = {
    "x-api-key": API_KEY,
    "Accept": "application/json",
    // If OAuth token provided, add Authorization header for private endpoints
    ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {}),
  };

  if (routeBody) {
    headers["Content-Type"] = "application/json";
  }

  const fetchOpts: RequestInit = {
    method,
    headers,
    ...(routeBody ? { body: JSON.stringify(routeBody) } : {}),
  };

  const res = await fetch(url, fetchOpts);
  const data = await res.json().catch(() => ({ error: "Non-JSON response from Etsy" }));

  return { ok: res.ok, status: res.status, data };
}

// ─── Helper ──────────────────────────────────

function buildUrl(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return url.toString();
}

export { ROUTE_MAP };