import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeDollarSign, ChevronDown, ChevronUp, FileImage, Mail, Phone, ShieldCheck, Upload, X } from 'lucide-react'
import api from '../lib/api'
import { computeEstimateCrossCheck } from '../lib/estimateCrossCheck'
import { safeExternalErrorMessage } from '../lib/safeErrors'
import { attachedEvidenceToFiles, findAttachedAppraisalEvidence } from '../lib/attachedAppraisal'
import EstimateReviewWarning from './EstimateReviewWarning'
import EstimateFinancialReview from './EstimateFinancialReview'
import EstimateSelectionToolbar from './EstimateSelectionToolbar'

const INSURANCE_COMPANIES = [
  'State Farm',
  'GEICO',
  'Progressive',
  'Allstate',
  'USAA',
  'Liberty Mutual',
  'Farmers',
  'Nationwide',
  'Travelers',
  'Erie',
]

const SUPPLEMENT_META = {
  none: { label: 'None', cls: 'border-line-2 bg-raised text-muted' },
  requested: { label: 'Requested', cls: 'border-gold/40 bg-gold/10 text-gold' },
  pending: { label: 'Pending', cls: 'border-gold/40 bg-gold/10 text-gold' },
  approved: { label: 'Approved', cls: 'border-good/40 bg-good/10 text-good' },
  denied: { label: 'Denied', cls: 'border-crit/40 bg-crit/10 text-crit' },
}

function centsToDollars(cents) {
  if (cents === null || cents === undefined || cents === '') return ''
  const n = Number(cents)
  if (!Number.isFinite(n)) return ''
  return (n / 100).toFixed(2)
}

function dollarsToCents(dollars) {
  if (dollars === null || dollars === undefined || dollars === '') return null
  const n = Number(dollars)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function dollarsValue(value) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toFixed(2)
}

