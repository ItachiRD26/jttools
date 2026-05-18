// LOCATION: app/api/auth/etsy/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getDb } from "@/lib/firebase-admin";
import { exchangeCodeForTokens, saveStoreConnection } from "@/lib/etsy-oauth";

export async function GET(req: NextRequest) {
  const APP_URL   = process.env.NEXT_PUBLIC_APP_URL!;
  const ETSY_KEY  = process.env.ETSY_API_KEY!;
  const ETSY_SEC  = process.env.ETSY_SHARED_SECRET!;
  const API_KEY   = `${ETSY_KEY}:${ETSY_SEC}`;

  console.log("[OAuth] ETSY_KEY set:", !!ETSY_KEY, "ETSY_SEC set:", !!ETSY_SEC);

  getAdminApp();
  const db = getDb();

  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) return NextResponse.redirect(`${APP_URL}/dashboard?etsy=cancelled`);
  if (!code || !state) return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=missing_params`);

  const pendingSnap = await db.collection("oauthPending").doc(state).get();
  if (!pendingSnap.exists) {
    console.error("[OAuth] Invalid state:", state);
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=invalid_state`);
  }

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
    console.log("[OAuth] Token exchange OK, expires_in:", tokens.expires_in);
  } catch (err) {
    console.error("[OAuth] Token exchange failed:", err);
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=token_exchange`);
  }

  let etsyUserId = "";
  let shopId     = "";
  let shopName   = "My Shop";

  // Attempt 1: /users/me with x-api-key as keystring:shared_secret
  try {
    const r1 = await fetch("https://openapi.etsy.com/v3/application/users/me", {
      headers: {
        "x-api-key":     API_KEY,
        "Authorization": `Bearer ${tokens.access_token}`,
        "Accept":        "application/json",
      },
    });
    const t1 = await r1.text();
    console.log("[OAuth] /users/me (keystring:secret):", r1.status, t1.slice(0, 300));

    if (r1.ok) {
      const d = JSON.parse(t1);
      etsyUserId = String(d.user_id ?? "");
    } else {
      // Attempt 2: x-api-key as keystring only
      const r2 = await fetch("https://openapi.etsy.com/v3/application/users/me", {
        headers: {
          "x-api-key":     ETSY_KEY,
          "Authorization": `Bearer ${tokens.access_token}`,
          "Accept":        "application/json",
        },
      });
      const t2 = await r2.text();
      console.log("[OAuth] /users/me (keystring only):", r2.status, t2.slice(0, 300));
      if (r2.ok) {
        const d = JSON.parse(t2);
        etsyUserId = String(d.user_id ?? "");
      }
    }
  } catch (err) {
    console.error("[OAuth] /users/me error:", err);
  }

  console.log("[OAuth] etsyUserId:", etsyUserId);

  if (etsyUserId) {
    // Get shop — try both API key formats
    for (const key of [API_KEY, ETSY_KEY]) {
      try {
        const r = await fetch(
          `https://openapi.etsy.com/v3/application/users/${etsyUserId}/shops`,
          {
            headers: {
              "x-api-key":     key,
              "Authorization": `Bearer ${tokens.access_token}`,
              "Accept":        "application/json",
            },
          }
        );
        const t = await r.text();
        console.log(`[OAuth] /shops (${key === ETSY_KEY ? "key only" : "key:secret"}):`, r.status, t.slice(0, 300));

        if (r.ok) {
          const d = JSON.parse(t);
          const shop = Array.isArray(d) ? d[0] : d;
          shopId   = String(shop?.shop_id ?? "");
          shopName = shop?.shop_name ?? "My Shop";
          if (shopId) break;
        }
      } catch (err) {
        console.error("[OAuth] /shops error:", err);
      }
    }
  }

  console.log("[OAuth] Final: shopId=", shopId, "shopName=", shopName, "uid=", uid);

  if (shopId) {
    try {
      await saveStoreConnection(uid, tokens, shopId, shopName, etsyUserId);
      console.log("[OAuth] ✓ Saved to Firestore");
    } catch (err) {
      console.error("[OAuth] ✗ saveStoreConnection failed:", err);
    }
  }

  await db.collection("oauthPending").doc(state).delete();

  const redirectUrl = shopId
    ? `${APP_URL}/dashboard?etsy=connected&shop=${encodeURIComponent(shopName)}`
    : `${APP_URL}/dashboard?etsy=error&reason=shop_not_found`;

  return NextResponse.redirect(redirectUrl);
}