// LOCATION: app/api/v1/uploads/confirm/route.ts
// POST /api/v1/uploads/confirm
//
// Step 3 of the presigned upload flow.
// Call this after the client has PUT the file to Vercel Blob.
// Returns the jt-upload:// URL to use in listings/create images[].url

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";

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

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "uploads");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  let body: { upload_id: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "Invalid JSON body." } },
      { status: 400, headers: cors() }
    );
  }

  if (!body.upload_id) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "upload_id is required." } },
      { status: 400, headers: cors() }
    );
  }

  const snap = await db.collection("uploads").doc(body.upload_id).get();

  if (!snap.exists) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 404, message: `Upload '${body.upload_id}' not found or expired.` } },
      { status: 404, headers: cors() }
    );
  }

  const data = snap.data()!;

  // Ownership check
  if (data.userId !== userId) {
    return NextResponse.json(
      { error: { code: "INVALID_API_KEY", status: 401, message: "This upload does not belong to your API key." } },
      { status: 401, headers: cors() }
    );
  }

  // Check TTL
  const expiresAt: Date = data.expiresAt?.toDate?.() ?? new Date(0);
  if (new Date() > expiresAt) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 410, message: "Upload expired. Re-upload the file." } },
      { status: 410, headers: cors() }
    );
  }

  // If onUploadCompleted hasn't fired yet (webhook delay), poll status
  if (data.status === "pending") {
    return NextResponse.json(
      {
        error: {
          code:    "UPLOAD_PENDING",
          status:  202,
          message: "Upload not yet confirmed by storage. Retry in 1-2 seconds.",
          hint:    "Call /uploads/confirm again after a short delay.",
        },
      },
      { status: 202, headers: cors() }
    );
  }

  const jtUrl = `jt-upload://${body.upload_id}`;

  return NextResponse.json(
    {
      url:          jtUrl,
      upload_id:    body.upload_id,
      filename:     data.filename,
      size:         data.size,
      content_type: data.contentType,
      type:         data.type,
      blob_url:     data.blobUrl,
      expires_in:   "24h",
    },
    { status: 200, headers: cors() }
  );
}