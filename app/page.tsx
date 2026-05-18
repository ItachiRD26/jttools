// LOCATION: app/page.tsx
// ROUTE: /
import Link from "next/link";

const STEPS = [
  {
    number: "01",
    title: "Create your account",
    description: "Sign up for free with email or Google. No credit card required to get started.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    number: "02",
    title: "Pick a plan",
    description: "Starting at $0/mo. Pay with PayPal. Your plan controls daily request limits and endpoint access.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
      </svg>
    ),
  },
  {
    number: "03",
    title: "Start making requests",
    description: "Generate your API key from the dashboard and include it in the x-api-key header of each request.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
];

const ENDPOINT_GROUPS = [
  { name: "Listings",   count: 11, color: "text-[#7F77DD]",   bg: "bg-[#7F77DD]/10  border-[#7F77DD]/20"  },
  { name: "Shops",      count: 8,  color: "text-blue-400",    bg: "bg-blue-500/10   border-blue-500/20"   },
  { name: "Shipping",   count: 7,  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20"},
  { name: "Search",     count: 1,  color: "text-amber-400",   bg: "bg-amber-500/10  border-amber-500/20"  },
  { name: "Categories", count: 4,  color: "text-pink-400",    bg: "bg-pink-500/10   border-pink-500/20"   },
  { name: "Images",     count: 3,  color: "text-cyan-400",    bg: "bg-cyan-500/10   border-cyan-500/20"   },
  { name: "Users",      count: 3,  color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/20" },
  { name: "Policies",   count: 1,  color: "text-red-400",     bg: "bg-red-500/10    border-red-500/20"    },
];

const PLANS = [
  { name: "Free",    price: "$0",  period: "",    daily: "500 req/day",    cta: "Get started free", href: "/auth",    featured: false },
  { name: "Pro",     price: "$50", period: "/mo", daily: "30,000 req/day", cta: "Get Pro",          href: "/pricing", featured: true  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden">
      <div className="fixed inset-0 bg-grid pointer-events-none" />
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, rgba(127,119,221,0.12) 0%, transparent 70%)" }}
      />

      {/* Nav */}
      <nav className="relative flex items-center justify-between px-6 md:px-12 py-5 border-b border-white/8">
        <span className="text-lg font-semibold"><img src="/logo.webp" alt="JeterDev Tools" className="h-16 w-auto" /></span>
        <div className="flex items-center gap-2 md:gap-6">
          <Link href="/docs"    className="text-sm text-white/50 hover:text-white transition-colors hidden md:block">Docs</Link>
          <Link href="/pricing" className="text-sm text-white/50 hover:text-white transition-colors hidden md:block">Pricing</Link>
          <Link href="/auth"    className="text-sm text-white/50 hover:text-white transition-colors">Sign in</Link>
          <Link href="/auth"    className="text-sm px-4 py-2 bg-[#7F77DD] hover:bg-[#6B62CC] text-white rounded-xl transition-colors font-medium">
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#7F77DD]/10 border border-[#7F77DD]/20 rounded-full text-xs text-[#7F77DD] font-mono mb-8 animate-fade-up">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7F77DD] animate-pulse" />
          Etsy API v3 Bridge · Now available
        </div>

        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-tight mb-6 animate-fade-up delay-100">
          The Etsy API,{" "}
          <span className="text-[#7F77DD]">without the hassle</span>
        </h1>

        <p className="text-base md:text-lg text-white/50 max-w-2xl mx-auto leading-relaxed mb-10 animate-fade-up delay-200">
          Access 38+ Etsy endpoints with a single API key. We handle authentication,
          rate limiting, and errors — you just consume the JSON.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-up delay-300">
          <Link href="/auth" className="px-6 py-3 bg-[#7F77DD] hover:bg-[#6B62CC] text-white font-medium rounded-xl transition-all text-sm w-full sm:w-auto">
            Start for free →
          </Link>
          <Link href="/docs" className="px-6 py-3 bg-white/5 hover:bg-white/8 border border-white/8 text-white/70 hover:text-white font-medium rounded-xl transition-all text-sm w-full sm:w-auto">
            View documentation
          </Link>
        </div>

        {/* Code preview */}
        <div className="mt-14 text-left bg-black/50 border border-white/8 rounded-2xl overflow-hidden animate-fade-up delay-400">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/6 bg-white/2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
            <span className="text-xs text-white/20 font-mono ml-2">terminal</span>
          </div>
          <div className="p-5 font-mono text-sm leading-7 overflow-x-auto">
            <div><span className="text-white/30"># Search active listings</span></div>
            <div>
              <span className="text-emerald-400">curl</span>{" "}
              <span className="text-amber-300">&quot;https://jeterdev.tools/api/v1/listings/search?query=handmade+art&amp;limit=5&quot;</span>{" "}
              <span className="text-white/50">\</span>
            </div>
            <div>&nbsp;&nbsp;<span className="text-white/50">-H</span>{" "}<span className="text-amber-300">&quot;x-api-key: jt_a3f4b5c6d7e8...&quot;</span></div>
            <div className="mt-4 text-white/30"># Response:</div>
            <div><span className="text-white/50">{"{"}</span></div>
            <div>&nbsp;&nbsp;<span className="text-[#7F77DD]">&quot;count&quot;</span><span className="text-white/50">:</span> <span className="text-emerald-400">5</span><span className="text-white/50">,</span></div>
            <div>&nbsp;&nbsp;<span className="text-[#7F77DD]">&quot;results&quot;</span><span className="text-white/50">: [{"{"} </span><span className="text-white/40">listing_id, title, price, ...</span><span className="text-white/50"> {"}"}]</span></div>
            <div><span className="text-white/50">{"}"}</span></div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="relative border-y border-white/6 py-8">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[["38+","Available endpoints"],["3","Access plans"],["v3","Etsy API version"],["<50ms","Avg. latency"]].map(([val, label]) => (
            <div key={label}>
              <div className="text-2xl font-semibold text-white font-mono">{val}</div>
              <div className="text-xs text-white/30 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="relative max-w-4xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <p className="text-xs font-mono text-[#7F77DD] tracking-widest uppercase mb-3">How it works</p>
          <h2 className="text-3xl font-semibold tracking-tight">Up and running in three steps</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STEPS.map((step) => (
            <div key={step.number} className="bg-white/2 border border-white/6 rounded-2xl p-6 hover:bg-white/4 transition-all">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[#7F77DD]/10 border border-[#7F77DD]/20 flex items-center justify-center text-[#7F77DD]">
                  {step.icon}
                </div>
                <span className="text-xs font-mono text-white/20">{step.number}</span>
              </div>
              <h3 className="text-base font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Endpoints */}
      <section className="relative border-t border-white/6 py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-mono text-[#7F77DD] tracking-widest uppercase mb-3">Endpoint coverage</p>
            <h2 className="text-3xl font-semibold tracking-tight mb-3">Everything you need from Etsy</h2>
            <p className="text-white/40 text-sm max-w-lg mx-auto">
              38 endpoints organized into 8 groups — search, listings, shops, shipping, images, and more.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {ENDPOINT_GROUPS.map((g) => (
              <Link key={g.name} href="/docs" className={`flex items-center justify-between px-4 py-3 bg-white/2 border rounded-xl hover:bg-white/4 transition-all ${g.bg}`}>
                <span className={`text-sm font-medium ${g.color}`}>{g.name}</span>
                <span className={`text-xs font-mono ${g.color} opacity-60`}>{g.count}</span>
              </Link>
            ))}
          </div>
          <div className="text-center">
            <Link href="/docs" className="text-sm text-[#7F77DD] hover:text-[#9F97FF] transition-colors">
              View full documentation →
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative border-t border-white/6 py-24">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-mono text-[#7F77DD] tracking-widest uppercase mb-3">Pricing</p>
            <h2 className="text-3xl font-semibold tracking-tight mb-3">Simple and transparent</h2>
            <p className="text-white/40 text-sm">Pay with PayPal. Daily reset at midnight UTC. No overage charges.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PLANS.map((plan) => (
              <div key={plan.name} className={`flex flex-col bg-white/2 rounded-2xl p-5 hover:bg-white/4 transition-all ${plan.featured ? "border-2 border-[#7F77DD] relative" : "border border-white/8"}`}>
                {plan.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-[#7F77DD] rounded-full text-[11px] font-medium whitespace-nowrap">
                    Most popular
                  </div>
                )}
                <div className="mb-4">
                  <div className="text-xs font-mono text-white/40 uppercase tracking-widest mb-1">{plan.name}</div>
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-3xl font-semibold">{plan.price}</span>
                    <span className="text-sm text-white/30">{plan.period}</span>
                  </div>
                  <div className="text-xs font-mono text-[#7F77DD] mt-0.5">{plan.daily}</div>
                </div>
                <div className="flex-1" />
                <Link href={plan.href} className={`block text-center py-2 rounded-xl text-sm font-medium transition-all mt-4 ${plan.featured ? "bg-[#7F77DD] hover:bg-[#6B62CC] text-white" : "bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"}`}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative border-t border-white/6 py-24">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight mb-4">Start in under 5 minutes</h2>
          <p className="text-white/40 text-sm mb-8">
            Create a free account, generate your API key, and start querying Etsy listings today.
          </p>
          <Link href="/auth" className="inline-block px-8 py-3 bg-[#7F77DD] hover:bg-[#6B62CC] text-white font-medium rounded-xl transition-all text-sm">
            Create free account →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-white/6 py-10">
        <div className="max-w-4xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="text-base font-semibold"><img src="/logo.webp" alt="JeterDev Tools" className="h-16 w-auto" /></span>
          <div className="flex items-center gap-6 text-sm text-white/30">
            <Link href="/docs"      className="hover:text-white/60 transition-colors">Docs</Link>
            <Link href="/pricing"   className="hover:text-white/60 transition-colors">Pricing</Link>
            <Link href="/dashboard" className="hover:text-white/60 transition-colors">Dashboard</Link>
            <Link href="/auth"      className="hover:text-white/60 transition-colors">Sign in</Link>
          </div>
          <p className="text-xs text-white/20 font-mono">© {new Date().getFullYear()} JT Tools</p>
        </div>
      </footer>
    </div>
  );
}