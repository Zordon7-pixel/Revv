import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import { Logo, Money, Panel, StatusBadge, dollarsToCents } from '../components/ui'

function ApprovalHeader({ shopName }) {
  return (
    <header className="flex items-center gap-3 border-b border-line pb-5">
      <Logo variant="mark" className="h-10 w-10 shrink-0" />
      <div className="min-w-0">
        <p className="break-words font-display text-lg font-semibold leading-tight text-ink">{shopName || 'REVV'} estimate approval</p>
        <p className="text-sm text-muted">Secure customer approval portal</p>
      </div>
    </header>
  )
}

export default function ApprovalPortal() {
  const { t } = useLanguage()
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError('')
    api.get(`/approval/${token}`)
      .then((response) => setData(response.data))
      .catch(() => setError('This approval link is invalid or expired.'))
      .finally(() => setLoading(false))
  }, [token])

  const totals = useMemo(() => {
    const ro = data?.ro || {}
    const labor = Number(ro.labor_cost || 0)
    const parts = Number(ro.parts_cost || 0)
    const sublet = Number(ro.sublet_cost || 0)
    const tax = Number(ro.tax || 0)
    const total = Number(ro.total || labor + parts + sublet + tax)
    return { labor, parts, sublet, tax, total }
  }, [data])

  async function submit(nextDecision) {
    if (nextDecision === 'decline' && !reason.trim()) {
      setError('Please explain what changes are needed.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/approval/${token}/respond`, {
        decision: nextDecision,
        reason: nextDecision === 'decline' ? reason : undefined,
      })
      setDecision(nextDecision)
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Could not submit response.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-void px-4 text-muted">
        <div className="flex items-center gap-3" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
          {t('common.loading')}
        </div>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-void px-4 py-8 text-ink sm:py-12">
        <div className="mx-auto max-w-xl space-y-5">
          <ApprovalHeader />
          <Panel className="p-6 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-crit" aria-hidden="true" />
            <h1 className="mt-4 font-display text-xl font-semibold text-ink">{t('portal.approveEstimate')}</h1>
            <p role="alert" className="mt-2 text-sm text-crit">{error || 'Approval link unavailable.'}</p>
          </Panel>
        </div>
      </main>
    )
  }

  if (decision === 'approve' || decision === 'decline') {
    const approved = decision === 'approve'
    return (
      <main className="min-h-screen bg-void px-4 py-8 text-ink sm:py-12">
        <div className="mx-auto max-w-xl space-y-5">
          <ApprovalHeader shopName={data.shop?.name} />
          <Panel className="p-6 text-center">
            {approved
              ? <CheckCircle2 className="mx-auto h-9 w-9 text-good" aria-hidden="true" />
              : <XCircle className="mx-auto h-9 w-9 text-crit" aria-hidden="true" />}
            <h1 className="mt-4 font-display text-xl font-semibold text-ink">
              {approved ? `${t('ro.estimate')} approved` : 'Changes requested'}
            </h1>
            <p role="status" className="mt-2 text-sm text-muted">
              {approved
                ? 'Thank you. The shop has been notified and your approval is recorded.'
                : 'Your note was sent to the shop. They will contact you to review the requested changes.'}
            </p>
          </Panel>
        </div>
      </main>
    )
  }

  const vehicleLabel = [data.vehicle?.year, data.vehicle?.make, data.vehicle?.model].filter(Boolean).join(' ') || 'Not provided'

  return (
    <main className="min-h-screen bg-void px-4 py-6 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <ApprovalHeader shopName={data.shop?.name} />

        <Panel title="Repair order" description="Review this estimate before approving or requesting changes.">
          <dl className="grid gap-x-8 gap-y-4 p-4 text-sm sm:grid-cols-2 sm:p-5">
            <div className="border-b border-line pb-3">
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">{t('common.name')}</dt>
              <dd className="mt-1 text-ink">{data.customer?.name || 'Not provided'}</dd>
            </div>
            <div className="border-b border-line pb-3">
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">{t('ro.title')}</dt>
              <dd className="mt-1 font-mono tabular-nums text-ink">{data.ro?.ro_number || 'Not provided'}</dd>
            </div>
            <div className="border-b border-line pb-3 sm:border-b-0 sm:pb-0">
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">{t('common.vehicle')}</dt>
              <dd className="mt-1 text-ink">{vehicleLabel}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">{t('common.status')}</dt>
              <dd className="mt-1"><StatusBadge status={data.ro?.status} /></dd>
            </div>
          </dl>
        </Panel>

        <Panel title={`${t('ro.estimate')} breakdown`}>
          <dl className="grid grid-cols-2 divide-x divide-y divide-line p-4 sm:grid-cols-4 sm:divide-y-0 sm:p-5">
            {[
              [t('ro.labor'), totals.labor],
              [t('ro.parts'), totals.parts],
              ['Sublet', totals.sublet],
              ['Tax', totals.tax],
            ].map(([label, amount]) => (
              <div key={label} className="min-w-0 p-3 first:pl-0 sm:py-0">
                <dt className="text-xs uppercase tracking-[0.08em] text-faint">{label}</dt>
                <dd className="mt-2"><Money cents={dollarsToCents(amount)} className="font-semibold text-ink" /></dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-4 sm:px-5">
            <span className="text-sm text-muted">{t('ro.total')} {t('ro.estimate')}</span>
            <Money cents={dollarsToCents(totals.total)} className="text-lg font-bold text-gold" />
          </div>
        </Panel>

        <Panel title="Your response" description="Add a note when requesting changes.">
          <div className="space-y-4 p-4 sm:p-5">
            {error && <p role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</p>}
            <label className="block text-xs font-medium text-muted">
              Change request note
              <textarea
                aria-label="Change request note"
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 w-full resize-y rounded-instrument border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                placeholder="Explain what needs to be adjusted..."
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => submit('approve')} disabled={submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-instrument bg-good px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
                <CheckCircle2 size={17} aria-hidden="true" />
                Approve {t('ro.estimate')}
              </button>
              <button type="button" onClick={() => submit('decline')} disabled={submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-instrument border border-crit/40 bg-crit/10 px-4 py-2.5 text-sm font-semibold text-crit transition-colors hover:bg-crit/15 disabled:opacity-50">
                <XCircle size={17} aria-hidden="true" />
                Request changes
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </main>
  )
}
