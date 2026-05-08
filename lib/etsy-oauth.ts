// LOCATION: lib/etsy-oauth.ts
// Etsy OAuth 2.0 — PKCE flow
// Handles token exchange, storage, and refresh

import { getDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

const ETSY_BASE     = "https://www.etsy.com/oauth";
const ETSY_API_BASE = "https://openapi.etsy.com/v3";
const CLIENT_ID     = process.env.ETSY_API_KEY!;
const REDIRECT_URI  = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/etsy/callback`;

// Etsy scopes needed for full shop management
export const ETSY_SCOPES = [
  "listings_r",   // read listings
  "listings_w",   // write listings
  "listings_d",   // delete listings
  "shops_r",      // read shop info
  "shops_w",      // write shop info
  "transactions_r", // read orders/transactions
  "profile_r",    // read user profile
  "email_r",      // read email
  "billing_r",    // read billing
  "cart_r",       // read cart
  "cart_w",       // write cart
  "favorites_r",  // read favorites
  "favorites_w",  // write favorites
  "feedback_r",   // read feedback
].join(" ");

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ─── Build authorization URL ──────────────────────────────────────────────────

export function buildAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 ETSY_SCOPES,
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: "S256",
  });
  return `${ETSY_BASE}/connect?${params.toString()}`;
}

// ─── Exchange code for tokens ─────────────────────────────────────────────────

export interface EtsyTokens {
  access_token:  string;
  refresh_token: string;
  expires_in:    number;
  token_type:    string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<EtsyTokens> {
  const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${JSON.stringify(err)}`);
  }

  return res.json();
}

// ─── Refresh access token ─────────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<EtsyTokens> {
  const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${JSON.stringify(err)}`);
  }

  return res.json();
}

// ─── Firestore token storage ──────────────────────────────────────────────────

export interface StoredEtsyConnection {
  userId:        string;
  etsyUserId:    string;
  shopId?:       string;
  shopName?:     string;
  accessToken:   string;
  refreshToken:  string;
  expiresAt:     Date;
  connectedAt:   FirebaseFirestore.FieldValue;
}

export async function saveEtsyTokens(
  userId: string,
  tokens: EtsyTokens,
  etsyUserId: string,
  shopId?: string,
  shopName?: string
) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db.collection("etsyConnections").doc(userId).set({
    userId,
    etsyUserId,
    shopId:       shopId ?? null,
    shopName:     shopName ?? null,
    accessToken:  tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    connectedAt:  FieldValue.serverTimestamp(),
  });
}

export async function getEtsyTokens(userId: string): Promise<StoredEtsyConnection | null> {
  const db = getDb();
  const snap = await db.collection("etsyConnections").doc(userId).get();
  if (!snap.exists) return null;
  return snap.data() as StoredEtsyConnection;
}

// ─── Get valid access token (auto-refresh if expired) ────────────────────────

export async function getValidAccessToken(userId: string): Promise<string> {
  const db = getDb();
  const connection = await getEtsyTokens(userId);

  if (!connection) {
    throw new Error("No Etsy connection found. Please connect your Etsy shop first.");
  }

  const now = new Date();
  const expiresAt = connection.expiresAt instanceof Date
    ? connection.expiresAt
    : (connection.expiresAt as unknown as FirebaseFirestore.Timestamp).toDate();

  // If token expires in less than 5 minutes, refresh it
  const fiveMinutes = 5 * 60 * 1000;
  if (expiresAt.getTime() - now.getTime() < fiveMinutes) {
    const newTokens = await refreshAccessToken(connection.refreshToken);
    const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

    await db.collection("etsyConnections").doc(userId).update({
      accessToken:  newTokens.access_token,
      refreshToken: newTokens.refresh_token,
      expiresAt:    newExpiresAt,
    });

    return newTokens.access_token;
  }

  return connection.accessToken;
}

// ─── Disconnect Etsy ──────────────────────────────────────────────────────────

export async function disconnectEtsy(userId: string) {
  const db = getDb();
  await db.collection("etsyConnections").doc(userId).delete();
}

// ─── Make authenticated Etsy request ─────────────────────────────────────────

export async function etsyAuthenticatedRequest(
  userId: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const accessToken = await getValidAccessToken(userId);

  return fetch(`${ETSY_API_BASE}${path}`, {
    ...options,
    headers: {
      "x-api-key":     CLIENT_ID,
      "Authorization": `Bearer ${accessToken}`,
      "Accept":        "application/json",
      ...(options.headers ?? {}),
    },
  });
}