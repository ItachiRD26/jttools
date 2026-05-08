// LOCATION: app/api/auth/etsy/callback/route.ts
// GET /api/auth/etsy/callback
// Etsy redirects here after user authorizes — exchanges code for tokens

import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getDb } from "@/lib/firebase-admin";
import {
  exchangeCodeForTokens,
  saveEtsyTokens,
  etsyAuthenticatedRequest,
} from "@/lib/etsy-oauth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

export async function GET(req: NextRequest) {
  getAdminApp();
  const db = getDb();

  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // ── User denied access ────────────────────────────────────────────────────
  if (error) {
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=cancelled`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=missing_params`);
  }

  // ── Retrieve pending OAuth state ──────────────────────────────────────────
  const pendingSnap = await db.collection("oauthPending").doc(state).get();
  if (!pendingSnap.exists) {
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=invalid_state`);
  }

  const { uid, codeVerifier, expiresAt } = pendingSnap.data()!;

  // Check not expired
  const expiry = expiresAt instanceof Date ? expiresAt : expiresAt.toDate();
  if (new Date() > expiry) {
    await db.collection("oauthPending").doc(state).delete();
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=expired`);
  }

  // ── Exchange code for tokens ──────────────────────────────────────────────
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, codeVerifier);
  } catch (err) {
    console.error("[OAuth] Token exchange failed:", err);
    return NextResponse.redirect(`${APP_URL}/dashboard?etsy=error&reason=token_exchange`);
  }

  // ── Get Etsy user info ────────────────────────────────────────────────────
  let etsyUserId = "";
  let shopId: string | undefined;
  let shopName: string | undefined;

  try {
    // Get user info
    const userRes = await etsyAuthenticatedRequest(
      uid,
      "/application/users/me"
    );

    // We need to temporarily save tokens to use etsyAuthenticatedRequest
    // So save first, then get user info
    await saveEtsyTokens(uid, tokens, "pending");

    const userRes2 = await etsyAuthenticatedRequest(uid, "/application/users/me");
    if (userRes2.ok) {
      const userData = await userRes2.json();
      etsyUserId = String(userData.user_id ?? "");

      // Get their shop
      const shopRes = await etsyAuthenticatedRequest(
        uid,
        `/application/users/${etsyUserId}/shops`
      );
      if (shopRes.ok) {
        const shopData = await shopRes.json();
        if (shopData.shop_id) {
          shopId   = String(shopData.shop_id);
          shopName = shopData.shop_name;
        }
      }
    }
  } catch (err) {
    console.error("[OAuth] Failed to get user info:", err);
  }

  // ── Save final tokens with user info ─────────────────────────────────────
  await saveEtsyTokens(uid, tokens, etsyUserId, shopId, shopName);

  // ── Update user doc with shop info ───────────────────────────────────────
  await db.collection("users").doc(uid).update({
    etsyConnected: true,
    etsyShopId:    shopId ?? null,
    etsyShopName:  shopName ?? null,
  });

  // ── Clean up pending state ────────────────────────────────────────────────
  await db.collection("oauthPending").doc(state).delete();

  // ── Redirect to dashboard with success ───────────────────────────────────
  return NextResponse.redirect(`${APP_URL}/dashboard?etsy=connected`);
}