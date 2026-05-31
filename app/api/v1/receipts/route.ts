// LOCATION: app/api/v1/receipts/route.ts
// GET /api/v1/receipts?shop_id=X[&min_last_modified=...&was_shipped=false&limit=100&offset=0&...]
//
// Returns Etsy receipts for a shop. shop_id is required — Etsy's
// receipts endpoint is shop-scoped and OAuth-only (no public version).
//
// All Etsy `getShopReceipts` query parameters are forwarded:
//   min_last_modified, max_last_modified  (Unix seconds)
//   min_created, max_created              (Unix seconds)
//   was_paid, was_shipped, was_delivered, was_canceled (booleans)
//   limit (1..100, default 25), offset (default 0)
//   sort_on (created | updated), sort_order (asc | desc)
//
// Each receipt embeds full transactions[] (per-item sku/listing_id/
// variation_id/quantity/price + images + variation values), shipments[]
// with tracking, plus was_shipped/was_paid status flags. This is what
// downstream order pipelines should treat as the source of truth for
// Etsy orders.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import {
  getValidAccessToken,
  StoreNotConnectedError,
  StoreTokenExpiredError,
} from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

// Query params we forward to Etsy verbatim. Listed explicitly so a typo
// or unsupported param returns a clear error here instead of an Etsy 400.
const FORWARDED_PARAMS = [
  "min_last_modified",
  "max_last_modified",
  "min_created",
  "max_created",
  "was_paid",
  "was_shipped",
  "was_delivered",
  "was_canceled",
  "limit",
  "offset",
  "sort_on",
  "sort_order",
] as const;

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth = await validateRequest(apiKey, "receipts");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const shopId = req.nextUrl.searchParams.get("shop_id")?.trim();
  if (!shopId) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          status: 400,
          message: "shop_id parameter is required.",
          hint: "Receipts are shop-scoped on Etsy. Pass ?shop_id=<your_shop_id>.",
        },
      },
      { status: 400 }
    );
  }

  // Resolve OAuth — receipts is OAuth-only.
  const db = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId = keySnap.data()?.userId as string | undefined;
  if (!userId) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", status: 401, message: "Could not identify user." } },
      { status: 401 }
    );
  }
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, shopId);
  } catch (err) {
    const isNotConnected = err instanceof StoreNotConnectedError;
    const code = isNotConnected ? "STORE_NOT_CONNECTED" : "STORE_TOKEN_EXPIRED";
    const status = isNotConnected ? 403 : 503;
    return NextResponse.json(
      {
        error: {
          code, status,
          message: isNotConnected
            ? `Shop ${shopId} is not connected to your account.`
            : "Store authorization expired. Re-link the shop at jeterdev.tools/dashboard.",
        },
      },
      { status }
    );
  }

  const upstream = new URL(`${ETSY_BASE}/application/shops/${shopId}/receipts`);
  for (const p of FORWARDED_PARAMS) {
    const v = req.nextUrl.searchParams.get(p);
    if (v !== null && v !== "") upstream.searchParams.set(p, v);
  }

  const res = await fetch(upstream.toString(), {
    headers: {
      "x-api-key": API_KEY(),
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          status: 502,
          message: "Etsy API error.",
          details: err,
        },
      },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({
    count: data.count ?? 0,
    results: data.results ?? [],
  });
}
