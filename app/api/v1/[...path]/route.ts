// LOCATION: app/api/v1/[...path]/route.ts
// Main proxy
// Public endpoints: x-api-key only
// Private endpoints: bridge auto-resolves OAuth token from shop_id
//   The developer just passes shop_id — no token handling needed on their side

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { proxyEtsyRequest } from "@/lib/etsy-client";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

// Private endpoints that need OAuth — user must have connected that shop
const OAUTH_REQUIRED = new Set([
  "listings/create", "listings/update", "listings/delete",
  "listings/property/update", "listings/property/delete",
  "listings/variation-images",
  // Etsy's /v3/application/listings/{id}/inventory endpoint requires
  // listings_r for any non-public response. The catch-all was previously
  // forwarding without an access token (treating inventory as a public
  // endpoint), which Etsy 401'd with "Access token is required for this
  // request (requires scope: listings_r)" — even when the caller passed
  // a valid shop_id. Connected shops already have listings_r in the
  // OAuth grant; no re-auth needed.
  "listings/inventory",
  "shops/orders", "shops/transactions", "shops/update",
  "store/receipt", "store/receipt/update",
  "store/section/create", "store/section/update", "store/section/delete",
  "images/upload", "images/delete",
  "media/file/upload", "media/file/delete", "media/video/upload",
  "users/me", "users/addresses",
  "policies/get", "policies/create", "policies/update", "policies/delete",
  "policies/privacy", "policies/privacy/create", "policies/privacy/update", "policies/privacy/delete",
  "policies/refund", "policies/refund/create", "policies/refund/update", "policies/refund/delete",
  "policies/shipping", "policies/payment",
  "shipping/create", "shipping/update", "shipping/delete",
]);

const PER_SECOND_LIMITS: Record<string, number> = {
  free: 1, starter: 3, pro: 10,
};

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const endpoint  = path.join("/");
  const apiKey    = req.headers.get("x-api-key");

  // ── 1. Auth + daily rate limit ─────────────────────────────────────────────
  const auth = await validateRequest(apiKey, endpoint);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      {
        status: auth.status,
        headers: {
          ...corsHeaders(),
          ...(auth.status === 429 ? { "Retry-After": "60" } : {}),
        },
      }
    );
  }

  // ── 2. Resolve OAuth token for private endpoints ───────────────────────────
  // The bridge looks up the token from the shop_id automatically.
  // Developer only passes shop_id — no token handling on their side.
  //
  // Special case for listings/active?state=draft: Etsy's draft listings
  // endpoint requires OAuth (listings_r scope), unlike the public active
  // endpoint which only needs the API key. Bucketing both under the same
  // route means we have to upgrade the auth conditionally based on the
  // state= query param. Connected shops already have listings_r from the
  // existing OAuth grant — no re-auth needed.
  let accessToken: string | undefined;

  const stateParam = req.nextUrl.searchParams.get("state");
  const needsOAuthForDraft = endpoint === "listings/active" && stateParam === "draft";

  if (OAUTH_REQUIRED.has(endpoint) || needsOAuthForDraft) {
    const searchParams = req.nextUrl.searchParams;
    const shopId = searchParams.get("shop_id");

    if (!shopId) {
      return NextResponse.json(
        {
          error: {
            code: "MISSING_SHOP_ID",
            status: 400,
            message: `Endpoint '${endpoint}' requires a shop_id parameter.`,
            hint: "Pass your Etsy shop ID as ?shop_id=YOUR_SHOP_ID",
            docs: "https://jeterdev.tools/docs#store-connection",
          },
        },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Get userId from API key
    const db      = getDb();
    const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
    const userId  = keySnap.data()?.userId;

    if (!userId) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", status: 401, message: "Could not identify user." } },
        { status: 401, headers: corsHeaders() }
      );
    }

    try {
      accessToken = await getValidAccessToken(userId, shopId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "OAuth error";
      const isNotConnected = msg.startsWith("STORE_NOT_CONNECTED");

      return NextResponse.json(
        {
          error: {
            code: isNotConnected ? "STORE_NOT_CONNECTED" : "STORE_TOKEN_EXPIRED",
            status: isNotConnected ? 403 : 503,
            message: isNotConnected
              ? `Shop ${shopId} is not connected to your account.`
              : "Store authorization expired.",
            hint: "Connect this shop at jeterdev.tools/dashboard.",
            docs: "https://jeterdev.tools/docs#store-connection",
          },
        },
        { status: isNotConnected ? 403 : 503, headers: corsHeaders() }
      );
    }
  }

  // ── 3. Params + body ───────────────────────────────────────────────────────
  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  let body: unknown;
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    body = await req.json().catch(() => undefined);
  }

  // ── 4. Proxy to Etsy ───────────────────────────────────────────────────────
  let result;
  try {
    result = await proxyEtsyRequest(endpoint, queryParams, body, accessToken);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          status: 502,
          message: "The Etsy API returned an error.",
          details: msg,
          docs: "https://jeterdev.tools/docs#errors",
        },
      },
      { status: 502, headers: corsHeaders() }
    );
  }

  if (!result) {
    return NextResponse.json(
      {
        error: {
          code: "ENDPOINT_NOT_FOUND",
          status: 404,
          message: `Endpoint '${endpoint}' does not exist.`,
          docs: "https://jeterdev.tools/docs",
        },
      },
      { status: 404, headers: corsHeaders() }
    );
  }

  // ── 5. Response with rate limit headers ────────────────────────────────────
  const perSecondLimit = PER_SECOND_LIMITS[auth.plan.id] ?? 1;

  return NextResponse.json(result.data, {
    status: result.status,
    headers: {
      ...corsHeaders(),
      "X-RateLimit-Limit-Day":        String(auth.plan.dailyLimit),
      "X-RateLimit-Remaining-Day":    String(auth.remaining),
      "X-RateLimit-Reset-Day":        getResetTimestamp(),
      "X-RateLimit-Limit-Second":     String(perSecondLimit),
      "X-RateLimit-Remaining-Second": String(perSecondLimit),
      "X-Plan":                       auth.plan.id,
    },
  });
}

export const GET    = handler;
export const POST   = handler;
export const PUT    = handler;
export const PATCH  = handler;
export const DELETE = handler;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":      "*",
    "Access-Control-Allow-Methods":     "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":     "Content-Type, x-api-key",
    "Access-Control-Expose-Headers":    "X-RateLimit-Limit-Day, X-RateLimit-Remaining-Day, X-RateLimit-Reset-Day, X-RateLimit-Limit-Second, X-RateLimit-Remaining-Second, X-Plan",
    "Access-Control-Allow-Credentials": "false",
    "X-Content-Type-Options":           "nosniff",
    "X-Frame-Options":                  "DENY",
  };
}

function getResetTimestamp(): string {
  const now      = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return String(Math.floor(midnight.getTime() / 1000));
}