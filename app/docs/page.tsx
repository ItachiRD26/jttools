"use client";
// LOCATION: app/docs/page.tsx

import { useState, useEffect } from "react";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface NavItem  { id: string; title: string; count?: number }
interface NavGroup { label: string; items: NavItem[] }
interface Param    { name: string; type: string; required: boolean; description: string }
interface Endpoint {
  method: Method; path: string; description: string;
  plan?: string; params?: Param[]; example: string;
  response?: string; note?: string;
}

const NAV: NavGroup[] = [
  {
    label: "Getting Started",
    items: [
      { id: "introduction",     title: "Introduction"      },
      { id: "authentication",   title: "Authentication"    },
      { id: "rate-limits",      title: "Rate Limits"       },
      { id: "store-connection", title: "Store Connection"  },
      { id: "errors",           title: "Errors"            },
    ],
  },
  {
    label: "Listing Builder",
    items: [
      { id: "listing-builder", title: "Overview"          },
      { id: "lb-uploads",      title: "Uploads",        count: 1 },
      { id: "lb-create",       title: "Create Listing", count: 1 },
      { id: "lb-jobs",         title: "Job Poll",       count: 1 },
    ],
  },
  {
    label: "Stores",
    items: [
      { id: "stores-list",      title: "List Stores",        count: 1 },
      { id: "stores-sync",      title: "Sync",               count: 1 },
      { id: "stores-live",      title: "Live Profiles",      count: 5 },
    ],
  },
  {
    label: "Etsy Marketplace",
    items: [
      { id: "search",      title: "Search",             count: 1  },
      { id: "listings",    title: "Listings",           count: 12 },
      { id: "shops",       title: "Shops",              count: 8  },
      { id: "store-mgmt",  title: "Store Management",   count: 5  },
      { id: "images",      title: "Images & Media",     count: 9  },
      { id: "properties",  title: "Listing Properties", count: 4  },
      { id: "shipping",    title: "Shipping",           count: 7  },
      { id: "categories",  title: "Categories",         count: 5  },
      { id: "users",       title: "User",               count: 3  },
      { id: "policies",    title: "Shop Policies",      count: 14 },
    ],
  },
];

