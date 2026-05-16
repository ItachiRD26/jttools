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
  // ⚠️ Must be keystring:shared_secret format
  const API_KEY = `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`;
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
        "Accept":        "application/json",
      },
    });

    console.log("[OAuth] /users/me status:", userRes.status);

    if (userRes.ok) {
      const userData = await userRes.json();
      console.log("[OAuth] user_id:", userData.user_id);
      etsyUserId = String(userData.user_id ?? "");

      if (etsyUserId) {
        const shopsRes = await fetch(
          `https://openapi.etsy.com/v3/application/users/${etsyUserId}/shops`,
          {
            headers: {
              "x-api-key":     API_KEY,
              "Authorization": `Bearer ${tokens.access_token}`,
              "Accept":        "application/json",
            },
          }
        );

        console.log("[OAuth] /shops status:", shopsRes.status);

        if (shopsRes.ok) {
          const shopsData = await shopsRes.json();
          console.log("[OAuth] shop_id:", shopsData.shop_id, "shop_name:", shopsData.shop_name);
          shopId   = String(shopsData.shop_id ?? "");
          shopName = shopsData.shop_name ?? "My Shop";
        } else {
          const errBody = await shopsRes.text();
          console.error("[OAuth] shops error:", errBody);
        }
      }
    } else {
      const errBody = await userRes.text();
      console.error("[OAuth] /users/me error:", errBody);
    }
  } catch (err) {
    console.error("[OAuth] Failed to get user/shop info:", err);
  }

  // Save connection — even if we couldn't get shop info, save with etsyUserId as fallback
  if (shopId) {
    await saveStoreConnection(uid, tokens, shopId, shopName, etsyUserId);
    console.log(`[OAuth] ✓ Saved connection for shop ${shopId} (${shopName})`);
  } else if (etsyUserId) {
    // Fallback: save with userId as shopId so at least the token is stored
    // User can reconnect to get proper shop info
    console.error(`[OAuth] ⚠ Could not get shop_id for user ${etsyUserId} — connection not saved`);
  } else {
    console.error("[OAuth] ⚠ Could not get any user info — connection not saved");
  }

  // Clean up
  await db.collection("oauthPending").doc(state).delete();

  const redirectUrl = shopId
    ? `${APP_URL}/dashboard?etsy=connected&shop=${encodeURIComponent(shopName)}`
    : `${APP_URL}/dashboard?etsy=error&reason=shop_not_found`;

  return NextResponse.redirect(redirectUrl);
}