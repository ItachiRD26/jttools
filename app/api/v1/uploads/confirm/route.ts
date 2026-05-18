// LOCATION: app/api/v1/uploads/confirm/route.ts
// POST /api/v1/uploads/confirm
// Verifies the file was uploaded to Firebase Storage and returns jt-upload:// URL

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb, getAdminApp } from "@/lib/firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { FieldValue } from "firebase-admin/firestore";

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
  try { body = await req.json(); }
  catch {
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
  if (data.userId !== userId) {
    return NextResponse.json(
      { error: { code: "INVALID_API_KEY", status: 401, message: "This upload does not belong to your API key." } },
      { status: 401, headers: cors() }
    );
  }

  const expiresAt: Date = data.expiresAt?.toDate?.() ?? new Date(0);
  if (new Date() > expiresAt) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 410, message: "Upload expired. Re-upload the file." } },
      { status: 410, headers: cors() }
    );
  }

  // Verify file exists in Firebase Storage
  getAdminApp();
  const bucket = getStorage().bucket();
  const file   = bucket.file(data.storagePath);

  let fileExists = false;
  try {
    const [exists] = await file.exists();
    fileExists = exists;
  } catch { fileExists = false; }

  if (!fileExists) {
    return NextResponse.json(
      {
        error: {
          code:    "UPLOAD_PENDING",
          status:  202,
          message: "File not found in storage. Upload the file first via PUT to upload_url.",
          hint:    "Make sure you PUT the file to the upload_url before calling confirm.",
        },
      },
      { status: 202, headers: cors() }
    );
  }

  // Generate signed read URL (25h — covers the 24h TTL)
  const [signedReadUrl] = await file.getSignedUrl({
    action:  "read",
    expires: Date.now() + 25 * 60 * 60 * 1000,
  });

  // Mark as ready
  if (data.status === "pending") {
    await db.collection("uploads").doc(body.upload_id).update({
      blobUrl:  signedReadUrl,
      status:   "ready",
      readyAt:  FieldValue.serverTimestamp(),
    });
  }

  return NextResponse.json(
    {
      url:          `jt-upload://${body.upload_id}`,
      upload_id:    body.upload_id,
      filename:     data.filename,
      size:         data.size,
      content_type: data.contentType,
      type:         data.type,
      expires_in:   "24h",
    },
    { status: 200, headers: cors() }
  );
}