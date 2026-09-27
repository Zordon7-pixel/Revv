import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { agreementInput, agreementButton } from '../lib/agreements'

const AgreementPdfViewer = lazy(() => import('../components/AgreementPdfViewer'))

function AgreementSigningForm() {
  const controller = useRef(new AbortController())
  useEffect(() => () => controller.current.abort(), [])
  const location = useLocation()
  const token = location.hash.slice(1)
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pdfUrl, setPdfUrl] = useState('')
  const [name, setName] = useState('')
  const [initials, setInitials] = useState({})
  const [consent, setConsent] = useState(false)
  async function request(suffix = '', options = {}) {
    const response = await fetch(`/api/agreements/public/session${suffix}`, {
      ...options, signal: controller.current.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'Could not open this agreement. Please contact the shop.')
    }
    return response
  }
  useEffect(() => {
    let active = true
    setRecord(null); setPdfUrl(''); setName(''); setInitials({}); setConsent(false); setError('')
    if (!/^[a-f0-9]{64}$/.test(token)) { setError('This signing link is incomplete. Please ask the shop for a new link.'); return }
    request().then((r) => r.json()).then((data) => { if (active) setRecord(data) }).catch((err) => { if (active) setError(err.message) })
    return () => { active = false }
  }, [token])
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])
  async function openDocument() {
    setBusy(true); setError('')
    try { const response = await request('/document'); setPdfUrl(URL.createObjectURL(await response.blob())) }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function downloadSigned() {
    setBusy(true); setError('')
    try {
      const response = await request('/signed')
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'signed-agreement.pdf'; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function sign(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await request('/sign', { method: 'POST', body: JSON.stringify({ name, initials, consent,
        consent_version: record.consent_version, document_sha256: record.agreement.document_sha256 }) })
      const data = await response.json(); setRecord((r) => ({ ...r, agreement: data.agreement })); setConsent(false)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const agreement = record?.agreement
  return <main className="min-h-screen bg-void px-4 py-8 text-ink">
    <div className="mx-auto max-w-3xl space-y-5">
      <header><p className="text-sm font-bold tracking-widest text-brand">REVV</p><h1 className="mt-3 text-2xl font-semibold">{agreement?.title || 'Your agreement'}</h1>
        {agreement && <p className="mt-2 text-sm text-muted">{agreement.shop_name} · Repair order {agreement.ro_number} · Prepared for {agreement.recipient_name}</p>}</header>
      {error && <p role="alert" className="rounded-lg border border-crit/40 bg-crit/10 p-4 text-sm text-crit">{error}</p>}
      {!record && !error && <p role="status" className="text-muted">Loading agreement…</p>}
      {agreement && <>
        <section className="rounded-xl border border-line bg-panel p-5 space-y-3">
          <h2 className="font-semibold">Review your agreement</h2>
          <p className="text-sm text-muted">Read the entire PDF before signing. If the name or agreement is incorrect, contact the shop. You can choose to sign on paper instead.</p>
          <button disabled={busy} className={agreementButton} onClick={openDocument}>{pdfUrl ? 'Reload agreement' : 'Open agreement PDF'}</button>
          {pdfUrl && <>
            <a href={pdfUrl} download="agreement-original.pdf" className="ml-3 text-sm text-brand underline">Download original</a>
            <Suspense fallback={<p className="text-sm text-muted">Loading document viewer…</p>}><AgreementPdfViewer url={pdfUrl} /></Suspense>
            <p className="text-xs text-muted">If your browser cannot show the PDF here, use Download original to read every page.</p>
          </>}
        </section>
        {agreement.status === 'pending' && <form onSubmit={sign} className="rounded-xl border border-line bg-panel p-5 space-y-4">
          <h2 className="font-semibold">Sign electronically</h2>
          {!pdfUrl && <p className="text-sm text-muted">Open and review the agreement PDF to enable signing.</p>}
          {(agreement.initial_sections || []).map((section) => <label key={section} className="block text-sm text-muted">Initials — {section}<input required disabled={!pdfUrl || busy} maxLength={10} className={agreementInput} value={initials[section] || ''} onChange={(e) => setInitials((values) => ({ ...values, [section]: e.target.value }))} /></label>)}
          <label className="block text-sm text-muted">Type your full legal name as your signature<input required disabled={!pdfUrl || busy} maxLength={120} autoComplete="name" className={agreementInput} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {name && <div className="rounded-lg border-b border-line bg-void px-4 py-5 font-serif text-2xl italic break-words" aria-label="Typed signature preview">{name}</div>}
          <label className="flex items-start gap-3 text-sm"><input required disabled={!pdfUrl || busy} type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>{record.consent_text}</span></label>
          <p className="text-xs text-muted">Your name, initials, consent, signing time, and connection details will be saved with this agreement.</p>
          <button disabled={!pdfUrl || !consent || !name.trim() || busy} className="rounded-lg bg-brand px-5 py-3 font-medium text-on-brand disabled:opacity-50">{busy ? 'Saving signature…' : 'Agree and sign'}</button>
        </form>}
        {agreement.status === 'awaiting_shop' && <section role="status" className="rounded-xl border border-good/30 bg-panel p-5 space-y-3"><h2 className="font-semibold text-good">Your signature has been saved</h2><p className="text-sm text-muted">The shop needs to add its signature. Return to this link once the shop has signed to download the completed agreement.</p><button className={agreementButton} onClick={() => request().then((r) => r.json()).then(setRecord).catch((err) => setError(err.message))}>Check signing status</button></section>}
        {agreement.status === 'signed' && <section role="status" className="rounded-xl border border-good/30 bg-panel p-5 space-y-3"><h2 className="font-semibold text-good">Agreement signed</h2><p className="text-sm text-muted">Download and keep your completed agreement, including its signature record.</p><button disabled={busy} className={agreementButton} onClick={downloadSigned}>Download signed agreement</button></section>}
        <p className="text-xs text-muted">This private link expires {new Date(agreement.expires_at).toLocaleDateString()}. The shop retains your completed agreement and can provide another copy.</p>
      </>}
    </div>
  </main>
}

export default function AgreementSigning() {
  const { hash } = useLocation()
  return <AgreementSigningForm key={hash} />
}
