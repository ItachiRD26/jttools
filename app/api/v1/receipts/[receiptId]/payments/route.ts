// LOCATION: app/api/v1/receipts/[receiptId]/payments/route.ts
// GET /api/v1/receipts/:receiptId/payments?shop_id=X
//
// Returns the Payment records associated with a receipt. Each Payment
// carries the money math the seller cares about that ISN'T on the
// receipt itself:
//   - amount_gross / amount_fees / amount_net (initial figures)
//   - posted_gross / posted_fees / posted_net (once Etsy posts to
//     the ledger; typically same as amount_* until refunds land)
//   - adjusted_gross / adjusted_fees / adjusted_net (final numbers
//     after refunds, discounts, etc. — this is what actually gets
//     deposited to the seller's bank)
//
// One receipt can have multiple payments in rare cases (partial
// captures, split-tender). Downstream typically sums adjusted_net
// across payments to compute the true payout for the order.
//
// shop_id is required (Etsy's payments endpoint is shop-scoped +
// OAuth-only, same pattern as the parent receipt endpoint).

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
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const apiKey = req.headers.get("x-api-key");
  const auth = await validateRequest(apiKey, "receipts");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { receiptId } = await params;
  const shopId = req.nextUrl.searchParams.get("shop_id")?.trim();
  if (!shopId) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          status: 400,
          message: "shop_id parameter is required.",
        },
      },
      { status: 400 }
    );
  }

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
    `${ETSY_BASE}/application/shops/${shopId}/receipts/${receiptId}/payments`
  );

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