const ENDPOINTS: Record<string, Endpoint[]> = {
  search: [
    {
      method: "GET", path: "/search/listings",
      description: "Full-text search across all active Etsy marketplace listings.",
      params: [
        { name: "query",      type: "string",  required: true,  description: "Search keywords (max 200 chars)" },
        { name: "limit",      type: "integer", required: false, description: "Results per page — default: 25, max: 100" },
        { name: "offset",     type: "integer", required: false, description: "Pagination offset — default: 0" },
        { name: "sort_on",    type: "string",  required: false, description: "Sort: created · price · updated · score" },
        { name: "sort_order", type: "string",  required: false, description: "asc or desc — default: desc" },
        { name: "min_price",  type: "float",   required: false, description: "Minimum price filter (USD)" },
        { name: "max_price",  type: "float",   required: false, description: "Maximum price filter (USD)" },
        { name: "taxonomy_id",type: "integer", required: false, description: "Filter by category taxonomy ID" },
      ],
      example: `curl "https://jeterdev.tools/api/v1/search/listings?query=ceramic+mug&limit=10&min_price=15" \\
  -H "x-api-key: jt_YOUR_KEY"`,
      response: `{
  "count": 847392,
  "results": [
    {
      "listing_id": 1234567890,
      "title": "Handmade Ceramic Mug",
      "price": { "amount": 2500, "divisor": 100, "currency_code": "USD" },
      "quantity": 12,
      "views": 1240,
      "num_favorers": 89,
      "url": "https://www.etsy.com/listing/1234567890/...",
      "shop_id": 61004439,
      "state": "active"
    }
  ]
}`,
    },
  ],

  listings: [
    { method: "GET",    path: "/listings/search",    description: "Search active listings — alias of /search/listings.",
      params: [{ name:"query",type:"string",required:true,description:"Search keywords" },{ name:"limit",type:"integer",required:false,description:"Max 100" },{ name:"offset",type:"integer",required:false,description:"Pagination offset" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/search?query=art&limit=10" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/listings/get",        description: "Retrieve a single listing by Etsy listing ID.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/get?listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/listings/active",     description: "Get all active listings for a shop.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"limit",type:"integer",required:false,description:"Max 100" },{ name:"offset",type:"integer",required:false,description:"Pagination offset" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/active?shop_id=61004439&limit=25" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/listings/featured",   description: "Get featured listings for a shop.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/featured?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "POST",   path: "/listings/create",     description: "Create a new listing in the connected shop.", plan: "Pro+", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"title",type:"string",required:true,description:"Listing title (max 140)" },{ name:"description",type:"string",required:true,description:"Full description" },{ name:"price",type:"object",required:true,description:"{amount, divisor, currency_code}" },{ name:"quantity",type:"integer",required:true,description:"Available quantity" },{ name:"taxonomy_id",type:"integer",required:true,description:"Etsy category ID" },{ name:"who_made",type:"string",required:true,description:"i_did · someone_else · collective" },{ name:"when_made",type:"string",required:true,description:"2020_2026 · made_to_order · etc." },{ name:"listing_type",type:"string",required:false,description:"physical · download · both" },{ name:"tags",type:"array",required:false,description:"Up to 13 tags" },{ name:"shipping_profile_id",type:"string",required:false,description:"Required for physical" },{ name:"return_policy_id",type:"string",required:false,description:"Required for physical" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/listings/create" \\
  -H "x-api-key: jt_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"shop_id":"61004439","title":"Handmade Ceramic Mug","description":"Beautiful mug...","price":{"amount":2500,"divisor":100,"currency_code":"USD"},"quantity":10,"taxonomy_id":1110,"who_made":"i_did","when_made":"made_to_order","listing_type":"physical","tags":["ceramic","mug"]}'` },
    { method: "PATCH",  path: "/listings/update",     description: "Update fields on an existing listing.", plan: "Pro+", note: "Requires Etsy shop connection.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"title",type:"string",required:false,description:"New title" },{ name:"description",type:"string",required:false,description:"New description" },{ name:"price",type:"object",required:false,description:"{amount, divisor, currency_code}" },{ name:"quantity",type:"integer",required:false,description:"New quantity" },{ name:"state",type:"string",required:false,description:"active · inactive · draft" },{ name:"tags",type:"array",required:false,description:"Replaces all existing tags" }],
      example: `curl -X PATCH "https://jeterdev.tools/api/v1/listings/update?listing_id=1234567890" \\
  -H "x-api-key: jt_YOUR_KEY" -d '{"title":"Updated Title","quantity":20}'` },
    { method: "DELETE", path: "/listings/delete",     description: "Permanently delete a listing.", plan: "Pro+", note: "Requires Etsy shop connection.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/listings/delete?listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/listings/images",     description: "Get all images for a listing.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/images?listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/listings/inventory",  description: "Get inventory/variation data for a listing.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/inventory?listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/listings/properties", description: "Get variation properties for a listing.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/properties?listing_id=1234567890&shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/listings/shipping",   description: "Get shipping info for a listing.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/shipping?listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/listings/batch",      description: "Fetch up to 100 listings by ID in a single request.",
      params: [{ name:"listing_ids",type:"string",required:true,description:"Comma-separated listing IDs (max 100)" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/batch?listing_ids=1234567890,9876543210,1122334455" -H "x-api-key: jt_YOUR_KEY"`,
      response: `{"count":3,"results":[{"listing_id":1234567890,"title":"Handmade Ceramic Mug",...},{"listing_id":9876543210,...}]}` },
  ],

  shops: [
    { method: "GET", path: "/shops/get",                 description: "Get full shop details.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/shops/get?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"`,
      response: `{"shop_id":61004439,"shop_name":"MyCeramicsShop","title":"Handmade Ceramics","url":"https://www.etsy.com/shop/MyCeramicsShop","num_favorers":843,"listing_active_count":47,"transaction_sold_count":1204}` },
    { method: "GET", path: "/shops/listings",            description: "Get all listings from a shop.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"state",type:"string",required:false,description:"active · inactive · draft · all" },{ name:"limit",type:"integer",required:false,description:"Max 100" },{ name:"offset",type:"integer",required:false,description:"Pagination" }],
      example: `curl "https://jeterdev.tools/api/v1/shops/listings?shop_id=61004439&state=active" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET", path: "/shops/sections",            description: "Get all shop sections.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/shops/sections?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET", path: "/shops/reviews",             description: "Get reviews for a shop.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"limit",type:"integer",required:false,description:"Max 100" },{ name:"offset",type:"integer",required:false,description:"Pagination" }],
      example: `curl "https://jeterdev.tools/api/v1/shops/reviews?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET", path: "/shops/transactions", plan: "Pro+", description: "Get transaction history.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"limit",type:"integer",required:false,description:"Max 100" },{ name:"offset",type:"integer",required:false,description:"Pagination" }],
      example: `curl "https://jeterdev.tools/api/v1/shops/transactions?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET", path: "/shops/orders", plan: "Pro+",       description: "Get orders (receipts) for a shop.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"limit",type:"integer",required:false,description:"Max 100" },{ name:"offset",type:"integer",required:false,description:"Pagination" },{ name:"was_paid",type:"boolean",required:false,description:"Filter by payment" },{ name:"was_shipped",type:"boolean",required:false,description:"Filter by shipping" }],
      example: `curl "https://jeterdev.tools/api/v1/shops/orders?shop_id=61004439&was_paid=true" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "PUT", path: "/shops/update", plan: "Pro+",       description: "Update shop metadata.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"title",type:"string",required:false,description:"Shop title" },{ name:"announcement",type:"string",required:false,description:"Shop announcement" },{ name:"sale_message",type:"string",required:false,description:"Message on purchase" }],
      example: `curl -X PUT "https://jeterdev.tools/api/v1/shops/update?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY" -d '{"title":"My Updated Shop"}'` },
    { method: "GET", path: "/shops/production-partners", description: "Get production partners for a shop.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/shops/production-partners?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
  ],

  "store-mgmt": [
    { method: "GET",    path: "/store/receipt",         description: "Get a specific order receipt by ID.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"receipt_id",type:"string",required:true,description:"Receipt/order ID" }],
      example: `curl "https://jeterdev.tools/api/v1/store/receipt?shop_id=61004439&receipt_id=3456789012" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "PUT",    path: "/store/receipt/update", plan: "Pro+", description: "Update a receipt — mark shipped, add tracking.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"receipt_id",type:"string",required:true,description:"Receipt ID" },{ name:"was_shipped",type:"boolean",required:false,description:"Mark as shipped" },{ name:"was_paid",type:"boolean",required:false,description:"Mark as paid" },{ name:"note_from_seller",type:"string",required:false,description:"Note to buyer" }],
      example: `curl -X PUT "https://jeterdev.tools/api/v1/store/receipt/update?shop_id=61004439&receipt_id=3456789012" -H "x-api-key: jt_YOUR_KEY" -d '{"was_shipped":true}'` },
    { method: "POST",   path: "/store/section/create", plan: "Pro+", description: "Create a new shop section.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"title",type:"string",required:true,description:"Section title (max 24 chars)" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/store/section/create" -H "x-api-key: jt_YOUR_KEY" -d '{"shop_id":"61004439","title":"Mugs & Cups"}'` },
    { method: "PUT",    path: "/store/section/update", plan: "Pro+", description: "Rename an existing shop section.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"shop_section_id",type:"string",required:true,description:"Section ID" },{ name:"title",type:"string",required:true,description:"New section title" }],
      example: `curl -X PUT "https://jeterdev.tools/api/v1/store/section/update?shop_id=61004439&shop_section_id=55308357" -H "x-api-key: jt_YOUR_KEY" -d '{"title":"Plates & Bowls"}'` },
    { method: "DELETE", path: "/store/section/delete", plan: "Pro+", description: "Delete a shop section. Listings become unsectioned.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"shop_section_id",type:"string",required:true,description:"Section ID" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/store/section/delete?shop_id=61004439&shop_section_id=55308357" -H "x-api-key: jt_YOUR_KEY"` },
  ],

  images: [
    { method: "GET",    path: "/images/listing",        description: "Get all images for a listing with URLs in multiple sizes.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" }],
      example: `curl "https://jeterdev.tools/api/v1/images/listing?listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY"`,
      response: `{"count":5,"results":[{"listing_image_id":5523110099001,"rank":1,"url_75x75":"https://i.etsystatic.com/.../75x75.jpg","url_570xN":"https://i.etsystatic.com/.../570xN.jpg","url_fullxfull":"https://i.etsystatic.com/.../fullxfull.jpg"}]}` },
    { method: "GET",    path: "/images/get",            description: "Get a single image by its ID.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"listing_image_id",type:"string",required:true,description:"Image ID" }],
      example: `curl "https://jeterdev.tools/api/v1/images/get?listing_id=1234567890&listing_image_id=5523110099001" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "POST",   path: "/images/upload",   plan: "Pro+", description: "Upload an image to a listing. Max 10 images.", note: "Requires Etsy shop connection.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"image",type:"file",required:true,description:"Image file (multipart)" },{ name:"rank",type:"integer",required:false,description:"Position 1-10 (1 = primary)" },{ name:"overwrite",type:"boolean",required:false,description:"Replace image at rank" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/images/upload?listing_id=1234567890&shop_id=61004439" -H "x-api-key: jt_YOUR_KEY" -F "image=@photo.jpg" -F "rank=1"` },
    { method: "DELETE", path: "/images/delete",   plan: "Pro+", description: "Delete an image from a listing.", note: "Requires Etsy shop connection.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"listing_image_id",type:"string",required:true,description:"Image ID" },{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/images/delete?listing_id=1234567890&listing_image_id=5523110099001&shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/media/files",           description: "List all digital files attached to a listing.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" }],
      example: `curl "https://jeterdev.tools/api/v1/media/files?shop_id=61004439&listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "POST",   path: "/media/file/upload", plan: "Pro+", description: "Upload a digital file to a listing.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"file",type:"file",required:true,description:"Digital file (multipart)" },{ name:"name",type:"string",required:false,description:"Display name" },{ name:"rank",type:"integer",required:false,description:"File order 1-10" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/media/file/upload?shop_id=61004439&listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY" -F "file=@pattern.pdf" -F "name=SewingPattern.pdf"` },
    { method: "DELETE", path: "/media/file/delete", plan: "Pro+", description: "Delete a digital file from a listing.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"listing_file_id",type:"string",required:true,description:"File ID" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/media/file/delete?shop_id=61004439&listing_id=1234567890&listing_file_id=987654321" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/media/video",           description: "Get videos attached to a listing.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" }],
      example: `curl "https://jeterdev.tools/api/v1/media/video?listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "POST",   path: "/media/video/upload", plan: "Pro+", description: "Upload a video to a listing. Max 1 video, max 100MB.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"video",type:"file",required:true,description:"Video file (multipart)" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/media/video/upload?shop_id=61004439&listing_id=1234567890" -H "x-api-key: jt_YOUR_KEY" -F "video=@demo.mp4"` },
  ],

  properties: [
    { method: "GET",    path: "/listings/properties",      description: "Get all variation properties for a listing.",
      params: [{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/listings/properties?listing_id=1234567890&shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/categories/properties",    description: "Get all available attributes for a category taxonomy. Cache this — rarely changes.",
      params: [{ name:"taxonomy_id",type:"string",required:true,description:"Etsy taxonomy node ID" }],
      example: `curl "https://jeterdev.tools/api/v1/categories/properties?taxonomy_id=482" -H "x-api-key: jt_YOUR_KEY"`,
      response: `{"properties":[{"property_id":200,"name":"Primary color","required":false,"possible_values":[{"value_id":1,"name":"Black"},{"value_id":2,"name":"White"}]}]}` },
    { method: "PUT",    path: "/listings/property/update", plan: "Pro+", description: "Set a property value on a listing (e.g. color, size).", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"property_id",type:"string",required:true,description:"Property ID from categories/properties" },{ name:"value_ids",type:"array",required:true,description:"Array of value IDs" },{ name:"values",type:"array",required:true,description:"Array of value names" }],
      example: `curl -X PUT "https://jeterdev.tools/api/v1/listings/property/update?shop_id=61004439&listing_id=1234567890&property_id=200" -H "x-api-key: jt_YOUR_KEY" -d '{"value_ids":[1,2],"values":["Black","White"]}'` },
    { method: "DELETE", path: "/listings/property/delete", plan: "Pro+", description: "Remove a property value from a listing.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"listing_id",type:"string",required:true,description:"Etsy listing ID" },{ name:"property_id",type:"string",required:true,description:"Property ID to remove" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/listings/property/delete?shop_id=61004439&listing_id=1234567890&property_id=200" -H "x-api-key: jt_YOUR_KEY"` },
  ],

  shipping: [
    { method: "GET",    path: "/shipping/profiles",     description: "List all shipping profiles for a shop.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/shipping/profiles?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/shipping/profile",      description: "Get a specific shipping profile by ID.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"profile_id",type:"string",required:true,description:"Shipping profile ID" }],
      example: `curl "https://jeterdev.tools/api/v1/shipping/profile?shop_id=61004439&profile_id=289094606827" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "POST",   path: "/shipping/create",  plan: "Pro+", description: "Create a new shipping profile.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"title",type:"string",required:true,description:"Profile name" },{ name:"origin_country_iso",type:"string",required:true,description:"ISO country code (e.g. US)" },{ name:"primary_cost",type:"object",required:true,description:"{amount,divisor,currency_code}" },{ name:"secondary_cost",type:"object",required:true,description:"Cost per additional item" },{ name:"min_processing_time",type:"integer",required:false,description:"Min processing days" },{ name:"max_processing_time",type:"integer",required:false,description:"Max processing days" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/shipping/create" -H "x-api-key: jt_YOUR_KEY" -d '{"shop_id":"61004439","title":"US Standard","origin_country_iso":"US","primary_cost":{"amount":500,"divisor":100,"currency_code":"USD"},"secondary_cost":{"amount":200,"divisor":100,"currency_code":"USD"}}'` },
    { method: "PUT",    path: "/shipping/update",  plan: "Pro+", description: "Update a shipping profile.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"profile_id",type:"string",required:true,description:"Profile ID" },{ name:"title",type:"string",required:false,description:"New profile name" }],
      example: `curl -X PUT "https://jeterdev.tools/api/v1/shipping/update?shop_id=61004439&profile_id=289094606827" -H "x-api-key: jt_YOUR_KEY" -d '{"title":"US Express"}'` },
    { method: "DELETE", path: "/shipping/delete",  plan: "Pro+", description: "Delete a shipping profile.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"profile_id",type:"string",required:true,description:"Profile ID" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/shipping/delete?shop_id=61004439&profile_id=289094606827" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/shipping/destinations", description: "Get shipping destinations for a profile.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"profile_id",type:"string",required:true,description:"Profile ID" }],
      example: `curl "https://jeterdev.tools/api/v1/shipping/destinations?shop_id=61004439&profile_id=289094606827" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/shipping/upgrades",     description: "Get expedited shipping options for a profile.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"profile_id",type:"string",required:true,description:"Profile ID" }],
      example: `curl "https://jeterdev.tools/api/v1/shipping/upgrades?shop_id=61004439&profile_id=289094606827" -H "x-api-key: jt_YOUR_KEY"` },
  ],

  categories: [
    { method: "GET", path: "/categories/list",       description: "Full Etsy seller taxonomy tree. Cache this response — categories rarely change.",
      params: [], example: `curl "https://jeterdev.tools/api/v1/categories/list" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET", path: "/categories/get",        description: "Get a single category node by taxonomy ID.",
      params: [{ name:"taxonomy_id",type:"string",required:true,description:"Etsy taxonomy node ID" }],
      example: `curl "https://jeterdev.tools/api/v1/categories/get?taxonomy_id=482" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET", path: "/categories/properties", description: "Get all attributes for a category — use to discover valid listing property values.",
      params: [{ name:"taxonomy_id",type:"string",required:true,description:"Etsy taxonomy node ID" }],
      example: `curl "https://jeterdev.tools/api/v1/categories/properties?taxonomy_id=482" -H "x-api-key: jt_YOUR_KEY"`,
      response: `{"properties":[{"property_id":200,"name":"Primary color","required":false,"possible_values":[{"value_id":1,"name":"Black"},{"value_id":2,"name":"White"}]}]}` },
    { method: "GET", path: "/categories/children",   description: "Get child nodes of a category.",
      params: [{ name:"taxonomy_id",type:"string",required:true,description:"Parent taxonomy node ID" }],
      example: `curl "https://jeterdev.tools/api/v1/categories/children?taxonomy_id=1" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET", path: "/categories/{id}/listing-schema", description: "Full schema for a taxonomy — required fields, optional fields, category attributes with possible values, and variation properties. Cache this response.", plan: "Pro+",
      params: [{ name:"id",type:"string",required:true,description:"Etsy taxonomy node ID" }],
      example: `curl "https://jeterdev.tools/api/v1/categories/482/listing-schema" -H "x-api-key: jt_YOUR_KEY"`,
      response: `{"taxonomy_id":482,"required_fields":["title","description","price","quantity","taxonomy_id","listing_type","who_made","when_made"],"optional_fields":["tags","materials","sku","styles","processing_min","processing_max"],"category_attributes":[{"property_id":200,"name":"Primary color","required":false,"possible_values":[{"value_id":1,"name":"Black"},{"value_id":2,"name":"White"}],"scales":[]}],"variation_properties":[{"property_id":200,"name":"Primary color","scales":[]},{"property_id":62809790533,"name":"Size","scales":[{"scale_id":17,"display_name":"US","description":"US sizing"}]}]}` },
  ],

  users: [
    { method: "GET", path: "/users/me",        description: "Get the authenticated Etsy user.", note: "Requires Etsy shop connection.",
      params: [], example: `curl "https://jeterdev.tools/api/v1/users/me" -H "x-api-key: jt_YOUR_KEY"`,
      response: `{"user_id":123456789,"login_name":"CeramicsLover","primary_email":"user@example.com","feedback_info":{"count":45,"score":100}}` },
    { method: "GET", path: "/users/get",       description: "Get public info about any Etsy user by ID.",
      params: [{ name:"user_id",type:"string",required:true,description:"Etsy user ID" }],
      example: `curl "https://jeterdev.tools/api/v1/users/get?user_id=123456789" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET", path: "/users/addresses", description: "Get saved addresses for a user.", note: "Requires Etsy shop connection.",
      params: [{ name:"user_id",type:"string",required:true,description:"Etsy user ID" }],
      example: `curl "https://jeterdev.tools/api/v1/users/addresses?user_id=123456789" -H "x-api-key: jt_YOUR_KEY"` },
  ],

  policies: [
    { method: "GET",    path: "/policies/get",            description: "Get all shop policies.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/policies/get?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "POST",   path: "/policies/create",   plan: "Pro+", description: "Create shop policies.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"allows_exchanges",type:"boolean",required:false,description:"Allow exchanges" },{ name:"allows_returns",type:"boolean",required:false,description:"Allow returns" },{ name:"accepts_custom_requests",type:"boolean",required:false,description:"Accept custom requests" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/policies/create" -H "x-api-key: jt_YOUR_KEY" -d '{"shop_id":"61004439","allows_returns":true,"allows_exchanges":false}'` },
    { method: "PUT",    path: "/policies/update",   plan: "Pro+", description: "Update shop policies.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"allows_exchanges",type:"boolean",required:false,description:"Allow exchanges" },{ name:"allows_returns",type:"boolean",required:false,description:"Allow returns" }],
      example: `curl -X PUT "https://jeterdev.tools/api/v1/policies/update" -H "x-api-key: jt_YOUR_KEY" -d '{"shop_id":"61004439","allows_returns":false}'` },
    { method: "DELETE", path: "/policies/delete",   plan: "Pro+", description: "Delete shop policies.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/policies/delete?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/policies/privacy",        description: "Get the shop privacy policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/policies/privacy?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "POST",   path: "/policies/privacy/create", plan: "Pro+", description: "Create a privacy policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"privacy_policy",type:"string",required:true,description:"Policy text" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/policies/privacy/create" -H "x-api-key: jt_YOUR_KEY" -d '{"shop_id":"61004439","privacy_policy":"We respect your privacy..."}'` },
    { method: "PUT",    path: "/policies/privacy/update", plan: "Pro+", description: "Update the privacy policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"privacy_policy",type:"string",required:true,description:"Updated policy text" }],
      example: `curl -X PUT "https://jeterdev.tools/api/v1/policies/privacy/update" -H "x-api-key: jt_YOUR_KEY" -d '{"shop_id":"61004439","privacy_policy":"Updated privacy..."}'` },
    { method: "DELETE", path: "/policies/privacy/delete", plan: "Pro+", description: "Delete the privacy policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/policies/privacy/delete?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/policies/refund",         description: "Get the refund/return policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/policies/refund?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "POST",   path: "/policies/refund/create",  plan: "Pro+", description: "Create a refund policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"accepts_returns",type:"boolean",required:true,description:"Accept returns" },{ name:"accepts_exchanges",type:"boolean",required:true,description:"Accept exchanges" },{ name:"return_deadline",type:"integer",required:false,description:"Days to return (7-60)" }],
      example: `curl -X POST "https://jeterdev.tools/api/v1/policies/refund/create" -H "x-api-key: jt_YOUR_KEY" -d '{"shop_id":"61004439","accepts_returns":true,"accepts_exchanges":true,"return_deadline":30}'` },
    { method: "PUT",    path: "/policies/refund/update",  plan: "Pro+", description: "Update the refund policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" },{ name:"accepts_returns",type:"boolean",required:false,description:"Accept returns" },{ name:"return_deadline",type:"integer",required:false,description:"Days to return" }],
      example: `curl -X PUT "https://jeterdev.tools/api/v1/policies/refund/update" -H "x-api-key: jt_YOUR_KEY" -d '{"shop_id":"61004439","return_deadline":14}'` },
    { method: "DELETE", path: "/policies/refund/delete",  plan: "Pro+", description: "Delete the refund policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl -X DELETE "https://jeterdev.tools/api/v1/policies/refund/delete?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/policies/shipping",       description: "Get the shipping policy text.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/policies/shipping?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
    { method: "GET",    path: "/policies/payment",        description: "Get the payment policy.", note: "Requires Etsy shop connection.",
      params: [{ name:"shop_id",type:"string",required:true,description:"Etsy shop ID" }],
      example: `curl "https://jeterdev.tools/api/v1/policies/payment?shop_id=61004439" -H "x-api-key: jt_YOUR_KEY"` },
  ],
};

