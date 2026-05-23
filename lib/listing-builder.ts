// LOCATION: lib/listing-builder.ts
// Orchestrates listing creation: draft (Firestore only) | publish | active (Etsy API)
// Handles multi-shop, variations, category attributes, images, personalization

import { getDb } from "./firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { getValidAccessToken } from "./etsy-oauth";
import { FieldValue } from "firebase-admin/firestore";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShopConfig {
  shop_id:               number;
  shipping_profile_id?:  number;
  return_policy_id?:     number;
  processing_profile_id?: number | string; // string for synthetic "1-3" composite IDs
  shop_section_id?:      number;
  production_partner_ids?: number[];
  price?:                number; // per-shop price override
}

export interface ListingData {
  title:            string;
  description:      string;
  listing_type?:    "physical" | "download" | "both";
  taxonomy_id:      number;
  price:            number;
  quantity:         number;
  who_made:         "i_did" | "someone_else" | "collective";
  when_made:        string;
  tags?:            string[];
  materials?:       string[];
  styles?:          string[];
  sku?:             string;
  is_supply?:       boolean;
  is_customizable?: boolean;
  is_taxable?:      boolean;
  should_auto_renew?: boolean;
  item_weight?:     number;
  item_weight_unit?: string;
  item_length?:     number;
  item_width?:      number;
  item_height?:     number;
  item_dimensions_unit?: string;
  processing_min?:       number;
  processing_max?:       number;
  readiness_state_id?:   number; // Etsy v3 required for physical listings
}

export interface ImageItem { url: string; rank: number }
export interface DigitalFile { url: string; name?: string }
export interface VideoItem  { url: string }

export interface CategoryAttribute {
  value_ids: number[];
  values:    string[];
  scale_id?: number;
}

export interface VariationProperty {
  property_id: number;
  name:        string;
  scale_id?:   number;
  values:      string[];
}

export interface VariationOffering {
  [key: string]: string | number | boolean | undefined;
  price:    number;
  quantity: number;
  sku?:     string;
  enabled?: boolean;
  processing_profile_id?: number;
}

export interface VariationsConfig {
  properties:       VariationProperty[];
  offerings:        VariationOffering[];
  variation_images?: {
    property: string;
    mapping:  Record<string, number>;
  };
}

export interface PersonalizationConfig {
  enabled:       boolean;
  is_required?:  boolean;
  instructions?: string;
  max_chars?:    number;
}

export interface CreateListingBody {
  state:               "draft" | "publish" | "active";
  shops:               ShopConfig[];
  listing:             ListingData;
  images?:             ImageItem[];
  digital_files?:      DigitalFile[];
  videos?:             VideoItem[];
  personalization?:    PersonalizationConfig;
  category_attributes?: Record<string, CategoryAttribute>;
  variations?:         VariationsConfig;
}

export interface ShopResult {
  shop_id:             string;
  status:              "ok" | "error";
  listing_id?:         number;
  listing_url?:        string;
  currency_code?:      string;
  price?:              number;
  images?:             { listing_image_id: number; url_fullxfull: string; rank: number }[];
  videos?:             unknown[];
  activated?:          boolean;
  activation_cost_usd?: number;
  warnings?:           { code: string; fields: string; reason: string }[];
  error?:              string;
  details?:            unknown;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  reason: string;
}

export function validatePayload(body: CreateListingBody): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!body.state || !["draft", "publish", "active"].includes(body.state)) {
    errors.push({ field: "state", reason: "Must be 'draft', 'publish', or 'active'" });
  }
  if (!body.shops?.length) {
    errors.push({ field: "shops", reason: "At least one shop is required" });
  }
  if (!body.listing?.title) errors.push({ field: "listing.title", reason: "Title is required" });
  if (!body.listing?.description) errors.push({ field: "listing.description", reason: "Description is required" });
  if (!body.listing?.taxonomy_id) errors.push({ field: "listing.taxonomy_id", reason: "taxonomy_id is required" });
  if (!body.listing?.price && body.listing?.price !== 0) errors.push({ field: "listing.price", reason: "Price is required" });
  if (!body.listing?.quantity) errors.push({ field: "listing.quantity", reason: "Quantity is required" });
  if (!body.listing?.who_made) errors.push({ field: "listing.who_made", reason: "who_made is required" });
  if (!body.listing?.when_made) errors.push({ field: "listing.when_made", reason: "when_made is required" });
  if (body.listing?.tags && body.listing.tags.length > 13) {
    errors.push({ field: "listing.tags", reason: "Maximum 13 tags allowed" });
  }
  if (body.listing?.title && body.listing.title.length > 140) {
    errors.push({ field: "listing.title", reason: "Title must be 140 characters or less" });
  }
  if (body.variations?.properties && body.variations.properties.length > 2) {
    errors.push({ field: "variations.properties", reason: "Maximum 2 variation properties allowed" });
  }

  // Physical listing needs shipping + return policy
  if (!body.listing?.listing_type || body.listing.listing_type === "physical") {
    body.shops?.forEach((shop, i) => {
      if (!shop.shipping_profile_id) {
        errors.push({ field: `shops[${i}].shipping_profile_id`, reason: "Required for physical listings" });
      }
      if (!shop.return_policy_id) {
        errors.push({ field: `shops[${i}].return_policy_id`, reason: "Required for physical listings" });
      }
    });
  }

  // Images: warn if jt-upload:// URLs are referenced but no file exists
  // (actual file validation happens at request time)
  if (body.images) {
    body.images.forEach((img, i) => {
      if (!img.url) {
        errors.push({ field: `images[${i}].url`, reason: "Image URL is required" });
      }
      if (!img.rank || img.rank < 1) {
        errors.push({ field: `images[${i}].rank`, reason: "Image rank must be 1 or greater" });
      }
    });
  }

  return errors;
}

