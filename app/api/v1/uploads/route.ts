// LOCATION: app/api/v1/uploads/route.ts
// POST /api/v1/uploads
// Upload an image/video/digital file BEFORE a listing exists.
// Returns a jt-upload:// URL to reference in POST /listings/create images[].url
// Files are cached in Firestore (metadata) + Vercel blob-compatible storage for 24h.
// The listing-builder resolves jt-upload:// URLs automatically at publish time.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/mov", "video/mpeg", "video/quicktime"];
const ALLOWED_DIGITAL_TYPES = [
  "application/pdf", "application/zip", "application/x-zip-compressed",
  "image/jpeg", "image/png", "image/svg+xml",
  "application/octet-stream", "text/plain",
];

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":   "*",
    "Access-Control-Allow-Methods":  "POST, OPTIONS",
    "Access-Control-Allow-Headers":  "Content-Type, x-api-key",
    "X-Content-Type-Options":        "nosniff",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "uploads");

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders() });
  }

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "Invalid multipart/form-data body." } },
      { status: 400, headers: corsHeaders() }
    );
  }

  const file = formData.get("file") as File | null;
  const type = (formData.get("type") as string | null) ?? "image";

  if (!file) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: "No file provided.",
          hint:    "Send a multipart/form-data request with a 'file' field.",
        },
      },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum is 100MB.`,
        },
      },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Validate content type
  const contentType = file.type || "application/octet-stream";
  let allowedTypes: string[];

  switch (type) {
    case "video":   allowedTypes = ALLOWED_VIDEO_TYPES;   break;
    case "digital": allowedTypes = ALLOWED_DIGITAL_TYPES; break;
    default:        allowedTypes = ALLOWED_IMAGE_TYPES;   break;
  }

  if (!allowedTypes.includes(contentType) && contentType !== "application/octet-stream") {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: `Content type '${contentType}' is not allowed for type '${type}'.`,
          hint:    `Allowed types for '${type}': ${allowedTypes.join(", ")}`,
        },
      },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Read file into buffer and store in Firestore as base64
  // For production with large files, replace this with Vercel Blob / Cloudinary / S3
  const buffer   = Buffer.from(await file.arrayBuffer());
  const fileId   = crypto.randomBytes(16).toString("hex");
  const uploadId = `jt_${fileId}`;

  const db = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  // Store metadata + base64 data (fine for images up to ~5MB; for larger use blob storage)
  const isSmall = buffer.length < 5 * 1024 * 1024; // < 5MB store inline

  await db.collection("uploads").doc(uploadId).set({
    userId,
    apiKey,
    uploadId,
    filename:    file.name,
    size:        file.size,
    contentType,
    type:        type ?? "image",
    // Store file data inline for small files
    ...(isSmall ? { data: buffer.toString("base64") } : {}),
    createdAt:   FieldValue.serverTimestamp(),
    expiresAt:   new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
    consumed:    false,
  });

  // For large files, store as a separate chunk (Firestore has 1MB doc limit)
  // In production: upload to Vercel Blob or S3 and store the URL instead
  if (!isSmall) {
    // Split into chunks of 900KB
    const CHUNK_SIZE = 900 * 1024;
    const chunks     = Math.ceil(buffer.length / CHUNK_SIZE);
    const batch      = db.batch();

    for (let i = 0; i < chunks; i++) {
      const chunk = buffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const ref   = db.collection("uploadChunks").doc(`${uploadId}_${i}`);
      batch.set(ref, {
        uploadId,
        chunk:     i,
        data:      chunk.toString("base64"),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    await batch.commit();
    await db.collection("uploads").doc(uploadId).update({ chunks, isChunked: true });
  }

  const jtUrl = `jt-upload://${uploadId}`;

  return NextResponse.json(
    {
      url:          jtUrl,
      upload_id:    uploadId,
      filename:     file.name,
      size:         file.size,
      content_type: contentType,
      type:         type ?? "image",
      expires_in:   "24h",
    },
    { status: 200, headers: corsHeaders() }
  );
}