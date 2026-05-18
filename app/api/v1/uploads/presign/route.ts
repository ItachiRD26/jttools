// LOCATION: app/api/v1/uploads/presign/route.ts
// POST /api/v1/uploads/presign
//
// Step 1 — returns Vercel Blob client upload token.
// The client uses this token with @vercel/blob's upload() or a direct PUT.
// File goes DIRECTLY to Vercel Blob — never through this function.
// Supports up to 100MB per file.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/mov", "video/mpeg", "video/quicktime",
  "application/pdf", "application/zip", "application/x-zip-compressed",
  "image/svg+xml", "text/plain",
];

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

  const body = await req.json() as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const meta       = clientPayload ? JSON.parse(clientPayload) : {};
        const size       = meta.size ?? 0;
        const uploadId   = `jt_${crypto.randomBytes(16).toString("hex")}`;

        if (size > MAX_FILE_SIZE) {
          throw new Error(`File too large: ${(size / 1024 / 1024).toFixed(1)}MB. Max is 100MB.`);
        }

        // Save pending upload to Firestore
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
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes:  MAX_FILE_SIZE,
          tokenPayload:        JSON.stringify({ uploadId, userId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
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