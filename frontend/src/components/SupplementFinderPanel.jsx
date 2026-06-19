import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, BadgeDollarSign, CheckCircle, FileSearch, RefreshCw, Upload } from 'lucide-react'
import api from '../lib/api'
import { safeExternalErrorMessage } from '../lib/safeErrors'

const FLAG_META = {
  undervalue: {
    label: 'Undervalue',
    title: 'Undervalued Lines',
    cls: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
    Icon: AlertTriangle,
  },
  review: {
    label: 'Review',
    title: 'Needs Review',
    cls: 'text-yellow-300 bg-yellow-900/30 border-yellow-700/40',
    Icon: FileSearch,
  },
  ok: {
    label: 'OK',
    title: 'OK Lines',
    cls: 'text-emerald-300 bg-emerald-900/30 border-emerald-700/40',
    Icon: CheckCircle,
  },
}

const SEVERITY_META = {
  high: 'text-red-300 bg-red-900/30 border-red-700/40',
  medium: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
  low: 'text-yellow-300 bg-yellow-900/30 border-yellow-700/40',
  none: 'text-slate-300 bg-slate-900/40 border-slate-700/40',
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
    <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2a2d3e]">
        <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
          <Icon size={13} className={meta.cls.split(' ')[0]} />
          {meta.title}
        </h4>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${meta.cls}`}>{flags.length}</span>
      </div>
      {flags.length === 0 ? (
        <p className="text-xs text-slate-500 px-3 py-3">No {meta.label.toLowerCase()} lines.</p>
      ) : (
        <div className="divide-y divide-[#2a2d3e]">
          {flags.map((flag, idx) => (
            <div key={`${type}-${idx}-${flag.description || 'line'}`} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-300 border border-indigo-700/40 uppercase font-semibold">
                      {flag.item_type || 'line'}
                    </span>
                    <SeverityBadge severity={flag.severity} />
                  </div>
                  <p className="text-sm text-white mt-1 truncate">{flag.description || 'Estimate line'}</p>
                  {flag.message && <p className="text-xs text-slate-400 mt-1">{flag.message}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={Number(flag.supplement_opportunity || 0) > 0 ? 'text-amber-300 font-semibold text-sm' : 'text-slate-500 text-sm'}>
                    {Number(flag.supplement_opportunity || 0) > 0 ? money(flag.supplement_opportunity) : '—'}
                  </div>
                  <div className="text-[10px] text-slate-500">Opportunity</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SupplementFinderPanel({ roId, importedItems = [], importedSummary = null }) {
  const fileInputRef = useRef(null)
  const [running, setRunning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [analysis, setAnalysis] = useState(null)

  const hasImportedItems = importedItems.length > 0
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

  const summary = analysis?.summary || null
  const busy = running || uploading

  return (
    <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
            <BadgeDollarSign size={13} /> Supplement Finder
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Finds labor-rate gaps and review lines from this RO estimate.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => analyzeItems(importedItems, 'imported RO estimate')}
            disabled={busy || !hasImportedItems}
            className="inline-flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
          >
            <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
            Analyze RO
          </button>
          <label className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cursor-pointer ${busy ? 'bg-slate-800 text-slate-500 pointer-events-none' : 'bg-[#0f1117] hover:bg-[#202437] text-slate-200 border border-[#2a2d3e]'}`}>
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
        </div>
      </div>

      {!hasImportedItems && (
        <p className="text-xs text-slate-500 bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
          No stored estimate lines are available for this RO yet. Upload an insurer estimate here or import one through Estimate Builder.
        </p>
      )}

      {error && <div className="text-xs text-red-300 bg-red-950/30 border border-red-800/40 rounded-lg p-3">{error}</div>}

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Insurer Allowed</div>
            <div className="text-lg font-bold text-white">{money(summary.total_insurance_allowed)}</div>
          </div>
          <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Shop Value</div>
            <div className="text-lg font-bold text-indigo-300">{money(summary.total_shop_value)}</div>
          </div>
          <div className="bg-[#0f1117] border border-amber-700/40 rounded-lg p-3">
            <div className="text-[10px] text-amber-400 uppercase font-semibold">Supplement Opportunity</div>
            <div className="text-lg font-bold text-amber-300">{money(summary.total_supplement_opportunity)}</div>
          </div>
        </div>
      )}

      {analysis && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Source: {sourceLabel || 'estimate analysis'}</span>
            <span>{analysis.flags?.length || 0} line{analysis.flags?.length === 1 ? '' : 's'} checked</span>
          </div>
          <FlagGroup type="undervalue" flags={groupedFlags.undervalue} />
          <FlagGroup type="review" flags={groupedFlags.review} />
          <FlagGroup type="ok" flags={groupedFlags.ok} />
        </div>
      )}

      {!analysis && !error && (
        <div className="text-sm text-slate-500 bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-4 text-center">
          Run analysis to surface supplement opportunities for this RO.
        </div>
      )}

      {importedSummary && hasImportedItems && !analysis && (
        <p className="text-[11px] text-slate-500">
          Current REVV estimate total: {money(importedSummary.grand_total)}.
        </p>
      )}
    </div>
  )
}