// ─── Job ID generator ─────────────────────────────────────────────────────────

function generateJobId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return "jt_" + Array.from({ length: 22 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generateListingPk(): number {
  return Math.floor(Date.now() / 1000) % 10000000 + Math.floor(Math.random() * 1000);
}

// ─── Draft creation ───────────────────────────────────────────────────────────

async function saveDraft(userId: string, apiKey: string, body: CreateListingBody) {
  const db        = getDb();
  const listingPk = generateListingPk();
  const jobId     = generateJobId();

  await db.collection("listingJobs").doc(jobId).set({
    userId, apiKey, listingPk,
    state: "draft",
    payload: body,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return {
    listing_pk:    listingPk,
    job_id:        jobId,
    status:        "draft" as const,
    dashboard_url: `/dashboard#drafts/${jobId}`,
  };
}

// ─── Etsy API helpers ─────────────────────────────────────────────────────────

async function etsyRequest(
  method: string,
  path: string,
  accessToken: string,
  body?: unknown,
  contentType: "json" | "form" = "json"
): Promise<Response> {
  const headers: Record<string, string> = {
    "x-api-key":     API_KEY(),
    "Authorization": `Bearer ${accessToken}`,
    "Accept":        "application/json",
  };

  let bodyPayload: string | FormData | undefined;

  if (body instanceof FormData) {
    // Multipart — no Content-Type header (browser sets boundary)
    bodyPayload = body;
  } else if (body && contentType === "form") {
    // Etsy listing create/update requires application/x-www-form-urlencoded
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const flat = body as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(flat)) {
      if (val === undefined || val === null) continue;
      if (Array.isArray(val)) {
        // Etsy v3's form parser expects repeated bare keys, NOT PHP bracket notation.
        // tags=a&tags=b&tags=c  ← correct (all values preserved)
        // tags[]=a&tags[]=b     ← wrong (Etsy reads "tags[]" as an unknown field)
        val.forEach(v => params.append(key, String(v)));
      } else {
        params.append(key, String(val));
      }
    }
    bodyPayload = params.toString();
  } else if (body) {
    headers["Content-Type"] = "application/json";
    bodyPayload = JSON.stringify(body);
  }

  return fetch(`${ETSY_BASE}${path}`, {
    method,
    headers,
    body: bodyPayload,
  });
}

// ─── Build Etsy listing payload from unified format ───────────────────────────

// ─── Field sanitisers ────────────────────────────────────────────────────────
// Etsy rejects materials that contain non-ASCII characters.
// This happens silently when copy-paste introduces typographic hyphens
// (U+2011, U+2013, U+2014), curly quotes, bullets, etc.
// We normalise every material string before it leaves the bridge:
//   1. Replace common lookalike punctuation with their ASCII equivalents.
//   2. Strip anything still outside printable ASCII (U+0020–U+007E).
//   3. Trim whitespace and drop empty strings.
// Tags follow the same rules per Etsy docs (plain ASCII, max 20 chars each).

function normaliseAscii(s: string): string {
  return s
    // Non-breaking hyphen, en-dash, em-dash → regular hyphen
    .replace(/[‑–—]/g, "-")
    // Curly/typographic quotes → straight quotes
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Bullet, middle dot → hyphen (materials context)
    .replace(/[•·]/g, "-")
    // Non-breaking space → regular space
    .replace(/ /g, " ")
    // Ellipsis → three dots
    .replace(/…/g, "...")
    // Strip anything still outside printable ASCII
    .replace(/[^ -~]/g, "")
    .trim();
}

function sanitiseMaterials(materials: string[]): string[] {
  return materials
    .map(normaliseAscii)
    .filter(Boolean);
}

function sanitiseTags(tags: string[]): string[] {
  return tags
    .map(t => normaliseAscii(t).slice(0, 20))
    .filter(Boolean);
}

function buildEtsyListingPayload(shopConfig: ShopConfig, listing: ListingData): Record<string, unknown> {
  const price = shopConfig.price ?? listing.price;

  const payload: Record<string, unknown> = {
    title:            listing.title,
    description:      listing.description,
    // Etsy v3 POST /shops/{id}/listings expects price as a plain float, not an object
    price:            price,
    quantity:          listing.quantity,
    who_made:          listing.who_made,
    when_made:         listing.when_made,
    taxonomy_id:       listing.taxonomy_id,
    listing_type:      listing.listing_type ?? "physical",
    tags:              sanitiseTags(listing.tags ?? []),
    materials:         sanitiseMaterials(listing.materials ?? []),
    styles:            listing.styles ?? [],
    is_supply:         listing.is_supply ?? false,
    is_customizable:   listing.is_customizable ?? false,
    is_taxable:        listing.is_taxable ?? true,
    should_auto_renew: listing.should_auto_renew ?? true,
  };

  if (shopConfig.shipping_profile_id) payload.shipping_profile_id = shopConfig.shipping_profile_id;
  if (shopConfig.return_policy_id)    payload.return_policy_id    = shopConfig.return_policy_id;
  if (shopConfig.shop_section_id)     payload.shop_section_id     = shopConfig.shop_section_id;
  if (listing.sku)                    payload.sku                 = listing.sku;
  if (listing.item_weight)            payload.item_weight         = listing.item_weight;
  if (listing.item_weight_unit)       payload.item_weight_unit    = listing.item_weight_unit;
  if (listing.item_length)            payload.item_length         = listing.item_length;
  if (listing.item_width)             payload.item_width          = listing.item_width;
  if (listing.item_height)            payload.item_height         = listing.item_height;
  if (listing.item_dimensions_unit)   payload.item_dimensions_unit = listing.item_dimensions_unit;
  // Send both processing_min/max AND readiness_state_id
  // Etsy requires readiness_state_id despite docs saying it's output-only.
  // The real ID is injected via shopConfig._readiness_state_id from resolveReadinessStateId().
  if (listing.processing_min) payload.processing_min = listing.processing_min;
  if (listing.processing_max) payload.processing_max = listing.processing_max;
  const injectedReadiness = (shopConfig as unknown as Record<string, unknown>)._readiness_state_id;
  if (injectedReadiness) payload.readiness_state_id = injectedReadiness;
  if (shopConfig.production_partner_ids?.length) {
    payload.production_partner_ids = shopConfig.production_partner_ids;
  }

  return payload;
}

// ─── Build Etsy inventory from variations ────────────────────────────────────

function buildEtsyInventory(variations: VariationsConfig, basePrice: number, readinessStateId: number): Record<string, unknown> {
  const { properties, offerings } = variations;

  // Build property name → property info lookup
  const propByName: Record<string, VariationProperty> = {};
  properties.forEach(p => { propByName[p.name.toLowerCase()] = p; });

  // Detect what varies
  const prices    = offerings.map(o => o.price as number);
  const allSamePrice = prices.every(p => p === prices[0]);
  const skus      = offerings.map(o => o.sku as string).filter(Boolean);
  const allUniqueSkus = skus.length === offerings.length && new Set(skus).size === offerings.length;

  // Build products
  const products = offerings.map(offering => {
    const propertyValues = properties.map(prop => {
      const key   = prop.name.toLowerCase();
      const value = offering[key] as string;
      return {
        property_id:   prop.property_id,
        // Custom variation properties (513=Flowers, 514=Color) use free-text values.
        // value_ids must be [] (empty) — sending [0] causes Etsy 404 "Resource not found".
        // Standard taxonomy properties may have real value_ids but we don't have them here,
        // so we always send [] and let Etsy match by values[] text.
        value_ids:     [],
        values:        [value],
        property_name: prop.name,
        ...(prop.scale_id ? { scale_id: prop.scale_id } : {}),
      };
    });

    const offeringPrice = (offering.price as number) ?? basePrice;

    return {
      sku:        (offering.sku as string) ?? "",
      offerings: [{
        // Inventory PUT requires plain float — NOT the {amount, divisor} object Etsy returns on reads
        price:              offeringPrice,
        quantity:           (offering.quantity as number) ?? 1,
        is_enabled:         (offering.enabled as boolean) !== false,
        // Required on every offering — use per-offering value if provided, else shop default
        readiness_state_id: (offering.processing_profile_id as number) || readinessStateId,
      }],
      property_values: propertyValues,
    };
  });

  // price_on_property / sku_on_property: must include ALL properties for N-property listings.
  // Sending only properties[0] on a 2-property listing causes Etsy 400:
  //   "price must be consistent across linked products" / SKU mismatch.
  // Etsy accepts an array of property_ids — include every property that participates.
  const allPropertyIds = properties.map(p => p.property_id).filter(Boolean);
  const priceOnProp  = allSamePrice  ? [] : allPropertyIds;
  const skuOnProp    = allUniqueSkus ? allPropertyIds : [];

  return { products, price_on_property: priceOnProp, quantity_on_property: [], sku_on_property: skuOnProp };
}

// ─── Resolve jt-upload:// URL → binary buffer ────────────────────────────────
// For presigned uploads (Vercel Blob): fetch from blobUrl stored in Firestore
// For legacy small uploads: reconstruct from base64 data in Firestore

async function resolveUploadUrl(url: string, db: Firestore): Promise<{ buffer: Buffer; contentType: string; filename: string } | null> {
  if (!url.startsWith("jt-upload://")) return null;

  const uploadId = url.replace("jt-upload://", "");
  const snap     = await db.collection("uploads").doc(uploadId).get();
  if (!snap.exists) return null;

  const data = snap.data()!;

  // Check not expired
  const expiresAt: Date = data.expiresAt?.toDate?.() ?? new Date(0);
  if (new Date() > expiresAt) return null;

  // Presigned upload path — file is on Vercel Blob, fetch it
  if (data.blobUrl) {
    const res = await fetch(data.blobUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType: data.contentType, filename: data.filename };
  }

  // Legacy small upload — inline base64 in Firestore
  if (data.isChunked) {
    const chunks: Buffer[] = [];
    for (let i = 0; i < data.chunks; i++) {
      const chunkSnap = await db.collection("uploadChunks").doc(`${uploadId}_${i}`).get();
      if (!chunkSnap.exists) return null;
      chunks.push(Buffer.from(chunkSnap.data()!.data, "base64"));
    }
    return { buffer: Buffer.concat(chunks), contentType: data.contentType, filename: data.filename };
  }

  if (!data.data) return null;
  return { buffer: Buffer.from(data.data, "base64"), contentType: data.contentType, filename: data.filename };
}

// ─── Upload image to Etsy (URL or jt-upload:// → re-upload) ─────────────────

async function uploadImageToListing(
  shopId: number, listingId: number,
  imageUrl: string, rank: number,
  accessToken: string,
  db?: Firestore
): Promise<{ listing_image_id: number; url_fullxfull: string; rank: number } | null> {
  try {
    let buffer: Buffer;
    let contentType: string;

    if (imageUrl.startsWith("jt-upload://") && db) {
      // Resolve from Firestore upload cache
      const resolved = await resolveUploadUrl(imageUrl, db);
      if (!resolved) throw new Error(`Upload file not found or expired: ${imageUrl}`);
      buffer      = resolved.buffer;
      contentType = resolved.contentType;
    } else {
      // Fetch from remote URL
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
      buffer      = Buffer.from(await imgResp.arrayBuffer());
      contentType = imgResp.headers.get("content-type") ?? "image/jpeg";
    }

    const ext = contentType.includes("png") ? "png" : contentType.includes("gif") ? "gif" : "jpg";

    const fd = new FormData();
    fd.append("image", new Blob([new Uint8Array(buffer)], { type: contentType }), `image.${ext}`);
    fd.append("rank",  String(rank));

    const res = await etsyRequest(
      "POST",
      `/application/shops/${shopId}/listings/${listingId}/images`,
      accessToken,
      fd
    );

    if (!res.ok) return null;
    const data = await res.json();
    return {
      listing_image_id: data.listing_image_id,
      url_fullxfull:    data.url_fullxfull ?? "",
      rank:             data.rank ?? rank,
    };
  } catch {
    return null;
  }
}

// ─── Set category attributes ──────────────────────────────────────────────────

async function setCategoryAttributes(
  shopId: number, listingId: number,
  attrs: Record<string, CategoryAttribute>,
  accessToken: string
) {
  await Promise.allSettled(
    Object.entries(attrs).map(([propertyId, attr]) =>
      etsyRequest(
        "PUT",
        `/application/shops/${shopId}/listings/${listingId}/properties/${propertyId}`,
        accessToken,
        {
          value_ids: attr.value_ids,
          values:    attr.values,
          ...(attr.scale_id ? { scale_id: attr.scale_id } : {}),
        }
      )
    )
  );
}

// ─── Set personalization ──────────────────────────────────────────────────────

async function setPersonalization(
  shopId: number, listingId: number,
  personalization: PersonalizationConfig,
  accessToken: string
) {
  await etsyRequest(
    "PUT",
    `/application/shops/${shopId}/listings/${listingId}/listing_personalization`,
    accessToken,
    {
      is_personalizable:     personalization.enabled,
      is_customizable:       personalization.enabled,
      personalization_instructions: personalization.instructions ?? "",
      personalization_char_count_max: personalization.max_chars ?? 256,
      personalization_is_required: personalization.is_required ?? false,
    }
  );
}

// Strip undefined/null values from warning objects before pushing to Firestore.
// Firestore rejects documents containing undefined even on optional fields.
// ignoreUndefinedProperties in getDb() is the primary guard; this is belt-and-suspenders.
function sanitizeWarning(w: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined));
}

// ─── Resolve readiness_state_id for a shop ───────────────────────────────────
//
// Priority order:
//   1. shopConfig.processing_profile_id  — caller supplied a real Etsy ID (large integer).
//      Use it directly; no network call needed.
//   2. GET /readiness-state-definitions  — the official Etsy endpoint (shops_r scope).
//      Returns profiles regardless of whether the shop has active listings.
//      If multiple profiles exist, pick the one whose min/max best matches
//      the requested processing window (or just take the first).
//   3. Hard error — do NOT silently fall back to a hardcoded table.
//      Hardcoded IDs (1, 2, 3…) are NOT universal; they are shop-specific.
//      Sending the wrong ID causes Etsy's "Could not find readiness_state_id" error.

// Returns null if the endpoint is unreachable or the shop has no profiles.
async function fetchReadinessStateIdFromEtsy(
  shopId: number,
  accessToken: string,
  preferredMin?: number,
  preferredMax?: number,
): Promise<number | null> {
  try {
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
      console.warn(`[ListingBuilder] readiness-state-definitions returned ${res.status} for shop ${shopId}`);
      return null;
    }
    const data = await res.json();
    const profiles: Array<{ readiness_state_id: number; min_processing_days: number; max_processing_days: number }> =
      data.results ?? [];

    if (profiles.length === 0) return null;

    // If caller supplied a preferred processing window, try to match it
    if (preferredMin !== undefined || preferredMax !== undefined) {
      const pMin = preferredMin ?? 1;
      const pMax = preferredMax ?? pMin;
      const match = profiles.find(
        p => p.min_processing_days === pMin && p.max_processing_days === pMax
      );
      if (match) {
        console.log(`[ListingBuilder] Matched readiness_state_id=${match.readiness_state_id} for ${pMin}-${pMax} days on shop ${shopId}`);
        return match.readiness_state_id;
      }
    }

    // No exact match — take first profile and warn
    const first = profiles[0];
    console.warn(
      `[ListingBuilder] No exact processing-time match for shop ${shopId} — ` +
      `using first profile readiness_state_id=${first.readiness_state_id} ` +
      `(${first.min_processing_days}-${first.max_processing_days} days)`
    );
    return first.readiness_state_id;
  } catch (err) {
    console.warn(`[ListingBuilder] Could not fetch readiness-state-definitions for shop ${shopId}:`, err);
    return null;
  }
}

