// LOCATION: app/api/v1/uploads/presign/route.ts
// POST /api/v1/uploads/presign
// Returns a Vercel Blob upload URL that the client PUT to directly.
// Uses generatePresignedUrl pattern — works with any HTTP client.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

export const maxDuration = 60;

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

  let body: { filename: string; content_type: string; size?: number; type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "Invalid JSON body." } },
      { status: 400, headers: cors() }
    );
  }

  if (!body.filename || !body.content_type) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "filename and content_type are required." } },
      { status: 400, headers: cors() }
    );
  }

  const uploadId  = `jt_${crypto.randomBytes(16).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Save pending upload metadata
  await db.collection("uploads").doc(uploadId).set({
    userId,
    apiKey,
    uploadId,
    filename:    body.filename,
    size:        body.size ?? 0,
    contentType: body.content_type,
    type:        body.type ?? "image",
    status:      "pending",
    createdAt:   FieldValue.serverTimestamp(),
    expiresAt,
    consumed:    false,
  });

  // Build the upload URL pointing to our streaming endpoint
  const uploadUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/v1/uploads/stream/${uploadId}`;

  return NextResponse.json(
    {
      upload_id:    uploadId,
      upload_url:   uploadUrl,
      method:       "PUT",
      content_type: body.content_type,
      expires_in:   "30min",
      note:         "PUT your file binary to upload_url with Content-Type header, then call /uploads/confirm",
    },
    { status: 200, headers: cors() }
  );
}