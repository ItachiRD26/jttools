// LOCATION: app/api/v1/stores/[shopId]/sync/route.ts
// POST /api/v1/stores/{shopId}/sync
// Full shop data refresh — surfaces per-resource errors

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

interface FetchResult { data: unknown[] | null; error: string | null; status: number | null }

async function etsyGet(path: string, accessToken: string): Promise<FetchResult> {
  try {
    const res = await fetch(`${ETSY_BASE}${path}`, {
      headers: {
        "x-api-key":     API_KEY(),
        "Authorization": `Bearer ${accessToken}`,
        "Accept":        "application/json",
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      let errBody: unknown;
      try { errBody = JSON.parse(errText); } catch { errBody = errText; }
      return { data: null, error: `Etsy ${res.status}: ${JSON.stringify(errBody)}`, status: res.status };
    }
    const data    = await res.json();
    const results = data.results ?? (Array.isArray(data) ? data : (data && typeof data === "object" ? [data] : []));
    return { data: results, error: null, status: res.status };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err.message : "Unknown error", status: null };
  }
}

// Fetch processing profiles directly from Etsy's readiness-state-definitions endpoint.
// This endpoint (GET /v3/application/shops/{shop_id}/readiness-state-definitions) is GA
// and returns profiles regardless of whether the shop has active listings.
// Scope: shops_r (already included in ETSY_SCOPES).
async function fetchProcessingProfiles(shopId: string, accessToken: string): Promise<FetchResult> {
  return etsyGet(
    `/application/shops/${shopId}/readiness-state-definitions?limit=100`,
    accessToken
  );
}

// Return policies: try new endpoint, fall back to legacy
async function fetchReturnPolicies(shopId: string, accessToken: string): Promise<FetchResult> {
  const r = await etsyGet(`/application/shops/${shopId}/return-policies`, accessToken);
  if (!r.error) return r;
  const legacy = await etsyGet(`/application/shops/${shopId}/policies/return`, accessToken);
  if (!legacy.error && legacy.data) {
    const item = legacy.data[0];
    return { data: item ? [item] : [], error: null, status: 200 };
  }
  return r; // return original error
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
  } catch (err) {
    if (err instanceof StoreTokenExpiredError) {
      return NextResponse.json(
        {
          error: {
            code:              "STORE_TOKEN_EXPIRED",
            status:            403,
            message:           `Shop ${shopId} OAuth token has expired and could not be refreshed. Re-link the shop to restore access.`,
            connection_expired: true,
            hint:              "Re-connect the shop at jeterdev.tools/dashboard.",
          },
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      {
        error: {
          code:    "STORE_NOT_CONNECTED",
          status:  403,
          message: `Shop ${shopId} is not connected.`,
          hint:    "Connect the shop at jeterdev.tools/dashboard.",
        },
      },
      { status: 403 }
    );
  }

  // Fetch all resources in parallel
  const [shipping, returnPolicies, processingProfiles, sections, productionPartners] =
    await Promise.all([
      etsyGet(`/application/shops/${shopId}/shipping-profiles`, accessToken),
      fetchReturnPolicies(shopId, accessToken),
      fetchProcessingProfiles(shopId, accessToken),
      etsyGet(`/application/shops/${shopId}/sections`, accessToken),
      etsyGet(`/application/shops/${shopId}/production-partners`, accessToken),
    ]);

  const errors: Record<string, string> = {};
  if (shipping.error)           errors.shipping_profiles    = shipping.error;
  if (returnPolicies.error)     errors.return_policies      = returnPolicies.error;
  if (processingProfiles.error) errors.processing_profiles  = processingProfiles.error;
  if (sections.error)           errors.shop_sections        = sections.error;
  if (productionPartners.error) errors.production_partners  = productionPartners.error;

  const hasErrors = Object.keys(errors).length > 0;
  const allFailed = hasErrors && !shipping.data && !returnPolicies.data && !sections.data;

  const response: Record<string, unknown> = {
    shop_id:             shopId,
    synced_at:           new Date().toISOString(),
    status:              allFailed ? "failed" : hasErrors ? "partial" : "ok",
    shipping_profiles:   shipping.data          ?? [],
    return_policies:     returnPolicies.data    ?? [],
    processing_profiles: processingProfiles.data ?? [],
    shop_sections:       sections.data          ?? [],
    production_partners: productionPartners.data ?? [],
  };

  if (hasErrors) {
    response.errors = errors;
    response.note   = "Some resources failed. Empty arrays may indicate fetch failure. Check errors field.";
  }

  return NextResponse.json(response, { status: allFailed ? 502 : 200 });
}