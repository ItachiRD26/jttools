// LOCATION: app/api/v1/stores/route.ts
// GET /api/v1/stores — returns connected Etsy shops for the authenticated user
// Auth: x-api-key header (same as all /api/v1/* endpoints)
//
// Each store entry includes:
//   token_valid        — false when the access token is near-expired (auto-refresh will fire on next use)
//   connection_expired — true when refresh has already failed; user must re-link at jeterdev.tools/dashboard
//                        Detect this flag and surface a reconnect prompt in your UI.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getAllStoreConnections } from "@/lib/etsy-oauth";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");

  const auth = await validateRequest(apiKey, "stores");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const uid = auth.userId;
  const connections = await getAllStoreConnections(uid);
  const now = new Date();

  const stores = connections.map(c => {
    const expiresAt = c.expiresAt instanceof Date
      ? c.expiresAt
      : (c.expiresAt as { toDate: () => Date })?.toDate?.() ?? new Date(0);

    const token_valid = expiresAt.getTime() - now.getTime() > 5 * 60 * 1000;

    return {
      shopId:             c.shopId,
      shopName:           c.shopName,
      etsyUserId:         c.etsyUserId,
      connectedAt:        c.connectedAt,
      token_valid,
      // Sticky flag set when a token refresh fails (revoked, expired refresh token, etc.)
      // When true, re-linking is required — auto-refresh will not recover this state.
      connection_expired: c.connection_expired ?? false,
    };
  });

  return NextResponse.json({
    stores,
    plan:      auth.plan.name,
    remaining: auth.remaining,
  });
}