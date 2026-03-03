import { Link } from 'react-router-dom'

const sections = [
  {
    title: 'Information We Collect',
    body: 'We collect account details (such as name, email, and role), shop operational data, and customer/vehicle information entered by each shop. Payment information is processed by Stripe. We also collect usage and device data needed to operate, secure, and improve REVV.',
  },
  {
    title: 'How We Use It',
    body: 'We use data to provide core product features, maintain account access, process billing, send service communications, support customers, monitor reliability, and improve performance and functionality.',
  },
  {
    title: 'Data Sharing',
    body: 'We do not sell personal data to third parties. We share data only with service providers required to run REVV, including Stripe (payments), Twilio (SMS), and Resend (email delivery), or when required by law.',
  },
  {
    title: 'Data Retention',
    body: 'We retain data for as long as needed to provide the service, meet legal obligations, resolve disputes, and enforce agreements. Retention periods may vary by data type and account status.',
  },
  {
    title: 'Security',
    body: 'We use reasonable administrative, technical, and organizational safeguards to protect data. No system is perfectly secure, but we continuously work to reduce risk and protect customer information.',
  },
  {
    title: 'Your Rights',
    body: 'Depending on your location, including under GDPR and CCPA-style frameworks, you may have rights to access, correct, delete, or request portability of personal data, and to object to or limit certain processing. You may also request information about categories of data collected and shared.',
  },
  {
    title: 'Contact',
    body: 'For privacy questions or rights requests, contact revvshopapp@gmail.com.',
  },
]

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#0f1117] px-6 py-10 text-slate-100 md:px-16 lg:px-24">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 border-b border-[#2a2d3e] pb-6">
          <Link to="/" className="text-sm text-indigo-300 transition hover:text-indigo-200">
            Back to REVV
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-white md:text-4xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-slate-400">Effective date: March 1, 2026</p>
          <p className="mt-1 text-sm text-slate-400">Company: Zordon Technologies LLC</p>
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
