import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  CheckCircle,
  ClipboardCheck,
  Clock3,
  Download,
  FileSearch,
  MessageSquareText,
  Play,
  ShieldCheck,
  Smartphone,
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
    description: 'Intake, production, parts, proof, approvals, and payment stay attached to the same job.',
  },
  {
    icon: TrendingUp,
    title: 'Profit signals before close',
    description: 'See labor gaps, supplement opportunities, job cost, and margin while there is still time to act.',
  },
  {
    icon: MessageSquareText,
    title: 'Customer communication that runs',
    description: 'Automatic SMS and email updates keep customers informed without tying up the front desk.',
  },
  {
    icon: FileSearch,
    title: 'Insurer-ready proof',
    description: 'Photos, inspections, diagnostics, approvals, and estimate records become one defensible packet.',
  },
  {
    icon: Clock3,
    title: 'Production pressure in view',
    description: 'Capacity, due dates, blockers, and technician work stay visible across the whole floor.',
  },
  {
    icon: ShieldCheck,
    title: 'Collision workflows built in',
    description: 'Total loss, SIU, ADAS, supplements, storage, and payment gates work like collision shops do.',
  },
]

const planFeatures = [
  'Unlimited repair orders',
  'Estimate import and supplement review',
  'Customer SMS and email notifications',
  'Proof packets and approval portals',
  'Job costing and profitability signals',
  'Owner, admin, estimator, and technician roles',
  'Parts, inventory, schedule, and time clock',
  'Direct onboarding support',
]

