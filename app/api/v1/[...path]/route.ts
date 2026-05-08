// LOCATION: app/api/v1/[...path]/route.ts
// Main proxy — structured errors, rate limit headers, OAuth support

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { proxyEtsyRequest } from "@/lib/etsy-client";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

// Endpoints that require the user's OAuth token
const OAUTH_REQUIRED = new Set([
  "listings/create",
  "listings/update",
  "listings/delete",
  "listings/inventory",
  "listings/properties",
  "shops/update",
  "shops/orders",
  "shops/transactions",
  "shipping/create",
  "shipping/update",
  "shipping/delete",
  "images/upload",
  "images/delete",
  "users/me",
  "users/addresses",
  "policies/get",
]);

// Per-second limits by plan
const PER_SECOND_LIMITS: Record<string, number> = {
  free:    1,
  starter: 3,
  pro:     10,
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

  // ── 2. OAuth token if needed ───────────────────────────────────────────────
  let accessToken: string | undefined;

  if (OAUTH_REQUIRED.has(endpoint)) {
    try {
      const db      = getDb();
      const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
      const userId  = keySnap.data()?.userId;

      if (!userId) {
        return NextResponse.json(
          { error: { code: "INTERNAL_ERROR", status: 401, message: "Could not identify user." } },
          { status: 401, headers: corsHeaders() }
        );
      }

      accessToken = await getValidAccessToken(userId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "OAuth error";
      const isNotConnected = msg.includes("No Etsy connection");

      return NextResponse.json(
        {
          error: {
            code: isNotConnected ? "STORE_NOT_CONNECTED" : "STORE_TOKEN_EXPIRED",
            status: isNotConnected ? 403 : 503,
            message: isNotConnected
              ? "You don't have an Etsy shop connected."
              : "Store authorization has expired.",
            hint: "Connect your Etsy shop at jeterdev.tools/dashboard.",
            docs: "https://jeterdev.tools/docs#store-connection",
          },
        },
        { status: isNotConnected ? 403 : 503, headers: corsHeaders() }
      );
    }
  }

  // ── 3. Params + body ───────────────────────────────────────────────────────
  const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  let body: unknown;
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    body = await req.json().catch(() => undefined);
  }

  // ── 4. Proxy to Etsy ───────────────────────────────────────────────────────
  let result;
  try {
    result = await proxyEtsyRequest(endpoint, searchParams, body, accessToken);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          status: 502,
          message: "The upstream Etsy API returned an error.",
          details: msg,
          docs: "https://jeterdev.tools/docs#errors",
        },
      },
      { status: 502, headers: corsHeaders() }
    );
  }

  if (!result) {
    return NextResponse.json(
      { error: { code: "ENDPOINT_NOT_FOUND", status: 404, message: `Endpoint '${endpoint}' does not exist.`, docs: "https://jeterdev.tools/docs" } },
      { status: 404, headers: corsHeaders() }
    );
  }

  // ── 5. Response with full rate limit headers ───────────────────────────────
  const perSecondLimit = PER_SECOND_LIMITS[auth.plan.id] ?? 1;

  return NextResponse.json(result.data, {
    status: result.status,
    headers: {
      ...corsHeaders(),
      // Daily limits
      "X-RateLimit-Limit-Day":      String(auth.plan.dailyLimit),
      "X-RateLimit-Remaining-Day":  String(auth.remaining),
      "X-RateLimit-Reset-Day":      getResetTimestamp(),
      // Per-second limits (informational)
      "X-RateLimit-Limit-Second":     String(perSecondLimit),
      "X-RateLimit-Remaining-Second": String(perSecondLimit),
      // Plan
      "X-Plan": auth.plan.id,
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