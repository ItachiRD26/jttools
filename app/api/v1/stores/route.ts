// LOCATION: app/api/v1/stores/route.ts
// GET /api/v1/stores — returns connected Etsy shops for the authenticated user
// Auth: x-api-key header (same as all /api/v1/* endpoints)

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
      shopId:      c.shopId,
      shopName:    c.shopName,
      etsyUserId:  c.etsyUserId,
      connectedAt: c.connectedAt,
      token_valid,
    };
  });

  return NextResponse.json({
    stores,
    plan: auth.plan.name,
    remaining: auth.remaining,
  });
}