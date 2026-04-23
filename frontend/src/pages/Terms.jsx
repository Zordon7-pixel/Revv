import { Link } from 'react-router-dom'

const sections = [
  {
    title: 'Acceptance of Terms',
    body: 'By using REVV at revvshop.app, you agree to these Terms of Service. If you do not agree, do not use the service.',
  },
  {
    title: 'Description of Service',
    body: 'REVV is shop management software for auto body and repair operations. Features include repair order tracking, customer communications, reporting, and operational workflows.',
  },
  {
    title: 'User Accounts',
    body: 'You are responsible for maintaining the confidentiality of your account credentials and for activity under your account. You agree to provide accurate account information and keep it updated.',
  },
  {
    title: 'Payment & Subscriptions',
    body: 'REVV offers Free, Pro, and Agency tiers. Paid plans are billed through Stripe on a recurring basis unless canceled. You authorize charges for your selected plan, and you are responsible for applicable taxes and payment method accuracy.',
  },
  {
    title: 'Acceptable Use',
    body: 'You agree not to misuse the platform, interfere with service operations, upload malicious content, or use REVV for unlawful activity. You are responsible for lawful handling of customer and vehicle data entered by your shop.',
  },
  {
    title: 'Intellectual Property',
    body: 'REVV, its software, branding, and related content are owned by Zordon Technologies LLC and protected by applicable intellectual property laws. Your subscription grants a limited right to use the service, not ownership.',
  },
  {
    title: 'Disclaimer of Warranties',
    body: 'REVV is provided on an "as is" and "as available" basis. We do not guarantee uninterrupted or error-free operation, and we disclaim implied warranties to the extent allowed by law.',
  },
  {
    title: 'Limitation of Liability',
    body: 'To the maximum extent permitted by law, Zordon Technologies LLC is not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of profits, data, or business opportunities arising from use of REVV.',
  },
  {
    title: 'SMS / Text Message Terms',
    body: 'REVV enables auto repair shops to send SMS (text message) notifications to their customers regarding vehicle repair status updates. By providing a phone number to a REVV-powered shop, you consent to receive automated text messages about your repair order status, including but not limited to: repair progress updates, parts status, ready-for-pickup alerts, and payment links. Message frequency varies based on repair activity (typically 2–8 messages per repair order). Message and data rates may apply. You may opt out at any time by replying STOP to any message. For help, reply HELP or contact revvshopapp@gmail.com. Carriers are not liable for delayed or undelivered messages.',
  },
  {
    title: 'Termination',
    body: 'We may suspend or terminate access for violations of these Terms or misuse of the platform. You may stop using the service at any time. Subscription cancellation terms follow your selected billing plan.',
  },
  {
    title: 'Governing Law',
    body: 'These Terms are governed by the laws of the State of Maryland, without regard to conflict-of-law rules.',
  },
  {
    title: 'Contact',
    body: 'Questions about these Terms can be sent to revvshopapp@gmail.com.',
  },
]

export default function Terms() {
  return (
    <div className="min-h-screen bg-[#0f1117] px-6 py-10 text-slate-100 md:px-16 lg:px-24">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 border-b border-[#2a2d3e] pb-6">
          <Link to="/" className="text-sm text-indigo-300 transition hover:text-indigo-200">
            Back to REVV
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-white md:text-4xl">Terms of Service</h1>
          <p className="mt-2 text-sm text-slate-400">Effective date: March 1, 2026</p>
          <p className="mt-1 text-sm text-slate-400">
            Company: Zordon Technologies LLC · Service: REVV shop management software at revvshop.app
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] p-5">
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-300">{section.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
