// LOCATION: app/api/v1/stores/[shopId]/shop-sections/create/route.ts
// POST /api/v1/stores/{shopId}/shop-sections/create   body: { title }
// Creates a shop section on Etsy (POST /shops/{id}/sections) and returns it.
// OAuth write (shops_w) — the same connected-shop token used to create listings.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

// Etsy caps shop-section titles at 24 characters.
const MAX_TITLE = 24;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  const { shopId } = await params;
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "stores/shop-sections/create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let title = "";
  try {
    const body = await req.json();
    title = String(body?.title ?? "").trim();
  } catch {
    /* title stays "" → validated below */
  }
  if (!title) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "A section title is required." } },
      { status: 400 }
    );
  }
  if (title.length > MAX_TITLE) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: `Etsy shop-section titles are ${MAX_TITLE} characters max.` } },
      { status: 400 }
    );
  }

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, shopId);
  } catch {
    return NextResponse.json(
      { error: { code: "STORE_NOT_CONNECTED", status: 403, message: `Shop ${shopId} is not connected.`, hint: "Connect at jeterdev.tools/dashboard.", docs: "https://jeterdev.tools/docs#store-connection" } },
      { status: 403 }
    );
  }

  const res = await fetch(`${ETSY_BASE}/application/shops/${shopId}/sections`, {
    method: "POST",
    headers: {
      "x-api-key":     API_KEY(),
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type":  "application/x-www-form-urlencoded",
      "Accept":        "application/json",
    },
    body: new URLSearchParams({ title }).toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Surface Etsy's message so the caller can show why (e.g. scope / duplicate).
    return NextResponse.json(
      { error: { code: "UPSTREAM_ERROR", status: 502, message: "Etsy API error.", details: err } },
      { status: 502 }
    );
  }

  const section = await res.json();
  return NextResponse.json({
    shop_id:      shopId,
    created_at:   new Date().toISOString(),
    shop_section: section,
  });
}
