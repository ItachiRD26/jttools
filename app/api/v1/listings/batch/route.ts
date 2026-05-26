// LOCATION: app/api/v1/listings/batch/route.ts
// GET /api/v1/listings/batch?listing_ids=1,2,3
//
// Fetches up to 100 listings in one call. Optional `includes` forwards
// Etsy's includes= parameter so the response embeds related resources
// (Images, Inventory, Videos, Shipping, Translations, Shop, User,
// Manufacturers) — saves 3N follow-up calls per listing on sync.
//
// Optional `shop_id` upgrades the call to authenticated (uses the shop's
// OAuth token). Required if you're fetching draft listing IDs — Etsy's
// public batch endpoint only returns active listings; drafts come back
// empty without OAuth.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import {
  getValidAccessToken,
  StoreNotConnectedError,
  StoreTokenExpiredError,
} from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

// Etsy v3 valid `includes` values for /listings/batch (per their OpenAPI
// spec). We don't validate strictly — Etsy returns a helpful 400 if you
// pass garbage — but list them here for the docs.
// Shipping, Images, Shop, User, Translations, Inventory, Videos, Manufacturers

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "listings/batch");

  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const idsParam = req.nextUrl.searchParams.get("listing_ids");
  if (!idsParam) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: "listing_ids parameter is required.",
          hint:    "Pass comma-separated listing IDs: ?listing_ids=123,456,789",
        },
      },
      { status: 400 }
    );
  }

  const ids = idsParam.split(",").map(id => id.trim()).filter(Boolean);

  if (ids.length > 100) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: "Maximum 100 listing IDs per request.",
        },
      },
      { status: 400 }
    );
  }

  const includes = req.nextUrl.searchParams.get("includes")?.trim() || undefined;
  const shopId   = req.nextUrl.searchParams.get("shop_id")?.trim() || undefined;

  // Resolve OAuth if a shop_id was provided. Without it, the call is
  // unauthenticated and Etsy returns active listings only.
  let accessToken: string | undefined;
  if (shopId) {
    const db      = getDb();
    const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
    const userId  = keySnap.data()?.userId as string | undefined;
    if (!userId) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", status: 401, message: "Could not identify user." } },
        { status: 401 }
      );
    }
    try {
      accessToken = await getValidAccessToken(userId, shopId);
    } catch (err) {
      const isNotConnected = err instanceof StoreNotConnectedError;
      const isExpired      = err instanceof StoreTokenExpiredError;
      const code   = isNotConnected ? "STORE_NOT_CONNECTED" : "STORE_TOKEN_EXPIRED";
      const status = isNotConnected ? 403 : 503;
      return NextResponse.json(
        {
          error: {
            code, status,
            message: isNotConnected
              ? `Shop ${shopId} is not connected to your account.`
              : "Store authorization expired. Re-link the shop at jeterdev.tools/dashboard.",
            details: isExpired ? undefined : (err instanceof Error ? err.message : undefined),
          },
        },
        { status }
      );
    }
  }

  // Build upstream URL — listing_ids + optional includes
  const upstream = new URL(`${ETSY_BASE}/application/listings/batch`);
  upstream.searchParams.set("listing_ids", ids.join(","));
  if (includes) upstream.searchParams.set("includes", includes);

  const res = await fetch(upstream.toString(), {
    headers: {
      "x-api-key": API_KEY(),
      "Accept":    "application/json",
      ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(
      {
        error: {
          code:    "UPSTREAM_ERROR",
          status:  502,
          message: "Etsy API error.",
          details: err,
        },
      },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({
    count:   data.count ?? ids.length,
    results: data.results ?? [],
  });
}