function parseDollars(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export default function InsurancePanel({ roId, ro, onUpdated }) {
  const [open, setOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [saveError, setSaveError] = useState('')

  // OCR import state
  const fileInputRef = useRef(null)
  const [ocrFiles, setOcrFiles] = useState([])
  const [ocrPreview, setOcrPreview] = useState(null)
  const [ocrParsing, setOcrParsing] = useState(false)
  const [ocrItems, setOcrItems] = useState(null)     // parsed line items
  const [ocrParsedMeta, setOcrParsedMeta] = useState(null)
  const [ocrCrossCheck, setOcrCrossCheck] = useState(null)
  const [ocrSelected, setOcrSelected] = useState({}) // checked items
  const [ocrImporting, setOcrImporting] = useState(false)
  const [ocrError, setOcrError] = useState(null)
  const [ocrNotice, setOcrNotice] = useState(null)
  const [ocrImportedCount, setOcrImportedCount] = useState(0)
  const [attachedAppraisalEvidence, setAttachedAppraisalEvidence] = useState([])

  useEffect(() => {
    let active = true
    async function loadReusableAppraisal() {
      try {
        const { data } = await api.get(`/estimate-metadata/metadata/${roId}`)
        if (!active) return
        const rawDraft = data?.metadata?.import_draft
        const draft = typeof rawDraft === 'string' ? JSON.parse(rawDraft) : rawDraft
        const items = Array.isArray(draft?.line_items) ? draft.line_items : []
        if (items.length) {
          const parsed = {
            ...draft,
            detected_format: draft.detected_format || 'unknown',
            needs_review: Boolean(draft.needs_review || draft.review_reasons?.length),
          }
          const selected = {}
          items.forEach((_, index) => { selected[index] = true })
          setOcrItems(items)
          setOcrParsedMeta(parsed)
          setOcrSelected(selected)
          setOcrCrossCheck(computeEstimateCrossCheck(parsed, ro))
          setOcrNotice(`Appraisal from RO creation is ready: ${items.length} line${items.length === 1 ? '' : 's'} staged for review. No re-upload needed.`)
          return
        }
        const tracker = await api.get(`/claim-tracker/ro/${roId}`)
        if (active) setAttachedAppraisalEvidence(findAttachedAppraisalEvidence(tracker.data?.evidence))
      } catch {
        if (active) setAttachedAppraisalEvidence([])
      }
    }
    loadReusableAppraisal()
    return () => { active = false }
  }, [roId])

  function handleFileChange(e) {
    const nextFiles = Array.from(e.target.files || [])
    if (!nextFiles.length) return
    const mergedFiles = [...ocrFiles, ...nextFiles].slice(0, 12)
    setOcrFiles(mergedFiles)
    setOcrItems(null)
    setOcrParsedMeta(null)
    setOcrCrossCheck(null)
    setOcrSelected({})
    setOcrError(null)
    setOcrNotice(null)
    setOcrImportedCount(0)
    const previewFile = mergedFiles.find((file) => file.type.startsWith('image/'))
    if (previewFile) {
      const reader = new FileReader()
      reader.onload = (ev) => setOcrPreview(ev.target.result)
      reader.readAsDataURL(previewFile)
    } else {
      setOcrPreview(null)
    }
    e.target.value = ''
  }

  async function parseEstimate(files = ocrFiles) {
    if (!files.length) return
    setOcrParsing(true)
    setOcrError(null)
    try {
      const form = new FormData()
      files.forEach((file) => form.append('estimate_images', file))
      const { data } = await api.post('/insurance-ocr/parse', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const parsed = {
        ...(data?.parsed || {}),
        detected_format: data?.parsed?.detected_format || data?.detected_format || null,
        needs_review: Boolean(data?.needs_review || data?.parsed?.needs_review),
      }
      const items = Array.isArray(parsed?.line_items) ? parsed.line_items : (data?.items || [])
      setOcrItems(items)
      setOcrParsedMeta(parsed)
      // Select all by default
      const sel = {}
      items.forEach((_, i) => { sel[i] = true })
      setOcrSelected(sel)

      const crossCheck = computeEstimateCrossCheck(parsed, ro)
      setOcrCrossCheck(crossCheck)

      setForm((prev) => ({
        ...prev,
        insurance_company: parsed.insurance_company || prev.insurance_company,
        insurance_claim_number: parsed.claim_number || prev.insurance_claim_number,
        adjuster_name: parsed.adjuster_name || prev.adjuster_name,
        adjuster_phone: parsed.adjuster_phone || prev.adjuster_phone,
        adjuster_email: parsed.adjuster_email || prev.adjuster_email,
      }))

      const existingClaim = ro?.insurance_claim_number || ro?.claim_number || ''
      const existingCarrier = ro?.insurance_company || ro?.insurer || ''
      const existingAdjuster = ro?.adjuster_name || ''
      const existingAdjusterPhone = ro?.adjuster_phone || ''
      const existingAdjusterEmail = ro?.adjuster_email || ''
      const patch = {}

      if (parsed.insurance_company && (!existingCarrier || !crossCheck.insurerMismatch)) {
        patch.insurance_company = parsed.insurance_company
      }
      if (parsed.claim_number && (!existingClaim || !crossCheck.claimMismatch)) {
        patch.insurance_claim_number = parsed.claim_number
      }
      if (parsed.adjuster_name && (!existingAdjuster || !crossCheck.adjusterMismatch)) {
        patch.adjuster_name = parsed.adjuster_name
      }
      if (parsed.adjuster_phone && !existingAdjusterPhone) {
        patch.adjuster_phone = parsed.adjuster_phone
      }
      if (parsed.adjuster_email && !existingAdjusterEmail) {
        patch.adjuster_email = parsed.adjuster_email
      }

      if (Object.keys(patch).length) {
        try {
          await api.patch(`/ros/${roId}/insurance`, patch)
          onUpdated?.()
          const appliedFields = []
          if (patch.insurance_company) appliedFields.push('carrier')
          if (patch.insurance_claim_number) appliedFields.push('claim #')
          if (patch.adjuster_name) appliedFields.push('adjuster')
          if (patch.adjuster_phone) appliedFields.push('adjuster phone')
          if (patch.adjuster_email) appliedFields.push('adjuster email')
          setOcrNotice(`Auto-populated ${appliedFields.join(', ')} from the estimate.`)
        } catch {
          setOcrNotice('Parsed metadata found, but auto-save failed. You can still import line items.')
        }
      } else if (crossCheck.hasMismatch) {
        setOcrNotice('Potential mismatch found. Metadata was not auto-overwritten.')
      } else if (items.length) {
        setOcrNotice('Estimate parsed successfully. Select line items to import.')
      }

      if (!items.length) {
        setOcrError('No line items were extracted. Try a clearer estimate image/PDF.')
      }
    } catch (err) {
      setOcrError(safeExternalErrorMessage(err, 'Could not parse the estimate. Try a clearer file.'))
    } finally {
      setOcrParsing(false)
    }
  }

  async function parseAttachedAppraisal() {
    setOcrError(null)
    try {
      const files = await attachedEvidenceToFiles(attachedAppraisalEvidence)
      setOcrFiles(files)
      await parseEstimate(files)
    } catch (err) {
      setOcrError(safeExternalErrorMessage(err, 'Could not load the appraisal attached to this RO.'))
    }
  }

  async function importSelected() {
    if (!ocrItems?.length) return
    if (ocrCrossCheck?.hasMismatch) {
      const proceed = window.confirm(
        `Potential mismatch detected:\n- ${ocrCrossCheck.messages.join('\n- ')}\n\nImport selected line items anyway?`
      )
      if (!proceed) return
    }
    const toImport = ocrItems.filter((_, i) => ocrSelected[i])
    if (!toImport.length) return
    setOcrImporting(true)
    try {
      let imported = 0
      for (const item of toImport) {
        await api.post(`/estimate-items/${roId}`, {
          description: item.description,
          type: item.type || 'labor',
          quantity: item.quantity ?? 1,
          unit_price: item.unit_price ?? 0,
        })
        imported += 1
      }
      let financialNotice = 'Estimate lines and financials imported to this RO.'
      try {
        await api.post(`/estimate-metadata/metadata/${roId}`, {
          adjuster_totals: ocrParsedMeta?.estimate_totals || undefined,
          import_draft: null,
        })
        await api.post(`/estimate-items/${roId}/import-financials`)
      } catch (financialErr) {
        financialNotice = `Imported ${imported} line${imported !== 1 ? 's' : ''}. ${financialErr?.response?.data?.error || 'Financial totals need review before they can be synced.'}`
      }
      onUpdated?.()
      setOcrFiles([])
      setOcrPreview(null)
      setOcrItems(null)
      setOcrParsedMeta(null)
      setOcrSelected({})
      setOcrImportedCount(imported)
      setOcrNotice(financialNotice)
      const openBuilder = window.confirm(
        `Imported ${imported} item${imported !== 1 ? 's' : ''}. Open Estimate Builder now?`
      )
      if (openBuilder) {
        window.location.assign(`/estimate-builder/${roId}`)
      }
    } catch (err) {
      setOcrError(err?.response?.data?.error || 'Import failed')
    } finally {
      setOcrImporting(false)
    }
  }
  const [form, setForm] = useState({
    insurance_company: '',
    insurance_claim_number: '',
    policy_number: '',
    adjuster_name: '',
    adjuster_phone: '',
    adjuster_email: '',
    deductible: '',
    is_drp: false,
    insurance_approved_amount: '',
    supplement_status: 'none',
    supplement_amount: '',
    supplement_notes: '',
    total_insurer_owed: '',
  })

  useEffect(() => {
    setForm({
      insurance_company: ro?.insurance_company || ro?.insurer || '',
      insurance_claim_number: ro?.insurance_claim_number || ro?.claim_number || '',
      policy_number: ro?.policy_number || '',
      adjuster_name: ro?.adjuster_name || '',
      adjuster_phone: ro?.adjuster_phone || '',
      adjuster_email: ro?.adjuster_email || '',
      deductible: dollarsValue(ro?.deductible),
      is_drp: !!ro?.is_drp,
      insurance_approved_amount: centsToDollars(ro?.insurance_approved_amount),
      supplement_status: ro?.supplement_status || 'none',
      supplement_amount: centsToDollars(ro?.supplement_amount),
      supplement_notes: ro?.supplement_notes || '',
      total_insurer_owed: centsToDollars(ro?.total_insurer_owed),
    })
  }, [ro])

  const totalPreview = useMemo(() => {
    const approved = Number(form.insurance_approved_amount || 0)
    const supplement = Number(form.supplement_amount || 0)
    return Number.isFinite(approved + supplement) ? (approved + supplement).toFixed(2) : '0.00'
  }, [form.insurance_approved_amount, form.supplement_amount])

  const supplementMeta = SUPPLEMENT_META[form.supplement_status] || SUPPLEMENT_META.none
  const inp = 'w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
  const selectedOcrCount = Object.values(ocrSelected).filter(Boolean).length

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (requestError) setRequestError('')
    if (saveError) setSaveError('')
  }

  async function saveInsurance() {
    setSaving(true)
    setSaveError('')
    try {
      const payload = {
        insurance_company: form.insurance_company || null,
        insurance_claim_number: form.insurance_claim_number || null,
        policy_number: form.policy_number || null,
        adjuster_name: form.adjuster_name || null,
        adjuster_phone: form.adjuster_phone || null,
        adjuster_email: form.adjuster_email || null,
        deductible: parseDollars(form.deductible),
        is_drp: !!form.is_drp,
        insurance_approved_amount: dollarsToCents(form.insurance_approved_amount),
        supplement_status: form.supplement_status || 'none',
        supplement_amount: dollarsToCents(form.supplement_amount),
        supplement_notes: form.supplement_notes || null,
      }
      await api.patch(`/ros/${roId}/insurance`, payload)
      onUpdated?.()
    } catch (err) {
      console.error('[InsurancePanel] Save insurance failed')
      setSaveError(err?.response?.data?.error || 'Could not save insurance details')
    } finally {
      setSaving(false)
    }
  }

  async function requestSupplement() {
    const amount = Number(form.supplement_amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setRequestError('Enter a supplement amount greater than $0.00.')
      return
    }
    setRequesting(true)
    setRequestError('')
    try {
      await api.post(`/ros/${roId}/supplement`, {
        amount: dollarsToCents(form.supplement_amount),
        notes: form.supplement_notes,
      })
      onUpdated?.()
    } catch (err) {
      console.error('[InsurancePanel] Request supplement failed')
      setRequestError(err?.response?.data?.error || 'Could not request supplement.')
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div className="col-span-full rounded-instrument border border-line-2 bg-panel p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <ShieldCheck size={12} /> Insurance
          </h2>
          <p className="mt-1 text-xs text-faint">
            {form.insurance_company || 'No carrier'} {form.insurance_claim_number ? `· Claim ${form.insurance_claim_number}` : ''}
          </p>
        </div>
        {open ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">

          {/* ── Insurance Estimate OCR Import ── */}
          <div className="rounded-instrument border border-dashed border-line-2 bg-panel-2 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <FileImage size={12} /> Import Insurance Estimate
              </h3>
              {(ocrFiles.length > 0 || ocrItems) && (
                <button type="button" onClick={() => {
                  setOcrFiles([])
                  setOcrPreview(null)
                  setOcrItems(null)
                  setOcrParsedMeta(null)
                  setOcrCrossCheck(null)
                  setOcrError(null)
                  setOcrNotice(null)
                }} className="rounded-md p-1 text-faint transition-colors hover:bg-crit/10 hover:text-crit" aria-label="Clear imported estimate">
                  <X size={14} />
                </button>
              )}
            </div>
            <p className="mb-3 text-[10px] text-faint">
              Upload a photo or scan of the adjuster's estimate. AI will extract line items you can import directly into the estimate.
            </p>
            {ocrNotice && <p role="status" className="mb-2 text-xs text-good">{ocrNotice}</p>}
            {ocrParsedMeta && (ocrParsedMeta.insurance_company || ocrParsedMeta.claim_number || ocrParsedMeta.adjuster_name || ocrParsedMeta.vehicle) && (
              <p className="mb-2 text-[10px] text-brand">
                Parsed: {[ocrParsedMeta.insurance_company, ocrParsedMeta.claim_number, ocrParsedMeta.adjuster_name, ocrParsedMeta.vehicle].filter(Boolean).join(' · ')}
              </p>
            )}
            <EstimateReviewWarning
              parsed={ocrParsedMeta}
              pendingActionCopy="Line items are not imported until you choose Import."
              className="mb-2"
            />
            {ocrCrossCheck?.hasMismatch && (
              <div role="alert" className="mb-2 space-y-1 rounded-instrument border border-crit/30 bg-crit/10 p-2">
                {ocrCrossCheck.messages.map((msg, idx) => (
                  <p key={idx} className="text-[10px] text-crit">{msg}</p>
                ))}
              </div>
            )}
            {ocrImportedCount > 0 && (
              <a href={`/estimate-builder/${roId}`} className="mb-2 inline-block text-[11px] text-brand underline transition-colors hover:text-brand-lit">
                Open Estimate Builder to review imported items
              </a>
            )}

            {!ocrFiles.length && !ocrItems && (
              <>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple className="hidden" aria-label="Insurance estimate files" onChange={handleFileChange} />
                {attachedAppraisalEvidence.length > 0 && (
                  <button
                    type="button"
                    onClick={parseAttachedAppraisal}
                    disabled={ocrParsing}
                    className="mb-2 w-full flex items-center justify-center gap-2 border border-brand/40 bg-brand/10 rounded-lg py-3 text-sm font-semibold text-brand hover:bg-brand/15 disabled:opacity-50"
                  >
                    <FileImage size={15} /> {ocrParsing ? 'Reading attached appraisal…' : `Use ${attachedAppraisalEvidence.length} Attached Appraisal Page${attachedAppraisalEvidence.length === 1 ? '' : 's'}`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-line-2 bg-void py-3 text-sm text-muted transition-colors hover:border-brand/50 hover:text-ink"
                >
                  <Upload size={15} /> Upload estimate photos / PDF
                </button>
              </>
            )}

            {ocrFiles.length > 0 && !ocrItems && (
              <div className="space-y-2">
                {ocrPreview && (
                  <img src={ocrPreview} alt="Estimate preview" className="max-h-40 w-full rounded-lg border border-line-2 object-contain" />
                )}
                {!ocrPreview && (
                  <p className="text-xs italic text-muted">{ocrFiles.map((file) => file.name).join(', ')}</p>
                )}
                <p className="text-[10px] text-faint">{ocrFiles.length} file{ocrFiles.length === 1 ? '' : 's'} selected</p>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple className="hidden" aria-label="Additional insurance estimate files" onChange={handleFileChange} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={ocrParsing || ocrFiles.length >= 12}
                  className="w-full rounded-lg border border-line-2 bg-void py-2 text-xs font-semibold text-muted transition-colors hover:border-brand/60 hover:text-ink disabled:opacity-50"
                >
                  Add another photo / PDF
                </button>
                {ocrError && <p role="alert" className="text-xs text-crit">{ocrError}</p>}
                <button
                  type="button"
                  onClick={() => parseEstimate()}
                  disabled={ocrParsing}
                  className="w-full rounded-lg bg-brand py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
                >
                  {ocrParsing ? 'Reading estimate…' : 'Extract Line Items with AI'}
                </button>
              </div>
            )}

            {ocrItems && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {ocrItems.length} items found — select to import:
                </p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {ocrItems.map((item, i) => (
                    <label key={i} className="flex cursor-pointer items-start gap-2 rounded p-1 transition-colors hover:bg-raised">
                      <input
                        type="checkbox"
                        checked={!!ocrSelected[i]}
                        onChange={e => setOcrSelected(prev => ({ ...prev, [i]: e.target.checked }))}
                        className="mt-0.5 accent-brand"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-xs text-ink">{item.description}</p>
                        <p className="font-mono text-[10px] tabular-nums text-faint">
                          {item.type} · qty {item.quantity ?? 1} · ${Number(item.unit_price ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                <EstimateFinancialReview totals={ocrParsedMeta?.estimate_totals} />
                {ocrError && <p role="alert" className="text-xs text-crit">{ocrError}</p>}
                <EstimateSelectionToolbar items={ocrItems} selected={ocrSelected} onChange={setOcrSelected} />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={importSelected}
                    disabled={ocrImporting || selectedOcrCount === 0}
                    className="min-h-11 bg-brand hover:bg-brand-lit disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg"
                  >
                    {ocrImporting ? 'Importing…' : `Import ${selectedOcrCount} item${selectedOcrCount === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] text-faint">Insurance Company</label>
              <input
                list="insurance-company-options"
                className={inp}
                value={form.insurance_company}
                onChange={(e) => set('insurance_company', e.target.value)}
                placeholder="State Farm"
              />
              <datalist id="insurance-company-options">
                {INSURANCE_COMPANIES.map((name) => <option key={name} value={name} />)}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-faint">Claim Number</label>
              <input aria-label="Claim number" className={inp} value={form.insurance_claim_number} onChange={(e) => set('insurance_claim_number', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-faint">Policy Number</label>
              <input aria-label="Policy number" className={inp} value={form.policy_number} onChange={(e) => set('policy_number', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-faint">Deductible ($)</label>
              <input aria-label="Deductible ($)" type="number" step="0.01" className={inp} value={form.deductible} onChange={(e) => set('deductible', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[10px] text-faint">Adjuster Name</label>
              <input aria-label="Adjuster name" className={inp} value={form.adjuster_name} onChange={(e) => set('adjuster_name', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-faint">Adjuster Phone</label>
              <div className="flex gap-2">
                <input aria-label="Adjuster phone" className={inp} value={form.adjuster_phone} onChange={(e) => set('adjuster_phone', e.target.value)} />
                {form.adjuster_phone && (
                  <a href={`tel:${form.adjuster_phone}`} className="rounded-lg border border-line-2 bg-void px-2.5 py-2 text-muted transition-colors hover:border-brand/50 hover:text-ink" aria-label="Call adjuster">
                    <Phone size={14} />
                  </a>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-faint">Adjuster Email</label>
              <div className="flex gap-2">
                <input aria-label="Adjuster email" className={inp} value={form.adjuster_email} onChange={(e) => set('adjuster_email', e.target.value)} />
                {form.adjuster_email && (
                  <a href={`mailto:${form.adjuster_email}`} className="rounded-lg border border-line-2 bg-void px-2.5 py-2 text-muted transition-colors hover:border-brand/50 hover:text-ink" aria-label="Email adjuster">
                    <Mail size={14} />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-instrument border border-line-2 bg-void px-3 py-2">
            <div>
              <p className="text-xs font-medium text-ink">Is this a Direct Repair Program job?</p>
              <p className="text-[10px] text-faint">Preferred insurer list work (DRP)</p>
            </div>
            <button
              type="button"
              onClick={() => set('is_drp', !form.is_drp)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${form.is_drp ? 'border-good/40 bg-good/10 text-good' : 'border-line-2 bg-panel-2 text-muted'}`}
              aria-pressed={form.is_drp}
            >
              {form.is_drp ? 'Yes' : 'No'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] text-faint">Insurance Approved Amount ($)</label>
              <input aria-label="Insurance approved amount" type="number" step="0.01" className={`${inp} font-mono tabular-nums`} value={form.insurance_approved_amount} onChange={(e) => set('insurance_approved_amount', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-faint">Total Insurer Owed ($)</label>
              <div className="flex h-[38px] items-center rounded-lg border border-gold/30 bg-gold/5 px-3 font-mono text-sm tabular-nums text-gold">
                ${form.total_insurer_owed || totalPreview}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-instrument border border-gold/30 bg-gold/5 p-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gold">
                <BadgeDollarSign size={12} /> Supplement
              </h3>
              <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${supplementMeta.cls}`}>
                {supplementMeta.label}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] text-faint">Supplement Status</label>
                <select
                  value={form.supplement_status}
                  onChange={(e) => set('supplement_status', e.target.value)}
                  className={inp}
                  aria-label="Supplement status"
                >
                  <option value="none">None</option>
                  <option value="requested">Requested</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="denied">Denied</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-faint">Supplement Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  className={`${inp} font-mono tabular-nums`}
                  aria-label="Supplement amount"
                  value={form.supplement_amount}
                  onChange={(e) => set('supplement_amount', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] text-faint">Notes</label>
              <textarea
                rows={3}
                className={inp}
                value={form.supplement_notes}
                onChange={(e) => set('supplement_notes', e.target.value)}
                placeholder="Additional damage found, teardown photos attached, etc."
                aria-label="Supplement notes"
              />
            </div>

            {requestError && (
              <p role="alert" className="text-xs text-crit">
                {requestError}
              </p>
            )}

            {saveError && (
              <p role="alert" className="text-xs text-crit">{saveError}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={requestSupplement}
                disabled={requesting}
                className="bg-gold hover:bg-gold-lit text-[var(--on-gold)] text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
              >
                {requesting ? 'Requesting...' : 'Request Supplement'}
              </button>
              <button
                type="button"
                onClick={saveInsurance}
                disabled={saving}
                className="bg-brand hover:bg-brand-lit text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Insurance'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