const SECTION_DESC: Record<string, string> = {
  "listing-builder": "Create Etsy listings with a single atomic API call. Handles multi-shop, variations, images, category attributes, and personalization.",
  "lb-create":       "POST /listings/create — the core endpoint. Accepts a single unified payload and handles all Etsy API orchestration.",
  "lb-jobs":         "Poll a listing creation job by job_id. Jobs are retained for 24 hours.",
  "stores-list":     "List all Etsy shops connected to your API key.",
  "stores-sync":     "One-shot full shop data refresh — returns shipping profiles, return policies, processing profiles, sections, and partners in one call.",
  "stores-live":     "Four endpoints that always hit Etsy fresh — no cache. Use before listing creation to get current profile IDs.",
  search:      "Full-text search across Etsy's active marketplace — 35M+ listings.",
  listings:    "Read, create, update, and delete Etsy listings. Write endpoints require Pro plan and store connection.",
  shops:       "Shop info, listings, sections, reviews, orders, and transactions.",
  "store-mgmt":"Manage individual orders, shop sections, and store-level operations.",
  images:      "Listing images, digital files, and videos. Upload/delete require Pro plan and store connection.",
  properties:  "Listing-level and category-level variation properties and attributes.",
  shipping:    "Manage shipping profiles, destinations, and expedited options.",
  categories:  "Etsy seller taxonomy. Cache /categories/list — it rarely changes.",
  users:       "Etsy user profiles and saved addresses.",
  policies:    "Full CRUD for all shop policies — general, privacy, refund, shipping, and payment.",
};

