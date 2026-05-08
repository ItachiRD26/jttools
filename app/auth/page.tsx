"use client";
// LOCATION: app/auth/page.tsx
// ROUTE: /auth

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { doc, setDoc, getFirestore, serverTimestamp } from "firebase/firestore";
import { app } from "@/lib/firebase-client";

const auth = getAuth(app);
const db   = getFirestore(app);

function AuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode]       = useState<"login" | "signup">("login");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        router.replace("/dashboard");
      } else {
        setChecking(false);
      }
    });
    return () => unsub();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", user.uid), {
          email, name, planId: "free", createdAt: serverTimestamp(),
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      const redirect = searchParams.get("redirect");
      const plan = searchParams.get("plan");
      if (redirect && plan) {
        router.push(`${redirect}?plan=${plan}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : "Error"));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setLoading(true);
    try {
      const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
      await setDoc(
        doc(db, "users", user.uid),
        { email: user.email, name: user.displayName, planId: "free", createdAt: serverTimestamp() },
        { merge: true }
      );
      const redirect = searchParams.get("redirect");
      const plan = searchParams.get("plan");
      if (redirect && plan) {
        router.push(`${redirect}?plan=${plan}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      setError(friendlyError(err instanceof Error ? err.message : "Error"));
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#7F77DD] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(#7F77DD 1px, transparent 1px), linear-gradient(90deg, #7F77DD 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-2xl font-semibold text-white tracking-tight">
            <img src="/logo.webp" alt="JeterDev Tools" className="h-16 w-auto" />
          </span>
          <p className="text-sm text-white/40 mt-1 font-mono">Etsy API Bridge</p>
        </div>

        <div className="bg-white/4 border border-white/8 rounded-2xl p-6 backdrop-blur-sm">
          {/* Tabs */}
          <div className="flex bg-white/4 rounded-lg p-1 mb-6">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 py-1.5 text-sm rounded-md transition-all font-medium ${
                  mode === m ? "bg-[#7F77DD] text-white" : "text-white/40 hover:text-white/60"
                }`}
              >
                {m === "login" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 bg-white/6 hover:bg-white/10 border border-white/8 rounded-xl py-2.5 text-sm text-white/80 hover:text-white transition-all mb-4 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-white/6" />
            <span className="text-xs text-white/30">or</span>
            <div className="flex-1 h-px bg-white/6" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <div>
                <label className="block text-xs text-white/40 mb-1.5 font-mono">Full name</label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe" required
                  className="w-full bg-white/4 border border-white/8 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#7F77DD]/50 transition-all"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-white/40 mb-1.5 font-mono">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" required
                className="w-full bg-white/4 border border-white/8 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#7F77DD]/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1.5 font-mono">Password</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" required minLength={6}
                className="w-full bg-white/4 border border-white/8 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#7F77DD]/50 transition-all"
              />
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full bg-[#7F77DD] hover:bg-[#6B62CC] text-white font-medium py-2.5 rounded-xl text-sm transition-all disabled:opacity-50"
            >
              {loading ? "Loading..." : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-white/25 mt-6">
          By continuing you agree to our{" "}
          <a href="/terms"   className="text-white/40 hover:text-white/60 underline">Terms</a>{" "}and{" "}
          <a href="/privacy" className="text-white/40 hover:text-white/60 underline">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}

function friendlyError(msg: string): string {
  if (msg.includes("user-not-found"))      return "No account found with this email.";
  if (msg.includes("wrong-password"))      return "Incorrect password.";
  if (msg.includes("invalid-credential"))  return "Invalid email or password.";
  if (msg.includes("email-already-in-use"))return "An account with this email already exists.";
  if (msg.includes("weak-password"))       return "Password must be at least 6 characters.";
  if (msg.includes("invalid-email"))       return "Please enter a valid email address.";
  if (msg.includes("popup-closed"))        return "Sign in cancelled.";
  if (msg.includes("popup-blocked"))       return "Popup blocked. Please allow popups for this site.";
  return "Something went wrong. Please try again.";
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#7F77DD] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <AuthContent />
    </Suspense>
  );
}