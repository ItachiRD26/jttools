// LOCATION: app/api/v1/categories/[categoryId]/listing-schema/route.ts
// GET /api/v1/categories/{categoryId}/listing-schema
// Returns full schema for a taxonomy: required fields, optional fields,
// category attributes (with possible values), and variation properties

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";

const ETSY_BASE = "https://openapi.etsy.com/v3";
const API_KEY   = () => `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;

// Fields always required for any listing
const REQUIRED_FIELDS = [
  "title", "description", "price", "quantity",
  "taxonomy_id", "listing_type", "who_made", "when_made",
];

// Fields always optional
const OPTIONAL_FIELDS = [
  "tags", "materials", "styles", "sku",
  "is_supply", "is_customizable", "is_taxable", "should_auto_renew",
  "item_weight", "item_weight_unit",
  "item_length", "item_width", "item_height", "item_dimensions_unit",
  "processing_min", "processing_max",
  "shop_section_id", "shipping_profile_id", "return_policy_id",
  "production_partner_ids",
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  const { categoryId } = await params;
  const apiKey         = req.headers.get("x-api-key");
  const auth           = await validateRequest(apiKey, "categories/listing-schema");

  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Validate taxonomy ID
  const taxId = parseInt(categoryId, 10);
  if (isNaN(taxId)) {
    return NextResponse.json(
      {
        error: {
          code:    "TAXONOMY_INVALID",
          status:  400,
          message: `'${categoryId}' is not a valid taxonomy ID.`,
          hint:    "Use GET /api/v1/categories/list to find valid taxonomy IDs.",
          docs:    "https://jeterdev.tools/docs#categories",
        },
      },
      { status: 400 }
    );
  }

  // Fetch category properties from Etsy. MUST use seller-taxonomy: listing
  // taxonomy_ids (and our /categories/list) come from the seller taxonomy, which
  // is a different node-id space than buyer-taxonomy. Querying buyer-taxonomy
  // with a seller id 404s for whole branches (e.g. Craft Supplies → "Artificial
  // Flowers"), which surfaced downstream as a permanent "Loading attributes…".
  const res = await fetch(
    `${ETSY_BASE}/application/seller-taxonomy/nodes/${taxId}/properties`,
    {
      headers: {
        "x-api-key": API_KEY(),
        "Accept":    "application/json",
      },
    }
  );

  if (!res.ok) {
    if (res.status === 404) {
      return NextResponse.json(
        {
          error: {
            code:    "TAXONOMY_INVALID",
            status:  400,
            message: `Taxonomy ID ${taxId} is not a valid Etsy category.`,
            hint:    "Use GET /api/v1/categories/list to find valid taxonomy IDs.",
          },
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: { code: "UPSTREAM_ERROR", status: 502, message: "Failed to fetch taxonomy properties." } },
      { status: 502 }
    );
  }

  const data       = await res.json();
  const properties = data.results ?? [];

  // Separate attributes from variation properties
  const categoryAttributes = properties.map((prop: {
    property_id:        number;
    name:               string;
    supports_variations: boolean;
    is_required:        boolean;
    is_multivalued:     boolean;
    max_values_allowed: number | null;
    scales:             unknown[];
    possible_values:    { value_id: number; name: string; scale_id?: number }[];
  }) => ({
    property_id:        prop.property_id,
    name:               prop.name,
    required:           prop.is_required        ?? false,
    is_multivalued:     prop.is_multivalued      ?? false,
    max_values_allowed: prop.max_values_allowed  ?? null,
    possible_values: (prop.possible_values ?? []).map((v: { value_id: number; name: string; scale_id?: number }) => ({
      value_id: v.value_id,
      name:     v.name,
      ...(v.scale_id ? { scale_id: v.scale_id } : {}),
    })),
    scales: prop.scales ?? [],
  }));

  const variationProperties = properties
    .filter((p: { supports_variations: boolean }) => p.supports_variations)
    .map((p: { property_id: number; name: string; scales: unknown[] }) => ({
      property_id: p.property_id,
      name:        p.name,
      scales:      p.scales ?? [],
    }));

  return NextResponse.json({
    taxonomy_id:          taxId,
    required_fields:      REQUIRED_FIELDS,
    optional_fields:      OPTIONAL_FIELDS,
    category_attributes:  categoryAttributes,
    variation_properties: variationProperties,
  });
}