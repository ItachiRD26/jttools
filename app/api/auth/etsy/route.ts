// LOCATION: app/api/auth/etsy/route.ts
// GET /api/auth/etsy?token=FIREBASE_TOKEN
// Initiates the Etsy OAuth flow

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp, getDb } from "@/lib/firebase-admin";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
} from "@/lib/etsy-oauth";
import { FieldValue } from "firebase-admin/firestore";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(`${APP_URL}/auth?error=unauthorized`);
  }

  // 1. Verify Firebase token
  let uid: string;
  try {
    getAdminApp();
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.redirect(`${APP_URL}/auth?error=invalid_token`);
  }

  // 2. Generate PKCE
  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state         = `${uid}:${Date.now()}`;

  // 3. Store pending state in Firestore (10 min TTL)
  const db = getDb();
  await db.collection("oauthPending").doc(state).set({
    uid,
    codeVerifier,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  // 4. Redirect to Etsy
  const authUrl = buildAuthUrl(state, codeChallenge);
  return NextResponse.redirect(authUrl);
}