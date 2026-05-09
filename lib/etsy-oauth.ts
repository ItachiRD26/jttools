// LOCATION: lib/etsy-oauth.ts
// Multi-store Etsy OAuth 2.0 with PKCE
// Each user can connect multiple Etsy shops independently.
// Tokens are stored per userId+shopId in Firestore.
// The bridge resolves the correct token automatically from the shop_id in each request.

import { getDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

const ETSY_BASE     = "https://www.etsy.com/oauth";
const ETSY_API_BASE = "https://openapi.etsy.com/v3";
const CLIENT_ID     = process.env.ETSY_API_KEY!;
const REDIRECT_URI  = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/etsy/callback`;

export const ETSY_SCOPES = [
  "listings_r", "listings_w", "listings_d",
  "shops_r", "shops_w",
  "transactions_r",
  "profile_r", "email_r",
  "favorites_r", "feedback_r",
  "billing_r",
].join(" ");

// ─── PKCE ────────────────────────────────────
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ─── Auth URL ─────────────────────────────────
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

// ─── Token exchange ───────────────────────────
export interface EtsyTokens {
  access_token:  string;
  refresh_token: string;
  expires_in:    number;
  token_type:    string;
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<EtsyTokens> {
  const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI, code, code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${JSON.stringify(await res.json().catch(() => ({})))}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<EtsyTokens> {
  const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(await res.json().catch(() => ({})))}`);
  return res.json();
}

// ─── Firestore: store connection per userId+shopId ───────────────────────────
// Collection: etsyConnections/{userId}/shops/{shopId}

export interface StoreConnection {
  userId:       string;
  shopId:       string;
  shopName:     string;
  etsyUserId:   string;
  accessToken:  string;
  refreshToken: string;
  expiresAt:    Date | FirebaseFirestore.Timestamp;
  connectedAt:  FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
}

export async function saveStoreConnection(
  userId: string,
  tokens: EtsyTokens,
  shopId: string,
  shopName: string,
  etsyUserId: string
) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db
    .collection("etsyConnections")
    .doc(userId)
    .collection("shops")
    .doc(String(shopId))
    .set({
      userId,
      shopId:       String(shopId),
      shopName,
      etsyUserId,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      connectedAt:  FieldValue.serverTimestamp(),
    });
}

export async function getStoreConnection(userId: string, shopId: string): Promise<StoreConnection | null> {
  const db   = getDb();
  const snap = await db
    .collection("etsyConnections")
    .doc(userId)
    .collection("shops")
    .doc(String(shopId))
    .get();
  return snap.exists ? (snap.data() as StoreConnection) : null;
}

export async function getAllStoreConnections(userId: string): Promise<StoreConnection[]> {
  const db   = getDb();
  const snap = await db
    .collection("etsyConnections")
    .doc(userId)
    .collection("shops")
    .get();
  return snap.docs.map(d => d.data() as StoreConnection);
}

export async function disconnectStore(userId: string, shopId: string) {
  const db = getDb();
  await db
    .collection("etsyConnections")
    .doc(userId)
    .collection("shops")
    .doc(String(shopId))
    .delete();
}

// ─── Get valid access token for a shop (auto-refresh) ────────────────────────
export async function getValidAccessToken(userId: string, shopId: string): Promise<string> {
  const db         = getDb();
  const connection = await getStoreConnection(userId, shopId);

  if (!connection) {
    throw new Error(`STORE_NOT_CONNECTED:${shopId}`);
  }

  const now       = new Date();
  const expiresAt = connection.expiresAt instanceof Date
    ? connection.expiresAt
    : (connection.expiresAt as FirebaseFirestore.Timestamp).toDate();

  // Refresh if expires in less than 5 minutes
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    const newTokens    = await refreshAccessToken(connection.refreshToken);
    const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

    await db
      .collection("etsyConnections")
      .doc(userId)
      .collection("shops")
      .doc(String(shopId))
      .update({
        accessToken:  newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        expiresAt:    newExpiresAt,
      });

    return newTokens.access_token;
  }

  return connection.accessToken;
}