// ─── Set variation images ─────────────────────────────────────────────────────
// Maps variation values to uploaded images via Etsy's variation-images endpoint.
// variation_images.mapping = { "Red": 0, "Blue": 1 } → 0-based index into images[]
// uploadedImages = array of { listing_image_id, url_fullxfull, rank } from Etsy

async function setVariationImages(
  shopId: number,
  listingId: number,
  variationImages: { property: string; mapping: Record<string, number> },
  properties: VariationProperty[],
  uploadedImages: { listing_image_id: number; url_fullxfull: string; rank: number }[],
  accessToken: string
): Promise<{ ok: boolean; etsy_status?: number; etsy_error?: unknown; payload_sent?: unknown; error?: string }> {
  // Find the property_id for the variation that has images
  const propName = variationImages.property.toLowerCase();
  const prop = properties.find(p => p.name.toLowerCase() === propName);
  if (!prop) {
    return { ok: false, error: `Variation property '${variationImages.property}' not found in properties[]` };
  }

  // ROUND-TRIP: After inventory PUT, Etsy auto-assigns value_ids to custom property values.
  // We must GET /listings/{id}/inventory to read back the real value_ids before
  // building the variation-images payload (which only accepts numeric value_id >= 1).
  //
  // Etsy has a read-after-write consistency window — the value_ids may not be populated
  // immediately after the PUT. Retry with backoff before declaring failure.
  let etsyValueIdMap: Record<string, number> = {}; // "1 Glazed Stem" → 12345678

  const invReadDelays = [500, 1500, 3000];
  for (let attempt = 0; attempt <= invReadDelays.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, invReadDelays[attempt - 1]));
      console.log(`[ListingBuilder] Retrying inventory GET for value_ids (attempt ${attempt + 1}) on listing ${listingId}`);
    }
    try {
      const invRes = await etsyRequest(
        "GET",
        `/application/listings/${listingId}/inventory`,
        accessToken
      );
      if (!invRes.ok) {
        console.warn(`[ListingBuilder] Inventory GET returned ${invRes.status} on attempt ${attempt + 1}`);
        continue;
      }
      const invData = await invRes.json();
      const products = invData.products ?? [];
      for (const product of products) {
        const propVal = (product.property_values ?? []).find(
          (pv: { property_id: number }) => pv.property_id === prop.property_id
        );
        if (propVal && propVal.values?.length && propVal.value_ids?.length) {
          const valueStr = propVal.values[0] as string;
          const valueId  = propVal.value_ids[0] as number;
          if (valueId >= 1) {
            etsyValueIdMap[valueStr] = valueId;
          }
        }
      }
      const readCount = Object.keys(etsyValueIdMap).length;
      console.log(`[ListingBuilder] Read back ${readCount} value_ids from inventory (attempt ${attempt + 1})`);
      if (readCount > 0) break; // got what we need
    } catch (err) {
      console.warn(`[ListingBuilder] Inventory GET threw on attempt ${attempt + 1}:`, err);
    }
  }

  // Build variation-images payload with real Etsy value_ids
  const variationImageEntries: { property_id: number; value_id: number; image_id: number }[] = [];

  for (const [value, imageIndex] of Object.entries(variationImages.mapping)) {
    const uploadedImage = uploadedImages[imageIndex];
    if (!uploadedImage) {
      console.warn(`[ListingBuilder] variation_images: no uploaded image at index ${imageIndex} for value "${value}"`);
      continue;
    }
    const valueId = etsyValueIdMap[value];
    if (!valueId || valueId < 1) {
      console.warn(`[ListingBuilder] No Etsy value_id found for "${value}" — skipping`);
      continue;
    }
    variationImageEntries.push({
      property_id: prop.property_id,
      value_id:    valueId,
      image_id:    uploadedImage.listing_image_id,
    });
  }

  if (variationImageEntries.length === 0) {
    return { ok: false, error: "No valid variation image mappings — could not read back value_ids from Etsy inventory" };
  }

  const payload = { variation_images: variationImageEntries };

  // Retry with backoff
  const delays = [1000, 2000, 3000];
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delays[attempt - 1]));
      console.log(`[ListingBuilder] variation-images retry ${attempt} for listing ${listingId}`);
    }
    lastRes = await etsyRequest(
      "POST",
      `/application/shops/${shopId}/listings/${listingId}/variation-images`,
      accessToken,
      payload
    );
    console.log(`[ListingBuilder] variation-images attempt ${attempt + 1}: ${lastRes.status}`);
    if (lastRes.ok) return { ok: true };
    if (lastRes.status !== 404) break;
  }

  const errText = await lastRes!.text();
  let errBody: unknown;
  try { errBody = JSON.parse(errText); } catch { errBody = errText; }

  return {
    ok:           false,
    etsy_status:  lastRes!.status,
    etsy_error:   errBody,
    payload_sent: payload,
  };
}

