// LOCATION: app/api/v1/listings/variation-images/route.ts
// POST /api/v1/listings/variation-images
//   Body: { shop_id, listing_id, property, mapping: { "<value>": <listing_image_id> } }
//
// Sets the variation→image links on an ALREADY-published listing (owner "update"
// flow). The create endpoint links images inline; this lets an edit re-push the
// associations after the owner adds/renames a variation or re-links a photo.
// `mapping` is { value → listing_image_id } — the caller resolves the concrete
// Etsy image id per value (so it never depends on Etsy's image order); we resolve
// the real value_id (read back from inventory) live. OAuth-required (listings_w).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { setVariationImagesOnListing } from "@/lib/listing-builder";
import { proxyEtsyRequest } from "@/lib/etsy-client";
import { getValidAccessToken } from "@/lib/etsy-oauth";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    "X-Content-Type-Options":       "nosniff",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function bad(message: string, status = 400) {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", status, message } },
    { status, headers: corsHeaders() },
  );
}

// GET /api/v1/listings/variation-images?shop_id=…&listing_id=…
//   READS the per-variation image mapping [{ property_id, value_id, image_id }]
//   from Etsy (getListingVariationImages). Consumers pair this with
//   /listings/images to resolve image_id → URL. OAuth-required (listings_r).
//
//   This route file previously exported only POST (the "set" flow), which
//   shadowed the catch-all proxy — so a GET here 405'd and every consumer's
//   variation-image read silently fell back to the main image. This handler
//   restores the read using the same OAuth + proxy path as the catch-all.
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const a = await validateRequest(apiKey, "listings/variation-images");
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status, headers: corsHeaders() });

  const shopId = req.nextUrl.searchParams.get("shop_id");
  const listingId = req.nextUrl.searchParams.get("listing_id");
  if (!shopId || !listingId) return bad("shop_id and listing_id query params are required.");

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(a.userId, shopId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OAuth error";
    const notConnected = msg.startsWith("STORE_NOT_CONNECTED");
    return NextResponse.json(
      {
        error: {
          code: notConnected ? "STORE_NOT_CONNECTED" : "OAUTH_ERROR",
          status: notConnected ? 409 : 502,
          message: notConnected ? "That shop isn’t connected to JeterDev." : msg,
          docs: "https://jeterdev.tools/docs#store-connection",
        },
      },
      { status: notConnected ? 409 : 502, headers: corsHeaders() },
    );
  }

  let result;
  try {
    result = await proxyEtsyRequest(
      "listings/variation-images",
      { shop_id: shopId, listing_id: listingId },
      undefined,
      accessToken,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "UPSTREAM_ERROR", status: 502, message: "The Etsy API returned an error.", details: msg } },
      { status: 502, headers: corsHeaders() },
    );
  }
  if (!result) return bad("Endpoint unavailable.", 404);
  return NextResponse.json(result.data, { status: result.status, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const a = await validateRequest(apiKey, "listings/variation-images");
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status, headers: corsHeaders() });

  let body: { shop_id?: number | string; listing_id?: number | string; property?: string; mapping?: Record<string, number> };
  try { body = await req.json(); } catch { return bad("Invalid JSON body."); }

  const shopId = Number(body.shop_id);
  const listingId = Number(body.listing_id);
  const property = typeof body.property === "string" ? body.property : "";
  const mapping = body.mapping && typeof body.mapping === "object" ? body.mapping : {};
  if (!shopId || !listingId) return bad("shop_id and listing_id are required.");
  if (!property) return bad("property (the image-bearing variation name) is required.");
  if (!Object.keys(mapping).length) return bad("mapping { value: listing_image_id } is required.");

  try {
    const r = await setVariationImagesOnListing(a.userId, shopId, listingId, property, mapping);
    if (!r.ok) {
      return NextResponse.json(
        { error: { code: "VARIATION_IMAGES_FAILED", status: r.etsy_status ?? 502, message: r.error ?? `Etsy rejected the links: ${JSON.stringify(r.etsy_error).slice(0, 300)}` } },
        { status: r.etsy_status && r.etsy_status >= 400 ? r.etsy_status : 502, headers: corsHeaders() },
      );
    }
    return NextResponse.json({ status: "completed", linked: r.linked ?? 0 }, { status: 200, headers: corsHeaders() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", status: 500, message: msg } }, { status: 500, headers: corsHeaders() });
  }
}
