import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BadgeDollarSign, CheckCircle, FileSearch, RefreshCw, Upload } from 'lucide-react'
import api from '../lib/api'
import { safeExternalErrorMessage } from '../lib/safeErrors'
import { attachedEvidenceToFiles, findAttachedAppraisalEvidence } from '../lib/attachedAppraisal'

const FLAG_META = {
  undervalue: {
    label: 'Undervalue',
    title: 'Undervalued Lines',
    cls: 'border-gold/40 bg-gold/10 text-gold',
    Icon: AlertTriangle,
  },
  review: {
    label: 'Review',
    title: 'Needs Review',
    cls: 'border-brand/40 bg-brand/10 text-brand',
    Icon: FileSearch,
  },
  ok: {
    label: 'OK',
    title: 'OK Lines',
    cls: 'border-good/40 bg-good/10 text-good',
    Icon: CheckCircle,
  },
}

const SEVERITY_META = {
  high: 'border-crit/40 bg-crit/10 text-crit',
  medium: 'border-brand/40 bg-brand/10 text-brand',
  low: 'border-line-2 bg-raised text-muted',
  none: 'border-line-2 bg-panel-2 text-muted',
}

function money(value) {
  const n = Number(value || 0)
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function toAnalyzeItem(item) {
  return {
    type: item?.type || 'other',
    description: item?.description || '',
    quantity: Number(item?.quantity ?? 1),
    unit_price: Number(item?.unit_price ?? 0),
  }
}

function SeverityBadge({ severity }) {
  const safeSeverity = String(severity || 'none').toLowerCase()
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${SEVERITY_META[safeSeverity] || SEVERITY_META.none}`}>
      {safeSeverity}
    </span>
  )
}

function FlagGroup({ type, flags }) {
  const meta = FLAG_META[type]
  const Icon = meta.Icon
  return (
    <div className="overflow-hidden rounded-instrument border border-line-2 bg-void">
      <div className="flex items-center justify-between gap-2 border-b border-line-2 px-3 py-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Icon size={13} className={meta.cls.split(' ')[0]} />
          {meta.title}
        </h4>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${meta.cls}`}>{flags.length}</span>
      </div>
      {flags.length === 0 ? (
        <p className="px-3 py-3 text-xs text-faint">No {meta.label.toLowerCase()} lines.</p>
      ) : (
        <div className="divide-y divide-line-2">
          {flags.map((flag, idx) => (
            <div key={`${type}-${idx}-${flag.description || 'line'}`} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">
                      {flag.item_type || 'line'}
                    </span>
                    <SeverityBadge severity={flag.severity} />
                  </div>
                  <p className="mt-1 truncate text-sm text-ink">{flag.description || 'Estimate line'}</p>
                  {flag.message && <p className="mt-1 text-xs text-muted">{flag.message}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`font-mono text-sm tabular-nums ${Number(flag.supplement_opportunity || 0) > 0 ? 'font-semibold text-gold' : 'text-faint'}`}>
                    {Number(flag.supplement_opportunity || 0) > 0 ? money(flag.supplement_opportunity) : '—'}
                  </div>
                  <div className="text-[10px] text-faint">Opportunity</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SupplementFinderPanel({ roId, importedItems = [], importedSummary = null, variant = 'default', onFileSupplement }) {
  const fileInputRef = useRef(null)
  const [running, setRunning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [analysis, setAnalysis] = useState(null)
  const [stagedEstimate, setStagedEstimate] = useState(null)
  const [attachedAppraisalEvidence, setAttachedAppraisalEvidence] = useState([])

  useEffect(() => {
    if (importedItems.length) {
      setStagedEstimate(null)
      return undefined
    }
    let active = true
    api.get(`/estimate-metadata/metadata/${roId}`)
      .then(({ data }) => {
        if (!active) return
        const rawDraft = data?.metadata?.import_draft
        const draft = typeof rawDraft === 'string' ? JSON.parse(rawDraft) : rawDraft
        if (Array.isArray(draft?.line_items) && draft.line_items.length) {
          setStagedEstimate(draft)
          return
        }
        return api.get(`/claim-tracker/ro/${roId}`).then((tracker) => {
          if (active) setAttachedAppraisalEvidence(findAttachedAppraisalEvidence(tracker.data?.evidence))
        })
      })
      .catch(() => { if (active) setStagedEstimate(null) })
    return () => { active = false }
  }, [roId, importedItems.length])

  const stagedItems = Array.isArray(stagedEstimate?.line_items) ? stagedEstimate.line_items : []
  const estimateItems = importedItems.length ? importedItems : stagedItems
  const hasImportedItems = estimateItems.length > 0
  const groupedFlags = useMemo(() => {
    const flags = Array.isArray(analysis?.flags) ? analysis.flags : []
    return {
      undervalue: flags.filter((flag) => flag.type === 'undervalue'),
      review: flags.filter((flag) => flag.type === 'review'),
      ok: flags.filter((flag) => flag.type === 'ok'),
    }
  }, [analysis?.flags])

  async function analyzeItems(items, label) {
    setRunning(true)
    setError('')
    try {
      const { data } = await api.post('/insurance-ocr/analyze', {
        line_items: items.map(toAnalyzeItem),
      })
      setAnalysis(data || null)
      setSourceLabel(label)
    } catch (err) {
      setError(safeExternalErrorMessage(err, 'Could not run supplement analysis.'))
    } finally {
      setRunning(false)
    }
  }

  async function parseAndAnalyze(files) {
    const selectedFiles = Array.from(files || []).slice(0, 12)
    if (!selectedFiles.length) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      selectedFiles.forEach((file) => form.append('estimate_images', file))
      const { data } = await api.post('/insurance-ocr/parse', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const parsed = data?.parsed || {}
      const items = Array.isArray(parsed?.line_items) ? parsed.line_items : (data?.items || [])
      if (!items.length) {
        setAnalysis(null)
        setSourceLabel('')
        setError('No line items were extracted. Try a clearer estimate image or PDF.')
        return
      }
      await analyzeItems(items, parsed.insurance_company ? `${parsed.insurance_company} upload` : 'uploaded estimate')
    } catch (err) {
      setError(safeExternalErrorMessage(err, 'Could not parse and analyze the estimate.'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function analyzeAttachedAppraisal() {
    setError('')
    try {
      const files = await attachedEvidenceToFiles(attachedAppraisalEvidence)
      await parseAndAnalyze(files)
    } catch (err) {
      setError(safeExternalErrorMessage(err, 'Could not load the appraisal attached to this RO.'))
    }
  }

  const summary = analysis?.summary || null
  const busy = running || uploading
  const hero = variant === 'hero'

  return (
    <div className={`${hero ? 'border-gold/40 bg-gold/5' : 'border-line bg-panel'} rounded-instrument border p-4 space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${hero ? 'text-gold' : 'text-muted'}`}>
            <BadgeDollarSign size={13} /> Supplement Finder
          </h2>
          <p className="mt-1 text-xs text-faint">
            Finds labor-rate gaps and review lines from this RO estimate.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => analyzeItems(
              estimateItems,
              importedItems.length ? 'imported RO estimate' : 'appraisal staged during RO creation'
            )}
            disabled={busy || !hasImportedItems}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
          >
            <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
            Analyze RO
          </button>
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${busy ? 'pointer-events-none bg-raised text-faint' : 'border border-line-2 bg-void text-muted transition-colors hover:border-brand/50 hover:text-ink'}`}>
            <Upload size={12} />
            Upload Estimate
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(event) => parseAndAnalyze(event.target.files)}
            />
          </label>
          {attachedAppraisalEvidence.length > 0 && !hasImportedItems && (
            <button
              type="button"
              onClick={analyzeAttachedAppraisal}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:bg-brand/15 disabled:opacity-50"
            >
              <FileSearch size={12} /> Use Attached Appraisal
            </button>
          )}
        </div>
      </div>

      {!hasImportedItems && (
        <p className="rounded-instrument border border-line-2 bg-void p-3 text-xs text-faint">
          No stored estimate lines are available for this RO yet. Upload an insurer estimate here or import one through Estimate Builder.
        </p>
      )}

      {!importedItems.length && stagedItems.length > 0 && (
        <p role="status" className="rounded-instrument border border-good/30 bg-good/10 p-3 text-xs text-good">
          The appraisal used to create this RO is ready with {stagedItems.length} estimate line{stagedItems.length === 1 ? '' : 's'}. Choose Analyze RO; no upload is needed.
        </p>
      )}

      {error && <div role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 p-3 text-xs text-crit">{error}</div>}

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-instrument border border-line-2 bg-void p-3">
            <div className="text-[10px] font-semibold uppercase text-faint">Insurer Allowed</div>
            <div className="font-mono text-lg font-bold tabular-nums text-ink">{money(summary.total_insurance_allowed)}</div>
          </div>
          <div className="rounded-instrument border border-line-2 bg-void p-3">
            <div className="text-[10px] font-semibold uppercase text-faint">Shop Value</div>
            <div className="font-mono text-lg font-bold tabular-nums text-ink">{money(summary.total_shop_value)}</div>
          </div>
          <div className="rounded-instrument border border-gold/40 bg-gold/5 p-3">
            <div className="text-[10px] font-semibold uppercase text-gold">Supplement Opportunity</div>
            <div className="font-mono text-lg font-bold tabular-nums text-gold">{money(summary.total_supplement_opportunity)}</div>
          </div>
          {hero && onFileSupplement && Number(summary.total_supplement_opportunity || 0) > 0 && (
            <button
              type="button"
              onClick={onFileSupplement}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-[var(--on-gold)] transition-colors hover:bg-gold-lit sm:col-span-3"
            >
              <BadgeDollarSign size={15} /> File supplement
            </button>
          )}
        </div>
      )}

      {analysis && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-faint">
            <span>Source: {sourceLabel || 'estimate analysis'}</span>
            <span>{analysis.flags?.length || 0} line{analysis.flags?.length === 1 ? '' : 's'} checked</span>
          </div>
          <FlagGroup type="undervalue" flags={groupedFlags.undervalue} />
          <FlagGroup type="review" flags={groupedFlags.review} />
          <FlagGroup type="ok" flags={groupedFlags.ok} />
        </div>
      )}

      {!analysis && !error && (
        <div className="rounded-instrument border border-line-2 bg-void p-4 text-center text-sm text-faint">
          Run analysis to surface supplement opportunities for this RO.
        </div>
      )}

      {importedSummary && hasImportedItems && !analysis && (
        <p className="text-[11px] text-faint">
          Current REVV estimate total: {money(importedSummary.grand_total)}.
        </p>
      )}

      {!importedSummary && stagedEstimate?.estimate_totals && !analysis && (
        <p className="text-xs text-faint">
          Staged insurer gross: {money(stagedEstimate.estimate_totals.total_cost_of_repairs || stagedEstimate.estimate_totals.gross_total || 0)}.
        </p>
      )}
    </div>
  )
}
