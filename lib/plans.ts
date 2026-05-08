// ─────────────────────────────────────────────
//  JT Tools — Plan Definitions
//  3 plans: free · starter ($25) · pro ($50)
// ─────────────────────────────────────────────

export type PlanId = "free" | "starter" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  dailyLimit: number;
  allowedEndpoints: string[];
  price: number; // USD/month (0 = free)
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    dailyLimit: 100,
    price: 0,
    allowedEndpoints: [
      "listings/search",
      "listings/get",
      "listings/active",
      "shops/get",
      "categories/list",
      "search/listings",
    ],
  },

  starter: {
    id: "starter",
    name: "Starter",
    dailyLimit: 2000,
    price: 25,
    allowedEndpoints: [
      "listings/search",
      "listings/get",
      "listings/active",
      "listings/featured",
      "listings/images",
      "listings/inventory",
      "listings/properties",
      "listings/shipping",
      "shops/get",
      "shops/listings",
      "shops/sections",
      "shops/reviews",
      "search/listings",
      "categories/list",
      "categories/get",
      "categories/properties",
      "images/listing",
      "users/me",
      "policies/get",
    ],
  },

  pro: {
    id: "pro",
    name: "Pro",
    dailyLimit: 50000,
    price: 50,
    allowedEndpoints: ["*"], // full access — all endpoints including write
  },
};

// ─── Helpers ────────────────────────────────

export function isEndpointAllowed(plan: Plan, endpoint: string): boolean {
  return plan.allowedEndpoints.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return endpoint.startsWith(prefix + "/") || endpoint === prefix;
    }
    return pattern === endpoint;
  });
}

export function getPlan(planId: string): Plan {
  return PLANS[planId as PlanId] ?? PLANS.free;
}