// All section IDs in order — defined outside component so it never changes size
const ALL_IDS = NAV.flatMap(g => g.items.map(i => i.id));

// ─── UI Components ────────────────────────────
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
        <button onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="text-[10px] text-white/30 hover:text-white/60 transition-colors">
          {copied ? "copied!" : "copy"}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono text-white/70 leading-relaxed overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

function InfoBox({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "warn" }) {
  const s = type === "warn" ? "bg-amber-500/6 border-amber-500/20 text-amber-400/80" : "bg-[#7F77DD]/6 border-[#7F77DD]/20 text-[#7F77DD]/80";
  return (
    <div className={`flex items-start gap-3 border rounded-xl p-4 my-4 text-sm leading-relaxed ${s}`}>
      <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {type === "warn"
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />}
      </svg>
      <span>{children}</span>
    </div>
  );
}

function EndpointBlock({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/6 rounded-xl overflow-hidden mb-2.5">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/2 transition-colors">
        <span className={`shrink-0 text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${METHOD_STYLE[ep.method]}`}>{ep.method}</span>
        <span className="font-mono text-sm text-white/80 flex-1">{ep.path}</span>
        {ep.plan && <span className="text-[10px] px-2 py-0.5 rounded bg-[#7F77DD]/10 border border-[#7F77DD]/20 text-[#7F77DD] font-mono shrink-0">{ep.plan}</span>}
        {ep.note && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono shrink-0 hidden md:block">OAuth</span>}
        <span className="text-xs text-white/30 shrink-0 hidden lg:block">{ep.description}</span>
        <svg className={`w-3.5 h-3.5 text-white/20 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-white/6 bg-white/1">
          {ep.note && <InfoBox type="warn">{ep.note} <a href="#store-connection" className="underline opacity-80">See Store Connection →</a></InfoBox>}
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

// ─── Content sections ─────────────────────────
function Introduction() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Getting Started</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-3">Introduction</h1>
        <p className="text-sm text-white/50 leading-relaxed">JeterDev Tools is a managed bridge over the Etsy API v3. Send requests with your API key and we handle Etsy authentication, rate limiting, and errors — you just consume the JSON.</p>
        <p className="text-sm text-white/40 leading-relaxed mt-2">Public endpoints work with your API key alone. Private endpoints (create listings, manage orders, upload images) require connecting your Etsy shop via OAuth from the dashboard.</p>
      </div>
      <div className="bg-white/3 border border-white/6 rounded-xl p-4">
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Base URL</p>
        <code className="font-mono text-sm text-[#7F77DD]">https://jeterdev.tools/api/v1</code>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[["Free","$0","100 req/day","1 req/s","6 endpoints"],["Starter","$25/mo","2,000 req/day","3 req/s","Read endpoints"],["Pro","$50/mo","50,000 req/day","10 req/s","All endpoints"]].map(([n,p,d,s,e]) => (
          <div key={n} className="bg-white/3 border border-white/6 rounded-xl p-4">
            <div className="text-[10px] font-mono text-white/30 uppercase mb-1">{n}</div>
            <div className="text-lg font-semibold text-white">{p}</div>
            <div className="text-xs font-mono text-[#7F77DD] mt-1">{d}</div>
            <div className="text-xs text-white/30 mt-0.5">{s} · {e}</div>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Quick start</p>
        <CodeBlock code={`curl "https://jeterdev.tools/api/v1/listings/search?query=handmade+art&limit=10" \\\n  -H "x-api-key: jt_YOUR_KEY_HERE"`} />
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
        <p className="text-sm text-white/50 leading-relaxed">All requests require an API key via the <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">x-api-key</code> header. Generate your key from the <a href="/dashboard" className="text-[#7F77DD] hover:underline">Dashboard</a>.</p>
      </div>
      <InfoBox type="warn">Never expose your API key in client-side code or public repositories. If compromised, rotate it immediately from your dashboard.</InfoBox>
      <CodeBlock code={`curl "https://jeterdev.tools/api/v1/listings/search?query=art" \\\n  -H "x-api-key: jt_a3f4b5c6d7e8f9..."`} />
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Key format</p>
        <CodeBlock code="jt_a3f4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6" lang="text" />
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Check your key</p>
        <CodeBlock code={`curl "https://jeterdev.tools/api/usage" \\\n  -H "x-api-key: jt_YOUR_KEY"`} />
        <CodeBlock code={`{"plan":"pro","dailyLimit":50000,"used":142,"remaining":49858,"resetsAt":"2026-05-09T00:00:00.000Z"}`} lang="json" />
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
        <p className="text-sm text-white/50 leading-relaxed">Two independent limits: <strong className="text-white/70">per-second</strong> and <strong className="text-white/70">daily</strong>. Daily limits reset at midnight UTC.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[["Free","1 req/s","100/day"],["Starter","3 req/s","2,000/day"],["Pro","10 req/s","50,000/day"]].map(([p,s,d]) => (
          <div key={p} className="bg-white/3 border border-white/6 rounded-xl p-4">
            <div className="text-[10px] font-mono text-white/30 uppercase mb-2">{p}</div>
            <div className="text-sm font-mono text-[#7F77DD]">{s}</div>
            <div className="text-xs text-white/40 mt-0.5">{d}</div>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Response headers</p>
        <CodeBlock code={`X-RateLimit-Limit-Day:        50000\nX-RateLimit-Remaining-Day:   49858\nX-RateLimit-Reset-Day:       1746835200\nX-RateLimit-Limit-Second:    10\nX-RateLimit-Remaining-Second:9\nX-Plan:                      pro`} lang="http" />
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">When rate limited — 429</p>
        <CodeBlock code={`{\n  "error": {\n    "code": "RATE_LIMIT_DAILY",\n    "status": 429,\n    "message": "Daily request limit reached (50000/day).",\n    "hint": "Limit resets at midnight UTC.",\n    "docs": "https://jeterdev.tools/docs#rate-limits"\n  }\n}`} lang="json" />
      </div>
    </div>
  );
}

function StoreConnection() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Getting Started</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-3">Store Connection</h1>
        <p className="text-sm text-white/50 leading-relaxed">Endpoints that access your own shop data require a connected Etsy store. Each user authenticates independently — your data is completely isolated from other users. Store connection uses OAuth 2.0 with PKCE and must be done through the dashboard.</p>
      </div>
      <InfoBox>Once connected, JeterDev Tools manages credential refresh automatically. There is no API endpoint for connecting a store.</InfoBox>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
          <p className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest mb-3">✓ API key only</p>
          {["search/listings","listings/search","listings/get","listings/active","listings/featured","listings/images","listings/inventory","listings/shipping","shops/get","shops/listings","shops/sections","shops/reviews","categories/*","images/listing","images/get","media/video","media/files","users/get"].map(ep => (
            <div key={ep} className="text-xs font-mono text-white/35 py-0.5">{ep}</div>
          ))}
        </div>
        <div className="bg-[#7F77DD]/5 border border-[#7F77DD]/20 rounded-xl p-4">
          <p className="text-[10px] font-mono text-[#7F77DD] uppercase tracking-widest mb-3">⚡ Requires store connection</p>
          {["listings/create","listings/update","listings/delete","listings/property/*","shops/orders","shops/transactions","shops/update","store/receipt/update","store/section/*","images/upload","images/delete","media/file/*","media/video/upload","users/me","users/addresses","policies/*","shipping/create","shipping/update","shipping/delete"].map(ep => (
            <div key={ep} className="text-xs font-mono text-white/35 py-0.5">{ep}</div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">How to connect</p>
        <div className="space-y-2">
          {[["1","Log in to JeterDev Tools","Go to jeterdev.tools/dashboard"],["2",'Click "Connect Etsy Shop"',"You will be redirected to Etsy to authorize your account"],["3","Review and authorize permissions","Etsy shows the list of permissions being requested"],["4","You are connected","Your shop name appears in the dashboard. Private endpoints are now available."]].map(([n,t,d]) => (
            <div key={n} className="flex items-start gap-4 p-3 border border-white/6 rounded-xl">
              <span className="text-sm font-mono font-bold text-[#7F77DD] shrink-0 mt-0.5">{n}</span>
              <div><p className="text-sm font-medium text-white/80">{t}</p><p className="text-xs text-white/35 mt-0.5">{d}</p></div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Error if not connected</p>
        <CodeBlock code={`{\n  "error": {\n    "code": "STORE_NOT_CONNECTED",\n    "status": 403,\n    "message": "You don't have an Etsy shop connected.",\n    "hint": "Connect your Etsy shop at jeterdev.tools/dashboard.",\n    "docs": "https://jeterdev.tools/docs#store-connection"\n  }\n}`} lang="json" />
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">OAuth scopes requested</p>
        <div className="flex flex-wrap gap-2">
          {["listings_r","listings_w","listings_d","shops_r","shops_w","transactions_r","profile_r","email_r","favorites_r","feedback_r"].map(s => (
            <span key={s} className="px-2.5 py-1 bg-[#7F77DD]/10 border border-[#7F77DD]/20 rounded-lg text-xs font-mono text-[#7F77DD]">{s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Errors() {
  const codes = [
    { code:"INVALID_API_KEY",         status:401, desc:"API key missing, invalid, or revoked.",              hint:"Generate a new key at jeterdev.tools/dashboard." },
    { code:"MISSING_API_KEY",         status:401, desc:"No x-api-key header provided.",                      hint:"Pass your key via the x-api-key header." },
    { code:"API_KEY_DISABLED",        status:403, desc:"This API key has been disabled.",                     hint:"Generate a new key at jeterdev.tools/dashboard." },
    { code:"ENDPOINT_NOT_IN_PLAN",    status:403, desc:"Endpoint not available on your current plan.",        hint:"Upgrade at jeterdev.tools/pricing." },
    { code:"STORE_NOT_CONNECTED",     status:403, desc:"Endpoint requires a connected Etsy shop.",            hint:"Connect at jeterdev.tools/dashboard." },
    { code:"STORE_NOT_OWNED",         status:403, desc:"shop_id is not connected to your account.",           hint:"Connect shops at jeterdev.tools/dashboard." },
    { code:"STORE_TOKEN_EXPIRED",     status:503, desc:"Store authorization has expired.",                    hint:"Reconnect your shop at jeterdev.tools/dashboard." },
    { code:"ENDPOINT_NOT_FOUND",      status:404, desc:"This endpoint does not exist.",                      hint:"Check the path against the docs." },
    { code:"RATE_LIMIT_DAILY",        status:429, desc:"Daily request limit reached.",                       hint:"Limit resets at midnight UTC. Retry-After header included." },
    { code:"RATE_LIMIT_SECOND",       status:429, desc:"Per-second rate limit exceeded.",                    hint:"Wait the Retry-After seconds before retrying." },
    { code:"VALIDATION_FAILED",       status:400, desc:"Request validation failed. See fields object.",       hint:"Fix the fields indicated in the fields object." },
    { code:"TAXONOMY_INVALID",        status:400, desc:"taxonomy_id is not a valid Etsy category.",           hint:"Use GET /categories/list or /categories/{id}/listing-schema." },
    { code:"JOB_NOT_FOUND",           status:404, desc:"Listing job not found or expired.",                   hint:"Jobs expire after 24 hours. Re-submit the create request." },
    { code:"ACTIVATION_COST_WARNING", status:200, desc:"state=active costs $0.20 per listing per shop.",     hint:"Check activation_cost_usd in the response." },
    { code:"UPSTREAM_ERROR",          status:502, desc:"The Etsy API returned an error.",                     hint:"Check the details field for the upstream response." },
    { code:"INTERNAL_ERROR",          status:500, desc:"Something went wrong on our end.",                   hint:"Try again or contact support." },
  ];
  const sc: Record<number,string> = { 200:"text-emerald-400 bg-emerald-500/10 border-emerald-500/20", 400:"text-amber-400 bg-amber-500/10 border-amber-500/20", 401:"text-red-400 bg-red-500/10 border-red-500/20", 403:"text-amber-400 bg-amber-500/10 border-amber-500/20", 404:"text-red-400 bg-red-500/10 border-red-500/20", 429:"text-red-400 bg-red-500/10 border-red-500/20", 500:"text-red-400 bg-red-500/10 border-red-500/20", 502:"text-red-400 bg-red-500/10 border-red-500/20", 503:"text-amber-400 bg-amber-500/10 border-amber-500/20" };
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Getting Started</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-3">Errors</h1>
        <p className="text-sm text-white/50 leading-relaxed">All errors follow a consistent shape with a machine-readable <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">code</code>, HTTP <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">status</code>, <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">message</code>, and actionable <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">hint</code>.</p>
      </div>
      <CodeBlock code={`{\n  "error": {\n    "code": "ENDPOINT_NOT_IN_PLAN",\n    "status": 403,\n    "message": "Endpoint 'listings/create' is not available on the Starter plan.",\n    "hint": "Upgrade your plan at jeterdev.tools/pricing.",\n    "docs": "https://jeterdev.tools/docs#rate-limits"\n  }\n}`} lang="json" />
      <div className="border border-white/6 rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 text-[10px] font-mono text-white/30 uppercase tracking-wider px-4 py-2.5 border-b border-white/6 bg-white/2">
          <div className="col-span-1">HTTP</div><div className="col-span-4">Code</div><div className="col-span-4">Description</div><div className="col-span-3">Hint</div>
        </div>
        {codes.map(c => (
          <div key={c.code} className="grid grid-cols-12 text-xs px-4 py-3 border-b border-white/4 last:border-0 items-start gap-2">
            <div className="col-span-1"><span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${sc[c.status]}`}>{c.status}</span></div>
            <div className="col-span-4 font-mono text-white/60 text-[11px] break-all">{c.code}</div>
            <div className="col-span-4 text-white/40">{c.desc}</div>
            <div className="col-span-3 text-white/30">{c.hint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EndpointSection({ id }: { id: string }) {
  const allItems = [...NAV[0].items, ...NAV[1].items];
  const item = allItems.find(i => i.id === id);
  const eps  = ENDPOINTS[id] ?? [];
  return (
    <div>
      <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Etsy Marketplace</p>
      <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">{item?.title ?? id}</h1>
      <p className="text-sm text-white/40 leading-relaxed mb-6">{SECTION_DESC[id]}</p>
      {eps.length === 0 && <p className="text-sm text-white/30">No endpoints documented yet for this section.</p>}
      {eps.map((ep, i) => <EndpointBlock key={i} ep={ep} />)}
    </div>
  );
}

// ─── Listing Builder sections ─────────────────

function ListingBuilderOverview() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Listing Builder</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-3">Overview</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          Create Etsy listings with a single atomic API call. Pass your full payload — title, images, variations, category attributes, personalization — and the bridge handles all Etsy API orchestration internally.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {([
          ["draft",   "Saves payload internally. Zero Etsy calls. Returns instantly.", "border-white/8"],
          ["publish", "Creates listing on Etsy as a draft. Uploads images and sets inventory. Returns listing_id.", "border-blue-500/20"],
          ["active",  "Same as publish + activates on Etsy. Costs $0.20 USD per listing per shop.", "border-[#7F77DD]/20"],
        ] as [string,string,string][]).map(([state, desc, border]) => (
          <div key={state} className={`border rounded-xl p-4 bg-white/3 ${border}`}>
            <div className="text-xs font-mono text-white/50 uppercase mb-2">state=&quot;{state}&quot;</div>
            <p className="text-xs text-white/40 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Recommended flow</p>
        <div className="space-y-2">
          {([
            ["1", "GET /stores",                        "Confirm connected shops and get their shop_ids"],
            ["2", "POST /stores/{shopId}/sync",          "Get shipping profiles, return policies, processing profiles, and sections in one call"],
            ["3", "GET /categories/{id}/listing-schema", "Discover required attributes and variation properties for your category"],
            ["4", "POST /listings/create",               "Submit with state=\"draft\" first, then re-submit with state=\"publish\" or \"active\""],
            ["5", "GET /listings/create/{job_id}",       "Poll for results — available for 24 hours"],
          ] as [string,string,string][]).map(([n, ep, desc]) => (
            <div key={n} className="flex items-start gap-4 p-3 border border-white/6 rounded-xl">
              <span className="text-sm font-mono font-bold text-[#7F77DD] shrink-0 mt-0.5">{n}</span>
              <div>
                <p className="text-sm font-mono text-white/70">{ep}</p>
                <p className="text-xs text-white/35 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <InfoBox type="warn">
        <strong>state=&quot;active&quot;</strong> costs $0.20 USD per listing per shop — this is Etsy&apos;s listing fee. Always use state=&quot;draft&quot; first to verify before activating.
      </InfoBox>
    </div>
  );
}


function ListingUploads() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Listing Builder</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Uploads</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          Upload images, videos, or digital files <strong className="text-white/70">before a listing exists</strong>. Uses a presigned URL flow — the file goes directly to storage, bypassing the 4.5MB function limit. Supports up to <strong className="text-white/70">100MB per file</strong>. Files cached 24 hours.
        </p>
      </div>

      <InfoBox>The presigned flow avoids all server-side size limits. Your client uploads directly to storage — JeterDev Tools never touches the binary.</InfoBox>

      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">3-step flow</p>
        <div className="space-y-2">
          {[
            ["1", "POST /uploads/presign",  "Get upload_id + a signed Firebase Storage URL"],
            ["2", "PUT file → upload_url",  "PUT directly to Firebase Storage — no size limit, file never touches Vercel"],
            ["3", "POST /uploads/confirm",  "Confirm upload and get your jt-upload:// URL"],
          ].map(([n, t, d]) => (
            <div key={n} className="flex items-start gap-4 p-3 border border-white/6 rounded-xl">
              <span className="text-sm font-mono font-bold text-[#7F77DD] shrink-0 mt-0.5">{n}</span>
              <div><p className="text-sm font-mono text-white/70">{t}</p><p className="text-xs text-white/35 mt-0.5">{d}</p></div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Step 1 — POST /api/v1/uploads/presign</p>
        <CodeBlock code={`curl -X POST "https://jeterdev.tools/api/v1/uploads/presign" \
  -H "x-api-key: jt_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename":"product-photo.jpg","content_type":"image/jpeg","size":15728640,"type":"image"}'`} />
        <CodeBlock code={`{
  "upload_id":    "jt_a1b2c3d4...",
  "upload_url":   "https://storage.googleapis.com/...?Signature=...",
  "method":       "PUT",
  "content_type": "image/jpeg",
  "expires_in":   "30min",
  "note":         "PUT your file binary to upload_url with Content-Type header"
}`} lang="json" />
      </div>

      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Step 2 — PUT file directly to upload_url (Firebase Storage)</p>
        <p className="text-sm text-white/40 mb-2">The file goes directly to Firebase Storage — never through Vercel. No size limit.</p>
        <CodeBlock code={`# curl — empty response body on success (HTTP 200)
curl -X PUT "https://storage.googleapis.com/...?Signature=..." \
  -H "Content-Type: image/jpeg" \
  --data-binary "@/path/to/photo.jpg"

# fetch (browser / Node.js)
await fetch(upload_url, {
  method:  "PUT",
  headers: { "Content-Type": "image/jpeg" },
  body:    fileBlob,   // File, Buffer, or ReadableStream — up to 5GB
});
// Empty response body = success`} />
      </div>

      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Step 3 — POST /api/v1/uploads/confirm</p>
        <CodeBlock code={`curl -X POST "https://jeterdev.tools/api/v1/uploads/confirm" \
  -H "x-api-key: jt_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"upload_id":"jt_a1b2c3d4..."}'`} />
        <CodeBlock code={`{
  "url":          "jt-upload://jt_a1b2c3d4...",
  "upload_id":    "jt_a1b2c3d4...",
  "filename":     "product-photo.jpg",
  "size":         15728640,
  "content_type": "image/jpeg",
  "type":         "image",
  "expires_in":   "24h"
}`} lang="json" />
      </div>

      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Full example — Node.js</p>
        <CodeBlock code={`const fs = require("fs");
const JT_KEY = "jt_YOUR_KEY";
const BASE   = "https://jeterdev.tools/api/v1";

async function uploadImage(filePath, filename) {
  const size = fs.statSync(filePath).size;

  // 1. Presign
  const { upload_id, upload_url } = await fetch(\`\${BASE}/uploads/presign\`, {
    method:  "POST",
    headers: { "x-api-key": JT_KEY, "Content-Type": "application/json" },
    body:    JSON.stringify({ filename, content_type: "image/jpeg", size }),
  }).then(r => r.json());

  // 2. PUT directly to Firebase Storage
  await fetch(upload_url, {
    method:  "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body:    fs.readFileSync(filePath),
  });
  // Empty response = success

  // 3. Confirm
  const { url } = await fetch(\`\${BASE}/uploads/confirm\`, {
    method:  "POST",
    headers: { "x-api-key": JT_KEY, "Content-Type": "application/json" },
    body:    JSON.stringify({ upload_id }),
  }).then(r => r.json());

  return url; // "jt-upload://jt_..."
}

// Use in listings/create
const imageUrl = await uploadImage("./ai-product-15mb.jpg", "product.jpg");

await fetch(\`\${BASE}/listings/create\`, {
  method:  "POST",
  headers: { "x-api-key": JT_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    state:   "draft",
    shops:   [{ shop_id: 61004439, shipping_profile_id: 289094606827, return_policy_id: 1396555302092 }],
    listing: { title: "AI Product", description: "...", taxonomy_id: 482, price: 29.99, quantity: 10, who_made: "i_did", when_made: "2020_2026" },
    images:  [{ url: imageUrl, rank: 1 }],
  }),
});`} />
      </div>

      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Use jt-upload:// in POST /listings/create</p>
        <CodeBlock code={`{
  "state": "publish",
  "shops": [...],
  "listing": { "title": "AI Generated Mug", ... },
  "images": [
    { "url": "jt-upload://jt_a1b2c3d4...", "rank": 1 },
    { "url": "jt-upload://jt_b2c3d4e5...", "rank": 2 }
  ]
}`} lang="json" />
      </div>

      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Supported formats and limits</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            ["image",   "JPG, PNG, GIF, WebP", "Max 100MB · Max 10 per listing"],
            ["video",   "MP4, MOV, MPEG",       "Max 100MB · Max 1 per listing"],
            ["digital", "PDF, ZIP, SVG, PNG",   "Max 100MB · Max 10 per listing"],
          ].map(([type, formats, limit]) => (
            <div key={String(type)} className="bg-white/3 border border-white/6 rounded-xl p-3">
              <div className="text-xs font-mono text-white/50 uppercase mb-1">{String(type)}</div>
              <div className="text-xs text-white/70">{String(formats)}</div>
              <div className="text-[10px] text-white/30 mt-0.5">{String(limit)}</div>
            </div>
          ))}
        </div>
      </div>

      <InfoBox type="warn">Upload URLs expire after 24 hours. If /listings/create fails and you retry after 24h, repeat the presign flow.</InfoBox>
    </div>
  );
}

function ListingCreate() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Listing Builder</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Create Listing</h1>
        <p className="text-sm text-white/40 mb-2 font-mono">POST /api/v1/listings/create</p>
        <p className="text-sm text-white/50 leading-relaxed">Single atomic call to create a listing across one or more shops.</p>
      </div>
      <InfoBox type="warn">Pro plan required.</InfoBox>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Request body</p>
        <CodeBlock code={`{
  "state": "draft",
  "shops": [{
    "shop_id": 61004439,
    "shipping_profile_id": 289094606827,
    "return_policy_id":    1396555302092,
    "processing_profile_id": 1456101932490,
    "shop_section_id":     55308357,
    "price": 34.99
  }],
  "listing": {
    "title": "Vintage Band Tee", "description": "Premium cotton...",
    "listing_type": "physical", "taxonomy_id": 482,
    "price": 29.99, "quantity": 100,
    "who_made": "i_did", "when_made": "2020_2026",
    "tags": ["vintage tee", "band shirt"],
    "processing_min": 1, "processing_max": 3
  },
  "images": [
    { "url": "https://example.com/black-tee.jpg", "rank": 1 },
    { "url": "https://example.com/white-tee.jpg", "rank": 2 }
  ],
  "personalization": {
    "enabled": true, "is_required": false,
    "instructions": "Enter name (max 15 chars)", "max_chars": 15
  },
  "category_attributes": {
    "200":          { "value_ids": [1],    "values": ["Black"] },
    "325502675244": { "value_ids": [2668], "values": ["Short sleeve"] }
  },
  "variations": {
    "properties": [
      { "property_id": 200,         "name": "Color", "values": ["Black","White"] },
      { "property_id": 62809790533, "name": "Size", "scale_id": 17, "values": ["S","M","L"] }
    ],
    "offerings": [
      { "color": "Black", "size": "S", "price": 29.99, "quantity": 20, "sku": "BLK-S" },
      { "color": "Black", "size": "L", "price": 34.99, "quantity": 15, "sku": "BLK-L" },
      { "color": "White", "size": "M", "price": 29.99, "quantity": 25, "sku": "WHT-M" }
    ],
    "variation_images": { "property": "color", "mapping": { "Black": 0, "White": 1 } }
  }
}`} lang="json" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Draft response</p>
          <CodeBlock code={`{
  "listing_pk":    1234567,
  "job_id":        "jt_aBcDeFgH...",
  "status":        "draft",
  "dashboard_url": "/dashboard#drafts/jt_..."
}`} lang="json" />
        </div>
        <div>
          <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Publish/Active response</p>
          <CodeBlock code={`{
  "job_id":      "jt_aBcDeFgH...",
  "listing_pk":  1234567,
  "status":      "completed",
  "shops_count": 1,
  "poll_url":    "/api/v1/listings/create/jt_...",
  "results": [{
    "shop_id":    "61004439",
    "status":     "ok",
    "listing_id": 4501295417,
    "listing_url":"https://www.etsy.com/listing/4501295417",
    "currency_code": "USD", "price": 29.99,
    "images": [{"listing_image_id":5523110099001,"url_fullxfull":"...","rank":1}],
    "videos": [], "activated": false,
    "activation_cost_usd": 0, "warnings": []
  }]
}`} lang="json" />
        </div>
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Validation error (400)</p>
        <CodeBlock code={`{
  "error": {
    "code": "VALIDATION_FAILED", "status": 400,
    "message": "Request validation failed.",
    "fields": {
      "listing.title": "Title is required",
      "shops[0].shipping_profile_id": "Required for physical listings"
    }
  }
}`} lang="json" />
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Shop not connected (403)</p>
        <CodeBlock code={`{
  "error": {
    "code": "STORE_NOT_OWNED", "status": 403,
    "message": "The following shop IDs are not connected: 61004439",
    "hint": "Connect shops at jeterdev.tools/dashboard."
  }
}`} lang="json" />
      </div>
    </div>
  );
}

function ListingJobPoll() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Listing Builder</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Job Poll</h1>
        <p className="text-sm text-white/40 mb-2 font-mono">GET /api/v1/listings/create/{"{job_id}"}</p>
        <p className="text-sm text-white/50 leading-relaxed">Retrieve a listing creation job result. Jobs are retained for 24 hours — useful for retry logic or restoring queue state after a page reload.</p>
      </div>
      <CodeBlock code={`curl "https://jeterdev.tools/api/v1/listings/create/jt_aBcDeFgHiJkL..." \\
  -H "x-api-key: jt_YOUR_KEY"`} />
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Response — same shape as create</p>
        <CodeBlock code={`{ "job_id": "jt_...", "listing_pk": 1234567, "status": "completed", "results": [...] }`} lang="json" />
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Job expired or not found</p>
        <CodeBlock code={`{ "error": { "code": "JOB_NOT_FOUND", "status": 404, "message": "Job 'jt_...' not found. Jobs expire after 24 hours." } }`} lang="json" />
      </div>
    </div>
  );
}

