import { useRef, useState } from 'react'
import { FileText, Loader2, Trash2, Upload } from 'lucide-react'
import api from '../lib/api'
import { parsedAppraisalToFields } from '../lib/appraisalIntake'
import { safeExternalErrorMessage } from '../lib/safeErrors'

const MAX_FILES = 12

const REVIEW_FIELDS = [
  ['customer_name', 'Customer name'],
  ['customer_phone', 'Customer phone'],
  ['customer_email', 'Customer email'],
  ['customer_address', 'Customer address'],
  ['year', 'Year'],
  ['make', 'Make'],
  ['model', 'Model'],
  ['vin', 'VIN'],
  ['color', 'Color'],
  ['plate', 'Plate'],
  ['mileage', 'Mileage'],
  ['insurer', 'Insurance company'],
  ['claim_number', 'Claim number'],
  ['policy_number', 'Policy number'],
  ['deductible', 'Deductible'],
  ['adjuster_name', 'Adjuster name'],
  ['adjuster_phone', 'Adjuster phone'],
  ['adjuster_email', 'Adjuster email'],
]

function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export default function AppraisalQuickIntake({ onApply }) {
  const inputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [fields, setFields] = useState(null)
  const [estimateDraft, setEstimateDraft] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-brand'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1'

  function addFiles(nextFiles) {
    const byKey = new Map(files.map((file) => [fileKey(file), file]))
    Array.from(nextFiles || []).forEach((file) => byKey.set(fileKey(file), file))
    setFiles(Array.from(byKey.values()).slice(0, MAX_FILES))
    setFields(null)
    setEstimateDraft(null)
    setError('')
  }

  async function parseAppraisal() {
    if (!files.length) return
    setParsing(true)
    setError('')
    try {
      const data = new FormData()
      files.forEach((file) => data.append('estimate_images', file))
      const response = await api.post('/insurance-ocr/parse', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const parsed = response.data?.parsed || {}
      setFields(parsedAppraisalToFields(parsed))
      setEstimateDraft(parsed)
    } catch (err) {
      setError(safeExternalErrorMessage(err, 'Could not read this appraisal. Keep the files selected and try clearer pages.'))
    } finally {
      setParsing(false)
    }
  }

  async function applyDetails() {
    if (!fields) return
    setApplying(true)
    setError('')
    try {
      await onApply?.({
        fields,
        files,
        estimateDraft: estimateDraft ? {
          ...estimateDraft,
          insurance_company: fields.insurer || estimateDraft.insurance_company || null,
          claim_number: fields.claim_number || estimateDraft.claim_number || null,
          adjuster_name: fields.adjuster_name || estimateDraft.adjuster_name || null,
          adjuster_phone: fields.adjuster_phone || estimateDraft.adjuster_phone || null,
          adjuster_email: fields.adjuster_email || estimateDraft.adjuster_email || null,
          customer_name: fields.customer_name || estimateDraft.customer_name || null,
          customer_phone: fields.customer_phone || estimateDraft.customer_phone || null,
          vin: fields.vin || estimateDraft.vin || null,
          vehicle_year: fields.year || estimateDraft.vehicle_year || null,
          vehicle_make: fields.make || estimateDraft.vehicle_make || null,
          vehicle_model: fields.model || estimateDraft.vehicle_model || null,
        } : null,
      })
    } catch (err) {
      setError(safeExternalErrorMessage(err, 'Could not apply the appraisal details.'))
    } finally {
      setApplying(false)
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="appraisal-quick-intake-title">
      <div>
        <h3 id="appraisal-quick-intake-title" className="text-sm font-semibold text-white">Appraisal Quick Intake</h3>
        <p className="mt-1 text-xs text-slate-400">
          Upload once. REVV fills the intake details and carries the estimate lines and totals into the new RO for review.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#3a4257] bg-[#0f1117] px-4 text-center hover:border-brand/70"
      >
        <Upload size={24} className="text-brand" />
        <span className="text-sm font-semibold text-white">Add appraisal PDF or photos</span>
        <span className="text-xs text-slate-500">Take several photos when the appraisal has multiple pages.</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        className="hidden"
        aria-label="Appraisal files"
        onChange={(event) => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-300">{files.length} of {MAX_FILES} pages selected</p>
            <button type="button" onClick={() => { setFiles([]); setFields(null); setEstimateDraft(null) }} className="text-xs text-slate-400 hover:text-brand">Clear</button>
          </div>
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {files.map((file, index) => (
              <div key={fileKey(file)} className="flex items-center gap-2 rounded-lg border border-[#2a2d3e] bg-[#0f1117] px-3 py-2">
                <FileText size={14} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => { setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index)); setFields(null) }}
                  className="text-slate-500 hover:text-red-300"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={parsing}
            onClick={parseAppraisal}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-lit disabled:opacity-50"
          >
            {parsing ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            {parsing ? 'Reading appraisal...' : 'Read Appraisal'}
          </button>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg border border-red-700/50 bg-red-950/30 px-3 py-2 text-sm text-red-100">{error}</p>}

      {fields && (
        <div className="space-y-4 rounded-lg border border-[#2a2d3e] bg-[#121520] p-4">
          <div>
            <h4 className="text-sm font-semibold text-white">Review extracted details</h4>
            <p className="text-xs text-slate-500">Correct anything uncertain before applying it to the New RO form.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {REVIEW_FIELDS.map(([key, label]) => (
              <div key={key} className={key === 'customer_address' ? 'sm:col-span-2' : ''}>
                <label className={lbl} htmlFor={`appraisal-${key}`}>{label}</label>
                <input
                  id={`appraisal-${key}`}
                  className={inp}
                  inputMode={['mileage', 'deductible'].includes(key) ? 'decimal' : undefined}
                  value={fields[key] || ''}
                  onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-slate-300">
            Customer notification consent is never inferred from paperwork. Confirm SMS or email consent in the New RO form.
          </div>
          {estimateDraft && (
            <div role="status" className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
              {(estimateDraft.line_items || []).length} estimate line{(estimateDraft.line_items || []).length === 1 ? '' : 's'} and the insurer totals will be attached to the new RO for review. You will not need to upload these pages again.
            </div>
          )}
          <button
            type="button"
            disabled={applying}
            onClick={applyDetails}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-lit disabled:opacity-50"
          >
            {applying && <Loader2 size={15} className="animate-spin" />}
            {applying ? 'Applying details...' : 'Use Details in New RO'}
          </button>
        </div>
      )}
    </section>
  )
}
