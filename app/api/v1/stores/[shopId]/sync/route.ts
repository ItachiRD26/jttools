// LOCATION: app/api/v1/stores/[shopId]/sync/route.ts
// POST /api/v1/stores/{shopId}/sync
// Full shop data refresh — surfaces per-resource errors instead of empty arrays

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import { getValidAccessToken } from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

interface FetchResult {
  data:  unknown[] | null;
  error: string | null;
  status: number | null;
}

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
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: msg, status: null };
  }
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

  // Fetch all resources in parallel — each tracked independently
  const [shipping, returnPolicies, processingProfiles, sections, partners] =
    await Promise.all([
      etsyGet(`/application/shops/${shopId}/shipping-profiles`,  accessToken),
      // Try new return-policies endpoint, then fall back to legacy
      etsyGet(`/application/shops/${shopId}/return-policies`,    accessToken).then(async r => {
        if (r.error) return etsyGet(`/application/shops/${shopId}/policies/return`, accessToken);
        return r;
      }),
      etsyGet(`/application/shops/${shopId}/production-partners`, accessToken),
      etsyGet(`/application/shops/${shopId}/sections`,           accessToken),
      etsyGet(`/application/shops/${shopId}/production-partners`, accessToken),
    ]);

  const synced_at = new Date().toISOString();
  const errors: Record<string, string> = {};

  if (shipping.error)          errors.shipping_profiles    = shipping.error;
  if (returnPolicies.error)    errors.return_policies       = returnPolicies.error;
  if (processingProfiles.error) errors.processing_profiles  = processingProfiles.error;
  if (sections.error)          errors.shop_sections         = sections.error;

  const hasErrors    = Object.keys(errors).length > 0;
  const allFailed    = hasErrors && !shipping.data && !returnPolicies.data && !sections.data;

  const response: Record<string, unknown> = {
    shop_id:             shopId,
    synced_at,
    status:              allFailed ? "failed" : hasErrors ? "partial" : "ok",
    shipping_profiles:   shipping.data          ?? [],
    return_policies:     returnPolicies.data     ?? [],
    processing_profiles: processingProfiles.data ?? [],
    shop_sections:       sections.data           ?? [],
    production_partners: partners.data           ?? [],
  };

  // Surface errors so consumers know what failed vs what's genuinely empty
  if (hasErrors) {
    response.errors = errors;
    response.note   = "Some resources failed to fetch. Check the 'errors' field for details. Empty arrays in the response may indicate fetch failure, not absence of data.";
  }

  return NextResponse.json(response, {
    status: allFailed ? 502 : 200,
  });
}