"use client";
// LOCATION: app/dashboard/page.tsx
// ROUTE: /dashboard

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuth, onAuthStateChanged, signOut, User } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { app } from "@/lib/firebase-client";

const auth = getAuth(app);
const db   = getFirestore(app);

interface UsageData {
  plan: string;
  dailyLimit: number;
  used: number;
  remaining: number;
  resetsAt: string;
  allowedEndpoints: string[];
}

interface UserData {
  email: string;
  name: string;
  planId: string;
  apiKey?: string;
  etsyConnected?: boolean;
  etsyShopId?: string;
  etsyShopName?: string;
}

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free:       { label: "Free",       color: "text-white/50"  },
  starter:    { label: "Starter",    color: "text-blue-400"  },
  pro:        { label: "Pro",        color: "text-[#7F77DD]" },
  enterprise: { label: "Enterprise", color: "text-amber-400" },
};

function DashboardContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser]               = useState<User | null>(null);
  const [userData, setUserData]       = useState<UserData | null>(null);
  const [usage, setUsage]             = useState<UsageData | null>(null);
  const [apiKey, setApiKey]           = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const [keyVisible, setKeyVisible]   = useState(false);
  const [loading, setLoading]         = useState(true);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [connectingEtsy, setConnectingEtsy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [capturingPayment, setCapturingPayment] = useState(false);
  const [paymentMsg, setPaymentMsg]   = useState("");

  const fetchUsage = useCallback(async (key: string) => {
    try {
      const res = await fetch("/api/usage", { headers: { "x-api-key": key } });
      if (res.ok) setUsage(await res.json());
    } catch {}
  }, []);

  const capturePaypalPayment = useCallback(async (orderId: string, currentUser: User) => {
    setCapturingPayment(true);
    setPaymentMsg("Confirming your PayPal payment...");
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPaymentMsg("✓ Payment confirmed. Your plan is now active.");
        setApiKey(data.apiKey);
        setKeyVisible(true);
        const snap = await getDoc(doc(db, "users", currentUser.uid));
        if (snap.exists()) setUserData(snap.data() as UserData);
        if (data.apiKey) await fetchUsage(data.apiKey);
      } else {
        setPaymentMsg("Payment could not be confirmed. Please contact support.");
      }
    } catch {
      setPaymentMsg("Network error. Please try refreshing the page.");
    } finally {
      setCapturingPayment(false);
      router.replace("/dashboard");
    }
  }, [fetchUsage, router]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/auth"); return; }
      setUser(u);

      const snap = await getDoc(doc(db, "users", u.uid));
      if (snap.exists()) {
        const data = snap.data() as UserData;
        setUserData(data);
        if (data.apiKey) {
          setApiKey(data.apiKey);
          await fetchUsage(data.apiKey);
        }
      }
      setLoading(false);

      // PayPal returns ?token=ORDER_ID&PayerID=... on approval
      const paypalOrderId = searchParams.get("token");
      const cancelled = searchParams.get("cancelled");
      if (paypalOrderId) {
        await capturePaypalPayment(paypalOrderId, u);
      }
      if (cancelled) {
        setPaymentMsg("Payment cancelled. You can try again anytime.");
        router.replace("/dashboard");
      }
      const etsyStatus = searchParams.get("etsy");
      if (etsyStatus === "connected") {
        setPaymentMsg("✓ Etsy shop connected successfully!");
        router.replace("/dashboard");
      }
      if (etsyStatus === "cancelled") {
        setPaymentMsg("Etsy connection cancelled.");
        router.replace("/dashboard");
      }
      if (etsyStatus === "error") {
        setPaymentMsg("Error connecting Etsy shop. Please try again.");
        router.replace("/dashboard");
      }
    });
    return () => unsub();
  }, [router, searchParams, fetchUsage, capturePaypalPayment]);


  async function connectEtsy() {
    if (!user) return;
    setConnectingEtsy(true);
    try {
      const token = await user.getIdToken();
      // Redirect to OAuth flow with token
      window.location.href = `/api/auth/etsy?token=${token}`;
    } catch {
      alert("Error connecting Etsy. Please try again.");
      setConnectingEtsy(false);
    }
  }

  async function disconnectEtsy() {
    if (!user) return;
    const confirmed = window.confirm("Disconnect your Etsy shop? Private endpoints will stop working.");
    if (!confirmed) return;
    try {
      const token = await user.getIdToken();
      await fetch("/api/auth/etsy/disconnect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setUserData((prev) => prev ? { ...prev, etsyConnected: false, etsyShopId: undefined, etsyShopName: undefined } : prev);
    } catch {
      alert("Error disconnecting. Please try again.");
    }
  }


  async function cancelPlan() {
    if (!user) return;
    const confirmed = window.confirm("Are you sure you want to cancel your plan? You will be downgraded to Free immediately.");
    if (!confirmed) return;
    setCancelling(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/user/cancel-plan", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPaymentMsg("Your plan has been cancelled. You are now on the Free plan.");
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) setUserData(snap.data() as UserData);
        if (apiKey) await fetchUsage(apiKey);
      }
    } catch {
      alert("Error cancelling plan. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  async function generateKey() {
    if (!user) return;
    setGeneratingKey(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/dashboard/generate-key", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const { apiKey: newKey } = await res.json();
      setApiKey(newKey);
      setKeyVisible(true);
      if (newKey) await fetchUsage(newKey);
    } catch {
      alert("Error generating key. Please try again.");
    } finally {
      setGeneratingKey(false);
    }
  }

  async function copyKey() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const usedPercent = usage ? Math.round((usage.used / usage.dailyLimit) * 100) : 0;
  const maskedKey   = apiKey ? apiKey.slice(0, 8) + "••••••••••••••••••••••••" + apiKey.slice(-4) : null;
  const planInfo    = PLAN_LABELS[userData?.planId ?? "free"];

  if (loading) {
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
        <a href="/" className="text-lg font-semibold"><img src="/logo.webp" alt="JeterDev Tools" className="h-16 w-auto" /></a>
        <div className="flex items-center gap-6">
          <a href="/docs"    className="text-sm text-white/50 hover:text-white transition-colors">Docs</a>
          <a href="/pricing" className="text-sm text-white/50 hover:text-white transition-colors">Pricing</a>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setProfileOpen(true)}
              className="w-7 h-7 rounded-full bg-[#7F77DD]/20 border border-[#7F77DD]/30 flex items-center justify-center text-xs font-medium text-[#7F77DD] hover:bg-[#7F77DD]/30 transition-colors"
            >
              {userData?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase()}
            </button>
            <button
              onClick={() => signOut(auth).then(() => router.push("/auth"))}
              className="text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <div className="relative max-w-3xl mx-auto px-6 py-12 space-y-4">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-white/40 mt-1">{userData?.email}</p>
        </div>

        {/* Payment status */}
        {(paymentMsg || capturingPayment) && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
            capturingPayment
              ? "bg-[#7F77DD]/10 border-[#7F77DD]/20 text-[#7F77DD]"
              : paymentMsg.startsWith("✓")
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}>
            {capturingPayment && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />}
            {paymentMsg}
          </div>
        )}

        {/* Plan */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Current plan</p>
              <p className={`text-xl font-semibold ${planInfo?.color}`}>{planInfo?.label ?? "Free"}</p>
            </div>
            <div className="flex items-center gap-2">
              <a href="/pricing" className="text-xs px-3 py-1.5 bg-[#7F77DD]/10 hover:bg-[#7F77DD]/20 border border-[#7F77DD]/20 text-[#7F77DD] rounded-lg transition-colors">
                Upgrade →
              </a>
              {userData?.planId !== "free" && (
                <button
                  onClick={cancelPlan}
                  disabled={cancelling}
                  className="text-xs px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg transition-colors disabled:opacity-50"
                >
                  {cancelling ? "Cancelling..." : "Cancel plan"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Usage */}
        {usage && (
          <div className="bg-white/3 border border-white/8 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Today&apos;s usage</p>
              <p className="text-xs text-white/30 font-mono">resets at midnight UTC</p>
            </div>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-3xl font-semibold font-mono">{usage.used.toLocaleString()}</span>
              <span className="text-sm text-white/30">/ {usage.dailyLimit.toLocaleString()} requests</span>
            </div>
            <div className="h-1.5 bg-white/6 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${usedPercent > 90 ? "bg-red-400" : usedPercent > 70 ? "bg-amber-400" : "bg-[#7F77DD]"}`}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-white/30">{usedPercent}% used</span>
              <span className="text-xs text-white/30">{usage.remaining.toLocaleString()} remaining</span>
            </div>
          </div>
        )}

        {/* API Key */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">API Key</p>
            {apiKey && (
              <button onClick={() => setKeyVisible((v) => !v)} className="text-xs text-white/30 hover:text-white/60 transition-colors">
                {keyVisible ? "Hide" : "Reveal"}
              </button>
            )}
          </div>

          {apiKey ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-black/30 border border-white/6 rounded-xl px-4 py-2.5 font-mono text-sm overflow-hidden">
                  <span className="text-white/70">{keyVisible ? apiKey : maskedKey}</span>
                </div>
                <button
                  onClick={copyKey}
                  className={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    copied
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : "bg-white/6 hover:bg-white/10 text-white/70 hover:text-white border-white/6"
                  }`}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <button
                onClick={generateKey}
                disabled={generatingKey}
                className="text-xs text-white/30 hover:text-white/50 transition-colors disabled:opacity-50"
              >
                {generatingKey ? "Generating..." : "↺ Regenerate key (revokes the current one)"}
              </button>

              <div className="flex items-start gap-2">
                <svg className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-xs text-white/30">Never expose your API key in client-side code or public repositories.</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-sm text-white/40 mb-4">No API key yet. Generate one to start using the API.</p>
              <button
                onClick={generateKey}
                disabled={generatingKey}
                className="px-5 py-2 bg-[#7F77DD] hover:bg-[#6B62CC] text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50"
              >
                {generatingKey ? "Generating..." : "Generate API key"}
              </button>
            </div>
          )}
        </div>


        {/* Etsy Connection */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Etsy Shop</p>
              {userData?.etsyConnected && userData.etsyShopName ? (
                <p className="text-sm font-medium text-emerald-400">✓ {userData.etsyShopName}</p>
              ) : (
                <p className="text-sm text-white/40">Not connected</p>
              )}
            </div>
            {userData?.etsyConnected ? (
              <button
                onClick={disconnectEtsy}
                className="text-xs px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={connectEtsy}
                disabled={connectingEtsy}
                className="text-xs px-3 py-1.5 bg-[#7F77DD]/10 hover:bg-[#7F77DD]/20 border border-[#7F77DD]/20 text-[#7F77DD] rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {connectingEtsy ? (
                  <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : null}
                Connect Etsy Shop
              </button>
            )}
          </div>
          {!userData?.etsyConnected && (
            <p className="text-xs text-white/30 leading-relaxed">
              Connect your Etsy shop to enable private endpoints — create listings, manage orders, upload images, and more.
            </p>
          )}
          {userData?.etsyConnected && userData.etsyShopId && (
            <p className="text-xs text-white/30 font-mono">Shop ID: {userData.etsyShopId}</p>
          )}
        </div>

        {/* Quick start */}
        {apiKey && (
          <div className="bg-white/3 border border-white/8 rounded-2xl p-5">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">Quick start</p>
            <div className="bg-black/40 border border-white/6 rounded-xl p-4 font-mono text-xs text-white/60 leading-relaxed overflow-x-auto">
              <span className="text-white/25"># Search listings</span><br />
              curl &quot;https://jeterdev.tools/api/v1/listings/search?query=art&quot; \<br />
              &nbsp;&nbsp;-H &quot;x-api-key: {keyVisible ? apiKey : maskedKey}&quot;
            </div>
            <div className="flex gap-4 mt-3">
              <a href="/docs"    className="text-xs text-[#7F77DD] hover:text-[#9F97FF] transition-colors">View full docs →</a>
              <a href="/pricing" className="text-xs text-white/30 hover:text-white/60 transition-colors">Upgrade plan →</a>
            </div>
          </div>
        )}

        {/* Allowed endpoints */}
        {usage?.allowedEndpoints && (
          <div className="bg-white/3 border border-white/8 rounded-2xl p-5">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">Endpoints available on your plan</p>
            <div className="flex flex-wrap gap-2">
              {usage.allowedEndpoints.map((ep) => (
                <span key={ep} className="px-2.5 py-1 bg-[#7F77DD]/10 border border-[#7F77DD]/20 rounded-lg text-xs font-mono text-[#7F77DD]">
                  {ep}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Profile Modal */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setProfileOpen(false)}
          />

          {/* Modal */}
          <div className="relative w-full max-w-md bg-[#111118] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/6">
              <h2 className="text-base font-semibold text-white">Account</h2>
              <button
                onClick={() => setProfileOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/6 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* User info */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[#7F77DD]/20 border border-[#7F77DD]/30 flex items-center justify-center text-lg font-semibold text-[#7F77DD]">
                  {userData?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{userData?.name ?? "User"}</p>
                  <p className="text-xs text-white/40 font-mono">{userData?.email}</p>
                </div>
              </div>

              <div className="h-px bg-white/6" />

              {/* Subscription */}
              <div>
                <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">Subscription</p>
                <div className="bg-white/3 border border-white/6 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/50">Current plan</span>
                    <span className={`text-sm font-semibold ${PLAN_LABELS[userData?.planId ?? "free"]?.color}`}>
                      {PLAN_LABELS[userData?.planId ?? "free"]?.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/50">Daily limit</span>
                    <span className="text-sm font-mono text-white/70">
                      {usage?.dailyLimit?.toLocaleString() ?? "100"} req/day
                    </span>
                  </div>
                  {userData?.planId !== "free" && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/50">Status</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Active
                      </span>
                    </div>
                  )}
                  {usage && (
                    <div>
                      <div className="flex justify-between text-xs text-white/30 mb-1.5">
                        <span>Today&apos;s usage</span>
                        <span>{usage.used} / {usage.dailyLimit}</span>
                      </div>
                      <div className="h-1 bg-white/6 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#7F77DD] rounded-full"
                          style={{ width: `${Math.min(100, (usage.used / usage.dailyLimit) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-3">
                  <a
                    href="/pricing"
                    onClick={() => setProfileOpen(false)}
                    className="flex-1 text-center py-2 text-xs font-medium bg-[#7F77DD]/10 hover:bg-[#7F77DD]/20 border border-[#7F77DD]/20 text-[#7F77DD] rounded-lg transition-colors"
                  >
                    {userData?.planId === "free" ? "Upgrade plan" : "Change plan"}
                  </a>
                  {userData?.planId !== "free" && (
                    <button
                      onClick={() => { setProfileOpen(false); cancelPlan(); }}
                      className="flex-1 py-2 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg transition-colors"
                    >
                      Cancel plan
                    </button>
                  )}
                </div>
              </div>

              <div className="h-px bg-white/6" />

              {/* Etsy connection */}
              <div>
                <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3">Etsy Shop</p>
                {userData?.etsyConnected ? (
                  <div className="flex items-center justify-between bg-white/3 border border-white/6 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-sm text-white/70">{userData.etsyShopName ?? "Connected"}</span>
                    </div>
                    <button
                      onClick={() => { setProfileOpen(false); disconnectEtsy(); }}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setProfileOpen(false); connectEtsy(); }}
                    className="w-full py-2 text-xs font-medium bg-white/4 hover:bg-white/8 border border-white/8 text-white/60 hover:text-white rounded-lg transition-colors"
                  >
                    Connect Etsy Shop
                  </button>
                )}
              </div>

              <div className="h-px bg-white/6" />

              {/* Sign out */}
              <button
                onClick={() => { setProfileOpen(false); signOut(auth).then(() => router.push("/auth")); }}
                className="w-full py-2.5 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/5 border border-red-500/10 rounded-xl transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#7F77DD] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}