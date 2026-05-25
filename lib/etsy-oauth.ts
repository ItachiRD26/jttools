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

// Thrown by refreshAccessToken with a parsed shape so callers can differentiate
// permanent failures (refresh token dead → user must reconnect) from transient
// ones (Etsy 5xx → safe to retry later).
export class RefreshTokenError extends Error {
  status:      number;
  etsyCode:    string | null; // e.g. "invalid_grant", "invalid_request"
  isPermanent: boolean;
  constructor(status: number, body: unknown) {
    const bodyObj = (body ?? {}) as Record<string, unknown>;
    const etsyCode = typeof bodyObj.error === "string" ? bodyObj.error : null;
    // OAuth 2.0 spec — these mean the refresh token is dead and no retry will help
    const permanentCodes = new Set([
      "invalid_grant",
      "invalid_request",
      "invalid_client",
      "unauthorized_client",
      "unsupported_grant_type",
    ]);
    const isPermanent =
      (etsyCode !== null && permanentCodes.has(etsyCode)) ||
      // 401/403 from Etsy's token endpoint = revoked/invalid grant
      status === 401 || status === 403;
    super(`Refresh failed (${status}, ${etsyCode ?? "no-error-code"}): ${JSON.stringify(body)}`);
    this.name        = "RefreshTokenError";
    this.status      = status;
    this.etsyCode    = etsyCode;
    this.isPermanent = isPermanent;
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<EtsyTokens> {
  const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new RefreshTokenError(res.status, body);
  }
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
  // Set to true when a refresh attempt fails permanently (refresh token
  // revoked / expired). Cleared on successful reconnect via saveStoreConnection
  // OR on successful recovery refresh.
  connection_expired?: boolean;
  expiredAt?:          FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  // Refresh telemetry — populated by getValidAccessToken's refresh path so
  // we can observe transient-vs-permanent failures and trigger the recovery
  // path (allow one refresh attempt per hour even on expired shops).
  lastRefreshError?:      string | null;
  lastRefreshAttemptAt?:  FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  lastRefreshSuccessAt?:  FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  refreshFailureCount?:   number;
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

// Recovery cooldown — if a shop is marked connection_expired, allow ONE
// refresh attempt per hour. A transient failure that flipped the flag will
// self-heal on next access; a truly dead refresh token will keep failing
// (permanently) and won't burn rate limit beyond once per hour. Without
// this, a single 5xx from Etsy's token endpoint requires a full user reconnect.
const EXPIRED_RECOVERY_INTERVAL_MS = 60 * 60 * 1000;

export async function getValidAccessToken(userId: string, shopId: string): Promise<string> {
  const db         = getDb();
  const connection = await getStoreConnection(userId, shopId);

  if (!connection) {
    throw new StoreNotConnectedError(shopId);
  }

  // Shop is currently marked expired. Try recovery if the last attempt was
  // more than an hour ago — gives transient-failure-flagged shops a chance
  // to self-heal without forcing the user to reconnect.
  if (connection.connection_expired) {
    const lastAttempt = connection.lastRefreshAttemptAt as
      | FirebaseFirestore.Timestamp
      | null
      | undefined;
    const lastAttemptDate = lastAttempt?.toDate?.() ?? new Date(0);
    const sinceLastAttempt = Date.now() - lastAttemptDate.getTime();

    if (sinceLastAttempt < EXPIRED_RECOVERY_INTERVAL_MS) {
      // Too soon since last attempt — caller still needs to reconnect
      throw new StoreTokenExpiredError(shopId);
    }

    console.log(
      `[OAuth] Shop ${shopId} marked expired but ${Math.round(sinceLastAttempt / 60000)}min ` +
      `since last attempt — trying recovery refresh`
    );
    // Fall through to the refresh path; the refresh attempt below will either
    // succeed (clears connection_expired) or fail (updates lastRefreshAttemptAt
    // so the next call will be gated by the hour cooldown).
  }

  const now       = new Date();
  const expiresAt = connection.expiresAt instanceof Date
    ? connection.expiresAt
    : (connection.expiresAt as FirebaseFirestore.Timestamp).toDate();

  const timeToExpiry = expiresAt.getTime() - now.getTime();
  console.log(`[OAuth] Shop ${shopId} token expires in ${Math.round(timeToExpiry / 60000)}min`);

  if (timeToExpiry >= 5 * 60 * 1000 && !connection.connection_expired) {
    // Token still valid AND not marked expired — return immediately, no lock needed
    return connection.accessToken;
  }

  // Token near expiry OR shop in recovery — acquire distributed lock before refreshing
  return withRefreshLock(userId, shopId, async () => {
    // Re-read inside the lock: another process may have already refreshed
    const fresh = await getStoreConnection(userId, shopId);
    if (!fresh) throw new StoreNotConnectedError(shopId);

    const freshExpiresAt = fresh.expiresAt instanceof Date
      ? fresh.expiresAt
      : (fresh.expiresAt as FirebaseFirestore.Timestamp).toDate();

    if (freshExpiresAt.getTime() - Date.now() >= 5 * 60 * 1000 && !fresh.connection_expired) {
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
        accessToken:           newTokens.access_token,
        refreshToken:          newTokens.refresh_token,
        expiresAt:             newExpiresAt,
        connection_expired:    false,
        expiredAt:             null,
        lastRefreshError:      null,
        lastRefreshAttemptAt:  FieldValue.serverTimestamp(),
        lastRefreshSuccessAt:  FieldValue.serverTimestamp(),
        refreshFailureCount:   0,
      });

      console.log(`[OAuth] Shop ${shopId} token refreshed, expires in ${newTokens.expires_in}s`);
      return newTokens.access_token;
    } catch (refreshErr) {
      // Differentiate permanent (refresh token dead, user must reconnect) from
      // transient (Etsy 5xx, network blip, momentary rate limit — safe to retry
      // later). Only flip connection_expired on permanent — transient failures
      // get logged and the shop stays in a recoverable state.
      const isPermanent = refreshErr instanceof RefreshTokenError && refreshErr.isPermanent;
      const errMsg      = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
      const etsyCode    = refreshErr instanceof RefreshTokenError ? refreshErr.etsyCode : null;

      console.error(
        `[OAuth] Refresh failed for shop ${shopId} ` +
        `(permanent=${isPermanent}, etsyCode=${etsyCode}):`, errMsg
      );

      const failureCount = (connection.refreshFailureCount ?? 0) + 1;

      if (isPermanent) {
        await ref.update({
          connection_expired:    true,
          expiredAt:             FieldValue.serverTimestamp(),
          lastRefreshError:      errMsg,
          lastRefreshAttemptAt:  FieldValue.serverTimestamp(),
          refreshFailureCount:   failureCount,
        });
        throw new StoreTokenExpiredError(shopId);
      }

      // Transient — don't burn the connection. Log + bump attempt timestamp
      // so the recovery cooldown ticks. Caller can retry. After 5+ consecutive
      // transient failures we DO mark expired as a circuit breaker (otherwise
      // a permanently-broken Etsy endpoint would never stop trying).
      const TRANSIENT_FAILURE_BREAKER = 5;
      const shouldBreakOpen = failureCount >= TRANSIENT_FAILURE_BREAKER;

      await ref.update({
        connection_expired:    shouldBreakOpen,
        expiredAt:             shouldBreakOpen ? FieldValue.serverTimestamp() : null,
        lastRefreshError:      errMsg,
        lastRefreshAttemptAt:  FieldValue.serverTimestamp(),
        refreshFailureCount:   failureCount,
      });

      if (shouldBreakOpen) {
        console.warn(`[OAuth] Shop ${shopId} hit ${TRANSIENT_FAILURE_BREAKER} consecutive transient failures — marking expired`);
        throw new StoreTokenExpiredError(shopId);
      }

      throw refreshErr;
    }
  });
}