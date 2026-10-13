// LOCATION: app/api/v1/listings/videos/route.ts
// Videos on an EXISTING listing (owner portal + Lister):
//   POST   — add a video     body { shop_id, listing_id, video: { url, name }, multi? }
//            url = https (e.g. a presigned R2 link) or jt-upload://<id> from /uploads/presign
//   DELETE — remove a video  body { shop_id, listing_id, video_id }
//   GET    — list videos     query ?shop_id=&listing_id=
// Etsy: 5–15 s, ≤100 MB, MP4/MOV, up to 2 per listing (pass multi:true for a second).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { uploadListingVideo, deleteListingVideo, listListingVideos } from "@/lib/listing-builder";

// Downloading + re-uploading up to 100 MB to Etsy can take a while.
export const maxDuration = 300;

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
  return NextResponse.json({ error: { code: "INVALID_REQUEST", status, message } }, { status, headers: corsHeaders() });
}

function failed(code: string, message: string, status = 502) {
  return NextResponse.json({ error: { code, status, message } }, { status, headers: corsHeaders() });
}

async function auth(req: NextRequest) {
  return validateRequest(req.headers.get("x-api-key"), "listings/videos");
}

export async function POST(req: NextRequest) {
  const a = await auth(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status, headers: corsHeaders() });
  let body: { shop_id?: number | string; listing_id?: number | string; video?: { url?: string; name?: string }; multi?: boolean };
  try { body = await req.json(); } catch { return bad("Invalid JSON body."); }
  const shopId = Number(body.shop_id);
  const listingId = Number(body.listing_id);
  const url = body.video?.url;
  if (!shopId || !listingId) return bad("shop_id and listing_id are required.");
  if (!url || typeof url !== "string") return bad("video.url is required (https URL or jt-upload:// reference).");
  try {
    const r = await uploadListingVideo(a.userId, shopId, listingId, { url, name: body.video?.name }, { multi: !!body.multi });
    if (!r.ok) return failed("VIDEO_UPLOAD_FAILED", r.error);
    return NextResponse.json({ status: "completed", video_id: r.video_id }, { status: 200, headers: corsHeaders() });
  } catch (err) {
    return failed("INTERNAL_ERROR", err instanceof Error ? err.message : "Unexpected error", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const a = await auth(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status, headers: corsHeaders() });
  let body: { shop_id?: number | string; listing_id?: number | string; video_id?: number | string };
  try { body = await req.json(); } catch { return bad("Invalid JSON body."); }
  const shopId = Number(body.shop_id), listingId = Number(body.listing_id), videoId = Number(body.video_id);
  if (!shopId || !listingId || !videoId) return bad("shop_id, listing_id and video_id are required.");
  try {
    const r = await deleteListingVideo(a.userId, shopId, listingId, videoId);
    if (!r.ok) return failed("DELETE_FAILED", r.error ?? "Delete failed");
    return NextResponse.json({ status: "completed", video_id: videoId }, { status: 200, headers: corsHeaders() });
  } catch (err) {
    return failed("INTERNAL_ERROR", err instanceof Error ? err.message : "Unexpected error", 500);
  }
}

export async function GET(req: NextRequest) {
  const a = await auth(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status, headers: corsHeaders() });
  const url = new URL(req.url);
  const shopId = Number(url.searchParams.get("shop_id"));
  const listingId = Number(url.searchParams.get("listing_id"));
  if (!shopId || !listingId) return bad("shop_id and listing_id query params are required.");
  try {
    const r = await listListingVideos(a.userId, shopId, listingId);
    if (!r.ok) return failed("LIST_FAILED", r.error);
    return NextResponse.json({ status: "completed", videos: r.videos }, { status: 200, headers: corsHeaders() });
  } catch (err) {
    return failed("INTERNAL_ERROR", err instanceof Error ? err.message : "Unexpected error", 500);
  }
}
