import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Camera, CheckCircle, Plus, Trash2, X } from 'lucide-react'
import api from '../lib/api'
import { computeEstimateCrossCheck } from '../lib/estimateCrossCheck'

const ITEM_TYPES = ['labor', 'parts', 'sublet', 'other']

function asNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function money(value) {
  return `$${asNumber(value, 0).toFixed(2)}`
}

// ── Severity badge helper ─────────────────────────────────────────────────────
function SeverityBadge({ severity }) {
  if (severity === 'high')   return <span className="text-xs bg-red-600/30 text-red-300 px-2 py-0.5 rounded font-medium">High</span>
  if (severity === 'medium') return <span className="text-xs bg-amber-600/30 text-amber-300 px-2 py-0.5 rounded font-medium">Medium</span>
  if (severity === 'low')    return <span className="text-xs bg-yellow-600/30 text-yellow-300 px-2 py-0.5 rounded font-medium">Review</span>
  return null
}

// ── OCR Preview Modal ─────────────────────────────────────────────────────────
function OcrModal({
  parsed,
  flags,
  analysisSummary,
  checked,
  crossCheck,
  metaNote,
  onToggle,
  onSelectAll,
  onSelectNone,
  onSelectPartsOnly,
  onImport,
  onCancel,
  importing,
}) {
  const checkedCount = Object.values(checked).filter(Boolean).length
  const hasAnalysis = flags && flags.length > 0
  const supplementTotal = analysisSummary?.total_supplement_opportunity || 0
  const undervalueCount = analysisSummary?.undervalue_count || 0

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d3e]">
          <div>
            <h2 className="text-white font-semibold text-base">Insurance Estimate Import</h2>
            {(parsed.insurance_company || parsed.claim_number || parsed.vehicle) && (
              <p className="text-slate-400 text-xs mt-0.5">
                {[parsed.insurance_company, parsed.claim_number, parsed.vehicle].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        {/* Phase 2: Analysis summary bar */}
        {metaNote && (
          <div className="px-5 py-3 bg-indigo-950/30 border-b border-indigo-800/30 text-indigo-200 text-xs">
            {metaNote}
          </div>
        )}
        {crossCheck?.hasMismatch && (
          <div className="px-5 py-3 bg-red-950/30 border-b border-red-800/30 space-y-1">
            {crossCheck.messages.map((msg, idx) => (
              <p key={idx} className="text-red-300 text-xs">{msg}</p>
            ))}
            <p className="text-red-200 text-[11px]">Review before importing.</p>
          </div>
        )}
        {hasAnalysis && supplementTotal > 0 && (
          <div className="px-5 py-3 bg-amber-950/40 border-b border-amber-800/40 flex items-center gap-3 flex-wrap">
            <AlertTriangle size={15} className="text-amber-400 shrink-0" />
            <span className="text-amber-300 text-sm font-medium">
              {undervalueCount} line{undervalueCount !== 1 ? 's' : ''} below your shop rate
            </span>
            <span className="text-amber-400 text-sm">
              · Supplement opportunity: <strong>{money(supplementTotal)}</strong>
            </span>
          </div>
        )}
        {hasAnalysis && supplementTotal === 0 && (
          <div className="px-5 py-3 bg-emerald-950/30 border-b border-emerald-800/30 flex items-center gap-3">
            <CheckCircle size={15} className="text-emerald-400 shrink-0" />
            <span className="text-emerald-300 text-sm">All line items are at or above your shop rates.</span>
          </div>
        )}

        {/* Line items */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <div className="text-[11px] text-slate-500">Select which lines to import</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSelectPartsOnly}
                className="text-[11px] px-2 py-1 rounded border border-[#2a2d3e] text-amber-300 hover:text-amber-200"
              >
                Select Parts Only
              </button>
              <button
                type="button"
                onClick={onSelectAll}
                className="text-[11px] px-2 py-1 rounded border border-[#2a2d3e] text-slate-300 hover:text-white"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={onSelectNone}
                className="text-[11px] px-2 py-1 rounded border border-[#2a2d3e] text-slate-300 hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>
          {parsed.line_items.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">No line items extracted. Try a clearer photo.</p>
          ) : parsed.line_items.map((item, idx) => {
            const flag = flags?.[idx]
            const isUndervalue = flag?.type === 'undervalue'
            const isReview = flag?.type === 'review'
            const borderClass = isUndervalue
              ? 'border-amber-700/60 bg-amber-950/20'
              : isReview
              ? 'border-yellow-700/40 bg-yellow-950/10'
              : 'border-[#2a2d3e]'

            return (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg bg-[#0f1117] border hover:border-indigo-500 transition-colors ${borderClass}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-indigo-500"
                  checked={!!checked[idx]}
                  onChange={() => onToggle(idx)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs bg-indigo-600/30 text-indigo-300 px-2 py-0.5 rounded font-medium">{item.type}</span>
                    {flag && flag.severity !== 'none' && <SeverityBadge severity={flag.severity} />}
                    <span className="text-white text-sm truncate">{item.description || '(no description)'}</span>
                  </div>
                  <div className="text-slate-400 text-xs mt-1">
                    Qty: {item.quantity} × {money(item.unit_price)} = {money(item.quantity * item.unit_price)}
                  </div>
                  {flag?.message && (
                    <div className="text-amber-400 text-xs mt-1">{flag.message}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer totals */}
        <div className="px-5 py-2 text-slate-400 text-xs border-t border-[#2a2d3e] flex items-center gap-4 flex-wrap">
          {parsed.total_allowed != null && (
            <span>Insurance total: <strong className="text-slate-200">{money(parsed.total_allowed)}</strong></span>
          )}
          {analysisSummary && (
            <>
              <span>Shop value: <strong className="text-slate-200">{money(analysisSummary.total_shop_value)}</strong></span>
              {analysisSummary.total_gap > 0 && (
                <span className="text-amber-400">Gap: <strong>{money(analysisSummary.total_gap)}</strong></span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[#2a2d3e]">
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-sm">Cancel</button>
          <button
            onClick={onImport}
            disabled={importing || checkedCount === 0}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {importing ? 'Importing...' : `Import ${checkedCount} item${checkedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function EstimateBuilder() {
  const { roId } = useParams()
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [ro, setRo] = useState(null)
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  // OCR state
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrModalOpen, setOcrModalOpen] = useState(false)
  const [ocrParsed, setOcrParsed] = useState(null)
  const [ocrFlags, setOcrFlags] = useState(null)
  const [ocrAnalysisSummary, setOcrAnalysisSummary] = useState(null)
  const [ocrChecked, setOcrChecked] = useState({})
  const [ocrImporting, setOcrImporting] = useState(false)
  const [ocrCrossCheck, setOcrCrossCheck] = useState(null)
  const [ocrMetaNote, setOcrMetaNote] = useState('')
  const [adjusterTotals, setAdjusterTotals] = useState(null)
  const [importingFinancials, setImportingFinancials] = useState(false)
  const [financialNotice, setFinancialNotice] = useState('')
  const [opportunity, setOpportunity] = useState(null)
  const [opportunityLoading, setOpportunityLoading] = useState(false)
  const [bulkTaxableSaving, setBulkTaxableSaving] = useState(false)

  async function loadOpportunities({ silent = false } = {}) {
    if (!silent) setOpportunityLoading(true)
    try {
      const { data } = await api.get(`/estimate-items/${roId}/opportunities`)
      setOpportunity({
        summary: data?.summary || null,
        flags: Array.isArray(data?.flags) ? data.flags : [],
        shopRates: data?.shop_rates || {},
      })
    } catch (_) {
      if (!silent) setOpportunity(null)
    } finally {
      if (!silent) setOpportunityLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      try {
        const [itemsRes, roRes] = await Promise.all([
          api.get(`/estimate-items/${roId}`),
          api.get(`/ros/${roId}`),
        ])
        if (!mounted) return
        setItems(itemsRes.data?.items || [])
        setSummary(itemsRes.data?.summary || null)
        setRo(roRes.data || null)
        await loadOpportunities({ silent: true })
      } catch (err) {
        alert(err?.response?.data?.error || 'Could not load estimate builder')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  }, [roId])

  const orderedItems = useMemo(
    () => [...items].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    [items]
  )

  function updateItemLocal(id, patch) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function saveItem(id, patch = null) {
    const current = items.find((item) => item.id === id)
    if (!current) return
    const next = patch ? { ...current, ...patch } : current
    setSavingId(id)
    try {
      const payload = {
        type: next.type,
        description: next.description || '',
        quantity: asNumber(next.quantity, 0),
        unit_price: asNumber(next.unit_price, 0),
        taxable: !!next.taxable,
        sort_order: Math.max(0, Math.trunc(asNumber(next.sort_order, 0))),
      }
      const { data } = await api.put(`/estimate-items/${roId}/${id}`, payload)
      updateItemLocal(id, data.item)
      setSummary(data.summary || null)
      await loadOpportunities({ silent: true })
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not save line item')
    } finally {
      setSavingId(null)
    }
  }

  async function addRow() {
    setAdding(true)
    try {
      const nextSort = items.length
      const { data } = await api.post(`/estimate-items/${roId}`, {
        type: 'labor',
        description: '',
        quantity: 1,
        unit_price: 0,
        taxable: false,
        sort_order: nextSort,
      })
      setItems((prev) => [...prev, data.item])
      setSummary(data.summary || null)
      await loadOpportunities({ silent: true })
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not add line item')
    } finally {
      setAdding(false)
    }
  }

  async function deleteRow(itemId) {
    setDeletingId(itemId)
    try {
      const { data } = await api.delete(`/estimate-items/${roId}/${itemId}`)
      setItems((prev) => prev.filter((item) => item.id !== itemId))
      setSummary(data.summary || null)
      await loadOpportunities({ silent: true })
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete line item')
    } finally {
      setDeletingId(null)
    }
  }

  async function setAllTaxable(nextTaxable) {
    const toUpdate = items.filter((item) => !!item.taxable !== !!nextTaxable)
    if (!toUpdate.length) return
    setBulkTaxableSaving(true)
    setItems((prev) => prev.map((item) => (
      toUpdate.some((candidate) => candidate.id === item.id)
        ? { ...item, taxable: !!nextTaxable }
        : item
    )))

    try {
      let lastSummary = summary
      for (const item of toUpdate) {
        const payload = {
          type: item.type,
          description: item.description || '',
          quantity: asNumber(item.quantity, 0),
          unit_price: asNumber(item.unit_price, 0),
          taxable: !!nextTaxable,
          sort_order: Math.max(0, Math.trunc(asNumber(item.sort_order, 0))),
        }
        const { data } = await api.put(`/estimate-items/${roId}/${item.id}`, payload)
        setItems((prev) => prev.map((row) => (row.id === item.id ? data.item : row)))
        lastSummary = data.summary || lastSummary
      }
      setSummary(lastSummary || null)
      await loadOpportunities({ silent: true })
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not update taxable values')
      try {
        const { data } = await api.get(`/estimate-items/${roId}`)
        setItems(data?.items || [])
        setSummary(data?.summary || null)
      } catch (_) {}
    } finally {
      setBulkTaxableSaving(false)
    }
  }

  async function importFinancialsToRo() {
    setImportingFinancials(true)
    setFinancialNotice('')
    try {
      const { data } = await api.post(`/estimate-items/${roId}/import-financials`)
      if (data?.summary) setSummary(data.summary)
      if (data?.financials) {
        setRo((prev) => (prev ? { ...prev, ...data.financials } : prev))
      }
      setFinancialNotice(`Imported financials into RO · Total ${money(data?.summary?.grand_total || 0)}`)
      await loadOpportunities({ silent: true })
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not import financial data into RO')
    } finally {
      setImportingFinancials(false)
    }
  }

  // ── OCR handlers ────────────────────────────────────────────────────────────
  async function handleOcrFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setOcrLoading(true)
    try {
      // Phase 1: parse
      const form = new FormData()
      form.append('estimate_image', file)
      const { data } = await api.post('/insurance-ocr/parse', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (!data.success) throw new Error(data.error || 'Parse failed')
      const parsed = {
        ...(data.parsed || {}),
        line_items: Array.isArray(data?.parsed?.line_items) ? data.parsed.line_items : [],
      }
      const initialChecked = {}
      parsed.line_items.forEach((_, idx) => { initialChecked[idx] = true })
      setOcrParsed(parsed)
      setAdjusterTotals(parsed?.estimate_totals || null)
      setOcrChecked(initialChecked)
      setOcrFlags(null)
      setOcrAnalysisSummary(null)
      const crossCheck = computeEstimateCrossCheck(parsed, ro)
      setOcrCrossCheck(crossCheck)
      setOcrMetaNote('')

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
          setRo((prev) => (prev ? {
            ...prev,
            ...patch,
            insurer: patch.insurance_company ?? prev.insurer,
            claim_number: patch.insurance_claim_number ?? prev.claim_number,
          } : prev))
          const appliedFields = []
          if (patch.insurance_company) appliedFields.push('carrier')
          if (patch.insurance_claim_number) appliedFields.push('claim #')
          if (patch.adjuster_name) appliedFields.push('adjuster')
          if (patch.adjuster_phone) appliedFields.push('adjuster phone')
          if (patch.adjuster_email) appliedFields.push('adjuster email')
          setOcrMetaNote(`Auto-populated ${appliedFields.join(', ')} from the estimate.`)
        } catch {
          setOcrMetaNote('Parsed metadata found, but auto-save failed. You can still import line items.')
        }
      } else if (crossCheck.hasMismatch) {
        setOcrMetaNote('Potential mismatch found. Metadata was not auto-overwritten.')
      }

      // Phase 2: analyze (non-blocking — show modal immediately, update when ready)
      setOcrModalOpen(true)
      try {
        const { data: aData } = await api.post('/insurance-ocr/analyze', {
          line_items: parsed.line_items,
        })
        if (aData.success) {
          setOcrFlags(aData.flags)
          setOcrAnalysisSummary(aData.summary)
        }
      } catch {
        // Analysis failure is non-fatal — import still works
      }
    } catch (err) {
      alert(err?.response?.data?.error || err.message || 'Could not parse estimate file')
    } finally {
      setOcrLoading(false)
    }
  }

  function toggleOcrItem(idx) {
    setOcrChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  function selectAllOcrItems() {
    if (!ocrParsed?.line_items?.length) return
    const next = {}
    ocrParsed.line_items.forEach((_, idx) => {
      next[idx] = true
    })
    setOcrChecked(next)
  }

  function clearOcrSelection() {
    if (!ocrParsed?.line_items?.length) return
    const next = {}
    ocrParsed.line_items.forEach((_, idx) => {
      next[idx] = false
    })
    setOcrChecked(next)
  }

  function selectPartsOnlyOcrItems() {
    if (!ocrParsed?.line_items?.length) return
    const next = {}
    ocrParsed.line_items.forEach((item, idx) => {
      next[idx] = String(item?.type || '').toLowerCase() === 'parts'
    })
    setOcrChecked(next)
  }


  async function importOcrItems() {
    if (!ocrParsed) return
    if (ocrCrossCheck?.hasMismatch) {
      const proceed = window.confirm(
        `Potential mismatch detected:\n- ${ocrCrossCheck.messages.join('\n- ')}\n\nImport selected line items anyway?`
      )
      if (!proceed) return
    }
    setOcrImporting(true)
    const selectedIndexSet = new Set(
      Object.entries(ocrChecked || {})
        .filter(([, isChecked]) => isChecked === true)
        .map(([idx]) => Number(idx))
        .filter((idx) => Number.isInteger(idx) && idx >= 0)
    )
    const toImport = ocrParsed.line_items.filter((_, idx) => selectedIndexSet.has(idx))
    if (!toImport.length) {
      setOcrImporting(false)
      alert('No line items selected to import.')
      return
    }
    let lastSummary = summary
    let imported = 0
    let partsRequestsCreated = 0
    let partsRequestsFailed = 0
    try {
      for (const item of toImport) {
        const nextSort = items.length + imported
        const { data } = await api.post(`/estimate-items/${roId}`, {
          type: item.type,
          description: item.description,
          quantity: asNumber(item.quantity, 1),
          unit_price: asNumber(item.unit_price, 0),
          taxable: false,
          sort_order: nextSort,
        })
        setItems((prev) => [...prev, data.item])
        lastSummary = data.summary || lastSummary
        imported++

        if (String(item.type || '').toLowerCase() === 'parts') {
          const partName = String(item.description || '').trim() || 'Imported part'
          const requestedQty = Math.max(1, Math.ceil(asNumber(item.quantity, 1)))
          try {
            await api.post('/parts-requests', {
              ro_id: roId,
              part_name: partName,
              quantity: requestedQty,
              notes: 'Auto-created from insurance estimate import',
            })
            partsRequestsCreated++
          } catch (_) {
            partsRequestsFailed++
          }
        }
      }
      setSummary(lastSummary)
      try {
        const refreshed = await api.get(`/estimate-items/${roId}`)
        setItems(refreshed.data?.items || [])
        setSummary(refreshed.data?.summary || lastSummary)
      } catch (_) {}
      setOcrModalOpen(false)
      setOcrParsed(null)
      setOcrCrossCheck(null)
      setOcrMetaNote('')
      const noticeLines = [
        `${imported} item${imported !== 1 ? 's' : ''} imported from insurance estimate.`,
      ]
      if (partsRequestsCreated > 0) {
        noticeLines.push(`${partsRequestsCreated} part request${partsRequestsCreated !== 1 ? 's' : ''} added to Parts Requests.`)
      }
      if (partsRequestsFailed > 0) {
        noticeLines.push(`${partsRequestsFailed} part request${partsRequestsFailed !== 1 ? 's' : ''} could not be created.`)
      }
      alert(noticeLines.join('\n'))
      await loadOpportunities({ silent: true })
    } catch (err) {
      alert(err?.response?.data?.error || 'Import failed — some items may not have been added')
    } finally {
      setOcrImporting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="text-slate-400">Loading estimate builder...</div>
  }

  const totals = summary || {
    subtotal: 0, labor_total: 0, parts_total: 0, sublet_total: 0,
    other_total: 0, taxable_subtotal: 0, tax_rate: 0, tax_amount: 0,
    grand_total: 0, line_count: 0,
  }
  const taxableCount = orderedItems.filter((item) => !!item.taxable).length
  const allTaxableSelected = orderedItems.length > 0 && taxableCount === orderedItems.length
  const noneTaxableSelected = taxableCount === 0
  const hasAdjusterTotals = !!adjusterTotals
  const adjusterRepairTotal = hasAdjusterTotals ? asNumber(adjusterTotals.total_cost_of_repairs, 0) : null
  const adjusterNetRepair = hasAdjusterTotals ? asNumber(adjusterTotals.net_cost_of_repairs, 0) : null
  const revvTotal = asNumber(totals.grand_total, 0)
  const revvVsAdjusterVariance = adjusterRepairTotal === null ? null : (revvTotal - adjusterRepairTotal)

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {ocrModalOpen && ocrParsed && (
        <OcrModal
          parsed={ocrParsed}
          flags={ocrFlags}
          analysisSummary={ocrAnalysisSummary}
          crossCheck={ocrCrossCheck}
          metaNote={ocrMetaNote}
          checked={ocrChecked}
          onToggle={toggleOcrItem}
          onSelectAll={selectAllOcrItems}
          onSelectNone={clearOcrSelection}
          onSelectPartsOnly={selectPartsOnlyOcrItems}
          onImport={importOcrItems}
          onCancel={() => {
            setOcrModalOpen(false)
            setOcrParsed(null)
            setOcrFlags(null)
            setOcrAnalysisSummary(null)
            setOcrCrossCheck(null)
            setOcrMetaNote('')
          }}
          importing={ocrImporting}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,application/pdf"
        className="hidden"
        onChange={handleOcrFile}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate(`/ros/${roId}`)} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">Estimate Builder</h1>
          <p className="text-slate-500 text-sm truncate">{ro?.ro_number || roId} {ro?.customer?.name ? `· ${ro.customer.name}` : ''}</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={ocrLoading}
          className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <Camera size={12} /> {ocrLoading ? 'Scanning...' : 'Import Insurance Estimate'}
        </button>
        <button
          onClick={addRow}
          disabled={adding}
          className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <Plus size={12} /> {adding ? 'Adding...' : 'Add Row'}
        </button>
        <button
          onClick={importFinancialsToRo}
          disabled={importingFinancials}
          className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <CheckCircle size={12} /> {importingFinancials ? 'Importing Financials...' : 'Import Financials To RO'}
        </button>
      </div>
      {financialNotice && (
        <div className="text-xs text-emerald-300 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">
          {financialNotice}
        </div>
      )}

      {hasAdjusterTotals && (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-white">Adjustor Estimate Totals</h2>
            {revvVsAdjusterVariance !== null && (
              <div className={`text-xs font-semibold ${Math.abs(revvVsAdjusterVariance) < 0.01 ? 'text-emerald-300' : 'text-amber-300'}`}>
                REVV vs Adjustor variance: {money(revvVsAdjusterVariance)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
              <p className="text-slate-400">Parts</p>
              <p className="text-white font-semibold">{money(adjusterTotals.parts)}</p>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
              <p className="text-slate-400">Body Labor</p>
              <p className="text-white font-semibold">
                {asNumber(adjusterTotals.body_labor_hours, 0).toFixed(1)}h @ {money(adjusterTotals.body_labor_rate)} = {money(adjusterTotals.body_labor_cost)}
              </p>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
              <p className="text-slate-400">Paint Labor</p>
              <p className="text-white font-semibold">
                {asNumber(adjusterTotals.paint_labor_hours, 0).toFixed(1)}h @ {money(adjusterTotals.paint_labor_rate)} = {money(adjusterTotals.paint_labor_cost)}
              </p>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
              <p className="text-slate-400">Paint Supplies</p>
              <p className="text-white font-semibold">
                {asNumber(adjusterTotals.paint_supplies_hours, 0).toFixed(1)}h @ {money(adjusterTotals.paint_supplies_rate)} = {money(adjusterTotals.paint_supplies_cost)}
              </p>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
              <p className="text-slate-400">Misc + Other</p>
              <p className="text-white font-semibold">
                {money(asNumber(adjusterTotals.miscellaneous, 0) + asNumber(adjusterTotals.other_charges, 0))}
              </p>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
              <p className="text-slate-400">Subtotal</p>
              <p className="text-white font-semibold">{money(adjusterTotals.subtotal)}</p>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
              <p className="text-slate-400">Total Cost of Repairs</p>
              <p className="text-white font-semibold">{money(adjusterRepairTotal)}</p>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
              <p className="text-slate-400">Net Cost of Repairs</p>
              <p className="text-white font-semibold">{money(adjusterNetRepair)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-white">Profit Opportunity Review</h2>
          <button
            type="button"
            onClick={() => loadOpportunities()}
            disabled={opportunityLoading}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-[#2a2d3e] text-slate-300 hover:text-white disabled:opacity-50"
          >
            {opportunityLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {opportunity?.summary ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
                <p className="text-slate-400">Undercut Labor Lines</p>
                <p className="text-amber-300 font-semibold">{opportunity.summary.labor_undercut_count || 0}</p>
              </div>
              <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
                <p className="text-slate-400">Supplement Opportunity</p>
                <p className="text-emerald-300 font-semibold">{money(opportunity.summary.total_supplement_opportunity || 0)}</p>
              </div>
              <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
                <p className="text-slate-400">Projected RO Total</p>
                <p className="text-white font-semibold">{money(opportunity.summary.projected_grand_total || 0)}</p>
              </div>
              <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2">
                <p className="text-slate-400">Projected Profit Uplift</p>
                <p className="text-emerald-300 font-semibold">+{money(opportunity.summary.profit_uplift || 0)}</p>
              </div>
            </div>
            {(opportunity.flags || []).length > 0 ? (
              <div className="space-y-1">
                {opportunity.flags.slice(0, 6).map((flag, idx) => (
                  <div key={`${flag.item_id || idx}-${idx}`} className="text-xs bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                    <p className="text-slate-300 truncate">{flag.description || 'Line item'}</p>
                    <p className="text-amber-300 font-medium whitespace-nowrap">+{money(flag.supplement_opportunity || 0)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-emerald-300">No labor undercut detected on current estimate items.</p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500">No opportunity data yet.</p>
        )}
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[#0f1117] text-slate-400">
            <tr>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Unit Price</th>
              <th className="text-center px-3 py-2">
                <div className="flex items-center justify-center gap-2">
                  <span>Taxable</span>
                  <button
                    type="button"
                    disabled={bulkTaxableSaving || allTaxableSelected || orderedItems.length === 0}
                    onClick={() => setAllTaxable(true)}
                    className={`px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                      allTaxableSelected
                        ? 'border-emerald-600/60 text-emerald-300 bg-emerald-900/30'
                        : 'border-[#2a2d3e] text-slate-300 hover:text-white'
                    } disabled:opacity-50`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    disabled={bulkTaxableSaving || noneTaxableSelected || orderedItems.length === 0}
                    onClick={() => setAllTaxable(false)}
                    className={`px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                      noneTaxableSelected
                        ? 'border-slate-500/60 text-slate-200 bg-slate-800/40'
                        : 'border-[#2a2d3e] text-slate-300 hover:text-white'
                    } disabled:opacity-50`}
                  >
                    None
                  </button>
                </div>
              </th>
              <th className="text-right px-3 py-2">Sort</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orderedItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">No line items yet.</td>
              </tr>
            ) : orderedItems.map((item) => (
              <tr key={item.id} className="border-t border-[#2a2d3e]">
                <td className="px-3 py-2">
                  <select
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white"
                    value={item.type}
                    onChange={(e) => {
                      const patch = { type: e.target.value }
                      updateItemLocal(item.id, patch)
                      saveItem(item.id, patch)
                    }}
                  >
                    {ITEM_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white"
                    value={item.description || ''}
                    onChange={(e) => updateItemLocal(item.id, { description: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                    placeholder="Line item description"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="0.01"
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white text-right"
                    value={item.quantity}
                    onChange={(e) => updateItemLocal(item.id, { quantity: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="0.01"
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white text-right"
                    value={item.unit_price}
                    onChange={(e) => updateItemLocal(item.id, { unit_price: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={!!item.taxable}
                    className="accent-indigo-500"
                    onChange={(e) => {
                      const patch = { taxable: e.target.checked }
                      updateItemLocal(item.id, patch)
                      saveItem(item.id, patch)
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="1"
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white text-right"
                    value={item.sort_order}
                    onChange={(e) => updateItemLocal(item.id, { sort_order: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2 text-right text-white font-medium">{money(item.total)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => deleteRow(item.id)}
                    disabled={deletingId === item.id}
                    className="inline-flex items-center gap-1 text-red-300 hover:text-red-200 text-xs"
                  >
                    <Trash2 size={13} /> {deletingId === item.id ? 'Deleting...' : 'Delete'}
                  </button>
                  {savingId === item.id && <span className="ml-2 text-[11px] text-slate-500">Saving...</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#2a2d3e] bg-[#0f1117] text-slate-300 text-xs">
              <td className="px-3 py-2" colSpan={3}>Labor: {money(totals.labor_total)}</td>
              <td className="px-3 py-2">Parts: {money(totals.parts_total)}</td>
              <td className="px-3 py-2" colSpan={2}>Sublet: {money(totals.sublet_total)}</td>
              <td className="px-3 py-2" colSpan={2}>Other: {money(totals.other_total)}</td>
            </tr>
            <tr className="border-t border-[#2a2d3e] bg-[#0f1117] text-slate-200 text-sm font-medium">
              <td className="px-3 py-2" colSpan={3}>Taxable Subtotal: {money(totals.taxable_subtotal)}</td>
              <td className="px-3 py-2" colSpan={2}>Tax ({(asNumber(totals.tax_rate, 0) * 100).toFixed(2)}%): {money(totals.tax_amount)}</td>
              <td className="px-3 py-2 text-right" colSpan={2}>Subtotal: {money(totals.subtotal)}</td>
              <td className="px-3 py-2 text-right">Grand Total: {money(totals.grand_total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
