// LOCATION: app/api/v1/listings/batch/route.ts
// GET /api/v1/listings/batch?listing_ids=1,2,3
// Fetch up to 100 listings in one call

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const auth   = await validateRequest(apiKey, "listings/batch");

  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const idsParam = req.nextUrl.searchParams.get("listing_ids");
  if (!idsParam) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: "listing_ids parameter is required.",
          hint:    "Pass comma-separated listing IDs: ?listing_ids=123,456,789",
        },
      },
      { status: 400 }
    );
  }

  const ids = idsParam.split(",").map(id => id.trim()).filter(Boolean);

  if (ids.length > 100) {
    return NextResponse.json(
      {
        error: {
          code:    "INVALID_REQUEST",
          status:  400,
          message: "Maximum 100 listing IDs per request.",
        },
      },
      { status: 400 }
    );
  }

  // Etsy's batch endpoint — fetch up to 100 listings
  const res = await fetch(
    `${ETSY_BASE}/application/listings/batch?listing_ids=${ids.join(",")}`,
    {
      headers: {
        "x-api-key": API_KEY(),
        "Accept":    "application/json",
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(
      {
        error: {
          code:    "UPSTREAM_ERROR",
          status:  502,
          message: "Etsy API error.",
          details: err,
        },
      },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({
    count:   data.count ?? ids.length,
    results: data.results ?? [],
  });
}