import { useMemo, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, FileText, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import api from '../lib/api'
import { safeExternalErrorMessage } from '../lib/safeErrors'

const emptyForm = {
  customer_name: '',
  customer_phone: '',
  vehicle_year: '',
  vehicle_make: '',
  vehicle_model: '',
  vin: '',
  insurance_company: '',
  claim_number: '',
  adjuster_name: '',
  adjuster_phone: '',
  adjuster_email: '',
  deductible: '',
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function splitVehicle(vehicle) {
  const parts = String(vehicle || '').trim().split(/\s+/).filter(Boolean)
  const year = /^\d{4}$/.test(parts[0]) ? parts.shift() : ''
  return { year, make: parts.shift() || '', model: parts.join(' ') }
}

function parsedToForm(parsed) {
  const vehicleParts = splitVehicle(parsed?.vehicle)
  return {
    customer_name: parsed?.customer_name || '',
    customer_phone: parsed?.customer_phone || '',
    vehicle_year: parsed?.vehicle_year || vehicleParts.year,
    vehicle_make: parsed?.vehicle_make || vehicleParts.make,
    vehicle_model: parsed?.vehicle_model || vehicleParts.model,
    vin: parsed?.vin || '',
    insurance_company: parsed?.insurance_company || '',
    claim_number: parsed?.claim_number || '',
    adjuster_name: parsed?.adjuster_name || '',
    adjuster_phone: parsed?.adjuster_phone || '',
    adjuster_email: parsed?.adjuster_email || '',
    deductible: parsed?.estimate_totals?.deductible ?? '',
  }
}

function normalizeItems(parsed) {
  const items = Array.isArray(parsed?.line_items) ? parsed.line_items : []
  return items.map((item) => ({
    description: item.description || '',
    type: ['labor', 'parts', 'sublet', 'other'].includes(item.type) ? item.type : 'other',
    quantity: item.quantity ?? 1,
    unit_price: item.unit_price ?? 0,
  }))
}

export default function EstimateImportWizard({ onClose, onImported }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [step, setStep] = useState('upload')
  const [parsing, setParsing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState([])

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0),
    [items]
  )

  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#EAB308]'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1.5'

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateItem(index, key, value) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)))
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  function addItem() {
    setItems((prev) => [...prev, { description: '', type: 'other', quantity: 1, unit_price: 0 }])
  }

  async function parseEstimate() {
    if (!file) return
    setParsing(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('estimate_image', file)
      const { data } = await api.post('/insurance-ocr/parse', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const parsed = data?.parsed || {}
      setForm(parsedToForm(parsed))
      setItems(normalizeItems(parsed))
      setStep('review')
    } catch (err) {
      setError(safeExternalErrorMessage(err, 'Could not parse that estimate. Try a clearer PDF or image.'))
    } finally {
      setParsing(false)
    }
  }

  async function createRo() {
    if (!form.vehicle_make.trim() || !form.vehicle_model.trim()) {
      setError('Vehicle make and model are required.')
      return
    }
    setCreating(true)
    setError('')
    try {
      const { data } = await api.post('/ros/import-estimate', {
        customer: {
          name: form.customer_name || 'Imported Estimate Customer',
          phone: form.customer_phone || null,
        },
        vehicle: {
          year: form.vehicle_year || null,
          make: form.vehicle_make,
          model: form.vehicle_model,
          vin: form.vin || null,
        },
        insurance: {
          company: form.insurance_company || null,
          claim_number: form.claim_number || null,
          adjuster_name: form.adjuster_name || null,
          adjuster_phone: form.adjuster_phone || null,
          adjuster_email: form.adjuster_email || null,
          deductible: form.deductible || null,
        },
        line_items: items,
      })
      onImported?.(data?.ro)
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create the repair order.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden bg-[#171c27] border border-[#2c3345] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[#2c3345] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[#EAB308]/15 text-[#EAB308] flex items-center justify-center">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Import CCC/Mitchell Estimate</h2>
              <p className="text-xs text-slate-400">PDF or image to first live RO</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(92vh-74px)] p-5 space-y-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <span className={step === 'upload' ? 'text-[#EAB308]' : 'text-emerald-400'}>1 Upload</span>
            <ArrowRight size={14} />
            <span className={step === 'review' ? 'text-[#EAB308]' : ''}>2 Review</span>
            <ArrowRight size={14} />
            <span>3 Create RO</span>
          </div>

          {step === 'upload' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="w-full min-h-48 rounded-lg border border-dashed border-[#3a4257] bg-[#0f1117] hover:border-[#EAB308]/70 transition-colors flex flex-col items-center justify-center gap-3 px-6 text-center"
              >
                <Upload className="text-[#EAB308]" size={30} />
                <span className="text-sm font-semibold text-white">{file ? file.name : 'Upload estimate PDF or image'}</span>
                <span className="text-xs text-slate-500">CCC, Mitchell, Audatex, scanned PDF, JPG, or PNG</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null)
                  setError('')
                }}
              />
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <button
                type="button"
                disabled={!file || parsing}
                onClick={parseEstimate}
                className="inline-flex items-center gap-2 bg-[#EAB308] hover:bg-[#facc15] text-black font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-60"
              >
                {parsing ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                {parsing ? 'Parsing estimate...' : 'Parse Estimate'}
              </button>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={lbl}>Customer</label>
                  <input className={inp} value={form.customer_name} onChange={(e) => setField('customer_name', e.target.value)} placeholder="Customer name" />
                </div>
                <div>
                  <label className={lbl}>Phone</label>
                  <input className={inp} value={form.customer_phone} onChange={(e) => setField('customer_phone', e.target.value)} placeholder="Customer phone" />
                </div>
                <div>
                  <label className={lbl}>VIN</label>
                  <input className={inp} value={form.vin} onChange={(e) => setField('vin', e.target.value)} placeholder="VIN" />
                </div>
                <div>
                  <label className={lbl}>Year</label>
                  <input className={inp} value={form.vehicle_year} onChange={(e) => setField('vehicle_year', e.target.value)} placeholder="2024" />
                </div>
                <div>
                  <label className={lbl}>Make</label>
                  <input className={inp} value={form.vehicle_make} onChange={(e) => setField('vehicle_make', e.target.value)} placeholder="Toyota" />
                </div>
                <div>
                  <label className={lbl}>Model</label>
                  <input className={inp} value={form.vehicle_model} onChange={(e) => setField('vehicle_model', e.target.value)} placeholder="Camry" />
                </div>
                <div>
                  <label className={lbl}>Carrier</label>
                  <input className={inp} value={form.insurance_company} onChange={(e) => setField('insurance_company', e.target.value)} placeholder="Insurance company" />
                </div>
                <div>
                  <label className={lbl}>Claim #</label>
                  <input className={inp} value={form.claim_number} onChange={(e) => setField('claim_number', e.target.value)} placeholder="Claim number" />
                </div>
                <div>
                  <label className={lbl}>Deductible</label>
                  <input className={inp} value={form.deductible} onChange={(e) => setField('deductible', e.target.value)} placeholder="500.00" />
                </div>
              </div>

              <div className="border border-[#2c3345] rounded-lg overflow-hidden">
                <div className="flex items-center justify-between gap-3 bg-[#0f1117] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Line Items</h3>
                    <p className="text-xs text-slate-500">{items.length} items, ${money(total)} total</p>
                  </div>
                  <button type="button" onClick={addItem} className="inline-flex items-center gap-1 text-xs font-semibold text-[#EAB308] hover:text-[#facc15]">
                    <Plus size={14} /> Add item
                  </button>
                </div>
                <div className="divide-y divide-[#2c3345]">
                  {items.map((item, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 p-3">
                      <select className={`${inp} col-span-12 md:col-span-2`} value={item.type} onChange={(e) => updateItem(index, 'type', e.target.value)}>
                        <option value="labor">Labor</option>
                        <option value="parts">Parts</option>
                        <option value="sublet">Sublet</option>
                        <option value="other">Other</option>
                      </select>
                      <input className={`${inp} col-span-12 md:col-span-6`} value={item.description} onChange={(e) => updateItem(index, 'description', e.target.value)} placeholder="Description" />
                      <input className={`${inp} col-span-5 md:col-span-1`} value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} placeholder="Qty" />
                      <input className={`${inp} col-span-5 md:col-span-2`} value={item.unit_price} onChange={(e) => updateItem(index, 'unit_price', e.target.value)} placeholder="Unit" />
                      <button type="button" onClick={() => removeItem(index)} className="col-span-2 md:col-span-1 text-slate-500 hover:text-red-300 flex items-center justify-center">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {!items.length && <p className="p-4 text-sm text-slate-400">No line items were extracted. Add items or create the RO with vehicle and claim details only.</p>}
                </div>
              </div>

              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={creating}
                  onClick={createRo}
                  className="inline-flex items-center gap-2 bg-[#EAB308] hover:bg-[#facc15] text-black font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-60"
                >
                  {creating ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {creating ? 'Creating RO...' : 'Create Repair Order'}
                </button>
                <button type="button" onClick={() => setStep('upload')} className="bg-[#232a3b] hover:bg-[#2c3345] text-slate-200 rounded-lg px-4 py-2.5 text-sm transition-colors">
                  Choose another file
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
