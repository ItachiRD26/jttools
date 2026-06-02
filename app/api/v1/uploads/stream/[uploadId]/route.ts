// LOCATION: app/api/v1/uploads/stream/[uploadId]/route.ts
// PUT /api/v1/uploads/stream/{uploadId}
// Receives the raw file binary and streams it to Vercel Blob.
// Vercel Pro: supports up to 50MB with streaming (no body parser).

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { validateRequest } from "@/lib/api-auth";

export const runtime    = "nodejs";
export const maxDuration = 60;

function cors() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  const { uploadId } = await params;
  const db           = getDb();

  // ── Auth + ownership check ───────────────────────────────────────────────
  // Validate the caller's API key, then verify the upload belongs to them.
  // Without this, knowing the 128-bit uploadId alone is enough to overwrite
  // someone else's pending upload — fine against random attackers (the id
  // is cryptographically random) but vulnerable to scenarios where the id
  // leaks via shared logs, devtools, or screen-share between collaborators.
  // Mirrors the ownership check already enforced by /uploads/confirm.
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "uploads");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: cors() });
  }
  const keySnap     = await db.collection("apiKeys").doc(apiKey!).get();
  const callerUserId = keySnap.data()?.userId as string | undefined;
  if (!callerUserId) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", status: 401, message: "Could not identify user." } },
      { status: 401, headers: cors() }
    );
  }

  // Verify upload exists and is pending
  const snap = await db.collection("uploads").doc(uploadId).get();
  if (!snap.exists) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 404, message: `Upload '${uploadId}' not found or expired.` } },
      { status: 404, headers: cors() }
    );
  }

  const data = snap.data()!;

  if (data.userId !== callerUserId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", status: 403, message: "This upload does not belong to your API key." } },
      { status: 403, headers: cors() }
    );
  }

  if (data.status !== "pending") {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 409, message: "Upload already completed or consumed." } },
      { status: 409, headers: cors() }
    );
  }

  const contentType = req.headers.get("content-type") ?? data.contentType ?? "application/octet-stream";

  // Stream directly to Vercel Blob — no buffering in function memory
  const blob = await put(
    `uploads/${uploadId}/${data.filename}`,
    req.body!,
    {
      access:      "private",
      contentType,
      token:       process.env.BLOB_READ_WRITE_TOKEN,
    }
  );

  // Update Firestore with blob URL
  await db.collection("uploads").doc(uploadId).update({
    blobUrl:  blob.url,
    status:   "ready",
    readyAt:  FieldValue.serverTimestamp(),
  });

  return NextResponse.json(
    {
      upload_id: uploadId,
      blob_url:  blob.url,
      status:    "ready",
      note:      "Now call POST /api/v1/uploads/confirm to get your jt-upload:// URL",
    },
    { status: 200, headers: cors() }
  );
}