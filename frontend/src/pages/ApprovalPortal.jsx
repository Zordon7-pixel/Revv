import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import api from '../lib/api'
import CustomerPanelQuote, { downloadQuotePdf } from '../components/CustomerPanelQuote'
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
  const { token } = useParams()
  return <ApprovalSession key={token} token={token} />
}
function ApprovalSession({ token }) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  useEffect(() => {
    let current = true
    setLoading(true); setError(''); setData(null); setDecision('')
    api.get(`/approval/${encodeURIComponent(token)}`)
      .then(response => { if (current) setData(response.data) })
      .catch(() => { if (current) setError('This approval link is unavailable, invalid, expired, revoked or superseded. Ask the shop for the current quote link.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [token, attempt])

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
      if (alive.current) setDecision(nextDecision)
    } catch (requestError) {
      if (alive.current) setError(requestError?.response?.data?.error || 'Could not submit response.')
    } finally {
      if (alive.current) setSubmitting(false)
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
            <p role="alert" className="mt-2 text-sm text-crit">{error || 'Approval link unavailable.'}</p><button type="button" className="mt-4 min-h-11 text-brand" onClick={() => setAttempt(value => value + 1)}>Reload approval link</button>
          </Panel>
        </div>
      </main>
    )
  }

  if (data.kind === 'panel_estimator') return <PanelApproval token={token} data={data} reload={() => setAttempt(value => value + 1)} />

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


const panelButton = 'min-h-11 rounded-instrument border border-line-2 bg-raised px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50'
const unavailable = 'This quote link is invalid, expired, revoked or superseded. Ask the shop for the current quote link.'
function validReceipt(receipt, data) {
  return receipt && ['approve', 'decline'].includes(receipt.decision) && receipt.revision_id === data.revision_id && receipt.quote_hash === data.quote_hash && receipt.disclosure_version === data.disclosure?.version && receipt.acknowledged === true && typeof receipt.actor_name === 'string' && typeof receipt.responded_at === 'string' && (receipt.decision === 'approve' ? receipt.reason == null : typeof receipt.reason === 'string' && !!receipt.reason.trim())
}
function PanelApproval({ token, data, reload }) {
  const [actor, setActor] = useState(''), [ack, setAck] = useState(false), [reason, setReason] = useState('')
  const [receipt, setReceipt] = useState(() => validReceipt(data.receipt, data) ? data.receipt : null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false), [retryBody, setRetryBody] = useState(null)
  const alive = useRef(true), lock = useRef(false), pending = useRef(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const valid = typeof data.revision_id === 'string' && !!data.revision_id && typeof data.quote_hash === 'string' && /^[a-f0-9]{64}$/.test(data.quote_hash) && data.quote?.revision_id === data.revision_id && data.quote?.quote_hash === data.quote_hash && typeof data.disclosure?.text === 'string' && typeof data.disclosure?.version === 'string' && (!data.receipt || validReceipt(data.receipt, data))
  const endpoint = `/approval/${encodeURIComponent(token)}`
  function failure(err, decisionRequest = false) {
    const status = err.response?.status, code = err.response?.data?.error
    if ([404, 410].includes(status) || ['APPROVAL_REVISION_CONFLICT', 'APPROVAL_DISCLOSURE_CONFLICT'].includes(code)) {
      setBlocked(true); setError(unavailable); setRetryBody(null)
    } else if (status === 409) {
      setBlocked(true); setRetryBody(null); setError('A conflicting decision or revision is already recorded. Your response was not confirmed. Reload to read the current receipt.')
    } else if (decisionRequest && (!status || status >= 500)) {
      setRetryBody(pending.current); setError('The response could not be confirmed. Retry the same decision to retrieve its receipt; your name, acknowledgement and decision are preserved.')
    } else setError('The request could not be completed. Please try again or reload the link.')
  }
  async function submit(decision) {
    if (lock.current || blocked || receipt || !valid) return
    const body = pending.current || { decision, revision_id: data.revision_id, quote_hash: data.quote_hash, disclosure_version: data.disclosure.version, actor_name: actor.trim(), acknowledged: true, ...(decision === 'decline' ? { reason: reason.trim() } : {}) }
    if (!pending.current && (!actor.trim() || !ack || (decision === 'decline' && !reason.trim()))) return
    pending.current = body; lock.current = true; setBusy(true); setError('')
    try {
      const response = await api.post(`${endpoint}/respond`, body)
      if (!alive.current) return
      if (!validReceipt(response.data.receipt, data) || response.data.receipt.decision !== body.decision || response.data.receipt.actor_name !== body.actor_name || (response.data.receipt.reason ?? null) !== (body.reason ?? null)) { setBlocked(true); setError('The service did not return a matching decision receipt. Reload to verify the recorded response.'); return }
      setReceipt(response.data.receipt); setRetryBody(null); pending.current = null
    } catch (err) { if (alive.current) { failure(err, true); if (err.response?.status && err.response.status < 500) pending.current = null } }
    finally { if (alive.current) { lock.current = false; setBusy(false) } }
  }
  async function pdf() {
    if (lock.current || blocked || !valid) return
    lock.current = true; setBusy(true); setError('')
    try { const response = await api.get(`${endpoint}/pdf`, { responseType: 'blob' }); if (alive.current) downloadQuotePdf(response.data, data.revision_id) }
    catch (err) { if (alive.current) failure(err) }
    finally { if (alive.current) { lock.current = false; setBusy(false) } }
  }
  return <main className="min-h-screen bg-void px-4 py-6 text-ink sm:py-10"><div className="mx-auto max-w-3xl space-y-5 break-words">
    <ApprovalHeader />
    {(!valid || blocked) ? <Panel className="space-y-4 p-5"><p role="alert">{error || unavailable}</p><button className={panelButton} type="button" onClick={reload}>Reload approval link</button></Panel> : <>
      <CustomerPanelQuote quote={data.quote} version={data.version} />
      <Panel title="Quote disclosure"><div className="space-y-3 p-5"><p>{data.disclosure.text}</p><p className="text-sm text-muted">Disclosure version: {data.disclosure.version} · Revision {data.revision_id}</p><button type="button" className={panelButton} disabled={busy || !!retryBody} onClick={pdf}>Download quote PDF</button></div></Panel>
      {error && <p role="alert" className="text-gold">{error}</p>}
      {receipt ? <Panel title="Recorded decision"><div className="space-y-2 p-5" role="status"><p>{receipt.decision === 'approve' ? 'Approved' : 'Declined'} by {receipt.actor_name}</p><p>Recorded at: {receipt.responded_at}</p><p>Decision revision: {receipt.revision_id} · Matches the current selected quote loaded here.</p>{receipt.reason && <p>Requested changes: {receipt.reason}</p>}<p>This immutable receipt applies only to this revision. Later changes require a new quote and approval; this is not approval of a future revision.</p><p>No shop notification was sent by this response. It does not establish carrier approval, take payment or change the repair workflow.</p></div></Panel> : <Panel title="Your response"><div className="space-y-4 p-5">
        <fieldset disabled={busy || !!retryBody} className="space-y-4"><label className="block">Your full name<input className="mt-1 min-h-11 w-full rounded-instrument border border-line-2 bg-void p-2" aria-label="Your full name" maxLength={200} value={actor} onChange={event => setActor(event.target.value)} /></label>
          <label className="flex min-h-11 items-start gap-3"><input className="mt-1" type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />I have read the displayed scope, price, revision and disclosure and acknowledge that my response applies only to this quote.</label>
          <label className="block">Change request reason (required to decline)<textarea className="mt-1 w-full rounded-instrument border border-line-2 bg-void p-2" aria-label="Change request reason" rows={4} maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <div className="flex flex-wrap gap-3"><button type="button" className={panelButton} disabled={!actor.trim() || !ack} onClick={() => submit('approve')}>Approve this revision</button><button type="button" className={panelButton} disabled={!actor.trim() || !ack || !reason.trim()} onClick={() => submit('decline')}>Decline this revision</button></div>
        </fieldset>
        {retryBody && <button type="button" className={panelButton} disabled={busy} onClick={() => submit(retryBody.decision)}>Retry same decision</button>}
        {busy && <p role="status">Request in progress…</p>}
        <p className="text-sm text-muted">Your response records a decision only. Contact the shop directly to discuss changes.</p>
      </div></Panel>}
    </>}
  </div></main>
}