export default function Landing() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const demoRef = useRef(null)

  async function handleWaitlist(event) {
    event.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'landing-download' }),
      })
    } catch {
      // The local confirmation remains useful if the waitlist service is temporarily unavailable.
    }
    setSubmitted(true)
    setSubmitting(false)
  }

  function playDemo() {
    demoRef.current?.playWithSound()
    document.getElementById('revv-demo')?.focus?.({ preventScroll: true })
  }

  return (
    <div className="landing-page min-h-screen bg-void text-ink">
      <section className="landing-hero" aria-labelledby="landing-title">
        <RevvDemo ref={demoRef} className="absolute inset-0" />
        <div className="landing-hero-shade" aria-hidden="true" />

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
          <div className="max-w-3xl">
            <p className="landing-kicker">
              <span className="landing-kicker-signal" aria-hidden="true" />
              The operating system for collision shops
            </p>
            <h1 id="landing-title" className="landing-title">
              Collision shop operations, in one live system.
            </h1>
            <p className="landing-hero-copy">
              REVV connects every repair, handoff, customer update, proof file, and dollar so your team can move faster without losing control.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/shop-register" className="revv-btn revv-btn-primary min-h-12 px-5 text-sm">
                Start free <ArrowRight size={17} />
              </Link>
              <button type="button" onClick={playDemo} className="landing-demo-cta">
                <Play size={16} fill="currentColor" />
                Watch REVV run <span aria-hidden="true">·</span> <span className="font-mono">0:30</span>
              </button>
            </div>
            <p className="landing-trust-line mt-5 text-xs font-medium uppercase tracking-[0.12em] text-white/60">
              First photo <span className="mx-2 text-brand-lit">→</span> final payment <span className="mx-2 text-brand-lit">→</span> one source of truth
            </p>
          </div>
        </div>

        <div className="landing-value-rail" aria-label="REVV operating coverage">
          <div><span>01</span><strong>Intake</strong></div>
          <div><span>02</span><strong>Production</strong></div>
          <div><span>03</span><strong>Proof</strong></div>
          <div><span>04</span><strong>Profit</strong></div>
        </div>
      </section>

      <main>
        <section className="border-b border-line bg-panel px-5 py-7 sm:px-8 lg:px-12">
          <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-3">
            <div className="landing-proof-stat">
              <p className="font-mono text-2xl font-semibold text-ink">8 stages</p>
              <p>One production line from intake through delivery.</p>
            </div>
            <div className="landing-proof-stat">
              <p className="font-mono text-2xl font-semibold text-gold">Profit visible</p>
              <p>Money signals appear while the repair is still active.</p>
            </div>
            <div className="landing-proof-stat">
              <p className="font-mono text-2xl font-semibold text-ink">Every screen</p>
              <p>Owner, estimator, technician, and customer stay in sync.</p>
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
            <div className="mt-12 grid gap-px overflow-hidden rounded-instrument border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
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

        <section className="landing-operations-band">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="landing-section-kicker text-brand-lit">One accountable workflow</p>
              <h2 className="landing-section-title text-white">No more wondering what changed while you were away.</h2>
              <p className="mt-5 max-w-xl text-sm leading-7 text-white/65">
                Owner activity, customer communication, insurer decisions, production movement, and money events stay attached to the RO and visible to the people who need them.
              </p>
            </div>
            <ol className="landing-stage-line" aria-label="REVV repair stages">
              {['Intake', 'Estimate', 'Approval', 'Parts', 'Repair', 'Paint', 'QC', 'Delivery'].map((stage, index) => (
                <li key={stage}>
                  <span className={index === 7 ? 'is-redline' : ''}>{index + 1}</span>
                  <strong>{stage}</strong>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="pricing" className="landing-section bg-panel-2">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="landing-section-kicker">Simple pricing</p>
              <h2 className="landing-section-title">Start with the full operating system.</h2>
              <p className="landing-section-copy">No stripped-down trial and no credit card required.</p>
            </div>
            <div className="mt-10 grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
              <article className="landing-price-card">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">14-day trial</p>
                <p className="mt-4 font-mono text-4xl font-semibold text-ink">$0</p>
                <p className="mt-3 text-sm text-muted">Full product access. No credit card. No setup fee.</p>
                <Link to="/shop-register" className="revv-btn revv-btn-secondary mt-8 min-h-11 w-full text-sm">
                  Start the trial
                </Link>
              </article>
              <article className="landing-price-card border-brand">
                <div className="grid gap-8 md:grid-cols-[0.65fr_1.35fr]">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-lit">REVV Pro</p>
                    <p className="mt-4 font-mono text-4xl font-semibold text-gold">$199<span className="text-base font-medium text-muted">/mo</span></p>
                    <p className="mt-3 text-sm text-muted">One shop. Your whole team. Every active RO.</p>
                    <Link to="/shop-register" className="revv-btn revv-btn-primary mt-8 min-h-11 w-full text-sm">
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
            </div>
            <p className="mt-6 text-sm text-muted">
              Multi-location or enterprise? <a href="mailto:revvshopapp@gmail.com" className="font-semibold text-brand hover:text-brand-lit">Talk to REVV.</a>
            </p>
          </div>
        </section>

        <section id="download" className="landing-section">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand-lit">
                <Smartphone size={15} /> Browser now · native app next
              </div>
              <h2 className="landing-section-title mt-5">Run REVV wherever the repair happens.</h2>
              <p className="landing-section-copy">
                REVV already adapts across desktop, tablet, and phone in the browser. The native floor app is next.
              </p>
              <ul className="mt-7 grid gap-3 sm:grid-cols-2">
                {['Photo proof from the bay', 'Technician assignments', 'Live RO status', 'Customer approvals'].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-muted">
                    <CheckCircle size={16} className="text-good" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="landing-waitlist">
              <Download size={20} className="text-brand-lit" />
              <h3 className="mt-4 font-display text-xl font-semibold text-ink">Get native app early access</h3>
              <p className="mt-2 text-sm text-muted">We will notify you when the REVV floor app is ready.</p>
              {submitted ? (
                <div className="mt-6 flex items-start gap-3 border-l-2 border-good bg-panel-2 p-4" role="status">
                  <CheckCircle size={19} className="mt-0.5 shrink-0 text-good" />
                  <div><p className="font-semibold text-ink">You are on the list.</p><p className="mt-1 text-xs text-muted">We will reach out when it is ready.</p></div>
                </div>
              ) : (
                <form onSubmit={handleWaitlist} className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <label className="sr-only" htmlFor="landing-waitlist-email">Work email</label>
                  <input
                    id="landing-waitlist-email"
                    type="email"
                    required
                    placeholder="shop@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="min-h-11 min-w-0 flex-1 rounded-instrument border border-line-2 bg-void px-4 text-sm text-ink outline-none transition focus:border-brand"
                  />
                  <button type="submit" disabled={submitting} className="revv-btn revv-btn-primary min-h-11 px-5 text-sm">
                    {submitting ? 'Saving…' : 'Notify me'}
                  </button>
                </form>
              )}
            </div>
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
