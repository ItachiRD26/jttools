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

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
