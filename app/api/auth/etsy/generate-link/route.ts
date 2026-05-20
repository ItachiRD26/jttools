// LOCATION: app/api/auth/etsy/generate-link/route.ts
// POST /api/auth/etsy/generate-link
// Generates a shareable Etsy OAuth URL tied to a specific user.
// Use this to connect shops from any browser (e.g. AdsPower).
//
// Flow:
//   1. POST /api/auth/etsy/generate-link (authenticated with Firebase token)
//   2. Copy the returned oauth_url
//   3. Paste in any browser (AdsPower, etc.)
//   4. Authorize on Etsy
//   5. Etsy redirects to /api/auth/etsy/callback → shop saved to your account

import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getDb } from "@/lib/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
} from "@/lib/etsy-oauth";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    getAdminApp();
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const db           = getDb();
  const codeVerifier = generateCodeVerifier();
  const challenge    = await generateCodeChallenge(codeVerifier);
  const state        = crypto.randomUUID().replace(/-/g, "");
  const expiresAt    = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  // Save pending OAuth state tied to this user
  await db.collection("oauthPending").doc(state).set({
    uid,
    codeVerifier,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });

  const oauthUrl = buildAuthUrl(state, challenge);

  return NextResponse.json({
    oauth_url:  oauthUrl,
    state,
    expires_in: "10min",
    note:       "Copy this URL and paste it in any browser. After authorizing on Etsy, the shop will be linked to your account automatically.",
  });
}