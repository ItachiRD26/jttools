// LOCATION: app/api/v1/shops/[shopId]/ledger/route.ts
// GET /api/v1/shops/{shopId}/ledger?min_created=X&max_created=Y&limit=N&offset=N
//
// Returns Etsy's Payment Account Ledger entries for a shop. This is
// where the fees that DON'T show up on getShopReceiptPayments live:
//
//   - Transaction fee (6.5% of item+shipping) — one entry per receipt
//   - Offsite ads fee (12–15% when applicable) — one entry per receipt
//   - Regulatory operating fee — one entry per receipt (some regions)
//   - Chargeback fees — when a buyer wins a dispute
//   - Listing fees ($0.20 per listing per 4 months) — not tied to a receipt
//   - Etsy Ads (CPC bidding) — periodic, not tied to a receipt
//   - Etsy Plus subscription — monthly, not tied to a receipt
//   - Refunds — negative amounts
//
// Entries with a receipt_id in `reference_id` aggregate PER-ORDER on
// the caller's side (they subtract from etsyPayoutUsd to get the
// truly-final take-home per order). Entries WITHOUT a receipt_id are
// shop-level overhead and roll up into the per-store overhead view.
//
// min_created / max_created are Unix seconds. Etsy caps limit at 100
// per request — callers paginate with offset. shop_id is required
// (Etsy's endpoint is shop-scoped + OAuth-only, matching every other
// billing-related endpoint we already proxy).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";
import {
  getValidAccessToken,
  StoreNotConnectedError,
} from "@/lib/etsy-oauth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shopId: string }> },
) {
  const apiKey = req.headers.get("x-api-key");
  const auth = await validateRequest(apiKey, "shops/ledger");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { shopId } = await params;

  const sp = req.nextUrl.searchParams;
  const minCreated = sp.get("min_created")?.trim();
  const maxCreated = sp.get("max_created")?.trim();
  const limit = sp.get("limit")?.trim();
  const offset = sp.get("offset")?.trim();

  const db = getDb();
  const keySnap = await db.collection("apiKeys").doc(apiKey!).get();
  const userId = keySnap.data()?.userId as string | undefined;
  if (!userId) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", status: 401, message: "Could not identify user." } },
      { status: 401 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, shopId);
  } catch (err) {
    const isNotConnected = err instanceof StoreNotConnectedError;
    const code = isNotConnected ? "STORE_NOT_CONNECTED" : "STORE_TOKEN_EXPIRED";
    const status = isNotConnected ? 403 : 503;
    return NextResponse.json(
      {
        error: {
          code,
          status,
          message: isNotConnected
            ? `Shop ${shopId} is not connected to your account.`
            : "Store authorization expired. Re-link the shop at jeterdev.tools/dashboard.",
        },
      },
      { status }
    );
  }

  const upstream = new URL(
    `${ETSY_BASE}/application/shops/${shopId}/payment-account/ledger-entries`
  );
  if (minCreated) upstream.searchParams.set("min_created", minCreated);
  if (maxCreated) upstream.searchParams.set("max_created", maxCreated);
  if (limit) upstream.searchParams.set("limit", limit);
  if (offset) upstream.searchParams.set("offset", offset);

  const res = await fetch(upstream.toString(), {
    headers: {
      "x-api-key": API_KEY(),
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          status: 502,
          message: "Etsy API error.",
          details: err,
        },
      },
      { status: 502 }
    );
  }

  return NextResponse.json(await res.json());
}
