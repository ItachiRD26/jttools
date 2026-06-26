"use client";
// LOCATION: app/pricing/page.tsx
// ROUTE: /pricing

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { app } from "@/lib/firebase-client";

const auth = getAuth(app);

const PLANS = [
  {
    id:          "free",
    name:        "Free",
    price:       0,
    daily:       "500 calls / day",
    description: "1 req/sec · Public endpoints",
    border:      "border-white/8",
    badge:       null,
    features: [
      "500 API calls per day",
      "Public listings & shop data",
      "Search, categories, images",
      "No credit card required",
    ],
  },
  {
    id:          "pro",
    name:        "Pro",
    price:       50,
    daily:       "30,000 calls / day",
    description: "10 req/sec · All endpoints",
    border:      "border-[#7F77DD]",
    badge:       "Most Popular",
    features: [
      "30,000 API calls per day",
      "Full endpoint access",
      "POST /listings/create (multi-shop)",
      "Uploads up to 100MB",
      "OAuth multi-store management",
      "Priority support",
    ],
  },
];

const AIRTM_LINK = process.env.NEXT_PUBLIC_AIRTM_LINK || "https://airtm.me/peter5uoojfnx";

function PricingContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser]               = useState<User | null>(null);
  const [checking, setChecking]       = useState(true);
  const [error, setError]             = useState("");
  const [paymentPlan, setPaymentPlan] = useState<typeof PLANS[0] | null>(null);
  const [proofFile, setProofFile]     = useState<File | null>(null);
  const [uploading, setUploading]     = useState(false);
  const [success, setSuccess]         = useState(false);

  const pendingPlan = searchParams.get("plan");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setChecking(false);

      if (u && pendingPlan) {
        const plan = PLANS.find((p) => p.id === pendingPlan);
        if (plan && plan.price > 0) {
          setPaymentPlan(plan);
        } else if (plan?.price === 0) {
          router.replace("/dashboard");
        }
      }
    });
    return () => unsub();
  }, [router, pendingPlan]);

  async function submitProof() {
    if (!user || !paymentPlan || !proofFile) return;
    setUploading(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const body = new FormData();
      body.append("proof", proofFile);
      body.append("planId", paymentPlan.id);

      const res = await fetch("/api/billing/airtm-payment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to verify payment");
      }
      setSuccess(true);
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploading(false);
    }
  }

  function handleSelect(plan: typeof PLANS[0]) {
    setError("");

    if (!user) {
      router.push(`/auth?redirect=/pricing&plan=${plan.id}`);
      return;
    }

    if (plan.price === 0) {
      router.push("/dashboard");
      return;
    }

    setPaymentPlan(plan);
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#7F77DD] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div
        className="fixed inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "linear-gradient(#7F77DD 1px, transparent 1px), linear-gradient(90deg, #7F77DD 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Nav */}
      <nav className="relative flex items-center justify-between px-8 py-4 border-b border-white/6">
        <a href="/" className="flex items-center">
          <img src="/logo.webp" alt="JeterDev Tools" className="h-16 w-auto" />
        </a>
        <div className="flex items-center gap-5">
          <a href="/docs" className="text-sm text-white/50 hover:text-white transition-colors">Docs</a>
          {user ? (
            <a href="/dashboard" className="text-sm px-4 py-1.5 bg-[#7F77DD] hover:bg-[#6B62CC] text-white rounded-lg transition-colors font-medium">
              Dashboard
            </a>
          ) : (
            <a href="/auth" className="text-sm px-4 py-1.5 bg-[#7F77DD] hover:bg-[#6B62CC] text-white rounded-lg transition-colors font-medium">
              Sign in
            </a>
          )}
        </div>
      </nav>

      <div className="relative max-w-4xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <p className="text-xs font-mono text-[#7F77DD] tracking-widest uppercase mb-4">Pricing</p>
          <h1 className="text-4xl font-semibold tracking-tight mb-4">Simple, transparent pricing</h1>
          <p className="text-white/40 text-base max-w-md mx-auto">
            Pay via AirTM. All plans reset daily at midnight UTC. No overage charges.
          </p>
        </div>

        {!user && (
          <div className="max-w-3xl mx-auto mb-8 flex items-center gap-3 px-4 py-3 bg-[#7F77DD]/10 border border-[#7F77DD]/20 rounded-xl text-sm text-[#7F77DD]">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>You&apos;ll be asked to sign in before completing your purchase.</span>
          </div>
        )}

        {error && (
          <div className="max-w-md mx-auto mb-8 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-center">
            {error}
          </div>
        )}

        {/* Plans */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-2xl mx-auto">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex flex-col bg-white/3 border rounded-2xl p-6 hover:bg-white/5 transition-all ${plan.border} ${"badge" in plan && plan.badge ? "border-2" : "border"}`}
            >
              {"badge" in plan && plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-[#7F77DD] rounded-full text-[11px] font-medium text-white whitespace-nowrap">
                  {plan.badge}
                </div>
              )}

              <div className="mb-5">
                <div className="text-xs font-mono text-white/40 uppercase tracking-widest mb-1">{plan.name}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-semibold">${plan.price}</span>
                  {plan.price > 0 && <span className="text-sm text-white/30">/mo</span>}
                </div>
                <div className="text-sm font-mono text-[#7F77DD] mt-1">{plan.daily}</div>
                <div className="text-xs text-white/30 mt-0.5">{plan.description}</div>
              </div>

              <ul className="flex-1 space-y-2.5 mb-6">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <svg className={`w-4 h-4 mt-0.5 shrink-0 ${i === 0 ? "text-[#7F77DD]" : "text-white/20"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className={i === 0 ? "text-white font-medium" : "text-white/50"}>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSelect(plan)}
                className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${"badge" in plan && plan.badge ? "bg-[#7F77DD] hover:bg-[#6B62CC] text-white" : "bg-white/6 hover:bg-white/10 text-white/80 hover:text-white"}`}
              >
                {plan.price === 0
                  ? "Get started free"
                  : user ? "Pay with AirTM" : "Select plan"}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-white/25 mt-10 font-mono">
          All plans include: CORS support · JSON responses · x-api-key auth · daily reset at 00:00 UTC
        </p>

        <div className="max-w-3xl mx-auto mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            ["When do limits reset?", "Every day at midnight UTC. Your counter goes back to zero automatically."],
            ["Can I cancel anytime?", "Yes. Cancel from your dashboard and you'll be downgraded to Free immediately."],
            ["What if I need more?", "Pro covers 30,000 req/day. Need a custom limit? Contact us."],
          ].map(([q, a]) => (
            <div key={q}>
              <p className="text-sm font-medium text-white/70 mb-1">{q}</p>
              <p className="text-xs text-white/35 leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* AirTM payment modal */}
      {paymentPlan && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-[#111118] border border-white/10 rounded-2xl p-6">
            {success ? (
              <div className="text-center py-6">
                <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-green-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-white font-medium">Payment received — Pro plan activated!</p>
                <p className="text-white/40 text-sm mt-1">Redirecting to your dashboard...</p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-white mb-1">Pay with AirTM</h2>
                <p className="text-sm text-white/40 mb-4">
                  Send <strong className="text-white">${paymentPlan.price}.00 USD</strong> via the AirTM link below, then upload a screenshot of the payment confirmation.
                </p>

                <a
                  href={AIRTM_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center py-2.5 mb-4 rounded-xl text-sm font-medium bg-[#7F77DD] hover:bg-[#6B62CC] text-white transition-colors"
                >
                  Open AirTM payment link ↗
                </a>

                <label className="block text-xs text-white/40 mb-1.5 font-mono">Payment proof (screenshot)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-white/70 bg-white/4 border border-white/8 rounded-xl px-3.5 py-2.5 mb-4 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-[#7F77DD] file:text-white file:text-xs"
                />

                {error && (
                  <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
                    {error}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => { setPaymentPlan(null); setProofFile(null); setError(""); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/6 hover:bg-white/10 text-white/70"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitProof}
                    disabled={!proofFile || uploading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[#7F77DD] hover:bg-[#6B62CC] text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {uploading
                      ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : "I've paid — submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { Suspense } from "react";

export default function PricingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#7F77DD] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <PricingContent />
    </Suspense>
  );
}