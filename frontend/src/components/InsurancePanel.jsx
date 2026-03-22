import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeDollarSign, ChevronDown, ChevronUp, FileImage, Mail, Phone, ShieldCheck, Upload, X } from 'lucide-react'
import api from '../lib/api'
import { computeEstimateCrossCheck } from '../lib/estimateCrossCheck'

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
  none: { label: 'None', cls: 'bg-slate-900/40 text-slate-300 border-slate-700/40' },
  requested: { label: 'Requested', cls: 'bg-amber-900/40 text-amber-300 border-amber-700/40' },
  pending: { label: 'Pending', cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40' },
  approved: { label: 'Approved', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' },
  denied: { label: 'Denied', cls: 'bg-red-900/40 text-red-300 border-red-700/40' },
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

export default function InsurancePanel({ roId, ro, onUpdated }) {
  const [open, setOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] = useState(false)

  // OCR import state
  const fileInputRef = useRef(null)
  const [ocrFile, setOcrFile] = useState(null)
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

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setOcrFile(file)
    setOcrItems(null)
    setOcrParsedMeta(null)
    setOcrCrossCheck(null)
    setOcrSelected({})
    setOcrError(null)
    setOcrNotice(null)
    setOcrImportedCount(0)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (ev) => setOcrPreview(ev.target.result)
      reader.readAsDataURL(file)
    } else {
      setOcrPreview(null)
    }
  }

  async function parseEstimate() {
    if (!ocrFile) return
    setOcrParsing(true)
    setOcrError(null)
    try {
      const form = new FormData()
      form.append('estimate_image', ocrFile)
      const { data } = await api.post('/insurance-ocr/parse', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const parsed = data?.parsed || {}
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
      setOcrError(err?.response?.data?.error || 'Could not parse the estimate. Try a clearer file.')
    } finally {
      setOcrParsing(false)
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
      onUpdated?.()
      setOcrFile(null)
      setOcrPreview(null)
      setOcrItems(null)
      setOcrSelected({})
      setOcrImportedCount(imported)
      setOcrNotice(`Imported ${imported} item${imported !== 1 ? 's' : ''} to Estimate Builder.`)
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
      deductible: centsToDollars(ro?.deductible),
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
  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]'

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function saveInsurance() {
    setSaving(true)
    try {
      const payload = {
        insurance_company: form.insurance_company || null,
        insurance_claim_number: form.insurance_claim_number || null,
        policy_number: form.policy_number || null,
        adjuster_name: form.adjuster_name || null,
        adjuster_phone: form.adjuster_phone || null,
        adjuster_email: form.adjuster_email || null,
        deductible: dollarsToCents(form.deductible),
        is_drp: !!form.is_drp,
        insurance_approved_amount: dollarsToCents(form.insurance_approved_amount),
        supplement_status: form.supplement_status || 'none',
        supplement_amount: dollarsToCents(form.supplement_amount),
        supplement_notes: form.supplement_notes || null,
      }
      await api.patch(`/ros/${roId}/insurance`, payload)
      onUpdated?.()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not save insurance details')
    } finally {
      setSaving(false)
    }
  }

  async function requestSupplement() {
    setRequesting(true)
    try {
      await api.post(`/ros/${roId}/supplement`, {
        amount: dollarsToCents(form.supplement_amount),
        notes: form.supplement_notes,
      })
      onUpdated?.()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not request supplement')
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4 col-span-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            <ShieldCheck size={12} /> Insurance
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {form.insurance_company || 'No carrier'} {form.insurance_claim_number ? `· Claim ${form.insurance_claim_number}` : ''}
          </p>
        </div>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">

          {/* ── Insurance Estimate OCR Import ── */}
          <div className="border border-dashed border-[#2a2d3e] rounded-xl p-3 bg-[#111423]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <FileImage size={12} /> Import Insurance Estimate
              </h3>
              {ocrFile && (
                <button type="button" onClick={() => {
                  setOcrFile(null)
                  setOcrPreview(null)
                  setOcrItems(null)
                  setOcrParsedMeta(null)
                  setOcrCrossCheck(null)
                  setOcrError(null)
                  setOcrNotice(null)
                }} className="text-slate-500 hover:text-red-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mb-3">
              Upload a photo or scan of the adjuster's estimate. AI will extract line items you can import directly into the estimate.
            </p>
            {ocrNotice && <p className="text-xs text-emerald-300 mb-2">{ocrNotice}</p>}
            {ocrParsedMeta && (ocrParsedMeta.insurance_company || ocrParsedMeta.claim_number || ocrParsedMeta.adjuster_name || ocrParsedMeta.vehicle) && (
              <p className="text-[10px] text-indigo-300 mb-2">
                Parsed: {[ocrParsedMeta.insurance_company, ocrParsedMeta.claim_number, ocrParsedMeta.adjuster_name, ocrParsedMeta.vehicle].filter(Boolean).join(' · ')}
              </p>
            )}
            {ocrCrossCheck?.hasMismatch && (
              <div className="mb-2 rounded border border-red-700/40 bg-red-950/20 p-2 space-y-1">
                {ocrCrossCheck.messages.map((msg, idx) => (
                  <p key={idx} className="text-[10px] text-red-300">{msg}</p>
                ))}
              </div>
            )}
            {ocrImportedCount > 0 && (
              <a href={`/estimate-builder/${roId}`} className="inline-block mb-2 text-[11px] text-indigo-300 hover:text-indigo-200 underline">
                Open Estimate Builder to review imported items
              </a>
            )}

            {!ocrFile && (
              <>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 border border-[#2a2d3e] rounded-lg py-3 text-sm text-slate-400 hover:text-white hover:border-indigo-500 transition-colors"
                >
                  <Upload size={15} /> Upload estimate photo / PDF
                </button>
              </>
            )}

            {ocrFile && !ocrItems && (
              <div className="space-y-2">
                {ocrPreview && (
                  <img src={ocrPreview} alt="Estimate preview" className="w-full max-h-40 object-contain rounded-lg border border-[#2a2d3e]" />
                )}
                {!ocrPreview && (
                  <p className="text-xs text-slate-400 italic">{ocrFile.name}</p>
                )}
                {ocrError && <p className="text-xs text-red-400">{ocrError}</p>}
                <button
                  type="button"
                  onClick={parseEstimate}
                  disabled={ocrParsing}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-lg"
                >
                  {ocrParsing ? 'Reading estimate…' : 'Extract Line Items with AI'}
                </button>
              </div>
            )}

            {ocrItems && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">
                  {ocrItems.length} items found — select to import:
                </p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {ocrItems.map((item, i) => (
                    <label key={i} className="flex items-start gap-2 cursor-pointer hover:bg-[#1a1d2e] rounded p-1">
                      <input
                        type="checkbox"
                        checked={!!ocrSelected[i]}
                        onChange={e => setOcrSelected(prev => ({ ...prev, [i]: e.target.checked }))}
                        className="mt-0.5 accent-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white truncate">{item.description}</p>
                        <p className="text-[10px] text-slate-500">
                          {item.type} · qty {item.quantity ?? 1} · ${Number(item.unit_price ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                {ocrError && <p className="text-xs text-red-400">{ocrError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { const all = {}; ocrItems.forEach((_, i) => { all[i] = true }); setOcrSelected(all) }}
                    className="text-[10px] text-slate-400 hover:text-white"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setOcrSelected({})}
                    className="text-[10px] text-slate-400 hover:text-white"
                  >
                    None
                  </button>
                  <button
                    type="button"
                    onClick={importSelected}
                    disabled={ocrImporting || !Object.values(ocrSelected).some(Boolean)}
                    className="ml-auto bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-1.5 rounded-lg"
                  >
                    {ocrImporting ? 'Importing…' : `Import ${Object.values(ocrSelected).filter(Boolean).length} items`}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Insurance Company</label>
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
              <label className="text-[10px] text-slate-500 block mb-1">Claim Number</label>
              <input className={inp} value={form.insurance_claim_number} onChange={(e) => set('insurance_claim_number', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Policy Number</label>
              <input className={inp} value={form.policy_number} onChange={(e) => set('policy_number', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Deductible ($)</label>
              <input type="number" step="0.01" className={inp} value={form.deductible} onChange={(e) => set('deductible', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Adjuster Name</label>
              <input className={inp} value={form.adjuster_name} onChange={(e) => set('adjuster_name', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Adjuster Phone</label>
              <div className="flex gap-2">
                <input className={inp} value={form.adjuster_phone} onChange={(e) => set('adjuster_phone', e.target.value)} />
                {form.adjuster_phone && (
                  <a href={`tel:${form.adjuster_phone}`} className="px-2.5 py-2 rounded-lg bg-[#0f1117] border border-[#2a2d3e] text-slate-300 hover:text-white">
                    <Phone size={14} />
                  </a>
                )}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Adjuster Email</label>
              <div className="flex gap-2">
                <input className={inp} value={form.adjuster_email} onChange={(e) => set('adjuster_email', e.target.value)} />
                {form.adjuster_email && (
                  <a href={`mailto:${form.adjuster_email}`} className="px-2.5 py-2 rounded-lg bg-[#0f1117] border border-[#2a2d3e] text-slate-300 hover:text-white">
                    <Mail size={14} />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
            <div>
              <p className="text-xs text-white font-medium">Is this a Direct Repair Program job?</p>
              <p className="text-[10px] text-slate-500">Preferred insurer list work (DRP)</p>
            </div>
            <button
              type="button"
              onClick={() => set('is_drp', !form.is_drp)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${form.is_drp ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' : 'bg-slate-900/30 text-slate-300 border-slate-700/40'}`}
            >
              {form.is_drp ? 'Yes' : 'No'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Insurance Approved Amount ($)</label>
              <input type="number" step="0.01" className={inp} value={form.insurance_approved_amount} onChange={(e) => set('insurance_approved_amount', e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Total Insurer Owed ($)</label>
              <div className="h-[38px] px-3 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-sm text-emerald-300 flex items-center">
                ${form.total_insurer_owed || totalPreview}
              </div>
            </div>
          </div>

          <div className="border border-[#2a2d3e] rounded-xl p-3 space-y-3 bg-[#111423]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <BadgeDollarSign size={12} /> Supplement
              </h3>
              <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${supplementMeta.cls}`}>
                {supplementMeta.label}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Supplement Status</label>
                <select
                  value={form.supplement_status}
                  onChange={(e) => set('supplement_status', e.target.value)}
                  className={inp}
                >
                  <option value="none">None</option>
                  <option value="requested">Requested</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="denied">Denied</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Supplement Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  className={inp}
                  value={form.supplement_amount}
                  onChange={(e) => set('supplement_amount', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Notes</label>
              <textarea
                rows={3}
                className={inp}
                value={form.supplement_notes}
                onChange={(e) => set('supplement_notes', e.target.value)}
                placeholder="Additional damage found, teardown photos attached, etc."
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={requestSupplement}
                disabled={requesting}
                className="bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
              >
                {requesting ? 'Requesting...' : 'Request Supplement'}
              </button>
              <button
                type="button"
                onClick={saveInsurance}
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
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
