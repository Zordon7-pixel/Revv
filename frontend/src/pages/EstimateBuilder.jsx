import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Camera, CheckCircle, Plus, Trash2, X } from 'lucide-react'
import api from '../lib/api'
import { computeEstimateCrossCheck } from '../lib/estimateCrossCheck'
import { safeExternalErrorMessage } from '../lib/safeErrors'
import EstimateReviewWarning from '../components/EstimateReviewWarning'
import AppOverlay from '../components/AppOverlay'
import EstimateFinancialReview from '../components/EstimateFinancialReview'
import EstimateSelectionToolbar from '../components/EstimateSelectionToolbar'

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
  if (severity === 'high')   return <span className="text-xs bg-crit/30 text-crit px-2 py-0.5 rounded font-medium">High</span>
  if (severity === 'medium') return <span className="text-xs bg-gold/20 text-gold px-2 py-0.5 rounded font-medium">Medium</span>
  if (severity === 'low')    return <span className="text-xs bg-raised text-muted px-2 py-0.5 rounded font-medium">Review</span>
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
  onSelectionChange,
  onImport,
  onCancel,
  importing,
  error,
}) {
  const checkedCount = Object.values(checked).filter(Boolean).length
  const hasAnalysis = flags && flags.length > 0
  const supplementTotal = analysisSummary?.total_supplement_opportunity || 0
  const undervalueCount = analysisSummary?.undervalue_count || 0

  return (
    <AppOverlay
      label="Insurance estimate import"
      onClose={() => !importing && onCancel()}
      className="bg-black/75 p-3 sm:p-5"
    >
      <div className="flex max-h-[calc(var(--app-viewport-height)-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-instrument border border-line-2 bg-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-2">
          <div>
            <h2 className="text-ink font-semibold text-base">Insurance Estimate Import</h2>
            {(parsed.insurance_company || parsed.claim_number || parsed.vehicle) && (
              <p className="text-muted text-xs mt-0.5">
                {[parsed.insurance_company, parsed.claim_number, parsed.vehicle].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button type="button" onClick={onCancel} disabled={importing} className="text-muted hover:text-ink disabled:opacity-50" aria-label="Close estimate import"><X size={18} /></button>
        </div>

        {/* Phase 2: Analysis summary bar */}
        {metaNote && (
          <div className="px-5 py-3 bg-brand/30 border-b border-brand/30 text-brand text-xs">
            {metaNote}
          </div>
        )}
        <EstimateReviewWarning
          parsed={parsed}
          pendingActionCopy="Line items are not imported until you choose Import."
          className="mx-5 mt-3"
        />
        {crossCheck?.hasMismatch && (
          <div className="px-5 py-3 bg-crit/30 border-b border-crit/30 space-y-1">
            {crossCheck.messages.map((msg, idx) => (
              <p key={idx} className="text-crit text-xs">{msg}</p>
            ))}
            <p className="text-crit text-[11px]">Review before importing.</p>
          </div>
        )}
        {error && (
          <div role="alert" className="border-b border-crit/40 bg-crit/20 px-5 py-3 text-xs text-crit">
            {error}
          </div>
        )}
        {hasAnalysis && supplementTotal > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-gold/40 bg-gold/10 px-5 py-3">
            <AlertTriangle size={15} className="text-gold shrink-0" />
            <span className="text-gold text-sm font-medium">
              {undervalueCount} line{undervalueCount !== 1 ? 's' : ''} below your shop rate
            </span>
            <span className="text-gold text-sm">
              · Supplement opportunity: <strong className="font-mono tabular-nums">{money(supplementTotal)}</strong>
            </span>
          </div>
        )}
        {hasAnalysis && supplementTotal === 0 && (
          <div className="px-5 py-3 bg-good/30 border-b border-good/30 flex items-center gap-3">
            <CheckCircle size={15} className="text-good shrink-0" />
            <span className="text-good text-sm">All line items are at or above your shop rates.</span>
          </div>
        )}

        {/* Financial review + line items */}
        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
          <EstimateFinancialReview totals={parsed.estimate_totals} />
          <div className="sticky top-0 z-10 rounded-instrument border border-line-2 bg-panel/95 p-3 backdrop-blur">
            <EstimateSelectionToolbar
              items={parsed.line_items}
              selected={checked}
              onChange={onSelectionChange}
            />
          </div>
          {parsed.line_items.length === 0 ? (
            <p className="text-faint text-sm text-center py-6">No line items extracted. Try a clearer photo.</p>
          ) : parsed.line_items.map((item, idx) => {
            const flag = flags?.[idx]
            const isUndervalue = flag?.type === 'undervalue'
            const isReview = flag?.type === 'review'
            const borderClass = isUndervalue
              ? 'border-gold/50 bg-gold/10'
              : isReview
              ? 'border-line-2 bg-raised'
              : 'border-line-2'

            return (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg bg-void border hover:border-brand transition-colors ${borderClass}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
                  checked={!!checked[idx]}
                  onChange={() => onToggle(idx)}
                  aria-label={`Select ${item.description || `estimate line ${idx + 1}`}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs bg-brand/30 text-brand px-2 py-0.5 rounded font-medium">{item.type}</span>
                    {flag && flag.severity !== 'none' && <SeverityBadge severity={flag.severity} />}
                    <span className="text-ink text-sm truncate">{item.description || '(no description)'}</span>
                  </div>
                  <div className="text-muted text-xs mt-1">
                    Qty: {item.quantity} × {money(item.unit_price)} = {money(item.quantity * item.unit_price)}
                  </div>
                  {flag?.message && (
                    <div className="text-crit text-xs mt-1">{flag.message}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer totals */}
        <div className="px-5 py-2 text-muted text-xs border-t border-line-2 flex items-center gap-4 flex-wrap">
          {parsed.total_allowed != null && (
            <span>Insurance total: <strong className="text-ink">{money(parsed.total_allowed)}</strong></span>
          )}
          {analysisSummary && (
            <>
              <span>Shop value: <strong className="text-ink">{money(analysisSummary.total_shop_value)}</strong></span>
              {analysisSummary.total_gap > 0 && (
                <span className="text-gold">Gap: <strong className="font-mono tabular-nums">{money(analysisSummary.total_gap)}</strong></span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-line-2">
          <button type="button" onClick={onCancel} disabled={importing} className="min-h-11 px-3 text-sm text-muted hover:text-ink disabled:opacity-50">Cancel</button>
          <button
            type="button"
            onClick={onImport}
            disabled={importing || checkedCount === 0}
            className="min-h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-on-gold transition-colors hover:bg-gold-lit disabled:opacity-50"
          >
            {importing ? 'Importing...' : `Import ${checkedCount} item${checkedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </AppOverlay>
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
  const [ocrError, setOcrError] = useState('')
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
  const [gapReview, setGapReview] = useState(null)
  const [gapReviewLoading, setGapReviewLoading] = useState(false)
  const [gapReviewError, setGapReviewError] = useState('')
  const [addingGapCode, setAddingGapCode] = useState('')
  const [bulkTaxableSaving, setBulkTaxableSaving] = useState(false)
  const [actionFeedback, setActionFeedback] = useState(null)

  function showActionFeedback(type, text) {
    setActionFeedback({ type, text })
  }

  async function loadGapReview({ silent = false } = {}) {
    if (!silent) setGapReviewLoading(true)
    try {
      const { data } = await api.get(`/estimate-assistant/gap-review/${roId}`)
      setGapReview(data || null)
      setGapReviewError('')
    } catch (err) {
      if (!silent) {
        setGapReview(null)
        setGapReviewError(err?.response?.data?.error || 'Could not review estimate gaps')
      }
    } finally {
      if (!silent) setGapReviewLoading(false)
    }
  }

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
    await loadGapReview({ silent: true })
  }

  async function addGapDraft(gap) {
    if (!gap?.draft || !gap?.code) return
    setAddingGapCode(gap.code)
    setGapReviewError('')
    try {
      const { data } = await api.post(`/estimate-items/${roId}`, {
        ...gap.draft,
        unit_price: 0,
        taxable: false,
        sort_order: items.length,
      })
      setItems((prev) => [...prev, data.item])
      setSummary(data.summary || null)
      await loadOpportunities({ silent: true })
    } catch (err) {
      setGapReviewError(err?.response?.data?.error || 'Could not add the draft line')
    } finally {
      setAddingGapCode('')
    }
  }

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      try {
        const [itemsRes, roRes, metaRes] = await Promise.all([
          api.get(`/estimate-items/${roId}`),
          api.get(`/ros/${roId}`),
          api.get(`/estimate-metadata/metadata/${roId}`).catch(() => null),
        ])
        if (!mounted) return
        setItems(itemsRes.data?.items || [])
        setSummary(itemsRes.data?.summary || null)
        setRo(roRes.data || null)
        if (metaRes?.data?.metadata?.adjuster_totals) {
          setAdjusterTotals(metaRes.data.metadata.adjuster_totals)
        }
        await loadOpportunities({ silent: true })
      } catch (err) {
        showActionFeedback('error', err?.response?.data?.error || 'Could not load estimate builder')
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
      showActionFeedback('error', err?.response?.data?.error || 'Could not save line item')
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
      showActionFeedback('error', err?.response?.data?.error || 'Could not add line item')
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
      showActionFeedback('error', err?.response?.data?.error || 'Could not delete line item')
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
      showActionFeedback('error', err?.response?.data?.error || 'Could not update taxable values')
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
      showActionFeedback('error', err?.response?.data?.error || 'Could not import financial data into RO')
    } finally {
      setImportingFinancials(false)
    }
  }

  // ── OCR handlers ────────────────────────────────────────────────────────────
  async function handleOcrFile(e) {
    const files = Array.from(e.target.files || []).slice(0, 12)
    if (!files.length) return
    e.target.value = ''
    setOcrLoading(true)
    setOcrError('')
    try {
      // Phase 1: parse
      const form = new FormData()
      files.forEach((file) => form.append('estimate_images', file))
      const { data } = await api.post('/insurance-ocr/parse', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (!data.success) throw new Error(data.error || 'Parse failed')
      const parsed = {
        ...(data.parsed || {}),
        detected_format: data?.parsed?.detected_format || data?.detected_format || null,
        needs_review: Boolean(data?.needs_review || data?.parsed?.needs_review),
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
      setOcrError(safeExternalErrorMessage(err, 'Could not parse estimate file. Try again or upload a clearer file.'))
    } finally {
      setOcrLoading(false)
    }
  }

  function toggleOcrItem(idx) {
    setOcrChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  async function importOcrItems() {
    if (!ocrParsed) return
    setOcrError('')
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
      setOcrError('Select at least one line item to import.')
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
      const noticeLines = [
        `${imported} item${imported !== 1 ? 's' : ''} imported from insurance estimate.`,
      ]
      if (partsRequestsCreated > 0) {
        noticeLines.push(`${partsRequestsCreated} part request${partsRequestsCreated !== 1 ? 's' : ''} added to Parts Requests.`)
      }
      if (partsRequestsFailed > 0) {
        noticeLines.push(`${partsRequestsFailed} part request${partsRequestsFailed !== 1 ? 's' : ''} could not be created.`)
      }
      let financialsImported = false
      try {
        if (adjusterTotals) {
          await api.post(`/estimate-metadata/metadata/${roId}`, { adjuster_totals: adjusterTotals })
        }
        const { data: financialData } = await api.post(`/estimate-items/${roId}/import-financials`)
        if (financialData?.summary) setSummary(financialData.summary)
        if (financialData?.financials) {
          setRo((prev) => (prev ? { ...prev, ...financialData.financials } : prev))
        }
        financialsImported = true
        setFinancialNotice(`Estimate revenue and profit inputs synced to this RO · Gross ${money(financialData?.summary?.total ?? financialData?.summary?.grand_total ?? 0)}`)
      } catch (financialErr) {
        const reviewMessage = financialErr?.response?.data?.error || 'Financial totals need review before they can be synced to the RO.'
        setFinancialNotice(`${imported} lines imported. ${reviewMessage}`)
      }
      setOcrModalOpen(false)
      setOcrParsed(null)
      setOcrCrossCheck(null)
      setOcrMetaNote('')
      noticeLines.push(financialsImported ? 'Estimate financials synced to the RO.' : 'Line items imported; review the financial notice before syncing totals.')
      showActionFeedback(partsRequestsFailed > 0 || !financialsImported ? 'warning' : 'success', noticeLines.join(' '))
      await loadOpportunities({ silent: true })
    } catch (err) {
      setOcrError(err?.response?.data?.error || 'Import failed — some items may not have been added')
    } finally {
      setOcrImporting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="text-muted">Loading estimate builder...</div>
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
          error={ocrError}
          checked={ocrChecked}
          onToggle={toggleOcrItem}
          onSelectionChange={setOcrChecked}
          onImport={importOcrItems}
          onCancel={() => {
            setOcrModalOpen(false)
            setOcrParsed(null)
            setOcrFlags(null)
            setOcrAnalysisSummary(null)
            setOcrCrossCheck(null)
            setOcrMetaNote('')
            setOcrError('')
          }}
          importing={ocrImporting}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleOcrFile}
      />

      <div className="flex items-start gap-3">
        <button type="button" onClick={() => navigate(`/ros/${roId}`)} className="mt-1 shrink-0 text-muted transition-colors hover:text-ink" aria-label="Back to repair order">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-ink">Estimate Builder</h1>
          <p className="text-faint text-sm truncate">{ro?.ro_number || roId} {ro?.customer?.name ? `· ${ro.customer.name}` : ''}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={ocrLoading}
          className="flex min-h-10 items-center justify-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-medium text-on-brand transition-colors hover:bg-brand-lit disabled:opacity-50"
        >
          <Camera size={12} /> {ocrLoading ? 'Scanning...' : 'Import Insurance Estimate'}
        </button>
        <button
          type="button"
          onClick={addRow}
          disabled={adding}
          className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/15 disabled:opacity-50"
        >
          <Plus size={12} /> {adding ? 'Adding...' : 'Add Row'}
        </button>
        <button
          type="button"
          onClick={importFinancialsToRo}
          disabled={importingFinancials}
          className="flex min-h-10 items-center justify-center gap-1 rounded-lg bg-gold px-3 py-2 text-xs font-semibold text-on-gold transition-colors hover:bg-gold-lit disabled:opacity-50"
        >
          <CheckCircle size={12} /> {importingFinancials ? 'Importing Financials...' : 'Import Financials To RO'}
        </button>
      </div>
      {financialNotice && (
        <div className="text-xs text-good bg-good/20 border border-good/40 rounded-lg px-3 py-2">
          {financialNotice}
        </div>
      )}
      {ocrError && (
        <div role="alert" className="text-xs text-crit bg-crit/30 border border-crit/40 rounded-lg px-3 py-2">
          {ocrError}
        </div>
      )}
      {actionFeedback?.text && (
        <div
          role={actionFeedback.type === 'error' ? 'alert' : 'status'}
          aria-live={actionFeedback.type === 'error' ? 'assertive' : 'polite'}
          className={`rounded-lg border px-3 py-2 text-xs ${
            actionFeedback.type === 'error'
              ? 'border-crit/40 bg-crit/20 text-crit'
              : actionFeedback.type === 'warning'
                ? 'border-gold/40 bg-gold/10 text-gold'
                : 'border-good/40 bg-good/20 text-good'
          }`}
        >
          {actionFeedback.text}
        </div>
      )}

      {hasAdjusterTotals && (
        <div className="space-y-2">
          {revvVsAdjusterVariance !== null && (
            <div className={`text-right text-xs font-semibold font-mono tabular-nums ${Math.abs(revvVsAdjusterVariance) < 0.01 ? 'text-good' : 'text-gold'}`}>
              REVV vs adjuster gross variance: {money(revvVsAdjusterVariance)}
            </div>
          )}
          <EstimateFinancialReview totals={adjusterTotals} title="Adjuster Estimate Totals" />
        </div>
      )}

      <div className="bg-panel border border-line-2 rounded-instrument p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-ink">Estimate Gap Review</h2>
            <p className="mt-1 text-xs text-faint">Compares estimate lines with documented damage. Suggestions are review-only and never change pricing automatically.</p>
          </div>
          <button
            type="button"
            onClick={() => loadGapReview()}
            disabled={gapReviewLoading}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-brand/40 text-brand hover:bg-brand/10 disabled:opacity-50"
          >
            {gapReviewLoading ? 'Reviewing...' : 'Refresh'}
          </button>
        </div>
        {gapReviewError && <p role="alert" className="rounded-lg border border-crit/40 bg-crit/30 px-3 py-2 text-xs text-crit">{gapReviewError}</p>}
        {!gapReview ? (
          <p className="text-xs text-faint">Loading available evidence...</p>
        ) : !gapReview.ready ? (
          <div className="rounded-lg border border-line-2 bg-void px-3 py-3">
            <p className="text-xs font-medium text-ink">Not ready yet</p>
            <p className="mt-1 text-xs text-faint">{gapReview.reason}</p>
          </div>
        ) : (gapReview.gaps || []).length === 0 ? (
          <div className="rounded-lg border border-good/40 bg-good/20 px-3 py-3 text-xs text-good">
            No likely gaps found across {gapReview.reviewed_line_count || 0} estimate lines and the current damage evidence.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {(gapReview.evidence_sources || []).map((source) => (
                <span key={source} className="rounded-full border border-line-2 bg-void px-2 py-1 text-[10px] text-muted">{source}</span>
              ))}
            </div>
            {(gapReview.gaps || []).map((gap) => (
              <div key={gap.code} className="rounded-lg border border-line-2 bg-void px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink">{gap.description}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${gap.confidence === 'high' ? 'border-good/50 bg-good/20 text-good' : 'border-gold/50 bg-gold/10 text-gold'}`}>
                        {gap.confidence} confidence
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{gap.reason}</p>
                    <p className="mt-1 text-[10px] text-faint">Draft quantity: {gap.draft?.quantity || 1}. Unit price remains $0.00 until reviewed.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addGapDraft(gap)}
                    disabled={addingGapCode === gap.code}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-gold px-3 py-2 text-xs font-semibold text-on-gold hover:bg-gold-lit disabled:opacity-50"
                  >
                    <Plus size={13} /> {addingGapCode === gap.code ? 'Adding...' : 'Add Draft'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-panel border border-line-2 rounded-instrument p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-ink">Profit Opportunity Review</h2>
          <button
            type="button"
            onClick={() => loadOpportunities()}
            disabled={opportunityLoading}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-line-2 text-ink hover:text-ink disabled:opacity-50"
          >
            {opportunityLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {opportunity?.summary ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-void border border-line-2 rounded-lg px-3 py-2">
                <p className="text-muted">Undercut Labor Lines</p>
                <p className="font-mono font-semibold tabular-nums text-crit">{opportunity.summary.labor_undercut_count || 0}</p>
              </div>
              <div className="bg-void border border-line-2 rounded-lg px-3 py-2">
                <p className="text-muted">Supplement Opportunity</p>
                <p className="font-mono font-semibold tabular-nums text-gold">{money(opportunity.summary.total_supplement_opportunity || 0)}</p>
              </div>
              <div className="bg-void border border-line-2 rounded-lg px-3 py-2">
                <p className="text-muted">Projected RO Total</p>
                <p className="font-mono font-semibold tabular-nums text-gold">{money(opportunity.summary.projected_grand_total || 0)}</p>
              </div>
              <div className="bg-void border border-line-2 rounded-lg px-3 py-2">
                <p className="text-muted">Projected Profit Uplift</p>
                <p className="font-mono font-semibold tabular-nums text-gold">+{money(opportunity.summary.profit_uplift || 0)}</p>
              </div>
            </div>
            {(opportunity.flags || []).length > 0 ? (
              <div className="space-y-1">
                {opportunity.flags.slice(0, 6).map((flag, idx) => (
                  <div key={`${flag.item_id || idx}-${idx}`} className="text-xs bg-void border border-line-2 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                    <p className="text-ink truncate">{flag.description || 'Line item'}</p>
                    <p className="font-mono font-medium tabular-nums text-gold whitespace-nowrap">+{money(flag.supplement_opportunity || 0)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-good">No labor undercut detected on current estimate items.</p>
            )}
          </>
        ) : (
          <p className="text-xs text-faint">No opportunity data yet.</p>
        )}
      </div>

      <div className="bg-panel border border-line-2 rounded-instrument overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-void text-muted">
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
                        ? 'border-good/60 text-good bg-good/30'
                        : 'border-line-2 text-ink hover:text-ink'
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
                        ? 'border-line-2 text-ink bg-raised'
                        : 'border-line-2 text-ink hover:text-ink'
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
                <td colSpan={8} className="px-3 py-8 text-center text-faint">No line items yet.</td>
              </tr>
            ) : orderedItems.map((item) => (
              <tr key={item.id} className="border-t border-line-2">
                <td className="px-3 py-2">
                  <select
                    className="w-full bg-void border border-line-2 rounded px-2 py-1 text-ink"
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
                    className="w-full bg-void border border-line-2 rounded px-2 py-1 text-ink"
                    value={item.description || ''}
                    onChange={(e) => updateItemLocal(item.id, { description: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                    placeholder="Line item description"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="0.01"
                    className="w-full bg-void border border-line-2 rounded px-2 py-1 text-right font-mono tabular-nums text-ink"
                    value={item.quantity}
                    onChange={(e) => updateItemLocal(item.id, { quantity: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="0.01"
                    className="w-full bg-void border border-line-2 rounded px-2 py-1 text-right font-mono tabular-nums text-ink"
                    value={item.unit_price}
                    onChange={(e) => updateItemLocal(item.id, { unit_price: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={!!item.taxable}
                    className="accent-brand"
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
                    className="w-full bg-void border border-line-2 rounded px-2 py-1 text-right font-mono tabular-nums text-ink"
                    value={item.sort_order}
                    onChange={(e) => updateItemLocal(item.id, { sort_order: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono font-medium tabular-nums text-gold">{money(item.total)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => deleteRow(item.id)}
                    disabled={deletingId === item.id}
                    className="inline-flex items-center gap-1 text-crit hover:text-crit text-xs"
                  >
                    <Trash2 size={13} /> {deletingId === item.id ? 'Deleting...' : 'Delete'}
                  </button>
                  {savingId === item.id && <span className="ml-2 text-[11px] text-faint">Saving...</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-2 bg-void text-ink text-xs">
              <td className="px-3 py-2" colSpan={3}>Labor: {money(totals.labor_total)}</td>
              <td className="px-3 py-2">Parts: {money(totals.parts_total)}</td>
              <td className="px-3 py-2" colSpan={2}>Sublet: {money(totals.sublet_total)}</td>
              <td className="px-3 py-2" colSpan={2}>Other: {money(totals.other_total)}</td>
            </tr>
            <tr className="border-t border-line-2 bg-void text-ink text-sm font-medium">
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
