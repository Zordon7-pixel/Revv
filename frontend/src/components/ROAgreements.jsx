import { useEffect, useState } from 'react'
import api from '../lib/api'
import { tryCopyToClipboard } from '../lib/clipboard'
import { agreementStatus, agreementInput, agreementButton, agreementError, downloadAgreement } from '../lib/agreements'

export default function ROAgreements({ roId, customerName = '', customerEmail = '', canCountersign = false, archiveOnly = false }) {
  const [templates, setTemplates] = useState([])
  const [items, setItems] = useState([])
  const [template, setTemplate] = useState('')
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
  async function load() {
    const [list, choices] = await Promise.all([api.get(`/agreements/ro/${roId}`), api.get('/agreements/templates')])
    setItems(Array.isArray(list.data.agreements) ? list.data.agreements : []); setConfig(list.data); setTemplates(Array.isArray(choices.data.templates) ? choices.data.templates : [])
  }
  useEffect(() => { setLink(''); load().catch((err) => setError(agreementError(err))) }, [roId])
  async function action(fn) {
    setBusy(true); setError(''); setMessage('')
    try { await fn(); await load() } catch (err) { setError(agreementError(err)) }
    finally { setBusy(false) }
  }
  function saveLink(path) { setLink(new URL(path, window.location.origin).href); setMessage('Link ready. No message has been sent to the customer.') }
  async function create(event) {
    event.preventDefault()
    await action(async () => { const { data } = await api.post(`/agreements/ro/${roId}`, { template_id: template, recipient_name: name, recipient_email: email }); saveLink(data.signing_path) })
  }
  return <section className="rounded-2xl border border-line bg-panel p-5 space-y-5">
    <div><h2 className="text-lg font-semibold text-ink">Agreements</h2><p className="text-sm text-muted">Prepare a customer agreement, open it on the shop tablet, or copy its private signing link.</p></div>
    {error && <p role="alert" className="text-sm text-crit">{error}</p>}
    {message && <p role="status" className="text-sm text-good">{message}</p>}
    {!archiveOnly && <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
      <label className="sm:col-span-2 text-sm text-muted">Shop agreement<select required className={agreementInput} value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">Choose agreement</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      <label className="text-sm text-muted">Customer name<input required maxLength={120} className={agreementInput} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="text-sm text-muted">Customer email (optional)<input type="email" maxLength={254} className={agreementInput} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <div className="sm:col-span-2"><button disabled={busy || !template} className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50">Prepare signing link</button>
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
        <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-medium text-ink">{item.title}</h3><p className="text-sm text-muted">{item.recipient_name}</p></div><span className="text-sm text-brand">{agreementStatus[item.status]}</span></div>
        <p className="text-xs text-muted">Created {new Date(item.created_at).toLocaleString()}{item.completed_at && ` · Completed ${new Date(item.completed_at).toLocaleString()}`}</p>
        {item.customer_signed_at && <p className="text-sm text-ink">Customer signed as {item.customer_signed_name} on {new Date(item.customer_signed_at).toLocaleString()}.</p>}
        <div className="flex flex-wrap gap-2">
          <button className={agreementButton} onClick={() => downloadAgreement(`/agreements/${item.id}/document`, 'agreement-original.pdf').catch((err) => setError(agreementError(err)))}>Original PDF</button>
          {item.status === 'signed' && <button className={agreementButton} onClick={() => downloadAgreement(`/agreements/${item.id}/signed`, 'signed-agreement.pdf').catch((err) => setError(agreementError(err)))}>Download signed PDF</button>}
          <button className={agreementButton} onClick={() => downloadAgreement(`/agreements/${item.id}/audit`, 'agreement-signing-record.json').catch((err) => setError(agreementError(err)))}>Signing record</button>
          {item.status !== 'voided' && <button disabled={busy} className={agreementButton} onClick={() => action(async () => { const { data } = await api.post(`/agreements/${item.id}/link`); saveLink(data.signing_path) })}>Replace sharing link</button>}
          {item.status === 'pending' && <button disabled={busy} className={agreementButton} onClick={() => action(async () => { await api.post(`/agreements/${item.id}/void`); setLink('') })}>Void unsigned request</button>}
          {item.status === 'awaiting_shop' && canCountersign && <button disabled={busy} className={agreementButton} onClick={() => { setSigning(item); setConsent(false); setSignerName('') }}>Add shop signature</button>}
        </div>
        {signing?.id === item.id && <form className="space-y-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); action(async () => { await api.post(`/agreements/${item.id}/countersign`, { name: signerName, consent, consent_version: config.consent_version, document_sha256: item.document_sha256 }); setSigning(null) }) }}>
          <p className="text-sm text-muted">Review the original PDF and customer signature above before signing.</p>
          <label className="block text-sm text-muted">Shop representative’s full legal name<input required maxLength={120} className={agreementInput} value={signerName} onChange={(e) => setSignerName(e.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm text-ink"><input required type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />{config.shop_consent_text}</label>
          <button disabled={busy || !consent} className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50">Sign for shop</button>
        </form>}
      </article>)}
    </div>
  </section>
}
