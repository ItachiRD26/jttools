// LOCATION: app/api/v1/uploads/route.ts
// POST /api/v1/uploads
//
// ⚠️ This endpoint is DEPRECATED — use the presigned flow instead:
//   1. POST /api/v1/uploads/presign  → get upload_url
//   2. PUT file → upload_url         → upload directly (no size limit)
//   3. POST /api/v1/uploads/confirm  → get jt-upload:// URL
//
// The old endpoint was capped at 4.5MB by Vercel's function body limit.
// The presigned flow supports up to 100MB per file.

import { NextResponse } from "next/server";

function cors() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function POST() {
  return NextResponse.json(
    {
      error: {
        code:    "ENDPOINT_CHANGED",
        status:  410,
        message: "POST /uploads has been replaced with a presigned upload flow that supports files up to 100MB.",
        hint:    "Use POST /uploads/presign → PUT to upload_url → POST /uploads/confirm",
        docs:    "https://jeterdev.tools/docs#lb-uploads",
      },
    },
    { status: 410, headers: cors() }
  );
}