// LOCATION: app/api/v1/stores/[shopId]/sync/route.ts
// POST /api/v1/stores/{shopId}/sync
// Returns full bundle: shipping profiles + return policies + processing profiles + shop sections + production partners

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

async function etsyGet(path: string, accessToken: string) {
  const res = await fetch(`${ETSY_BASE}${path}`, {
    headers: {
      "x-api-key":     API_KEY(),
      "Authorization": `Bearer ${accessToken}`,
      "Accept":        "application/json",
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.results ?? data ?? [];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  const { shopId } = await params;
  const apiKey     = req.headers.get("x-api-key");
  const auth       = await validateRequest(apiKey, "stores/sync");

  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db      = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId  = keySnap.data()?.userId as string;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, shopId);
  } catch {
    return NextResponse.json(
      {
        error: {
          code:    "STORE_NOT_CONNECTED",
          status:  403,
          message: `Shop ${shopId} is not connected.`,
          hint:    "Connect at jeterdev.tools/dashboard.",
          docs:    "https://jeterdev.tools/docs#store-connection",
        },
      },
      { status: 403 }
    );
  }

  // Fetch all four resources in parallel
  const [shippingProfiles, returnPolicies, processingProfiles, shopSections, productionPartners] =
    await Promise.all([
      etsyGet(`/application/shops/${shopId}/shipping-profiles`, accessToken),
      etsyGet(`/application/shops/${shopId}/return-policies`,   accessToken),
      etsyGet(`/application/shops/${shopId}/production-partner-profiles`, accessToken),
      etsyGet(`/application/shops/${shopId}/sections`,          accessToken),
      etsyGet(`/application/shops/${shopId}/production-partners`, accessToken),
    ]);

  const synced_at = new Date().toISOString();

  return NextResponse.json({
    shop_id:             shopId,
    synced_at,
    shipping_profiles:   shippingProfiles  ?? [],
    return_policies:     returnPolicies    ?? [],
    processing_profiles: processingProfiles ?? [],
    shop_sections:       shopSections       ?? [],
    production_partners: productionPartners ?? [],
  });
}