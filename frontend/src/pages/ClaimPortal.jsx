import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, FileCheck2, Loader2, ShieldCheck } from 'lucide-react'
import api from '../lib/api'
import { Logo, Money, Panel, dollarsToCents } from '../components/ui'

const inputClass = 'w-full rounded-instrument border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

function PortalHeader() {
  return (
    <header className="flex items-center gap-3 border-b border-line pb-5">
      <Logo variant="mark" className="h-10 w-10 shrink-0" />
      <div className="min-w-0">
        <p className="font-display text-lg font-semibold text-ink">Insurance assessment</p>
        <p className="text-sm text-muted">Secure claim review powered by REVV</p>
      </div>
    </header>
  )
}

export default function ClaimPortal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [data, setData] = useState(null)
  const [form, setForm] = useState({
    adjustor_name: '',
    adjustor_company: '',
    adjustor_email: '',
    approved_labor: '',
    approved_parts: '',
    supplement_amount: '',
    adjustor_notes: '',
  })
  const [assessmentFile, setAssessmentFile] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const { data: response } = await api.get(`/claim-link/${token}`)
        setData(response)
      } catch {
        setError('This claim link is invalid or unavailable.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }))

  async function onSubmit(event) {
    event.preventDefault()
    if (!form.adjustor_name.trim() || !form.adjustor_company.trim()) {
      setError('Adjustor name and company are required.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const formData = new FormData()
      Object.entries(form).forEach(([key, value]) => formData.append(key, value))
      if (assessmentFile) formData.append('assessment', assessmentFile)
      await api.post(`/claim-link/${token}/submit`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setSuccess(true)
      setData((previous) => ({
        ...previous,
        link: { ...(previous?.link || {}), submitted_at: new Date().toISOString() },
      }))
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Could not submit assessment.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-void px-4 text-muted">
        <div className="flex items-center gap-3" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
          Loading insurance assessment...
        </div>
      </main>
    )
  }

  if (error && !data) {
    return (
      <main className="min-h-screen bg-void px-4 py-8 text-ink sm:py-12">
        <div className="mx-auto max-w-2xl space-y-5">
          <PortalHeader />
          <Panel className="p-6 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-crit" aria-hidden="true" />
            <h1 className="mt-4 font-display text-xl font-semibold text-ink">Assessment unavailable</h1>
            <p role="alert" className="mt-2 text-sm text-crit">{error}</p>
          </Panel>
        </div>
      </main>
    )
  }

  if (data?.link?.submitted_at || success) {
    return (
      <main className="min-h-screen bg-void px-4 py-8 text-ink sm:py-12">
        <div className="mx-auto max-w-2xl space-y-5">
          <PortalHeader />
          <Panel className="p-6 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-good" aria-hidden="true" />
            <h1 className="mt-4 font-display text-xl font-semibold text-ink">Assessment received</h1>
            <p role="status" className="mt-2 text-sm text-muted">The shop has been notified. Thank you for completing the claim review.</p>
          </Panel>
        </div>
      </main>
    )
  }

  const ro = data?.ro || {}
  const vehicle = data?.vehicle || {}
  const customer = data?.customer || {}
  const shop = data?.shop || {}
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Not provided'

  return (
    <main className="min-h-screen bg-void px-4 py-6 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-5">
        <PortalHeader />

        <Panel title="Repair order" description="Confirm the vehicle and shop before submitting your assessment.">
          <dl className="grid gap-x-8 gap-y-4 p-4 text-sm sm:grid-cols-2 sm:p-5">
            {[
              ['Shop', shop.name || 'Not provided'],
              ['RO number', ro.ro_number || 'Not provided'],
              ['Vehicle', vehicleLabel],
              ['VIN', vehicle.vin || 'Not provided'],
              ['Customer', customer.name || 'Not provided'],
              ['Shop contact', shop.phone || 'Not provided'],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 border-b border-line pb-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
                <dt className="text-xs font-medium uppercase tracking-[0.08em] text-faint">{label}</dt>
                <dd className="mt-1 break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Shop estimate" description="Current repair figures supplied by the shop.">
          <dl className="grid divide-y divide-line p-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:p-5">
            <div className="py-3 sm:px-4 sm:py-0 sm:first:pl-0">
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">Parts</dt>
              <dd className="mt-2"><Money cents={dollarsToCents(ro.parts_cost)} className="text-lg font-semibold text-ink" /></dd>
            </div>
            <div className="py-3 sm:px-4 sm:py-0">
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">Labor</dt>
              <dd className="mt-2"><Money cents={dollarsToCents(ro.labor_cost)} className="text-lg font-semibold text-ink" /></dd>
            </div>
            <div className="py-3 sm:px-4 sm:py-0 sm:last:pr-0">
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">Estimate total</dt>
              <dd className="mt-2"><Money cents={dollarsToCents(ro.total)} className="text-lg font-semibold text-gold" /></dd>
            </div>
          </dl>
        </Panel>

        <Panel as="form" onSubmit={onSubmit} title="Your assessment" description="Required fields are marked with an asterisk.">
          <div className="space-y-5 p-4 sm:p-5">
            {error && <p role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted">
                Adjustor name *
                <input aria-label="Adjustor name" className={`${inputClass} mt-1`} value={form.adjustor_name} onChange={(event) => set('adjustor_name', event.target.value)} required />
              </label>
              <label className="text-xs font-medium text-muted">
                Company *
                <input aria-label="Adjustor company" className={`${inputClass} mt-1`} value={form.adjustor_company} onChange={(event) => set('adjustor_company', event.target.value)} required />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                Email
                <input aria-label="Adjustor email" type="email" className={`${inputClass} mt-1`} value={form.adjustor_email} onChange={(event) => set('adjustor_email', event.target.value)} />
              </label>
              <label className="text-xs font-medium text-muted">
                Approved labor amount
                <input aria-label="Approved labor amount" type="number" min="0" step="0.01" className={`${inputClass} mt-1`} value={form.approved_labor} onChange={(event) => set('approved_labor', event.target.value)} />
              </label>
              <label className="text-xs font-medium text-muted">
                Approved parts amount
                <input aria-label="Approved parts amount" type="number" min="0" step="0.01" className={`${inputClass} mt-1`} value={form.approved_parts} onChange={(event) => set('approved_parts', event.target.value)} />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                Supplement amount
                <input aria-label="Supplement amount" type="number" min="0" step="0.01" placeholder="0.00" className={`${inputClass} mt-1`} value={form.supplement_amount} onChange={(event) => set('supplement_amount', event.target.value)} />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                Notes or comments
                <textarea aria-label="Assessment notes" rows={4} className={`${inputClass} mt-1 resize-y`} value={form.adjustor_notes} onChange={(event) => set('adjustor_notes', event.target.value)} />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                Assessment PDF
                <input aria-label="Assessment PDF" type="file" accept="application/pdf,.pdf" className={`${inputClass} mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink`} onChange={(event) => setAssessmentFile(event.target.files?.[0] || null)} />
              </label>
            </div>

            <button type="submit" disabled={submitting} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
              <FileCheck2 size={17} aria-hidden="true" />
              {submitting ? 'Submitting...' : 'Submit assessment'}
            </button>
          </div>
        </Panel>
      </div>
    </main>
  )
}
