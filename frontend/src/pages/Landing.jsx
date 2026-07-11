import { useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  FileSearch,
  Play,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import LeadCaptureForm from '../components/LeadCaptureForm'
import RevvDemo from '../components/RevvDemo'
import { Logo } from '../components/ui'

const features = [
  {
    icon: ClipboardCheck,
    title: 'One live repair order',
    description: 'Intake, production, parts, approvals, proof, and payment stay attached to the same job.',
  },
  {
    icon: TrendingUp,
    title: 'Protect profit before delivery',
    description: 'Catch labor gaps, supplement opportunities, and margin risk while there is still time to act.',
  },
  {
    icon: FileSearch,
    title: 'Proof ready when insurers ask',
    description: 'Photos, inspections, diagnostics, approvals, and customer updates become one defensible record.',
  },
]

const planFeatures = [
  'Unlimited repair orders',
  'Estimate import and supplement review',
  'Customer SMS and email notifications',
  'Proof packets and approval portals',
  'Job costing and profitability signals',
  'Parts, schedule, and technician workflow',
]

export default function Landing() {
  const demoRef = useRef(null)

  function playDemo() {
    demoRef.current?.playWithSound()
    document.getElementById('product-tour')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="landing-page min-h-screen bg-void text-ink">
      <section className="landing-hero" aria-labelledby="landing-title">
        <header className="landing-nav">
          <nav className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6" aria-label="Main navigation">
            <Link to="/" className="landing-wordmark" aria-label="REVV home">
              <Logo variant="wordmark" alt="REVV wordmark" className="h-7 w-auto" />
            </Link>
            <div className="hidden items-center gap-7 lg:flex">
              <a href="#features" className="landing-nav-link">Platform</a>
              <a href="#pricing" className="landing-nav-link">Pricing</a>
              <a href="#contact" className="landing-nav-link">Talk to REVV</a>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link to="/login" className="revv-btn revv-btn-secondary border-white/20 bg-black/20 text-white hover:border-white/50 hover:text-white">
                Sign in
              </Link>
              <Link to="/shop-register" className="revv-btn revv-btn-primary min-h-10 px-4">
                Start free <ArrowRight size={15} />
              </Link>
            </div>
          </nav>
        </header>

        <div className="landing-hero-content">
          <div className="max-w-xl">
            <p className="landing-kicker">
              <span className="landing-kicker-signal" aria-hidden="true" />
              The operating system for collision shops
            </p>
            <h1 id="landing-title" className="landing-title">
              Run every repair. Protect every dollar.
            </h1>
            <p className="landing-hero-copy">
              One live system for the repair, the customer, the proof, and the profit.
            </p>
            <button type="button" onClick={playDemo} className="landing-demo-cta mt-7">
              <Play size={16} fill="currentColor" />
              Watch the product tour <span aria-hidden="true">·</span> <span className="font-mono">0:30</span>
            </button>
          </div>
        </div>
      </section>

      <section id="product-tour" className="landing-demo-stage" aria-label="REVV product tour">
        <RevvDemo ref={demoRef} />
      </section>

      <main>
        <section className="border-b border-line bg-panel px-5 py-7 sm:px-8 lg:px-12">
          <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-3">
            <div className="landing-proof-stat">
              <p className="font-mono text-2xl font-semibold text-ink">One live RO</p>
              <p>The job stays connected from intake through delivery.</p>
            </div>
            <div className="landing-proof-stat">
              <p className="font-mono text-2xl font-semibold text-gold">Profit protected</p>
              <p>Money gaps surface while the repair is still open.</p>
            </div>
            <div className="landing-proof-stat">
              <p className="font-mono text-2xl font-semibold text-ink">Customers updated</p>
              <p>SMS, email, approvals, and proof move with the job.</p>
            </div>
          </div>
        </section>

        <section id="features" className="landing-section">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="landing-section-kicker">Built around the repair</p>
              <h2 className="landing-section-title">The floor moves. The system keeps up.</h2>
              <p className="landing-section-copy">
                REVV replaces disconnected notes, tabs, texts, and handoffs with one operational record your shop can trust.
              </p>
            </div>
            <div className="mt-12 grid gap-px overflow-hidden rounded-instrument border border-line bg-line md:grid-cols-3">
              {features.map(({ icon: Icon, title, description }, index) => (
                <article key={title} className="landing-feature bg-panel">
                  <div className="flex items-center justify-between">
                    <Icon size={21} className={index === 1 ? 'text-gold' : 'text-brand-lit'} />
                    <span className="font-mono text-[11px] text-faint">0{index + 1}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="landing-section bg-panel-2">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-3xl">
              <p className="landing-section-kicker">Simple pricing</p>
              <h2 className="landing-section-title">The full shop operating system.</h2>
              <p className="landing-section-copy">Fourteen days free. No credit card or setup fee.</p>
            </div>
            <article className="landing-price-card mt-10 border-brand">
              <div className="grid gap-8 md:grid-cols-[0.75fr_1.25fr] md:items-center">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-lit">REVV Pro</p>
                  <p className="mt-4 font-mono text-4xl font-semibold text-gold">$199<span className="text-base font-medium text-muted">/mo</span></p>
                  <p className="mt-3 text-sm text-muted">One shop. Your whole team. Every active RO.</p>
                  <Link to="/shop-register" className="revv-btn revv-btn-primary mt-7 min-h-11 w-full text-sm sm:w-auto">
                    Start free <ArrowRight size={15} />
                  </Link>
                </div>
                <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {planFeatures.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted">
                      <Check size={15} className="mt-0.5 shrink-0 text-good" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
            <p className="mt-6 text-sm text-muted">
              Multi-location or enterprise? <a href="mailto:revvshopapp@gmail.com" className="font-semibold text-brand hover:text-brand-lit">Talk to REVV.</a>
            </p>
          </div>
        </section>

        <section id="contact" className="landing-section border-t border-line bg-panel">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div>
              <p className="landing-section-kicker">See your shop in REVV</p>
              <h2 className="landing-section-title">Bring one real workflow. We will show you the difference.</h2>
              <p className="landing-section-copy">Tell us where your operation loses time or money today.</p>
              <div className="mt-7 flex items-center gap-3 text-sm text-muted"><UsersRound size={18} className="text-brand-lit" /> Built with working collision shops.</div>
            </div>
            <div className="landing-lead-form"><LeadCaptureForm /></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-void px-5 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="landing-footer-mark"><Logo variant="mark" alt="REVV mark" className="h-7 w-7" /></span>
            <p className="text-xs text-muted">REVV © 2026 Zordon Technologies LLC</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
            <a href="#features" className="hover:text-ink">Platform</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <Link to="/terms-and-conditions" className="hover:text-ink">Terms</Link>
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
            <Link to="/login" className="hover:text-ink">Sign in</Link>
            <a href="mailto:revvshopapp@gmail.com" className="hover:text-ink">revvshopapp@gmail.com</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
