// ─────────────────────────────────────────────
//  JT Tools — Plan Definitions
//  2 plans: free · pro ($50/mo)
// ─────────────────────────────────────────────

export type PlanId = "free" | "pro";

export interface Plan {
  id:               PlanId;
  name:             string;
  dailyLimit:       number;
  perSecondLimit:   number;
  allowedEndpoints: string[];
  price:            number; // USD/month (0 = free)
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id:             "free",
    name:           "Free",
    dailyLimit:     500,
    perSecondLimit: 1,
    price:          0,
    allowedEndpoints: [
      // Public read-only endpoints
      "listings/search",
      "listings/get",
      "listings/active",
      "listings/featured",
      "listings/images",
      "listings/inventory",
      "listings/shipping",
      "listings/batch",
      "shops/get",
      "shops/listings",
      "shops/sections",
      "shops/reviews",
      "search/listings",
      "categories/list",
      "categories/get",
      "categories/properties",
      "categories/children",
      "categories/*/listing-schema",
      "images/listing",
      "images/get",
      "media/video",
      "media/files",
      "users/get",
    ],
  },

  pro: {
    id:             "pro",
    name:           "Pro",
    dailyLimit:     30000,
    perSecondLimit: 10,
    price:          50,
    allowedEndpoints: ["*"], // full access — all endpoints
  },
};

// ─── Helpers ────────────────────────────────

export function isEndpointAllowed(plan: Plan, endpoint: string): boolean {
  return plan.allowedEndpoints.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.includes("*")) {
      // Handle wildcard patterns like "categories/*/listing-schema"
      const regex = new RegExp("^" + pattern.replace(/\*/g, "[^/]+") + "$");
      return regex.test(endpoint);
    }
    return pattern === endpoint;
  });
}

export function getPlan(planId: string): Plan {
  return PLANS[planId as PlanId] ?? PLANS.free;
}