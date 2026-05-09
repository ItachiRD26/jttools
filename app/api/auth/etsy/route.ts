// LOCATION: app/api/auth/etsy/route.ts
// GET /api/auth/etsy?token=FIREBASE_TOKEN
// Initiates Etsy OAuth flow

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp, getDb } from "@/lib/firebase-admin";
import { generateCodeVerifier, generateCodeChallenge, buildAuthUrl } from "@/lib/etsy-oauth";
import { FieldValue } from "firebase-admin/firestore";

export async function GET(req: NextRequest) {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
  const token   = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(`${APP_URL}/auth?error=unauthorized`);

  let uid: string;
  try {
    getAdminApp();
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.redirect(`${APP_URL}/auth?error=invalid_token`);
  }

  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state         = `${uid}:${Date.now()}`;

  await getDb().collection("oauthPending").doc(state).set({
    uid, codeVerifier,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  return NextResponse.redirect(buildAuthUrl(state, codeChallenge));
}