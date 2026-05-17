// LOCATION: app/api/v1/uploads/presign/route.ts
// POST /api/v1/uploads/presign
//
// Step 1 of the presigned upload flow.
// Returns a signed URL the client uses to PUT the file DIRECTLY to Vercel Blob.
// Bypasses Vercel's 4.5MB function body limit — supports up to 500MB.
//
// Flow:
//   1. POST /uploads/presign { filename, content_type, size, type }
//   2. Client PUT file → upload_url (directly to Vercel Blob)
//   3. POST /uploads/confirm { upload_id } → returns jt-upload:// URL
//   4. Use jt-upload:// URL in POST /listings/create images[].url

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
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

  // handleUpload manages the Vercel Blob client-upload token handshake
  const body = await req.json() as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Validate file before issuing token
        const meta = clientPayload ? JSON.parse(clientPayload) : {};
        const size = meta.size ?? 0;

        if (size > MAX_FILE_SIZE) {
          throw new Error(`File too large: ${(size / 1024 / 1024).toFixed(1)}MB. Maximum is 100MB.`);
        }

        const uploadId = `jt_${crypto.randomBytes(16).toString("hex")}`;

        // Store pending upload metadata
        await db.collection("uploads").doc(uploadId).set({
          userId,
          apiKey,
          uploadId,
          filename:    pathname,
          size,
          contentType: meta.content_type ?? "image/jpeg",
          type:        meta.type ?? "image",
          status:      "pending",
          createdAt:   FieldValue.serverTimestamp(),
          expiresAt:   new Date(Date.now() + 24 * 60 * 60 * 1000),
          consumed:    false,
        });

        return {
          allowedContentTypes: [
            "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
            "video/mp4", "video/mov", "video/mpeg", "video/quicktime",
            "application/pdf", "application/zip", "application/x-zip-compressed",
          ],
          maximumSizeInBytes: MAX_FILE_SIZE,
          tokenPayload: JSON.stringify({ uploadId, userId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Called by Vercel Blob after the client finishes uploading
        const { uploadId } = JSON.parse(tokenPayload ?? "{}");
        if (!uploadId) return;

        await db.collection("uploads").doc(uploadId).update({
          blobUrl:  blob.url,
          status:   "ready",
          readyAt:  FieldValue.serverTimestamp(),
        });
      },
    });

    return NextResponse.json(jsonResponse, { headers: cors() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Presign failed";
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: msg } },
      { status: 400, headers: cors() }
    );
  }
}