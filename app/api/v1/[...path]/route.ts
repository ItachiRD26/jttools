// ─────────────────────────────────────────────
//  JT Tools — Main Proxy Handler
//  Route: /api/v1/[...path]
//  e.g. GET /api/v1/listings/search?query=art
// ─────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { proxyEtsyRequest } from "@/lib/etsy-client";

// ─── Shared handler ──────────────────────────

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // Build endpoint slug from URL segments: ["listings","search"] → "listings/search"
  const endpoint = path.join("/");

  // ── 1. Authenticate & rate-limit ──────────
  const apiKey = req.headers.get("x-api-key");
  const auth = await validateRequest(apiKey, endpoint);

  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message },
      {
        status: auth.status,
        headers: corsHeaders(),
      }
    );
  }

  // ── 2. Extract query params ────────────────
  const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());

  // ── 3. Extract body (for POST/PATCH/PUT) ──
  let body: unknown = undefined;
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    body = await req.json().catch(() => undefined);
  }

  // ── 4. Proxy to Etsy ──────────────────────
  const result = await proxyEtsyRequest(endpoint, searchParams, body);

  // ── 5. Return with usage headers ──────────
  return NextResponse.json(result.data, {
    status: result.status,
    headers: {
      ...corsHeaders(),
      "X-RateLimit-Limit": String(auth.plan.dailyLimit),
      "X-RateLimit-Remaining": String(auth.remaining),
      "X-RateLimit-Reset": getResetTimestamp(),
      "X-Plan": auth.plan.id,
    },
  });
}

// Export for all methods
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

// ─── OPTIONS (CORS preflight) ────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// ─── Helpers ─────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    "Access-Control-Expose-Headers":
      "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Plan",
  };
}

/** Returns Unix timestamp for midnight UTC tonight */
function getResetTimestamp(): string {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return String(Math.floor(midnight.getTime() / 1000));
}