// ─── Stores sections ──────────────────────────

function StoresList() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Stores</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">List Stores</h1>
        <p className="text-sm text-white/40 mb-2 font-mono">GET /api/v1/stores</p>
        <p className="text-sm text-white/50 leading-relaxed">Returns all Etsy shops connected to your API key with their <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">shop_id</code>, connection status, and token validity.</p>
      </div>
      <CodeBlock code={`curl "https://jeterdev.tools/api/v1/stores" -H "x-api-key: jt_YOUR_KEY"`} />
      <CodeBlock code={`{
  "count": 2,
  "stores": [
    { "shop_id": "61004439", "shop_name": "MyCeramicsShop", "is_connected": true, "token_valid": true, "connected_at": "2026-05-09T12:00:00.000Z" },
    { "shop_id": "72005550", "shop_name": "MyVintageShop",  "is_connected": true, "token_valid": true, "connected_at": "2026-05-10T08:30:00.000Z" }
  ]
}`} lang="json" />
    </div>
  );
}

function StoresSync() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Stores</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Sync</h1>
        <p className="text-sm text-white/40 mb-2 font-mono">POST /api/v1/stores/{"{shopId}"}/sync</p>
        <p className="text-sm text-white/50 leading-relaxed">One-shot full shop data refresh. Returns shipping profiles, return policies, processing profiles, shop sections, and production partners in a single response.</p>
      </div>
      <InfoBox>Always hits Etsy fresh — no cache. Use this before listing creation to get all required IDs.</InfoBox>
      <CodeBlock code={`curl -X POST "https://jeterdev.tools/api/v1/stores/61004439/sync" -H "x-api-key: jt_YOUR_KEY"`} />
      <CodeBlock code={`{
  "shop_id": "61004439", "synced_at": "2026-05-09T14:22:00.000Z",
  "shipping_profiles":   [{ "shipping_profile_id": 289094606827, "title": "US Standard" }],
  "return_policies":     [{ "return_policy_id": 1396555302092, "accepts_returns": true }],
  "processing_profiles": [{ "production_partner_profile_id": 1456101932490, "title": "1-3 days" }],
  "shop_sections":       [{ "shop_section_id": 55308357, "title": "Mugs & Cups" }],
  "production_partners": []   // separate from processing_profiles
}`} lang="json" />
    </div>
  );
}

