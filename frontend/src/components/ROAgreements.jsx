import { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { tryCopyToClipboard } from '../lib/clipboard'
import { agreementStatus, agreementInput, agreementButton, agreementError, downloadAgreement } from '../lib/agreements'

const emptyPreparation = () => ({ stage: 'intake', estimate: '', amount: '', deductible: '', loss_date: '', condition: '', invoice: '', reviewed: false, insurance_denied: false, repairs_complete: false })

export default function ROAgreements({ roId, customerName = '', customerEmail = '', canCountersign = false, archiveOnly = false, initialTemplate = '', intakeOnly = false }) {
  const [templates, setTemplates] = useState([])
  const [items, setItems] = useState([])
  const [template, setTemplate] = useState(initialTemplate)
  const [name, setName] = useState(customerName)
  const [email, setEmail] = useState(customerEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [message, setMessage] = useState('')
  const [signing, setSigning] = useState(null)
  const [signerName, setSignerName] = useState('')
  const [consent, setConsent] = useState(false)
  const [config, setConfig] = useState({})
  const [preparation, setPreparation] = useState(emptyPreparation)
  const [autofill, setAutofill] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const contextGeneration = useRef(0)
  const selected = templates.find((item) => item.id === template)
  const preparedKind = selected?.preparation_kind
  const removal = preparedKind === 'miles_removal_v1'
  const field = (key, value) => setPreparation((prev) => ({ ...prev, [key]: value, ...(key === 'reviewed' ? {} : { reviewed: false }) }))
  async function load(generation = contextGeneration.current) {
    const [list, choices] = await Promise.all([api.get(`/agreements/ro/${roId}`), api.get('/agreements/templates')])
    if (generation !== contextGeneration.current) return
    setItems(Array.isArray(list.data.agreements) ? list.data.agreements : []); setConfig(list.data); setTemplates(Array.isArray(choices.data.templates) ? choices.data.templates : [])
  }
  async function refreshDetails(generation = contextGeneration.current) {
    setLoadingDetails(true); setDetailsError(''); setAutofill(null)
    setPreparation((prev) => ({ ...prev, reviewed: false }))
    try {
      const { data } = await api.get(`/agreements/ro/${roId}/preparation`)
      if (generation !== contextGeneration.current) return
      if (!data.identity || !data.defaults || !data.revision) throw new Error('RO details are unavailable. Please reload them before preparing an authorization.')
      setAutofill(data); setName(data.identity.name || customerName); setEmail(data.identity.email || customerEmail)
      setPreparation((prev) => ({ ...prev, ...data.defaults, reviewed: false }))
    } catch (err) { if (generation === contextGeneration.current) setDetailsError(agreementError(err)) }
    finally { if (generation === contextGeneration.current) setLoadingDetails(false) }
  }
  useEffect(() => {
    const generation = ++contextGeneration.current
    setBusy(false); setLink(''); setItems([]); setConfig({}); setTemplates([]); setMessage(''); setError(''); setSigning(null)
    setTemplate(initialTemplate); setName(customerName); setEmail(customerEmail); setPreparation(emptyPreparation()); setAutofill(null)
    Promise.all([api.get(`/agreements/ro/${roId}`), api.get('/agreements/templates')]).then(([list, choices]) => {
      if (generation !== contextGeneration.current) return
      setItems(Array.isArray(list.data.agreements) ? list.data.agreements : []); setConfig(list.data)
      setTemplates(Array.isArray(choices.data.templates) ? choices.data.templates : [])
    }).catch((err) => { if (generation === contextGeneration.current) setError(agreementError(err)) })
    if (!archiveOnly) refreshDetails(generation)
    return () => { contextGeneration.current++ }
  }, [roId, archiveOnly])
  async function action(fn) {
    const generation = contextGeneration.current
    setBusy(true); setError(''); setMessage('')
    try { await fn(generation); if (generation === contextGeneration.current) await load(generation) } catch (err) { if (generation === contextGeneration.current) setError(agreementError(err)) }
    finally { if (generation === contextGeneration.current) setBusy(false) }
  }
  function saveLink(path, generation = contextGeneration.current) { if (generation !== contextGeneration.current) return; setLink(new URL(path, window.location.origin).href); setMessage('Link ready. No message has been sent to the customer.') }
  function sourceLabel(key) {
    if (autofill && preparation[key] !== autofill.defaults[key]) return 'Entered or adjusted by staff'
    return autofill?.sources?.[key] || 'Staff completes if not recorded'
  }
  function requestBody() {
    return { template_id: template, recipient_name: name, recipient_email: email,
      ...(preparedKind ? { source_revision: autofill?.revision, preparation: { ...preparation, stage: removal ? 'removal' : preparation.stage } } : {}) }
  }
  async function preview() {
    const generation = contextGeneration.current
    setBusy(true); setError('')
    try {
      const { data } = await api.post(`/agreements/ro/${roId}/preview`, requestBody(), { responseType: 'blob' })
      if (generation !== contextGeneration.current) return
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'authorization-preview.pdf'; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      setMessage('Preview downloaded. No signing request or customer message was created.')
    } catch (err) {
      if (generation !== contextGeneration.current) return
      if (err.response?.data instanceof Blob) {
        try { const body = JSON.parse(await err.response.data.text()); if (generation !== contextGeneration.current) return; setError(body.error || 'Could not prepare preview.') } catch { if (generation === contextGeneration.current) setError('Could not prepare preview.') }
      } else setError(agreementError(err))
    } finally { if (generation === contextGeneration.current) setBusy(false) }
  }
  async function create(event) {
    event.preventDefault()
    await action(async (generation) => { const { data } = await api.post(`/agreements/ro/${roId}`, requestBody()); saveLink(data.signing_path, generation) })
  }
  return <section className="rounded-2xl border border-line bg-panel p-5 space-y-5">
    <div><h2 className="text-lg font-semibold text-ink">Agreements</h2><p className="text-sm text-muted">Review the details from this RO. Your customer reviews the completed agreement and signs.</p></div>
    {error && <p role="alert" className="text-sm text-crit">{error}</p>}
    {message && <p role="status" className="text-sm text-good">{message}</p>}
    {!archiveOnly && <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
      <label className="sm:col-span-2 text-sm text-muted">Shop agreement<select required className={agreementInput} value={template} onChange={(e) => { setTemplate(e.target.value); setPreparation((prev) => ({ ...prev, stage: 'intake', reviewed: false })) }}><option value="">Choose agreement</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      <label className="text-sm text-muted">Customer name<input required maxLength={120} className={agreementInput} value={name} onChange={(e) => { setName(e.target.value); field('reviewed', false) }} /></label>
      <label className="text-sm text-muted">Customer email (optional)<input type="email" maxLength={254} className={agreementInput} value={email} onChange={(e) => { setEmail(e.target.value); field('reviewed', false) }} /></label>
      {preparedKind && <fieldset className="sm:col-span-2 space-y-3 rounded-lg border border-line p-3">
        <legend className="text-sm font-medium text-ink">Authorization details</legend>
        <div className="rounded-xl bg-void p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">Auto-filled from this RO</h3>
            <button type="button" disabled={loadingDetails || busy} className={agreementButton} onClick={() => refreshDetails()}>Reload RO details</button></div>
          {loadingDetails && <p role="status" className="text-sm text-muted">Loading saved customer, vehicle and estimate details…</p>}
          {detailsError && <p role="alert" className="text-sm text-crit">{detailsError}</p>}
          {autofill && <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            {[["Repair order", autofill.identity.ro_number], ["Vehicle", autofill.identity.vehicle], ["VIN", autofill.identity.vin], ["Phone", autofill.identity.phone], ["Insurer", autofill.identity.insurer], ["Claim", autofill.identity.claim]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="font-medium text-ink break-words">{value || 'Not recorded'}</dd></div>)}
          </dl>}
          <p className="text-xs text-muted">The customer will not need to enter these details again. Correct customer or vehicle information on the RO, then reload here.</p>
        </div>
        {autofill?.warnings?.map((warning) => <p key={warning} className="text-sm text-warn">{warning}</p>)}

        {!removal && !intakeOnly && <label className="block text-sm text-muted">Signing stage<select className={agreementInput} value={preparation.stage} onChange={(e) => field('stage', e.target.value)}><option value="intake">Intake authorization</option><option value="completion">Completion acknowledgment</option></select></label>}
        {!removal && preparation.stage === 'intake' && <>
          <label className="block text-sm text-muted">Estimate reference / version<input required maxLength={100} className={agreementInput} value={preparation.estimate} onChange={(e) => field('estimate', e.target.value)} /><span className="mt-1 block text-xs text-muted">{sourceLabel('estimate')}</span></label>
          <label className="block text-sm text-muted">Authorized total, including tax ($)<input required type="number" min="0" max="99999999.99" step="0.01" className={agreementInput} value={preparation.amount} onChange={(e) => field('amount', e.target.value)} /><span className="mt-1 block text-xs text-muted">{sourceLabel('amount')}</span></label>
          {preparedKind === 'miles_insurance_v1' && <>
            <label className="block text-sm text-muted">Deductible ($)<input required type="number" min="0" max="99999999.99" step="0.01" className={agreementInput} value={preparation.deductible} onChange={(e) => field('deductible', e.target.value)} /><span className="mt-1 block text-xs text-muted">{sourceLabel('deductible')}</span></label>
            <label className="block text-sm text-muted">Date of loss<input required type="date" className={agreementInput} value={preparation.loss_date} onChange={(e) => field('loss_date', e.target.value)} /><span className="mt-1 block text-xs text-muted">{sourceLabel('loss_date')}</span></label>
          </>}
          <p className="text-xs text-muted">Saved amounts are suggestions for staff to confirm, not additional customer consent. The completion acknowledgment is signed separately after repairs.</p>
        </>}
        {removal && <>
          <label className="block text-sm text-muted">Unrepaired conditions and transport arrangements<textarea required maxLength={600} className={agreementInput} value={preparation.condition} onChange={(e) => field('condition', e.target.value)} /></label>
          <label className="flex gap-2 text-sm text-ink"><input required type="checkbox" checked={preparation.insurance_denied} onChange={(e) => field('insurance_denied', e.target.checked)} />The insurance claim was denied and the customer is requesting vehicle removal.</label>
        </>}
        {!removal && preparation.stage === 'completion' && <>
          <label className="block text-sm text-muted">Final invoice reference<input required maxLength={100} className={agreementInput} value={preparation.invoice} onChange={(e) => field('invoice', e.target.value)} /><span className="mt-1 block text-xs text-muted">{sourceLabel('invoice')}</span></label>
          <label className="flex gap-2 text-sm text-ink"><input required type="checkbox" checked={preparation.repairs_complete} onChange={(e) => field('repairs_complete', e.target.checked)} />Repairs are complete. The customer will inspect the vehicle before signing.</label>
        </>}
        <label className="flex gap-2 text-sm text-ink"><input required type="checkbox" checked={preparation.reviewed} onChange={(e) => field('reviewed', e.target.checked)} />I checked the customer, vehicle, amounts, and signing stage for this authorization.</label>
      </fieldset>}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        {preparedKind && <button type="button" disabled={busy || loadingDetails || !autofill || !preparation.reviewed} className={agreementButton} onClick={preview}>Preview filled PDF</button>}
        <button disabled={busy || !template || (preparedKind && (loadingDetails || !autofill || !preparation.reviewed))} className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50">Prepare signing link</button>
        {!templates.length && <p className="mt-2 text-sm text-muted">An owner or admin can upload the shop’s agreement in Settings → Core.</p>}</div>
    </form>}
    {link && <div className="rounded-lg border border-brand/30 bg-brand/5 p-3 space-y-2">
      <label className="block text-sm text-ink">Private signing link<input readOnly value={link} className={agreementInput} onFocus={(e) => e.target.select()} /></label>
      <div className="flex flex-wrap gap-2"><button className={agreementButton} onClick={async () => setMessage(await tryCopyToClipboard(link) ? 'Signing link copied.' : 'Select the link above and copy it.')}>Copy link</button>
        <a className={agreementButton} href={link} target="_blank" rel="noreferrer">Open for customer</a></div>
      <p className="text-xs text-muted">Anyone with this link can access the agreement. Share it only with the intended customer. Links expire after 30 days.</p>
    </div>}
    <div className="space-y-3">
      {!items.length && <p className="text-sm text-muted">No agreement requests for this repair order yet.</p>}
      {items.map((item) => <article key={item.id} className="rounded-lg border border-line p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-medium text-ink">{item.title}</h3>{item.preparation_details?.stage && <p className="text-xs text-muted">Signing stage: {item.preparation_details.stage}</p>}<p className="text-sm text-muted">{item.recipient_name}</p></div><span className="text-sm text-brand">{agreementStatus[item.status]}</span></div>
        <p className="text-xs text-muted">Created {new Date(item.created_at).toLocaleString()}{item.completed_at && ` · Completed ${new Date(item.completed_at).toLocaleString()}`}</p>
        {item.customer_signed_at && <p className="text-sm text-ink">Customer signed as {item.customer_signed_name} on {new Date(item.customer_signed_at).toLocaleString()}.</p>}
        <div className="flex flex-wrap gap-2">
          <button className={agreementButton} onClick={() => downloadAgreement(`/agreements/${item.id}/document`, 'agreement-original.pdf').catch((err) => setError(agreementError(err)))}>Review prepared PDF</button>
          {item.status === 'signed' && <button className={agreementButton} onClick={() => downloadAgreement(`/agreements/${item.id}/signed`, 'signed-agreement.pdf').catch((err) => setError(agreementError(err)))}>Download signed PDF</button>}
          <button className={agreementButton} onClick={() => downloadAgreement(`/agreements/${item.id}/audit`, 'agreement-signing-record.json').catch((err) => setError(agreementError(err)))}>Signing record</button>
          {item.status !== 'voided' && <button disabled={busy} className={agreementButton} onClick={() => action(async (generation) => { const { data } = await api.post(`/agreements/${item.id}/link`); saveLink(data.signing_path, generation) })}>Replace sharing link</button>}
          {item.status === 'pending' && <button disabled={busy} className={agreementButton} onClick={() => action(async (generation) => { await api.post(`/agreements/${item.id}/void`); if (generation === contextGeneration.current) setLink('') })}>Void unsigned request</button>}
          {item.status === 'awaiting_shop' && canCountersign && <button disabled={busy} className={agreementButton} onClick={() => { setSigning(item); setConsent(false); setSignerName('') }}>Add shop signature</button>}
        </div>
        {signing?.id === item.id && <form className="space-y-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); action(async (generation) => { await api.post(`/agreements/${item.id}/countersign`, { name: signerName, consent, consent_version: config.consent_version, document_sha256: item.document_sha256 }); if (generation === contextGeneration.current) setSigning(null) }) }}>
          <p className="text-sm text-muted">Review the original PDF and customer signature above before signing.</p>
          <label className="block text-sm text-muted">Shop representative’s full legal name<input required maxLength={120} className={agreementInput} value={signerName} onChange={(e) => setSignerName(e.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm text-ink"><input required type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />{config.shop_consent_text}</label>
          <button disabled={busy || !consent} className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50">Sign for shop</button>
        </form>}
      </article>)}
    </div>
  </section>
}
