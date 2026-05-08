"use client";
// LOCATION: app/docs/page.tsx
// ROUTE: /docs

import { useState, useEffect } from "react";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface NavItem  { id: string; title: string; count?: number }
interface NavGroup { label: string; items: NavItem[] }

interface Param {
  name: string; type: string; required: boolean; description: string;
}
interface Endpoint {
  method: Method; path: string; description: string;
  plan?: string; params?: Param[]; example: string; response?: string;
}

const NAV: NavGroup[] = [
  {
    label: "Getting Started",
    items: [
      { id: "introduction",  title: "Introduction"   },
      { id: "authentication",title: "Authentication" },
      { id: "rate-limits",   title: "Rate Limits"    },
      { id: "errors",        title: "Errors"         },
    ],
  },
  {
    label: "Etsy Marketplace",
    items: [
      { id: "search",     title: "Search",         count: 1  },
      { id: "listings",   title: "Listings",       count: 11 },
      { id: "shops",      title: "Shops",          count: 8  },
      { id: "shipping",   title: "Shipping",       count: 7  },
      { id: "categories", title: "Categories",     count: 4  },
      { id: "images",     title: "Images & Media", count: 3  },
      { id: "users",      title: "Users",          count: 3  },
      { id: "policies",   title: "Shop Policies",  count: 1  },
    ],
  },
];

