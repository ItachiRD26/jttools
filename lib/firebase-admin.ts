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
      projectId:    process.env.FIREBASE_PROJECT_ID!,
      clientEmail:  process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey:   process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
    // ⚠️ Required for Firebase Storage
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
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

export const Collections = {
  API_KEYS: "apiKeys",
  USERS:    "users",
  USAGE:    "usage",
  LOGS:     "logs",
} as const;