function StoresLive() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-mono text-[#7F77DD] tracking-widest uppercase mb-2">Stores</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Live Profiles</h1>
        <p className="text-sm text-white/50 leading-relaxed">Four endpoints that always hit Etsy fresh — never cached. Use them individually when you only need one data type. For all four at once use <code className="font-mono text-xs bg-white/6 px-1.5 py-0.5 rounded">POST /stores/{"{shopId}"}/sync</code>.</p>
      </div>
      <InfoBox>All /live endpoints require the shop to be connected and count against your daily rate limit.</InfoBox>
      <div>
        <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-2">Shared response shape</p>
        <CodeBlock code={`{ "shop_id": "61004439", "fetched_at": "2026-05-09T14:22:00.000Z", "count": 3, "<profile_type>": [...] }`} lang="json" />
      </div>
      {([
        ["/stores/{shopId}/shipping-profiles/live", "shipping_profiles",   "Shipping profiles → shipping_profile_id"],
        ["/stores/{shopId}/return-policies/live",   "return_policies",     "Return policies → return_policy_id"],
        ["/stores/{shopId}/processing-profiles/live","processing_profiles","Processing profiles → processing_profile_id"],
        ["/stores/{shopId}/shop-sections/live",     "shop_sections",       "Shop sections → shop_section_id"],
      ] as [string,string,string][]).map(([path, key, desc]) => (
        <div key={path} className="border border-white/6 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">GET</span>
            <span className="font-mono text-sm text-white/70">{path}</span>
          </div>
          <p className="text-xs text-white/40 mb-3">{desc}</p>
          <CodeBlock code={`curl "https://jeterdev.tools/api/v1/${path.replace("{shopId}","61004439")}" -H "x-api-key: jt_YOUR_KEY"`} />
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────
export default function DocsPage() {
  const [active, setActive] = useState("introduction");
  const [mobileOpen, setMobileOpen] = useState(false);

  // Scroll spy — watches main scroll container and highlights active section
  useEffect(() => {
    const main = document.getElementById("doc-main");
    if (!main) return;

    const mainEl = main; // capture for closure — TypeScript narrowing
    function onScroll() {
      const scrollTop = mainEl.scrollTop + 120; // offset for header
      let current = ALL_IDS[0];

      for (const id of ALL_IDS) {
        const el = document.getElementById(`section-${id}`);
        if (el && el.offsetTop <= scrollTop) {
          current = id;
        }
      }
      setActive(current);
    }

    mainEl.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => mainEl.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll sidebar to keep active item visible
  useEffect(() => {
    const sidebar = document.getElementById("doc-sidebar");
    const activeEl = document.getElementById("nav-" + active);
    if (!sidebar || !activeEl) return;
    const sTop    = sidebar.scrollTop;
    const sBottom = sTop + sidebar.clientHeight;
    const eTop    = activeEl.offsetTop;
    const eBottom = eTop + activeEl.clientHeight;
    if (eTop < sTop + 40) {
      sidebar.scrollTo({ top: eTop - 40, behavior: "smooth" });
    } else if (eBottom > sBottom - 40) {
      sidebar.scrollTo({ top: eBottom - sidebar.clientHeight + 40, behavior: "smooth" });
    }
  }, [active]);

  // Click sidebar → scroll main content to section
  function scrollTo(id: string) {
    setMobileOpen(false);
    const main = document.getElementById("doc-main");
    const el   = document.getElementById("section-" + id);
    if (main && el) main.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
  }

  function renderSection(id: string) {
    switch (id) {
      case "introduction":     return <Introduction />;
      case "authentication":   return <Authentication />;
      case "rate-limits":      return <RateLimits />;
      case "store-connection": return <StoreConnection />;
      case "errors":           return <Errors />;
      case "listing-builder":  return <ListingBuilderOverview />;
      case "lb-uploads":       return <ListingUploads />;
      case "lb-create":        return <ListingCreate />;
      case "lb-jobs":          return <ListingJobPoll />;
      case "stores-list":      return <StoresList />;
      case "stores-sync":      return <StoresSync />;
      case "stores-live":      return <StoresLive />;
      default:                 return <EndpointSection id={id} />;
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-white/6 shrink-0 sticky top-0 z-10 bg-[#0a0a0f]/95 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <a href="/"><img src="/logo.webp" alt="JeterDev Tools" className="h-10 w-auto" /></a>
          <span className="text-white/20 text-sm hidden md:block font-mono">API Reference</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/pricing"   className="text-sm text-white/40 hover:text-white/70 transition-colors hidden md:block">Pricing</a>
          <a href="/dashboard" className="text-sm text-white/40 hover:text-white/70 transition-colors hidden md:block">Dashboard</a>
          <a href="/dashboard" className="text-xs px-3 py-1.5 bg-[#7F77DD] hover:bg-[#6B62CC] text-white rounded-lg transition-colors font-medium">Get API key</a>
          <button onClick={() => setMobileOpen(o => !o)} className="md:hidden text-white/40 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
            </svg>
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="md:hidden border-b border-white/6 bg-[#0a0a0f] py-4 px-6 sticky top-[53px] z-10">
          {NAV.map(group => (
            <div key={group.label} className="mb-4">
              <p className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-2">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.items.map(item => (
                  <button key={item.id} onClick={() => scrollTo(item.id)} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${active === item.id ? "bg-[#7F77DD]/10 border-[#7F77DD]/20 text-[#7F77DD]" : "border-white/6 text-white/40 hover:text-white/70"}`}>
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex" style={{ height: "calc(100vh - 53px)", overflow: "hidden" }}>
        {/* Sticky sidebar */}
        <aside id="doc-sidebar" className="w-56 shrink-0 border-r border-white/6 hidden md:block sticky top-[53px] h-[calc(100vh-53px)] overflow-y-auto py-5">
          {NAV.map(group => (
            <div key={group.label} className="mb-5">
              <p className="text-[9px] font-mono text-white/25 uppercase tracking-widest px-5 mb-1.5">{group.label}</p>
              {group.items.map(item => (
                <button
                  id={"nav-" + item.id}
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className={`w-full flex items-center justify-between px-5 py-1.5 text-sm transition-all text-left border-l-2 ${
                    active === item.id
                      ? "border-[#7F77DD] text-white font-medium bg-white/2"
                      : "border-transparent text-white/40 hover:text-white/70 hover:bg-white/1"
                  }`}
                >
                  {item.title}
                  {item.count !== undefined && (
                    <span className={`text-[10px] font-mono ${active === item.id ? "text-[#7F77DD]" : "text-white/20"}`}>{item.count}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Scrollable content — all sections rendered */}
        <main id="doc-main" className="flex-1 px-6 md:px-10 max-w-4xl overflow-y-auto" style={{height: "calc(100vh - 53px)"}}>
          {ALL_IDS.map((id, i) => (
            <div
              key={id}
              id={`section-${id}`}
              className={`py-12 ${i < ALL_IDS.length - 1 ? "border-b border-white/4" : ""}`}
            >
              {renderSection(id)}
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}