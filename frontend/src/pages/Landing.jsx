import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ClipboardList,
  Clock,
  MessageSquare,
  Shield,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react'

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
    title: 'Customer Portal',
    description:
      'Private tracking links for every customer. They check status - you stop answering phones.',
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
  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-100">
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
              <Link
                to="/login"
                className="rounded-lg border border-[#2a2d3e] bg-[#1a1d2e] px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-indigo-500 hover:text-white"
              >
                Sign In
              </Link>
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

      <section id="pricing" className="px-6 pb-20 md:px-16 lg:px-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold text-white md:text-4xl">Pricing that scales with your shop</h2>
          <p className="mt-4 text-slate-400">Start free, upgrade when your volume grows.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <article className="rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] p-6">
              <h3 className="text-xl font-semibold text-white">Starter</h3>
              <p className="mt-2 text-3xl font-bold text-indigo-400">Free</p>
              <p className="mt-4 text-sm text-slate-400">
                Up to 25 ROs/month, 1 location, customer portal, basic reports
              </p>
              <Link
                to="/shop-register"
                className="mt-6 inline-flex w-full justify-center rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Get Started Free
              </Link>
            </article>

            <article className="relative rounded-xl border border-indigo-500 bg-[#1a1d2e] p-6 shadow-[0_0_80px_-45px_rgba(99,102,241,0.95)]">
              <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
                Most Popular
              </span>
              <h3 className="text-xl font-semibold text-white">Pro</h3>
              <p className="mt-2 text-3xl font-bold text-indigo-400">$79/mo</p>
              <p className="mt-4 text-sm text-slate-400">
                Unlimited ROs, SMS notifications, job costing, insurance tools, turnaround
                estimator, priority support
              </p>
              <Link
                to="/shop-register"
                className="mt-6 inline-flex w-full justify-center rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Start Free Trial
              </Link>
            </article>

            <article className="rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] p-6">
              <h3 className="text-xl font-semibold text-white">Agency</h3>
              <p className="mt-2 text-3xl font-bold text-indigo-400">$199/mo</p>
              <p className="mt-4 text-sm text-slate-400">
                Everything in Pro + multiple locations, white-label portal, API access, dedicated
                onboarding
              </p>
              <a
                href="mailto:revvshopapp@gmail.com"
                className="mt-6 inline-flex w-full justify-center rounded-lg border border-indigo-500 px-4 py-3 text-sm font-semibold text-indigo-300 transition hover:bg-indigo-500/10"
              >
                Contact Us
              </a>
            </article>
          </div>
          <p className="mt-6 text-sm text-slate-400">
            Stripe payments coming soon. Email revvshopapp@gmail.com to get started today.
          </p>
        </div>
      </section>

      <footer className="border-t border-[#2a2d3e] px-6 py-8 md:px-16 lg:px-24">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
          <p>REVV © 2026 Zordon Technologies LLC</p>
          <div className="flex items-center gap-4">
            <Link to="/login" className="transition hover:text-white">
              Sign In
            </Link>
            <Link to="/shop-register" className="transition hover:text-white">
              Get Started
            </Link>
            <a href="mailto:revvshopapp@gmail.com" className="transition hover:text-white">
              revvshopapp@gmail.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
