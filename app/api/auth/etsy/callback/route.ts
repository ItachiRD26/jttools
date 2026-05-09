// LOCATION: app/api/auth/etsy/callback/route.ts
// Etsy redirects here after user authorizes

import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getDb } from "@/lib/firebase-admin";
import {
  exchangeCodeForTokens,
  saveStoreConnection,
} from "@/lib/etsy-oauth";

export async function GET(req: NextRequest) {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
  const API_KEY = process.env.ETSY_API_KEY!;
  getAdminApp();
  const db = getDb();

  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) return NextResponse.redirect(`${APP_URL}/dashboard?etsy=cancelled`);
  if (!code || !state) return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error`);

  // Retrieve pending state
  const pendingSnap = await db.collection("oauthPending").doc(state).get();
  if (!pendingSnap.exists) return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=invalid_state`);

  const { uid, codeVerifier, expiresAt } = pendingSnap.data()!;
  const expiry = expiresAt instanceof Date ? expiresAt : expiresAt.toDate();
  if (new Date() > expiry) {
    await db.collection("oauthPending").doc(state).delete();
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=expired`);
  }

  // Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, codeVerifier);
  } catch (err) {
    console.error("[OAuth] Token exchange failed:", err);
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=token_exchange`);
  }

  // Get Etsy user and shop info using the new token
  let etsyUserId = "";
  let shopId     = "";
  let shopName   = "My Shop";

  try {
    const userRes = await fetch("https://openapi.etsy.com/v3/application/users/me", {
      headers: {
        "x-api-key":     API_KEY,
        "Authorization": `Bearer ${tokens.access_token}`,
      },
    });

    if (userRes.ok) {
      const userData = await userRes.json();
      etsyUserId = String(userData.user_id ?? "");

      // Get their shops
      const shopsRes = await fetch(
        `https://openapi.etsy.com/v3/application/users/${etsyUserId}/shops`,
        {
          headers: {
            "x-api-key":     API_KEY,
            "Authorization": `Bearer ${tokens.access_token}`,
          },
        }
      );

      if (shopsRes.ok) {
        const shopsData = await shopsRes.json();
        shopId   = String(shopsData.shop_id ?? "");
        shopName = shopsData.shop_name ?? "My Shop";
      }
    }
  } catch (err) {
    console.error("[OAuth] Failed to get user/shop info:", err);
  }

  // Save per-shop connection
  if (shopId) {
    await saveStoreConnection(uid, tokens, shopId, shopName, etsyUserId);
  }

  // Clean up
  await db.collection("oauthPending").doc(state).delete();

  return NextResponse.redirect(`${APP_URL}/dashboard?etsy=connected&shop=${shopName}`);
}