import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle,
  ClipboardList,
  Clock,
  Download,
  MessageSquare,
  Shield,
  Smartphone,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react'
import LeadCaptureForm from '../components/LeadCaptureForm'

const features = [
  {
    icon: ClipboardList,
    title: 'Job Tracking',
    description:
      'Every RO from intake to delivery. Real-time status, tech assignments, photo uploads.',
  },
  {
    icon: TrendingUp,
    title: 'Profitability Dashboard',
    description:
      'Revenue, costs, and margins per job. Stop guessing which work makes money.',
  },
  {
    icon: Users,
    title: 'Customer Updates',
    description:
      'Private tracking and payment links for every customer. No account setup required.',
  },
  {
    icon: Shield,
    title: 'Insurance Workflows',
    description:
      'Claim status, SIU holds, total loss flags. Built for shops that live in insurance.',
  },
  {
    icon: Clock,
    title: 'Turnaround Estimator',
    description: "Predicted delivery dates based on your shop's own history.",
  },
  {
    icon: MessageSquare,
    title: 'Auto SMS',
    description: 'Status-change texts fire automatically. Powered by Twilio.',
  },
]

export default function Landing() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleWaitlist(e) {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'landing-download' }),
      })
    } catch {
      // silent — still show confirmation even if endpoint isn't live yet
    }
    setSubmitted(true)
    setSubmitting(false)
  }


  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-100">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="px-6 py-5 md:px-16 lg:px-24">
        <nav className="flex items-center justify-between">
          <Link to="/" className="text-2xl font-extrabold tracking-wide text-indigo-400">
            REVV
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-slate-400 transition hover:text-white">
              Features
            </a>
            <a href="#pricing" className="text-sm text-slate-400 transition hover:text-white">
              Pricing
            </a>
            <a href="#download" className="text-sm text-slate-400 transition hover:text-white">
              Download
            </a>
            <a href="#contact" className="text-sm text-slate-400 transition hover:text-white">
              Contact
            </a>
            <Link to="/login" className="text-sm text-slate-400 transition hover:text-white">
              Sign In
            </Link>
            <Link
              to="/shop-register"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              Get Started <ArrowRight size={16} />
            </Link>
          </div>
          <div className="flex items-center gap-4 md:hidden">
            <a href="#download" className="text-sm text-slate-300 transition hover:text-white">
              Download
            </a>
            <Link to="/login" className="text-sm text-slate-300 transition hover:text-white">
              Sign In
            </Link>
            <Link
              to="/shop-register"
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
            >
              Get Started <ArrowRight size={14} />
            </Link>
          </div>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="px-6 pb-16 pt-8 md:px-16 md:pb-24 lg:px-24">
        <div className="mx-auto max-w-6xl rounded-3xl border border-[#2a2d3e] bg-gradient-to-b from-indigo-500/10 via-[#0f1117] to-[#0f1117] p-8 shadow-[0_0_140px_-50px_rgba(99,102,241,0.9)] md:p-14">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold leading-tight text-white md:text-6xl">
              Modern Shop Management. Built for Real Shops.
            </h1>
            <p className="mt-6 text-base text-slate-300 md:text-xl">
              Track every job from intake to pickup. Automate customer updates. Know your numbers.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to="/shop-register"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Start Free <ArrowRight size={16} />
              </Link>
              <a
                href="#download"
                className="inline-flex items-center gap-2 rounded-lg border border-[#2a2d3e] bg-[#1a1d2e] px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-indigo-500 hover:text-white"
              >
                <Download size={15} /> Get the App
              </a>
            </div>
          </div>

          <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-[#2a2d3e] bg-[#1a1d2e] p-5 text-left shadow-2xl">
            <p className="text-xs uppercase tracking-widest text-slate-400">Live RO Snapshot</p>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-semibold text-white">2019 Toyota Camry</p>
                <p className="text-sm text-slate-400">RO #4821 · Front bumper + paint blend</p>
              </div>
              <span className="inline-flex items-center gap-2 self-start rounded-full border border-indigo-500/30 bg-indigo-500/15 px-3 py-1 text-xs font-semibold text-indigo-300">
                <Wrench size={14} />
                In Progress
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ───────────────────────────────────────────────────── */}
      <section className="border-y border-[#2a2d3e] bg-[#1a1d2e] px-6 py-8 md:px-16 lg:px-24">
        <div className="mx-auto grid max-w-6xl gap-6 text-center md:grid-cols-3 md:text-left">
          <div>
            <p className="text-2xl font-semibold text-indigo-400">500+</p>
            <p className="mt-1 text-sm text-slate-300">Repair Orders Tracked</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-indigo-400">3</p>
            <p className="mt-1 text-sm text-slate-300">Active Shops</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-indigo-400">Collision · Mechanical · PDR</p>
            <p className="mt-1 text-sm text-slate-300">Built for mixed-service operations</p>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section id="features" className="px-6 py-16 md:px-16 md:py-24 lg:px-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold text-white md:text-4xl">Built for day-to-day shop reality</h2>
          <p className="mt-4 max-w-2xl text-slate-400">
            Keep production moving, customers informed, and profit visible from one control center.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] p-6 transition hover:border-indigo-500/60"
              >
                <div className="mb-4 inline-flex rounded-lg bg-indigo-500/15 p-2 text-indigo-400">
                  <Icon size={20} />
                </div>
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm text-slate-400">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="px-6 pb-20 md:px-16 lg:px-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold text-white md:text-4xl">Simple, honest pricing</h2>
          <p className="mt-4 text-slate-400">Try it free. No credit card required.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {/* Left: Trial card */}
            <article className="rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] p-8 flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-semibold text-white">14-Day Free Trial</h3>
                <p className="mt-2 text-3xl font-bold text-indigo-400">$0</p>
                <ul className="mt-6 space-y-3">
                  {[
                    'No credit card required',
                    'Full access during trial',
                    'Cancel anytime',
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-slate-300">
                      <CheckCircle size={16} className="shrink-0 text-indigo-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                to="/shop-register"
                className="mt-8 inline-flex w-full justify-center rounded-lg border border-indigo-500 px-4 py-3 text-sm font-semibold text-indigo-300 transition hover:bg-indigo-500/10"
              >
                Start Free Trial
              </Link>
            </article>

            {/* Right: Pro plan card */}
            <article className="relative rounded-xl border border-indigo-500 bg-[#1a1d2e] p-8 shadow-[0_0_80px_-45px_rgba(99,102,241,0.95)] flex flex-col justify-between">
              <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
                Pro Plan
              </span>
              <div>
                <h3 className="text-xl font-semibold text-white">Everything You Need</h3>
                <p className="mt-2 text-3xl font-bold text-indigo-400">$199<span className="text-lg font-normal text-slate-400">/mo</span></p>
                <ul className="mt-6 space-y-3">
                  {[
                    'Unlimited repair orders',
                    'SMS notifications to customers',
                    'Insurance estimate tools + OCR import',
                    'Job costing & profitability dashboard',
                    'Multi-user (owner, admin, tech roles)',
                    'Customer approval portal',
                    'Parts & inventory tracking',
                    'Scheduling & time clock',
                    'Dedicated support',
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-slate-300">
                      <CheckCircle size={16} className="shrink-0 text-indigo-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                to="/shop-register"
                className="mt-8 inline-flex w-full justify-center rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Start Free Trial
              </Link>
            </article>
          </div>
          <p className="mt-8 text-sm text-slate-400">
            Multi-location or enterprise?{' '}
            <a href="mailto:revvshopapp@gmail.com" className="text-indigo-400 hover:underline">
              Contact us at revvshopapp@gmail.com
            </a>
          </p>
        </div>
      </section>

      {/* ── Download / Early Access ──────────────────────────────────────── */}
      <section id="download" className="border-t border-[#2a2d3e] bg-[#1a1d2e] px-6 py-20 md:px-16 lg:px-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            {/* Left: copy */}
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300">
                <Smartphone size={13} /> Mobile App — Coming Soon
              </div>
              <h2 className="text-3xl font-bold text-white md:text-4xl">
                REVV in your pocket.
              </h2>
              <p className="mt-4 text-slate-400">
                A native mobile app for techs and managers is on the way — check RO status, upload photos, and approve work orders from the floor without touching a desktop.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'Photo uploads from the bay',
                  'Tech job assignments & clock-in',
                  'Real-time RO status updates',
                  'Customer approval on the go',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-slate-300">
                    <CheckCircle size={16} className="shrink-0 text-indigo-400" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-slate-500">
                In the meantime, REVV runs on any device in your browser at{' '}
                <a href="https://revvshop.app" className="text-indigo-400 hover:underline">
                  revvshop.app
                </a>
                .
              </p>
            </div>

            {/* Right: waitlist form */}
            <div className="rounded-2xl border border-[#2a2d3e] bg-[#0f1117] p-8">
              <div className="mb-1 inline-flex items-center gap-2 text-indigo-400">
                <Download size={18} />
                <span className="text-base font-semibold text-white">Get Early Access</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Be first to know when the mobile app drops. We'll also send you a free extended trial.
              </p>

              {submitted ? (
                <div className="mt-6 flex items-center gap-3 rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-4">
                  <CheckCircle size={20} className="shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">You're on the list.</p>
                    <p className="text-xs text-slate-400 mt-0.5">We'll reach out when the app is ready.</p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleWaitlist} className="mt-6 space-y-4">
                  <input
                    type="email"
                    required
                    placeholder="shop@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-[#2a2d3e] bg-[#1a1d2e] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
                  >
                    <Download size={15} />
                    {submitting ? 'Saving...' : 'Notify Me When It\'s Ready'}
                  </button>
                  <p className="text-center text-xs text-slate-500">No spam. Unsubscribe any time.</p>
                </form>
              )}

              <div className="mt-6 border-t border-[#2a2d3e] pt-5">
                <p className="text-xs text-slate-500 mb-3">Already using REVV on web?</p>
                <Link
                  to="/shop-register"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#2a2d3e] px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-indigo-500 hover:text-white"
                >
                  Start Free in Browser <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Contact / Lead Capture ────────────────────────────────────── */}
      <section id="contact" className="px-6 py-20 md:px-16 lg:px-24">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold text-white md:text-4xl text-center">
            Ready to modernize your shop?
          </h2>
          <p className="mt-4 text-center text-slate-400">
            Tell us about your operation and we'll show you how REVV fits in.
          </p>
          <div className="mt-10 rounded-2xl border border-[#2a2d3e] bg-[#0f1117] p-8">
            <LeadCaptureForm />
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#2a2d3e] px-6 py-8 md:px-16 lg:px-24">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
          <p>REVV © 2026 Zordon Technologies LLC</p>
          <div className="flex items-center gap-4 flex-wrap">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <a href="#download" className="transition hover:text-white">Download</a>
            <Link to="/terms-and-conditions" className="transition hover:text-white">Terms</Link>
            <Link to="/privacy" className="transition hover:text-white">Privacy</Link>
            <Link to="/login" className="transition hover:text-white">Sign In</Link>
            <Link to="/shop-register" className="transition hover:text-white">Get Started</Link>
            <a href="mailto:revvshopapp@gmail.com" className="transition hover:text-white">
              revvshopapp@gmail.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
