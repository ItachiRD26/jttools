// LOCATION: app/api/v1/uploads/presign/route.ts
// POST /api/v1/uploads/presign
// Returns a Firebase Storage signed upload URL.
// Client PUTs directly to Firebase — bypasses ALL Vercel limits.
// Supports up to 5GB per file (Firebase Storage limit).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb, getAdminApp } from "@/lib/firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

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

  if (body.size && body.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: `File too large. Max is 100MB.` } },
      { status: 400, headers: cors() }
    );
  }

  const uploadId   = `jt_${crypto.randomBytes(16).toString("hex")}`;
  const filePath   = `uploads/${uploadId}/${body.filename}`;
  const expiresAt  = new Date(Date.now() + 30 * 60 * 1000); // 30 min to upload

  // Generate Firebase Storage signed URL for direct PUT
  getAdminApp();
  const bucket = getStorage().bucket();
  const file   = bucket.file(filePath);

  const [signedUploadUrl] = await file.getSignedUrl({
    action:      "write",
    expires:     expiresAt,
    contentType: body.content_type,
  });

  // Save pending upload metadata
  await db.collection("uploads").doc(uploadId).set({
    userId,
    apiKey,
    uploadId,
    filename:    body.filename,
    size:        body.size ?? 0,
    contentType: body.content_type,
    type:        body.type ?? "image",
    storagePath: filePath,
    status:      "pending",
    createdAt:   FieldValue.serverTimestamp(),
    expiresAt:   new Date(Date.now() + 24 * 60 * 60 * 1000),
    consumed:    false,
  });

  return NextResponse.json(
    {
      upload_id:    uploadId,
      upload_url:   signedUploadUrl,  // Direct Firebase Storage URL — no Vercel limit
      method:       "PUT",
      content_type: body.content_type,
      expires_in:   "30min",
      note:         "PUT your file binary to upload_url with Content-Type header, then call /uploads/confirm",
    },
    { status: 200, headers: cors() }
  );
}