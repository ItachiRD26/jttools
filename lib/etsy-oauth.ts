// LOCATION: lib/etsy-oauth.ts
// Multi-store Etsy OAuth 2.0 with PKCE
// Each user can connect multiple Etsy shops independently.
// Tokens are stored per userId+shopId in Firestore.
// The bridge resolves the correct token automatically from the shop_id in each request.

import { getDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

const ETSY_BASE     = "https://www.etsy.com/oauth";
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
  userId:             string;
  shopId:             string;
  shopName:           string;
  etsyUserId:         string;
  accessToken:        string;
  refreshToken:       string;
  expiresAt:          Date | FirebaseFirestore.Timestamp;
  connectedAt:        FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  // Set to true when a refresh attempt fails (revoked, expired refresh token, etc.)
  // Cleared back to false on successful reconnect via saveStoreConnection.
  connection_expired?: boolean;
  expiredAt?:          FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
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
      accessToken:        tokens.access_token,
      refreshToken:       tokens.refresh_token,
      expiresAt,
      connectedAt:        FieldValue.serverTimestamp(),
      // Reconnect always clears any previous expiry flag
      connection_expired: false,
      expiredAt:          null,
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

// ─── Typed error so callers can distinguish the two failure modes ─────────────

export class StoreNotConnectedError extends Error {
  constructor(shopId: string) {
    super(`STORE_NOT_CONNECTED:${shopId}`);
    this.name = "StoreNotConnectedError";
  }
}

export class StoreTokenExpiredError extends Error {
  constructor(shopId: string) {
    super(`STORE_TOKEN_EXPIRED:${shopId}`);
    this.name = "StoreTokenExpiredError";
  }
}

// ─── Get valid access token for a shop (auto-refresh) ────────────────────────
// Throws StoreNotConnectedError  — no Firestore doc for this shop
// Throws StoreTokenExpiredError  — refresh token is dead, user must re-link
// ─── Distributed refresh lock ────────────────────────────────────────────────
// Vercel is serverless — multiple concurrent requests can all see a near-expired
// token and race to refresh it. Etsy uses refresh token rotation: the first
// request to refresh invalidates the old refresh token immediately. The second
// request (arriving ms later with the now-dead token) fails → connection_expired.
//
// Fix: Firestore-based optimistic lock.
//   1. Before refreshing, write refreshing:true + refreshingAt:now (only if not
//      already set) using a transaction that checks the current value.
//   2. If another process already holds the lock, wait up to LOCK_TIMEOUT_MS
//      and re-read the doc — it will have the new access token by then.
//   3. After refresh (success or failure), clear the lock.
//   4. Lock has a TTL guard: if refreshingAt is older than LOCK_TTL_MS the lock
//      is considered stale (crashed process) and we override it.

const LOCK_POLL_MS    = 300;  // how often to re-check while waiting
const LOCK_TIMEOUT_MS = 8000; // max time to wait for another process to finish
const LOCK_TTL_MS     = 15000; // stale lock threshold — assume crash after this

async function withRefreshLock<T>(
  userId: string,
  shopId: string,
  fn: () => Promise<T>
): Promise<T> {
  const db  = getDb();
  const ref = db
    .collection("etsyConnections")
    .doc(userId)
    .collection("shops")
    .doc(String(shopId));

  // Try to acquire lock via transaction
  const acquired = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const isLocked    = data.refreshing === true;
    const lockedAt    = (data.refreshingAt as FirebaseFirestore.Timestamp)?.toDate?.() ?? new Date(0);
    const lockAge     = Date.now() - lockedAt.getTime();
    const lockIsStale = lockAge > LOCK_TTL_MS;

    if (isLocked && !lockIsStale) return false; // another process has it

    tx.update(ref, { refreshing: true, refreshingAt: FieldValue.serverTimestamp() });
    return true;
  });

  if (!acquired) {
    // Another process is refreshing — poll until it finishes or we time out
    console.log(`[OAuth] Shop ${shopId} refresh lock held by another process, waiting...`);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, LOCK_POLL_MS));
      const snap = await ref.get();
      const data = snap.data() ?? {};
      if (!data.refreshing) {
        // Lock released — return whatever token the other process stored
        console.log(`[OAuth] Shop ${shopId} lock released, using refreshed token`);
        return data.accessToken as T;
      }
    }
    // Timed out waiting — proceed anyway (worst case: duplicate refresh attempt)
    console.warn(`[OAuth] Shop ${shopId} lock wait timed out, proceeding with refresh`);
  }

  try {
    return await fn();
  } finally {
    // Always release the lock
    await ref.update({ refreshing: false, refreshingAt: null }).catch(() => {});
  }
}

export async function getValidAccessToken(userId: string, shopId: string): Promise<string> {
  const db         = getDb();
  const connection = await getStoreConnection(userId, shopId);

  if (!connection) {
    throw new StoreNotConnectedError(shopId);
  }

  if (connection.connection_expired) {
    throw new StoreTokenExpiredError(shopId);
  }

  const now       = new Date();
  const expiresAt = connection.expiresAt instanceof Date
    ? connection.expiresAt
    : (connection.expiresAt as FirebaseFirestore.Timestamp).toDate();

  const timeToExpiry = expiresAt.getTime() - now.getTime();
  console.log(`[OAuth] Shop ${shopId} token expires in ${Math.round(timeToExpiry / 60000)}min`);

  if (timeToExpiry >= 5 * 60 * 1000) {
    // Token still valid — return immediately, no lock needed
    return connection.accessToken;
  }

  // Token near expiry — acquire distributed lock before refreshing
  return withRefreshLock(userId, shopId, async () => {
    // Re-read inside the lock: another process may have already refreshed
    const fresh = await getStoreConnection(userId, shopId);
    if (!fresh) throw new StoreNotConnectedError(shopId);

    const freshExpiresAt = fresh.expiresAt instanceof Date
      ? fresh.expiresAt
      : (fresh.expiresAt as FirebaseFirestore.Timestamp).toDate();

    if (freshExpiresAt.getTime() - Date.now() >= 5 * 60 * 1000) {
      console.log(`[OAuth] Shop ${shopId} already refreshed by another process`);
      return fresh.accessToken;
    }

    console.log(`[OAuth] Refreshing token for shop ${shopId}...`);
    const ref = db
      .collection("etsyConnections")
      .doc(userId)
      .collection("shops")
      .doc(String(shopId));

    try {
      const newTokens    = await refreshAccessToken(fresh.refreshToken);
      const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

      await ref.update({
        accessToken:        newTokens.access_token,
        refreshToken:       newTokens.refresh_token,
        expiresAt:          newExpiresAt,
        connection_expired: false,
        expiredAt:          null,
      });

      console.log(`[OAuth] Shop ${shopId} token refreshed, expires in ${newTokens.expires_in}s`);
      return newTokens.access_token;
    } catch (refreshErr) {
      console.error(`[OAuth] Refresh failed for shop ${shopId}:`, refreshErr);

      await ref.update({
        connection_expired: true,
        expiredAt:          FieldValue.serverTimestamp(),
      });

      throw new StoreTokenExpiredError(shopId);
    }
  });
}