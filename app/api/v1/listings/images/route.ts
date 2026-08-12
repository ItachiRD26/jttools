// LOCATION: app/api/v1/listings/images/route.ts
// Reconcile images on an EXISTING listing (owner-portal "update" flow):
//   POST   — add image(s)   body { shop_id, listing_id, images: [{ url, rank }] }
//   DELETE — remove an image body { shop_id, listing_id, listing_image_id }
//   GET    — list images    query ?shop_id=&listing_id=
// The create endpoint uploads all images at once; this lets an update push only
// the ones that failed or were newly added, and delete the ones that were
// removed — so Etsy's images stay in sync with the source of truth.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import {
  uploadImagesToExistingListing,
  deleteListingImage,
  listListingImages,
} from "@/lib/listing-builder";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, DELETE, GET, OPTIONS",
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

async function auth(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const res = await validateRequest(apiKey, "listings/images");
  return res;
}

// ── Add images to an existing listing ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const a = await auth(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status, headers: corsHeaders() });

  let body: { shop_id?: number | string; listing_id?: number | string; images?: Array<{ url?: string; rank?: number }> };
  try { body = await req.json(); } catch { return bad("Invalid JSON body."); }

  const shopId = Number(body.shop_id);
  const listingId = Number(body.listing_id);
  const images = Array.isArray(body.images) ? body.images : [];
  if (!shopId || !listingId) return bad("shop_id and listing_id are required.");
  if (!images.length) return bad("images[] is required (each { url, rank }).");
  const clean = images
    .filter((i) => i && typeof i.url === "string" && i.url)
    .map((i) => ({ url: i.url as string, rank: Number(i.rank) || 1 }));
  if (!clean.length) return bad("No valid images to upload (each needs a url).");

  try {
    const results = await uploadImagesToExistingListing(a.userId, shopId, listingId, clean);
    const anyOk = results.some((r) => r.ok);
    const allOk = results.every((r) => r.ok);
    return NextResponse.json(
      { status: allOk ? "completed" : anyOk ? "partial" : "failed", results },
      { status: 200, headers: corsHeaders() },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", status: 500, message: msg } },
      { status: 500, headers: corsHeaders() },
    );
  }
}

// ── Delete an image from a listing ─────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const a = await auth(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status, headers: corsHeaders() });

  let body: { shop_id?: number | string; listing_id?: number | string; listing_image_id?: number | string };
  try { body = await req.json(); } catch { return bad("Invalid JSON body."); }

  const shopId = Number(body.shop_id);
  const listingId = Number(body.listing_id);
  const imageId = Number(body.listing_image_id);
  if (!shopId || !listingId || !imageId) return bad("shop_id, listing_id and listing_image_id are required.");

  try {
    const r = await deleteListingImage(a.userId, shopId, listingId, imageId);
    if (!r.ok) return NextResponse.json({ error: { code: "DELETE_FAILED", status: 502, message: r.error } }, { status: 502, headers: corsHeaders() });
    return NextResponse.json({ status: "completed", listing_image_id: imageId }, { status: 200, headers: corsHeaders() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", status: 500, message: msg } }, { status: 500, headers: corsHeaders() });
  }
}

// ── List a listing's current images ────────────────────────────────────────
export async function GET(req: NextRequest) {
  const a = await auth(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status, headers: corsHeaders() });

  const url = new URL(req.url);
  const shopId = Number(url.searchParams.get("shop_id"));
  const listingId = Number(url.searchParams.get("listing_id"));
  if (!shopId || !listingId) return bad("shop_id and listing_id query params are required.");

  try {
    const r = await listListingImages(a.userId, shopId, listingId);
    if (!r.ok) return NextResponse.json({ error: { code: "LIST_FAILED", status: 502, message: r.error } }, { status: 502, headers: corsHeaders() });
    return NextResponse.json({ status: "completed", images: r.images }, { status: 200, headers: corsHeaders() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", status: 500, message: msg } }, { status: 500, headers: corsHeaders() });
  }
}
