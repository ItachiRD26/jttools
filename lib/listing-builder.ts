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
    tags:              listing.tags ?? [],
    materials:         listing.materials ?? [],
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
  // processing_min/max are the correct INPUT fields for Etsy createDraftListing.
  // readiness_state_id is an OUTPUT field only per Etsy docs.
  // We still need readiness_state_id on inventory PUT offerings (different endpoint).
  if (listing.processing_min) payload.processing_min = listing.processing_min;
  if (listing.processing_max) payload.processing_max = listing.processing_max;
  if (shopConfig.production_partner_ids?.length) {
    payload.production_partner_ids = shopConfig.production_partner_ids;
  }

  return payload;
}

// ─── Build Etsy inventory from variations ────────────────────────────────────

function buildEtsyInventory(variations: VariationsConfig, basePrice: number, readinessStateId = 3): Record<string, unknown> {
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

  // price_on_property: which property causes price variation
  const priceOnProp  = allSamePrice  ? [] : [properties[0]?.property_id].filter(Boolean);
  const skuOnProp    = allUniqueSkus ? [properties[0]?.property_id].filter(Boolean) : [];

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

// ─── Fetch real readiness_state_id from shop's active listings ───────────────
// Etsy v3 requires a shop-specific readiness_state_id — it cannot be set inline.
// We grab it from any active listing on the shop.

// Map processing_min/max to Etsy's standard readiness_state_id
// These are universal IDs — not shop-specific
function processingToReadinessId(min: number, max: number): number {
  if (max <= 1)  return 1; // Same day / 1 day
  if (max <= 2)  return 2; // 1-2 days
  if (max <= 3)  return 3; // 1-3 days
  if (max <= 5)  return 4; // 3-5 days
  if (max <= 7)  return 5; // 1-2 weeks (up to 7 days)
  if (max <= 14) return 6; // 1-2 weeks
  if (max <= 21) return 7; // 2-3 weeks
  if (max <= 30) return 8; // 3-4 weeks
  return 9;                // longer
}

async function fetchReadinessStateId(
  shopId: number,
  accessToken: string,
  processingMin?: number,
  processingMax?: number,
): Promise<number> {
  // First try: get from an active listing on the shop (most reliable)
  try {
    const res = await fetch(
      `${ETSY_BASE}/application/shops/${shopId}/listings/active?limit=5&fields=listing_id,readiness_state_id`,
      {
        headers: {
          "x-api-key":     API_KEY(),
          "Authorization": `Bearer ${accessToken}`,
          "Accept":        "application/json",
        },
      }
    );
    if (res.ok) {
      const data     = await res.json();
      const listings = data.results ?? [];
      // Find first listing that has a valid readiness_state_id
      for (const listing of listings) {
        const id = listing?.readiness_state_id;
        if (id && typeof id === "number" && id > 0) {
          console.log(`[ListingBuilder] Got readiness_state_id=${id} from active listing on shop ${shopId}`);
          return id;
        }
      }
    }
  } catch (err) {
    console.warn(`[ListingBuilder] Could not fetch readiness_state_id from listings:`, err);
  }

  // Second try: map from processing_min/max provided in the request
  if (processingMin !== undefined || processingMax !== undefined) {
    const min = processingMin ?? 1;
    const max = processingMax ?? 3;
    const id  = processingToReadinessId(min, max);
    console.log(`[ListingBuilder] Derived readiness_state_id=${id} from processing_min=${min} processing_max=${max}`);
    return id;
  }

  // Final fallback
  console.warn(`[ListingBuilder] Using readiness_state_id=4 (3-5 days) as fallback for shop ${shopId}`);
  return 4;
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

  // 1. Fetch real readiness_state_id from this shop's active listings
  const readinessStateId = await fetchReadinessStateId(shopId, accessToken);
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
    console.error(`[ListingBuilder] Etsy 400 for shop ${shopId}:`, JSON.stringify(errBody));
    return {
      shop_id: String(shopId),
      status:  "error",
      error:   (errBody as { error?: string })?.error ?? `Etsy listing creation failed (${createRes.status})`,
      details: errBody,
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
  // Two bugs fixed:
  // (a) Wrong URL: must be /application/listings/{id}/inventory (no /shops/ prefix)
  // (b) Etsy eventual consistency: new listings return 404 for ~1-3s after create
  //     Retry with backoff — same approach ETO used.
  if (body.variations?.properties?.length) {
    const inventory = buildEtsyInventory(body.variations, body.listing.price, readinessStateId);
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
      warnings.push({
        code:       "INVENTORY_SET_FAILED",
        fields:     "variations",
        reason:     `Inventory PUT failed after ${delays.length + 1} attempts`,
        etsy_error:  invErrBody,
        etsy_status: invRes!.status,
        inventory_payload_sent: inventory,
      } as unknown as { code: string; fields: string; reason: string });
    }
  }

  // 4. Set category attributes
  if (body.category_attributes && Object.keys(body.category_attributes).length > 0) {
    await setCategoryAttributes(shopId, listingId, body.category_attributes, accessToken);
  }

  // 5. Set personalization
  if (body.personalization?.enabled) {
    await setPersonalization(shopId, listingId, body.personalization, accessToken);
  }

  // 6. Activate if state="active"
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