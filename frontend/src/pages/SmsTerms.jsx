import { Link } from 'react-router-dom'

export default function SmsTerms() {
  return (
    <div className="min-h-screen bg-void px-6 py-10 text-ink md:px-16 lg:px-24">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 border-b border-line-2 pb-6">
          <Link to="/" className="text-sm text-brand transition hover:text-brand-lit">
            Back to REVV
          </Link>
          <h1 className="mt-3 font-display text-3xl font-bold text-ink md:text-4xl">SMS Terms of Service</h1>
          <p className="mt-2 text-sm text-muted">Effective date: March 1, 2026</p>
          <p className="mt-1 text-sm text-muted">
            Company: Zordon Technologies LLC · Service: REVV at revvshop.app
          </p>
        </div>

        <div className="divide-y divide-line">
          <section className="pb-6">
            <h2 className="font-display text-lg font-semibold text-ink">Program Name</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              REVV Repair Status Notifications
            </p>
          </section>

          <section className="py-6">
            <h2 className="font-display text-lg font-semibold text-ink">What Messages You Will Receive</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              When you provide your phone number to an auto repair shop that uses REVV, you may receive automated text messages regarding your vehicle repair, including:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li>• Repair status updates (e.g., In Progress, Waiting for Parts, Quality Check)</li>
              <li>• Ready-for-pickup notifications</li>
              <li>• Payment and invoice links</li>
              <li>• Delivery confirmation</li>
            </ul>
          </section>

          <section className="py-6">
            <h2 className="font-display text-lg font-semibold text-ink">Consent & Opt-In</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              Consent is collected in person at the auto repair shop during vehicle drop-off. By providing your phone number to a REVV-powered shop, you agree to receive automated repair status text messages from that shop. Consent is not required as a condition of purchasing any goods or services.
            </p>
          </section>

          <section className="py-6">
            <h2 className="font-display text-lg font-semibold text-ink">Message Frequency</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              Message frequency varies based on the status of your vehicle repair. You will typically receive 2–8 messages per repair order over the course of the repair.
            </p>
          </section>

          <section className="py-6">
            <h2 className="font-display text-lg font-semibold text-ink">Message & Data Rates</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              Message and data rates may apply. Check with your wireless carrier for details about your messaging plan.
            </p>
          </section>

          <section className="py-6">
            <h2 className="font-display text-lg font-semibold text-ink">Opt-Out</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              You may opt out of receiving text messages at any time by replying <strong className="text-ink">STOP</strong> to any message. You will receive a one-time confirmation message and no further texts will be sent.
            </p>
          </section>

          <section className="py-6">
            <h2 className="font-display text-lg font-semibold text-ink">Help</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              For help, reply <strong className="text-ink">HELP</strong> to any message, or contact us at{' '}
              <a href="mailto:revvshopapp@gmail.com" className="text-brand hover:underline">
                revvshopapp@gmail.com
              </a>.
            </p>
          </section>

          <section className="py-6">
            <h2 className="font-display text-lg font-semibold text-ink">Privacy</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              Your phone number and message data are handled in accordance with our{' '}
              <Link to="/privacy" className="text-brand hover:underline">
                Privacy Policy
              </Link>. We do not sell or share your phone number with third parties for marketing purposes. Carriers are not liable for delayed or undelivered messages.
            </p>
          </section>

          <section className="py-6">
            <h2 className="font-display text-lg font-semibold text-ink">Support Contact</h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              Zordon Technologies LLC<br />
              <a href="mailto:revvshopapp@gmail.com" className="text-brand hover:underline">
                revvshopapp@gmail.com
              </a><br />
              <a href="https://revvshop.app" className="text-brand hover:underline">
                revvshop.app
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