const ENDPOINTS: Record<string, Endpoint[]> = {
  search: [
    {
      method: "GET", path: "/search/listings", description: "Search active Etsy listings by keyword",
      params: [
        { name: "query",     type: "string",  required: true,  description: "Search keywords" },
        { name: "limit",     type: "integer", required: false, description: "Results per page (default: 25, max: 100)" },
        { name: "offset",    type: "integer", required: false, description: "Pagination offset (default: 0)" },
        { name: "sort_on",   type: "string",  required: false, description: "created · price · updated · score" },
        { name: "min_price", type: "float",   required: false, description: "Minimum price filter (USD)" },
        { name: "max_price", type: "float",   required: false, description: "Maximum price filter (USD)" },
      ],
      example: `curl "https://api.jt.tools/v1/search/listings?query=ceramic+mug&limit=10" \\
  -H "x-api-key: jt_YOUR_KEY"`,
      response: `{\n  "count": 10,\n  "results": [\n    {\n      "listing_id": 1234567890,\n      "title": "Handmade Ceramic Mug",\n      "price": { "amount": 2500, "divisor": 100, "currency_code": "USD" }\n    }\n  ]\n}`,
    },
  ],
  listings: [
    { method:"GET",    path:"/listings/search",    description:"Search active listings",              params:[{name:"query",type:"string",required:true,description:"Keywords"},{name:"limit",type:"integer",required:false,description:"Max 100"},{name:"offset",type:"integer",required:false,description:"Pagination"}], example:`curl "https://api.jt.tools/v1/listings/search?query=art" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/listings/get",        description:"Get a listing by ID",                 params:[{name:"listing_id",type:"string",required:true,description:"Etsy listing ID"}], example:`curl "https://api.jt.tools/v1/listings/get?listing_id=1234567890" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/listings/active",     description:"Get active listings from a shop",     params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"},{name:"limit",type:"integer",required:false,description:""},{name:"offset",type:"integer",required:false,description:""}], example:`curl "https://api.jt.tools/v1/listings/active?limit=25" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/listings/featured",   description:"Get featured listings",               params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/listings/featured" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
    { method:"POST",   path:"/listings/create",     description:"Create a new listing",   plan:"Pro+", params:[{name:"body",type:"object",required:true,description:"Listing object per Etsy schema"}], example:`curl -X POST "https://api.jt.tools/v1/listings/create" \\\n  -H "x-api-key: jt_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"My Listing","price":{"amount":2500},...}'` },
    { method:"PATCH",  path:"/listings/update",     description:"Update a listing",       plan:"Pro+", params:[{name:"listing_id",type:"string",required:true,description:"Etsy listing ID"},{name:"body",type:"object",required:true,description:"Fields to update"}], example:`curl -X PATCH "https://api.jt.tools/v1/listings/update?listing_id=123" \\\n  -H "x-api-key: jt_YOUR_KEY" \\\n  -d '{"title":"New Title"}'` },
    { method:"DELETE", path:"/listings/delete",     description:"Delete a listing",       plan:"Pro+", params:[{name:"listing_id",type:"string",required:true,description:"Etsy listing ID"}], example:`curl -X DELETE "https://api.jt.tools/v1/listings/delete?listing_id=123" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/listings/images",     description:"Get images for a listing",            params:[{name:"listing_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/listings/images?listing_id=123" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/listings/inventory",  description:"Get inventory for a listing",         params:[{name:"listing_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/listings/inventory?listing_id=123" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/listings/properties", description:"Get listing properties/variations",   params:[{name:"listing_id",type:"string",required:true,description:""},{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/listings/properties?listing_id=123" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/listings/shipping",   description:"Get shipping info for a listing",     params:[{name:"listing_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/listings/shipping?listing_id=123" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
  ],
  shops: [
    { method:"GET", path:"/shops/get",                 description:"Get shop information",         params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/shops/get?shop_id=YOUR_SHOP_ID" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/shops/listings",            description:"Get all listings from a shop", params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"},{name:"limit",type:"integer",required:false,description:""},{name:"offset",type:"integer",required:false,description:""}], example:`curl "https://api.jt.tools/v1/shops/listings?shop_id=YOUR_SHOP_ID&limit=50" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/shops/sections",            description:"Get shop sections",            params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/shops/sections?shop_id=YOUR_SHOP_ID" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/shops/reviews",             description:"Get shop reviews",             params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"},{name:"limit",type:"integer",required:false,description:""}], example:`curl "https://api.jt.tools/v1/shops/reviews?shop_id=YOUR_SHOP_ID" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/shops/transactions",        description:"Get shop transactions",        params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/shops/transactions?shop_id=YOUR_SHOP_ID" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/shops/orders",              description:"Get shop orders (receipts)",   params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"},{name:"limit",type:"integer",required:false,description:""}], example:`curl "https://api.jt.tools/v1/shops/orders?shop_id=YOUR_SHOP_ID" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"PUT", path:"/shops/update",              description:"Update shop information", plan:"Pro+", params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"},{name:"body",type:"object",required:true,description:""}], example:`curl -X PUT "https://api.jt.tools/v1/shops/update" \\\n  -H "x-api-key: jt_YOUR_KEY" -d '{"title":"My Shop"}'` },
    { method:"GET", path:"/shops/production-partners", description:"Get production partners",     params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/shops/production-partners?shop_id=YOUR_SHOP_ID" -H "x-api-key: jt_YOUR_KEY"` },
  ],
  shipping: [
    { method:"GET",    path:"/shipping/profiles",     description:"List all shipping profiles",          params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/shipping/profiles?shop_id=YOUR_SHOP_ID" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/shipping/profile",      description:"Get a shipping profile by ID",        params:[{name:"profile_id",type:"string",required:true,description:""},{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/shipping/profile?profile_id=123" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"POST",   path:"/shipping/create",       description:"Create a shipping profile", plan:"Pro+", params:[{name:"body",type:"object",required:true,description:"Profile object"}], example:`curl -X POST "https://api.jt.tools/v1/shipping/create" \\\n  -H "x-api-key: jt_YOUR_KEY" -d '{"title":"US Standard"}'` },
    { method:"PUT",    path:"/shipping/update",       description:"Update a shipping profile", plan:"Pro+", params:[{name:"profile_id",type:"string",required:true,description:""}], example:`curl -X PUT "https://api.jt.tools/v1/shipping/update?profile_id=123" \\\n  -H "x-api-key: jt_YOUR_KEY" -d '{"title":"Updated"}'` },
    { method:"DELETE", path:"/shipping/delete",       description:"Delete a shipping profile", plan:"Pro+", params:[{name:"profile_id",type:"string",required:true,description:""}], example:`curl -X DELETE "https://api.jt.tools/v1/shipping/delete?profile_id=123" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/shipping/destinations", description:"Get destinations for a profile",      params:[{name:"profile_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/shipping/destinations?profile_id=123" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET",    path:"/shipping/upgrades",     description:"Get upgrades for a profile",          params:[{name:"profile_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/shipping/upgrades?profile_id=123" -H "x-api-key: jt_YOUR_KEY"` },
  ],
  categories: [
    { method:"GET", path:"/categories/list",       description:"List the full taxonomy tree",     params:[], example:`curl "https://api.jt.tools/v1/categories/list" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/categories/get",        description:"Get a category by taxonomy ID",   params:[{name:"taxonomy_id",type:"string",required:true,description:"Etsy taxonomy node ID"}], example:`curl "https://api.jt.tools/v1/categories/get?taxonomy_id=1" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/categories/properties", description:"Get properties for a category",   params:[{name:"taxonomy_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/categories/properties?taxonomy_id=1" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/categories/children",   description:"Get child nodes of a category",   params:[{name:"taxonomy_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/categories/children?taxonomy_id=1" -H "x-api-key: jt_YOUR_KEY"` },
  ],
  images: [
    { method:"GET",    path:"/images/listing", description:"Get all images for a listing",            params:[{name:"listing_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/images/listing?listing_id=123" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"POST",   path:"/images/upload",  description:"Upload an image to a listing", plan:"Pro+", params:[{name:"listing_id",type:"string",required:true,description:""},{name:"body",type:"multipart",required:true,description:"Image file"}], example:`curl -X POST "https://api.jt.tools/v1/images/upload?listing_id=123" \\\n  -H "x-api-key: jt_YOUR_KEY" \\\n  -F "image=@photo.jpg"` },
    { method:"DELETE", path:"/images/delete",  description:"Delete an image from a listing", plan:"Pro+", params:[{name:"listing_id",type:"string",required:true,description:""},{name:"listing_image_id",type:"string",required:true,description:""}], example:`curl -X DELETE "https://api.jt.tools/v1/images/delete?listing_id=123&listing_image_id=456" \\\n  -H "x-api-key: jt_YOUR_KEY"` },
  ],
  users: [
    { method:"GET", path:"/users/me",        description:"Get the authenticated user", params:[], example:`curl "https://api.jt.tools/v1/users/me" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/users/get",       description:"Get a user by ID",           params:[{name:"user_id",type:"string",required:true,description:"Etsy user ID"}], example:`curl "https://api.jt.tools/v1/users/get?user_id=123" -H "x-api-key: jt_YOUR_KEY"` },
    { method:"GET", path:"/users/addresses", description:"Get addresses for a user",   params:[{name:"user_id",type:"string",required:true,description:""}], example:`curl "https://api.jt.tools/v1/users/addresses?user_id=123" -H "x-api-key: jt_YOUR_KEY"` },
  ],
  policies: [
    { method:"GET", path:"/policies/get", description:"Get policies for a shop", params:[{name:"shop_id",type:"string",required:true,description:"Your Etsy shop ID (numeric)"}], example:`curl "https://api.jt.tools/v1/policies/get?shop_id=YOUR_SHOP_ID" -H "x-api-key: jt_YOUR_KEY"` },
  ],
};

const SECTION_DESC: Record<string, string> = {
  search:     "Full-text search across Etsy's active marketplace listings.",
  listings:   "Create, read, update, and delete Etsy listings. Write endpoints require the Pro plan.",
  shops:      "Retrieve shop info, listings, sections, reviews, orders, and transactions.",
  shipping:   "Manage shipping profiles, destinations, and upgrades.",
  categories: "Browse Etsy's full seller taxonomy tree and category properties.",
  images:     "Retrieve, upload, and delete images attached to listings.",
  users:      "Retrieve Etsy user information and saved addresses.",
  policies:   "Retrieve the policies configured for an Etsy shop.",
};

const METHOD_STYLE: Record<Method, string> = {
  GET:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  POST:   "bg-blue-500/10   text-blue-400   border-blue-500/20",
  PUT:    "bg-amber-500/10  text-amber-400  border-amber-500/20",
  PATCH:  "bg-amber-500/10  text-amber-400  border-amber-500/20",
  DELETE: "bg-red-500/10    text-red-400    border-red-500/20",
};

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-3 rounded-xl bg-black/40 border border-white/6 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/6">
        <span className="text-[10px] font-mono text-white/25 uppercase">{lang}</span>
        <button
          onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
        >
          {copied ? "copied!" : "copy"}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono text-white/70 leading-relaxed overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

function EndpointBlock({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/6 rounded-xl overflow-hidden mb-2.5">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/2 transition-colors">
        <span className={`shrink-0 text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${METHOD_STYLE[ep.method]}`}>{ep.method}</span>
        <span className="font-mono text-sm text-white/80 flex-1">{ep.path}</span>
        {ep.plan && <span className="text-[10px] px-2 py-0.5 rounded bg-[#7F77DD]/10 border border-[#7F77DD]/20 text-[#7F77DD] font-mono shrink-0">{ep.plan}</span>}
        <span className="text-xs text-white/30 shrink-0 hidden md:block">{ep.description}</span>
        <svg className={`w-3.5 h-3.5 text-white/20 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-white/6 bg-white/1">
          {ep.params && ep.params.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Parameters</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-white/25 uppercase tracking-wider">
                    <th className="text-left pb-2 font-mono w-1/4">Name</th>
                    <th className="text-left pb-2 font-mono w-1/6">Type</th>
                    <th className="text-left pb-2 w-1/6">Required</th>
                    <th className="text-left pb-2">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/4">
                  {ep.params.map((p) => (
                    <tr key={p.name}>
                      <td className="py-2 font-mono text-white/70 pr-3">{p.name}</td>
                      <td className="py-2 text-white/30 pr-3 font-mono">{p.type}</td>
                      <td className="py-2 pr-3">
                        {p.required
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">required</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/4 text-white/30 border border-white/6">optional</span>}
                      </td>
                      <td className="py-2 text-white/40">{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Example</p>
            <CodeBlock code={ep.example} />
          </div>
          {ep.response && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Response</p>
              <CodeBlock code={ep.response} lang="json" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Introduction() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Getting Started</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-3">Introduction</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          JT Tools is a managed bridge over the Etsy API v3. Send requests with your API key and we handle Etsy authentication, rate limiting, and errors. The response is Etsy&apos;s original JSON, unmodified.
        </p>
      </div>
      <div className="bg-white/3 border border-white/6 rounded-xl p-4">
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Base URL</p>
        <code className="font-mono text-sm text-[#7F77DD]">https://api.jt.tools/v1</code>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Free","$0","100/day"],["Starter","$25/mo","2,000/day"],["Pro","$50/mo","50,000/day"]].map(([n,p,d]) => (
          <div key={n} className="bg-white/3 border border-white/6 rounded-xl p-3">
            <div className="text-[10px] font-mono text-white/30 uppercase">{n}</div>
            <div className="text-base font-semibold text-white mt-0.5">{p}</div>
            <div className="text-[11px] text-white/30 mt-0.5 font-mono">{d}</div>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Quick start</p>
        <CodeBlock code={`curl "https://api.jt.tools/v1/listings/search?query=handmade+art&limit=10" \\\n  -H "x-api-key: jt_YOUR_KEY_HERE"`} />
      </div>
    </div>
  );
}

function Authentication() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Getting Started</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-3">Authentication</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          All requests must include your API key in the{" "}
          <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">x-api-key</code>{" "}
          header. Generate your key from the <a href="/dashboard" className="text-[#7F77DD] hover:underline">Dashboard</a>.
        </p>
      </div>
      <div className="flex items-start gap-3 bg-amber-500/6 border border-amber-500/20 rounded-xl p-4">
        <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
        <p className="text-xs text-amber-400/80">Never expose your API key in client-side code or public repositories.</p>
      </div>
      <CodeBlock code={`curl https://api.jt.tools/v1/listings/search?query=art \\\n  -H "x-api-key: jt_a3f4b5c6d7e8f9..."`} />
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Key format</p>
        <p className="text-sm text-white/40 mb-2">Keys are prefixed with <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">jt_</code> followed by 48 hex characters.</p>
        <CodeBlock code="jt_a3f4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6" lang="text" />
      </div>
    </div>
  );
}

function RateLimits() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Getting Started</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-3">Rate Limits</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          Each API key has a daily request limit based on its plan. Limits reset at <strong className="text-white/70">midnight UTC</strong>. Every response includes rate limit headers.
        </p>
      </div>
      <CodeBlock code={`X-RateLimit-Limit:     5000\nX-RateLimit-Remaining: 4953\nX-RateLimit-Reset:     1736985600   # Unix timestamp\nX-Plan:                pro`} lang="http" />
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">When you hit the limit</p>
        <CodeBlock code={`HTTP 429 Too Many Requests\n\n{\n  "error": "Daily limit of 5000 requests reached. Resets at midnight UTC."\n}`} lang="json" />
      </div>
      <div className="border border-white/6 rounded-xl overflow-hidden">
        <div className="grid grid-cols-4 text-[10px] font-mono text-white/30 uppercase tracking-wider px-4 py-2.5 border-b border-white/6 bg-white/2">
          <div>Plan</div><div>Req/day</div><div>Price</div><div>Endpoints</div>
        </div>
        {[["Free","100","$0","6"],["Starter","2,000","$25/mo","19 read"],["Pro","50,000","$50/mo","All (incl. write)"]].map(([p,r,pr,e]) => (
          <div key={p} className="grid grid-cols-4 text-xs px-4 py-2.5 border-b border-white/4 text-white/50 last:border-0">
            <div className="font-medium text-white/70">{p}</div>
            <div className="font-mono">{r}</div>
            <div>{pr}</div>
            <div>{e}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Errors() {
  const codes = [
    { code:"200", label:"OK",               desc:"Request succeeded. Etsy response returned as-is.",          color:"text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    { code:"401", label:"Unauthorized",      desc:"Missing or invalid API key.",                               color:"text-red-400 bg-red-500/10 border-red-500/20" },
    { code:"403", label:"Forbidden",         desc:"Key is disabled or endpoint not available on your plan.",   color:"text-amber-400 bg-amber-500/10 border-amber-500/20" },
    { code:"404", label:"Not Found",         desc:"The endpoint slug does not exist.",                         color:"text-red-400 bg-red-500/10 border-red-500/20" },
    { code:"429", label:"Too Many Requests", desc:"Daily limit reached. Resets at midnight UTC.",              color:"text-red-400 bg-red-500/10 border-red-500/20" },
    { code:"500", label:"Server Error",      desc:"Something went wrong on our end.",                          color:"text-red-400 bg-red-500/10 border-red-500/20" },
  ];
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Getting Started</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-3">Errors</h1>
        <p className="text-sm text-white/50 leading-relaxed">JT Tools uses standard HTTP status codes. All errors return a JSON body with an <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">error</code> field.</p>
      </div>
      <CodeBlock code={`{\n  "error": "Endpoint 'listings/create' is not available on the Starter plan."\n}`} lang="json" />
      <div className="flex flex-col gap-2">
        {codes.map((c) => (
          <div key={c.code} className="flex items-center gap-4 p-3 border border-white/6 rounded-xl">
            <span className={`text-[11px] font-mono px-2 py-0.5 rounded border shrink-0 ${c.color}`}>{c.code}</span>
            <span className="text-sm text-white/70 font-medium w-36 shrink-0">{c.label}</span>
            <span className="text-xs text-white/40">{c.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EndpointSection({ id }: { id: string }) {
  const item = NAV[1].items.find((i) => i.id === id);
  return (
    <div>
      <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Etsy Marketplace</p>
      <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">{item?.title ?? id}</h1>
      <p className="text-sm text-white/40 leading-relaxed mb-6">{SECTION_DESC[id]}</p>
      {(ENDPOINTS[id] ?? []).map((ep, i) => <EndpointBlock key={i} ep={ep} />)}
    </div>
  );
}

export default function DocsPage() {
  const [active, setActive] = useState("introduction");

  useEffect(() => {
    document.getElementById("doc-content")?.scrollTo(0, 0);
  }, [active]);

  function renderContent() {
    if (active === "introduction")   return <Introduction />;
    if (active === "authentication") return <Authentication />;
    if (active === "rate-limits")    return <RateLimits />;
    if (active === "errors")         return <Errors />;
    return <EndpointSection id={active} />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-white/6 shrink-0">
        <div className="flex items-center gap-6">
          <a href="/" className="text-base font-semibold"><img src="/logo.webp" alt="JeterDev Tools" className="h-16 w-auto" /></a>
          <span className="text-white/20 text-sm hidden md:block">API Reference</span>
        </div>
        <div className="flex items-center gap-5">
          <a href="/pricing"   className="text-sm text-white/40 hover:text-white/70 transition-colors hidden md:block">Pricing</a>
          <a href="/dashboard" className="text-sm text-white/40 hover:text-white/70 transition-colors hidden md:block">Dashboard</a>
          <a href="/dashboard" className="text-xs px-3 py-1.5 bg-[#7F77DD] hover:bg-[#6B62CC] text-white rounded-lg transition-colors font-medium">
            Get API key
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 53px)" }}>
        <aside className="w-56 shrink-0 border-r border-white/6 overflow-y-auto py-5 hidden md:block">
          {NAV.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="text-[9px] font-mono text-white/25 uppercase tracking-widest px-5 mb-1.5">{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActive(item.id)}
                  className={`w-full flex items-center justify-between px-5 py-1.5 text-sm transition-all text-left border-l-2 ${
                    active === item.id
                      ? "border-[#7F77DD] text-white font-medium bg-white/2"
                      : "border-transparent text-white/40 hover:text-white/70 hover:bg-white/1"
                  }`}
                >
                  {item.title}
                  {item.count !== undefined && (
                    <span className={`text-[10px] font-mono ${active === item.id ? "text-[#7F77DD]" : "text-white/20"}`}>
                      {item.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <main id="doc-content" className="flex-1 overflow-y-auto py-10 px-8 max-w-3xl">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}