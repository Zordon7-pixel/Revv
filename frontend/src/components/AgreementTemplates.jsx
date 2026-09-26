import { useEffect, useState } from 'react'
import api from '../lib/api'
import { agreementInput, agreementButton, agreementError, downloadAgreement } from '../lib/agreements'

export default function AgreementTemplates() {
  const [templates, setTemplates] = useState([])
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [sections, setSections] = useState('')
  const [shopSignature, setShopSignature] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function load() { const { data } = await api.get('/agreements/templates'); setTemplates(Array.isArray(data.templates) ? data.templates : []) }
  useEffect(() => { load().catch((err) => setError(agreementError(err))) }, [])
  async function upload(event) {
    event.preventDefault(); setError(''); setMessage('')
    if (!file || file.size > 10 * 1024 * 1024) { setError('Choose a PDF under 10MB.'); return }
    setBusy(true)
    try {
      const body = new FormData()
      body.append('agreement', file); body.append('title', title)
      body.append('requires_shop_signature', String(shopSignature))
      body.append('initial_sections', JSON.stringify(sections.split('\n').map((s) => s.trim()).filter(Boolean)))
      await api.post('/agreements/templates', body)
      await load(); setMessage('Agreement uploaded. Open a repair order’s Agreements tab to prepare it for a customer.')
    } catch (err) { setError(agreementError(err)) }
    finally { setBusy(false) }
  }
  async function archive(id) {
    setBusy(true); setError('')
    try { await api.post(`/agreements/templates/${id}/archive`); await load() }
    catch (err) { setError(agreementError(err)) }
    finally { setBusy(false) }
  }
  return <section className="rounded-2xl border border-line bg-panel p-5 space-y-4">
    <div><h2 className="font-semibold text-ink">Agreements & e-signatures</h2>
      <p className="mt-1 text-sm text-muted">Upload the shop’s approved agreement as a static PDF. Each customer signs a fixed copy; uploading a replacement does not change existing requests.</p></div>
    {error && <p role="alert" className="text-sm text-crit">{error}</p>}
    {message && <p role="status" className="text-sm text-good">{message}</p>}
    <form onSubmit={upload} className="space-y-3">
      <label className="block text-sm text-muted">Agreement title<input required maxLength={160} className={agreementInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shop liability agreement" /></label>
      <label className="block text-sm text-muted">Agreement PDF<input type="file" required accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" /></label>
      <p className="text-xs text-faint">Up to 10MB and 50 pages. Use a PDF without fillable fields or existing digital signatures.</p>
      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={shopSignature} onChange={(e) => setShopSignature(e.target.checked)} />Require a shop representative’s signature after the customer signs</label>
      <label className="block text-sm text-muted">Sections requiring customer initials (optional)
        <textarea className={agreementInput} rows={3} value={sections} onChange={(e) => setSections(e.target.value)} placeholder="Page 2 - Storage charges&#10;Page 3 - Repair authorization" />
      </label>
      <p className="text-xs text-faint">One section per line, up to 12. Signatures and initials appear in a signing record appended to the agreement; they are not placed over the original PDF.</p>
      <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand disabled:opacity-50">{busy ? 'Saving…' : 'Upload agreement'}</button>
    </form>
    <div className="space-y-2">
      {!templates.length && <p className="text-sm text-muted">No agreements uploaded yet.</p>}
      {templates.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
        <div><p className="text-sm font-medium text-ink">{item.title}</p><p className="text-xs text-muted">{item.page_count} pages · {item.requires_shop_signature ? 'Customer + shop' : 'Customer signature'} · {new Date(item.created_at).toLocaleDateString()}</p></div>
        <div className="flex gap-2"><button type="button" className={agreementButton} onClick={() => downloadAgreement(`/agreements/templates/${item.id}/document`, 'agreement-template.pdf').catch((err) => setError(agreementError(err)))}>Download</button>
          <button type="button" className={agreementButton} disabled={busy} onClick={() => archive(item.id)}>Archive template</button></div>
      </div>)}
    </div>
  </section>
}
