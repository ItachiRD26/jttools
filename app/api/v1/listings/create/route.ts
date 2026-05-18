// LOCATION: app/api/v1/listings/create/route.ts
// POST /api/v1/listings/create
// Atomic listing creation: draft | publish | active

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import {
  createListing,
  validatePayload,
  type CreateListingBody,
} from "@/lib/listing-builder";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");

  // Auth
  const auth = await validateRequest(apiKey, "listings/create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: corsHeaders() });
  }

  // Parse body
  let body: CreateListingBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", status: 400, message: "Invalid JSON body." } },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Validate payload
  const errors = validatePayload(body);
  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: {
          code:    "VALIDATION_FAILED",
          status:  400,
          message: "Request validation failed.",
          fields:  Object.fromEntries(errors.map(e => [e.field, e.reason])),
        },
      },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Get userId from API key
  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  if (body.state !== "draft") {
    // ── Preflight: verify all shops connected ─────────────────────────────
    const notOwned: string[] = [];
    for (const shop of body.shops) {
      const connSnap = await db
        .collection("etsyConnections").doc(userId)
        .collection("shops").doc(String(shop.shop_id)).get();
      if (!connSnap.exists) notOwned.push(String(shop.shop_id));
    }

    if (notOwned.length > 0) {
      return NextResponse.json(
        {
          error: {
            code:    "STORE_NOT_OWNED",
            status:  403,
            message: `The following shop IDs are not connected to your account: ${notOwned.join(", ")}`,
            hint:    "Connect shops at jeterdev.tools/dashboard.",
            docs:    "https://jeterdev.tools/docs#store-connection",
          },
        },
        { status: 403, headers: corsHeaders() }
      );
    }

    // ── Preflight: validate shop-scoped profile IDs ───────────────────────
    // Check that shipping_profile_id and shop_section_id belong to the shop
    const { getValidAccessToken } = await import("@/lib/etsy-oauth");
    const ETSY_BASE = "https://openapi.etsy.com/v3";
    const API_KEY   = `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;
    const fieldErrors: Record<string, string> = {};

    for (let i = 0; i < body.shops.length; i++) {
      const shop = body.shops[i];
      try {
        const token = await getValidAccessToken(userId, String(shop.shop_id));
        const headers = { "x-api-key": API_KEY, "Authorization": `Bearer ${token}`, "Accept": "application/json" };

        // Validate shop_section_id
        if (shop.shop_section_id) {
          const sectRes = await fetch(`${ETSY_BASE}/application/shops/${shop.shop_id}/sections`, { headers });
          if (sectRes.ok) {
            const sectData = await sectRes.json();
            const validSectionIds = (sectData.results ?? []).map((s: { shop_section_id: number }) => s.shop_section_id);
            if (!validSectionIds.includes(shop.shop_section_id)) {
              fieldErrors[`shops[${i}].shop_section_id`] = `Section ${shop.shop_section_id} not found in shop ${shop.shop_id}.`;
            }
          }
        }

        // Validate shipping_profile_id
        if (shop.shipping_profile_id) {
          const shipRes = await fetch(`${ETSY_BASE}/application/shops/${shop.shop_id}/shipping-profiles`, { headers });
          if (shipRes.ok) {
            const shipData = await shipRes.json();
            const validIds = (shipData.results ?? []).map((s: { shipping_profile_id: number }) => s.shipping_profile_id);
            if (!validIds.includes(shop.shipping_profile_id)) {
              fieldErrors[`shops[${i}].shipping_profile_id`] = `Shipping profile ${shop.shipping_profile_id} not found in shop ${shop.shop_id}.`;
            }
          }
        }
      } catch { /* if token fetch fails, the publish step will handle it */ }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json(
        {
          error: {
            code:    "VALIDATION_FAILED",
            status:  400,
            message: "Request validation failed.",
            fields:  fieldErrors,
          },
        },
        { status: 400, headers: corsHeaders() }
      );
    }
  }

  const result = await createListing(userId, apiKey!, body);

  // Always return 200 with results[] so caller can inspect per-shop errors.
  // Use 500 only for catastrophic failures (not per-shop Etsy rejections).
  return NextResponse.json(result, {
    status: 200,
    headers: { ...corsHeaders(), ...rateLimitHeaders(auth) },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":   "*",
    "Access-Control-Allow-Methods":  "POST, OPTIONS",
    "Access-Control-Allow-Headers":  "Content-Type, x-api-key",
    "X-Content-Type-Options":        "nosniff",
  };
}

function rateLimitHeaders(auth: { plan: { dailyLimit: number; id: string }; remaining: number }) {
  const perSecond: Record<string, number> = { free: 1, starter: 3, pro: 10 };
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  return {
    "X-RateLimit-Limit-Day":        String(auth.plan.dailyLimit),
    "X-RateLimit-Remaining-Day":    String(auth.remaining),
    "X-RateLimit-Reset-Day":        String(Math.floor(midnight.getTime() / 1000)),
    "X-RateLimit-Limit-Second":     String(perSecond[auth.plan.id] ?? 1),
    "X-RateLimit-Remaining-Second": String(perSecond[auth.plan.id] ?? 1),
    "X-Plan":                       auth.plan.id,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}