// ─── Publish to a single shop ─────────────────────────────────────────────────

async function publishToShop(
  userId: string,
  shopConfig: ShopConfig,
  body: CreateListingBody,
  state: "publish" | "active",
  db: Firestore
): Promise<ShopResult> {
  const shopId = shopConfig.shop_id;

  // Get OAuth token for this shop
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, String(shopId));
  } catch {
    return {
      shop_id: String(shopId),
      status:  "error",
      error:   `Shop ${shopId} is not connected. Connect it at jeterdev.tools/dashboard.`,
    };
  }

  // 1. Resolve readiness_state_id — three-step priority:
  //    a) shopConfig.processing_profile_id is a real Etsy ID (large integer) → use directly
  //    b) GET /readiness-state-definitions → pick matching profile
  //    c) No profiles found → hard fail (do NOT fall back to a hardcoded table)
  let readinessStateId: number;

  const rawProfileId = shopConfig.processing_profile_id;
  const parsedProfileId = typeof rawProfileId === "string"
    ? parseInt(rawProfileId, 10)
    : (typeof rawProfileId === "number" ? rawProfileId : NaN);

  // Real Etsy readiness_state_ids are large shop-specific integers (> 1000).
  // Synthetic composite keys like "1-3" parse to NaN or small numbers — skip those.
  if (!isNaN(parsedProfileId) && parsedProfileId > 1000) {
    readinessStateId = parsedProfileId;
    console.log(`[ListingBuilder] Using caller-supplied processing_profile_id=${readinessStateId} as readiness_state_id for shop ${shopId}`);
  } else {
    // Not supplied or not a real ID — fetch from Etsy
    const preferredMin = body.listing.processing_min;
    const preferredMax = body.listing.processing_max;
    const fetched = await fetchReadinessStateIdFromEtsy(shopId, accessToken, preferredMin, preferredMax);
    if (!fetched) {
      return {
        shop_id: String(shopId),
        status:  "error",
        error:   `Could not resolve a readiness_state_id for shop ${shopId}. ` +
                 `Supply processing_profile_id from GET /stores/${shopId}/processing-profiles/live, ` +
                 `or configure processing time in your Etsy dashboard.`,
      };
    }
    readinessStateId = fetched;
  }

  const shopConfigWithReadiness = {
    ...shopConfig,
    _readiness_state_id: readinessStateId,
  };

  // Build the Etsy listing payload
  const etsyPayload = buildEtsyListingPayload(shopConfigWithReadiness, body.listing);
  console.log("[ListingBuilder] Payload readiness_state_id:", (etsyPayload as Record<string,unknown>).readiness_state_id);
  // Etsy createDraftListing requires application/x-www-form-urlencoded
  const createRes = await etsyRequest(
    "POST",
    `/application/shops/${shopId}/listings`,
    accessToken,
    etsyPayload,
    "form"
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    let errBody: unknown;
    try { errBody = JSON.parse(errText); } catch { errBody = errText; }
    console.error(
      `[ListingBuilder] listings/create failed for shop ${shopId} (${createRes.status}):`,
      JSON.stringify(errBody),
      "\nPayload sent:",
      JSON.stringify(etsyPayload)
    );
    return {
      shop_id: String(shopId),
      status:  "error",
      error:   `Etsy listing creation failed (${createRes.status})`,
      details: {
        etsy_status:  createRes.status,
        etsy_error:   errBody,
        payload_sent: etsyPayload,
      },
    };
  }

  const created = await createRes.json();
  const listingId: number = created.listing_id;

  const warnings: { code: string; fields: string; reason: string }[] = [];
  const uploadedImages: { listing_image_id: number; url_fullxfull: string; rank: number }[] = [];
  const uploadedVideos: unknown[] = [];

  // 2. Upload images
  // Etsy supports up to 10 images per listing. For listings with more than 10,
  // we upload all sequentially after creation — ranks above 10 are accepted by Etsy's
  // image upload endpoint even though the listing create payload caps at 10.
  if (body.images?.length) {
    // Sort by rank to upload in order
    const sortedImages = [...body.images].sort((a, b) => a.rank - b.rank);

    for (const img of sortedImages) {
      const uploaded = await uploadImageToListing(shopId, listingId, img.url, img.rank, accessToken, db);
      if (uploaded) {
        uploadedImages.push(uploaded);
      } else {
        warnings.push({ code: "IMAGE_UPLOAD_FAILED", fields: `images[${img.rank}].url`, reason: `Failed to upload image at rank ${img.rank}` });
      }
    }
  }

  // 3. Set inventory/variations
  // Two code paths:
  //   A) Variations listing  → buildEtsyInventory() builds the full product matrix
  //   B) Single-item listing → minimal inventory PUT with one product, used ONLY to
  //      persist the SKU. Etsy v3 ignores the top-level sku field on listing create;
  //      SKU must live in inventory.products[0].sku.
  // Both paths share the same retry-with-backoff logic (Etsy 404 for ~1-3s after create).

  // ── Path B: single-item SKU ──────────────────────────────────────────────
  const hasSku        = Boolean(body.listing.sku);
  const hasVariations = Boolean(body.variations?.properties?.length);

  if (hasSku && !hasVariations) {
    const singleItemInventory = {
      products: [{
        sku:             body.listing.sku,
        property_values: [],
        offerings: [{
          // Inventory PUT expects a plain float, not a money object.
          // Same fix as the variations path — amount/divisor = float.
          price:      parseFloat((body.listing.price ?? 0).toFixed(2)),
          quantity:   body.listing.quantity ?? 1,
          is_enabled: true,
        }],
      }],
      price_on_property:    [],
      quantity_on_property: [],
      sku_on_property:      [],
    };

    const SKU_URL = `/application/listings/${listingId}/inventory`;
    let skuRes: Response | null = null;
    const skuDelays = [1000, 2000, 3000];

    for (let attempt = 0; attempt <= skuDelays.length; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, skuDelays[attempt - 1]));
        console.log(`[ListingBuilder] SKU inventory PUT retry ${attempt} for listing ${listingId}`);
      }
      skuRes = await etsyRequest("PUT", SKU_URL, accessToken, singleItemInventory);
      console.log(`[ListingBuilder] SKU inventory PUT attempt ${attempt + 1}: ${skuRes.status}`);
      if (skuRes.ok) break;
      // Retry on 404 (listing not yet consistent) and 409 (write conflict).
      // Any other status (400 bad payload, 403 auth, etc.) is not retryable — log and bail.
      const retryable = skuRes.status === 404 || skuRes.status === 409;
      if (!retryable) {
        const preview = await skuRes.clone().text().catch(() => "(unreadable)");
        console.error(`[ListingBuilder] SKU PUT non-retryable ${skuRes.status} for listing ${listingId}:`, preview);
        break;
      }
    }

    if (!skuRes || !skuRes.ok) {
      const skuErrText = await skuRes!.text();
      let skuErrBody: unknown;
      try { skuErrBody = JSON.parse(skuErrText); } catch { skuErrBody = skuErrText; }
      console.error(`[ListingBuilder] SKU inventory PUT failed for listing ${listingId}:`, JSON.stringify(skuErrBody));
      warnings.push(sanitizeWarning({
        code:        "SKU_SET_FAILED",
        fields:      "listing.sku",
        reason:      `SKU inventory PUT failed after ${skuDelays.length + 1} attempts`,
        etsy_error:  skuErrBody,
        etsy_status: skuRes!.status,
        payload_sent: singleItemInventory,
      }) as unknown as { code: string; fields: string; reason: string });
    } else {
      console.log(`[ListingBuilder] SKU set for listing ${listingId}: ${body.listing.sku}`);
    }
  }

  // ── Path A: variations inventory ─────────────────────────────────────────
  if (hasVariations) {
    const inventory = buildEtsyInventory(body.variations!, body.listing.price, readinessStateId);
    const INVENTORY_URL = `/application/listings/${listingId}/inventory`;

    let invRes: Response | null = null;
    const delays = [1000, 2000, 3000];

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, delays[attempt - 1]));
        console.log(`[ListingBuilder] Inventory PUT retry ${attempt} for listing ${listingId}`);
      }
      invRes = await etsyRequest("PUT", INVENTORY_URL, accessToken, inventory);
      console.log(`[ListingBuilder] Inventory PUT attempt ${attempt + 1}: ${invRes.status}`);
      if (invRes.ok) break;
      if (invRes.status !== 404) break; // only retry on 404
    }

    if (!invRes || !invRes.ok) {
      const invErrText = await invRes!.text();
      let invErrBody: unknown;
      try { invErrBody = JSON.parse(invErrText); } catch { invErrBody = invErrText; }
      console.error(`[ListingBuilder] Inventory PUT failed for listing ${listingId}:`, JSON.stringify(invErrBody));
      warnings.push(sanitizeWarning({
        code:       "INVENTORY_SET_FAILED",
        fields:     "variations",
        reason:     `Inventory PUT failed after ${delays.length + 1} attempts`,
        etsy_error:  invErrBody,
        etsy_status: invRes!.status,
        inventory_payload_sent: inventory,
      }) as unknown as { code: string; fields: string; reason: string });
    }
  } // end Path A

  // 4. Set variation images (link uploaded images to variation values)
  if (body.variations?.variation_images && uploadedImages.length > 0) {
    const viResult = await setVariationImages(
      shopId,
      listingId,
      body.variations.variation_images,
      body.variations.properties,
      uploadedImages,
      accessToken
    );
    if (!viResult.ok) {
      console.warn(`[ListingBuilder] Variation images failed for listing ${listingId}:`, viResult.etsy_error ?? viResult.error);
      warnings.push(sanitizeWarning({
        code:         "VARIATION_IMAGES_FAILED",
        fields:       "variations.variation_images",
        reason:       `Variation-images POST failed after ${4} attempts`,
        etsy_status:  viResult.etsy_status,
        etsy_error:   viResult.etsy_error,
        payload_sent: viResult.payload_sent,
      }) as unknown as { code: string; fields: string; reason: string });
    } else {
      console.log(`[ListingBuilder] ✓ Variation images set for listing ${listingId}`);
    }
  }

  // 5. Set category attributes
  if (body.category_attributes && Object.keys(body.category_attributes).length > 0) {
    await setCategoryAttributes(shopId, listingId, body.category_attributes, accessToken);
  }

  // 6. Set personalization
  if (body.personalization?.enabled) {
    await setPersonalization(shopId, listingId, body.personalization, accessToken);
  }

  // 7. Activate if state="active"
  let activated = false;
  if (state === "active") {
    const activateRes = await etsyRequest(
      "PATCH",
      `/application/shops/${shopId}/listings/${listingId}`,
      accessToken,
      { state: "active" }
    );
    activated = activateRes.ok;
    if (!activateRes.ok) {
      warnings.push({ code: "ACTIVATION_FAILED", fields: "state", reason: "Failed to activate listing on Etsy" });
    }
  }

  const listingPrice = shopConfig.price ?? body.listing.price;

  return {
    shop_id:    String(shopId),
    status:     "ok",
    listing_id: listingId,
    listing_url: `https://www.etsy.com/listing/${listingId}`,
    currency_code: "USD",
    price:      listingPrice,
    images:     uploadedImages,
    videos:     uploadedVideos,
    activated,
    activation_cost_usd: state === "active" ? 0.20 : 0,
    warnings,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function createListing(
  userId: string,
  apiKey: string,
  body: CreateListingBody
): Promise<Record<string, unknown>> {
  const db = getDb() as Firestore;

  // Draft — no Etsy calls
  if (body.state === "draft") {
    return saveDraft(userId, apiKey, body);
  }

  // Publish / Active — orchestrate per-shop
  const listingPk = generateListingPk();
  const jobId     = generateJobId();

  const results = await Promise.allSettled(
    body.shops.map(shop => publishToShop(userId, shop, body, body.state as "publish" | "active", db))
  );

  const shopResults: ShopResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      shop_id: String(body.shops[i].shop_id),
      status:  "error" as const,
      error:   r.reason?.message ?? "Unknown error",
    };
  });

  const allFailed  = shopResults.every(r => r.status === "error");
  const jobStatus  = allFailed ? "failed" : "completed";

  const activationCost = body.state === "active" ? body.shops.length * 0.20 : 0;

  const response: Record<string, unknown> = {
    job_id:      jobId,
    listing_pk:  listingPk,
    status:      jobStatus,
    shops_count: body.shops.length,
    results:     shopResults,
    poll_url:    `/api/v1/listings/create/${jobId}`,
    ...(body.state === "active" ? {
      activation_cost_usd: activationCost,
      warnings: [{
        code:   "ACTIVATION_COST_WARNING",
        fields: "state",
        reason: `Activating ${body.shops.length} listing(s) costs $${activationCost.toFixed(2)} USD (Etsy listing fee).`,
      }],
    } : {}),
  };

  // Store job in Firestore for poll endpoint (24h TTL)
  await db.collection("listingJobs").doc(jobId).set({
    userId, apiKey, listingPk,
    state:     body.state,
    status:    jobStatus,
    response,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return response;
}