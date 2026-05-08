// ─────────────────────────────────────────────
//  JT Tools — Firebase Admin (singleton)
// ─────────────────────────────────────────────
import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

let app: App;
let db: Firestore;

export function getAdminApp(): App {
  if (app) return app;

  if (getApps().length > 0) {
    app = getApps()[0];
    return app;
  }

  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      // Replace newline escape sequences that env vars sometimes carry
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });

  return app;
}

export function getDb(): Firestore {
  if (!db) {
    getAdminApp();
    db = getFirestore();
  }
  return db;
}

// ─── Firestore Collection References ────────

export const Collections = {
  API_KEYS: "apiKeys",       // apiKey string → { userId, planId, active, createdAt }
  USERS: "users",            // userId → { email, planId, createdAt }
  USAGE: "usage",            // apiKey → subcollection daily/{YYYY-MM-DD} → { count }
  LOGS: "logs",              // optional audit log per request
} as const;