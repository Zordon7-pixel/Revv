import { useState, useEffect } from 'react'
import { X, CheckCircle, Sparkles, Plus } from 'lucide-react'
import api from '../lib/api'
import LibraryAutocomplete from './LibraryAutocomplete'
import VehicleDiagram from './VehicleDiagram'
import TurnaroundEstimator from './TurnaroundEstimator'
import { searchInsurers } from '../data/insurers'
import { useLanguage } from '../contexts/LanguageContext'

const JOB_TYPES = ['collision','paint','detailing','glass','towing','key_programming','wheel_recon','car_wrap']
const DAMAGE_TYPES = [
  { value: 'front_impact', label: 'Front Impact' },
  { value: 'rear_impact', label: 'Rear Impact' },
  { value: 'side_damage', label: 'Side Damage' },
  { value: 'hail', label: 'Hail' },
  { value: 'glass', label: 'Glass' },
]

export default function AddROModal({ onClose, onSaved }) {
  const { t } = useLanguage()
  const [customers, setCustomers] = useState([])
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    // Customer (new or existing)
    customer_id: '', new_customer: false,
    customer_name: '', customer_phone: '', customer_email: '',
    // Vehicle
    vehicle_id: '', new_vehicle: true,
    year: '', make: '', model: '', vin: '', color: '', plate: '',
    // Job
    job_type: 'collision', payment_type: 'insurance',
    claim_number: '', insurer: 'Progressive', adjuster_name: '', adjuster_phone: '', deductible: '',
    estimated_delivery: '', notes: '', damage_type: 'front_impact', damaged_panels: []
  })
  const [suggestions, setSuggestions] = useState([])
  const [suggestionSummary, setSuggestionSummary] = useState(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [addedCodes, setAddedCodes] = useState([])

  useEffect(() => { api.get('/customers').then(r => setCustomers(r.data.customers)) }, [])

  useEffect(() => {
    if (step !== 3 || !form.year || !form.make.trim() || !form.model.trim()) return
    setLoadingSuggestions(true)
    api.get('/estimate-assistant/suggestions', {
      params: {
        make: form.make,
        model: form.model,
        damageType: form.damage_type,
      },
    })
      .then(({ data }) => {
        setSuggestions(data.suggestions || [])
        setSuggestionSummary(data.summary || null)
      })
      .catch(() => {
        setSuggestions([])
        setSuggestionSummary(null)
      })
      .finally(() => setLoadingSuggestions(false))
  }, [step, form.year, form.make, form.model, form.damage_type])

  useEffect(() => {
    setAddedCodes([])
  }, [form.damage_type, form.make, form.model, form.year])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1'

  function addSuggestionLineItem(item) {
    if (addedCodes.includes(item.code)) return
    const nextLine = `• ${item.description} (${item.labor_hours} hr labor, ~$${Number(item.parts_estimate || 0).toLocaleString()} parts)`
    setForm((prev) => ({
      ...prev,
      notes: prev.notes ? `${prev.notes}\n${nextLine}` : nextLine,
    }))
    setAddedCodes((prev) => [...prev, item.code])
  }

  async function submit() {
    // Validate before hitting the API
    if (!form.new_customer && !form.customer_id) {
      alert('Please select an existing customer or switch to new customer.')
      return
    }
    if (form.new_customer && !form.customer_name.trim()) {
      alert(`${t('common.name')} is required.`)
      return
    }
    if (!form.make.trim() || !form.model.trim() || !form.year) {
      alert(`${t('common.vehicle')} ${t('common.year').toLowerCase()}, ${t('common.make').toLowerCase()}, and ${t('common.model').toLowerCase()} are required.`)
      return
    }

    setLoading(true)
    try {
      let customer_id = form.customer_id
      if (!customer_id || form.new_customer) {
        const { data } = await api.post('/customers', { name: form.customer_name, phone: form.customer_phone, email: form.customer_email })
        customer_id = data.id
      }
      const { data: veh } = await api.post('/vehicles', {
        customer_id, year: +form.year, make: form.make, model: form.model,
        vin: form.vin, color: form.color, plate: form.plate
      })
      await api.post('/ros', {
        customer_id, vehicle_id: veh.id, job_type: form.job_type,
        payment_type: form.payment_type, claim_number: form.claim_number,
        insurer: form.payment_type === 'insurance' ? form.insurer : null,
        adjuster_name: form.adjuster_name, adjuster_phone: form.adjuster_phone,
        deductible: +form.deductible || 0, estimated_delivery: form.estimated_delivery, notes: form.notes,
        damaged_panels: form.damaged_panels
      })
      onSaved()
    } catch(e) {
      const msg = e?.response?.data?.error || e?.message || 'Unknown error'
      alert(`Error creating RO: ${msg}`)
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-[#1a1d2e] border border-[#2a2d3e] sm:max-w-2xl sm:rounded-xl rounded-none w-full h-screen sm:h-auto sm:max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#2a2d3e]">
          <h2 className="font-bold text-white">{t('ro.addRO')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {step === 1 && (
            <>
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Step 1 — Customer</h3>
              <div className="flex gap-2">
                <button onClick={() => set('new_customer', false)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${!form.new_customer ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-400 border border-[#2a2d3e]'}`}>Existing</button>
                <button onClick={() => set('new_customer', true)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${form.new_customer ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-400 border border-[#2a2d3e]'}`}>New</button>
              </div>
              {!form.new_customer ? (
                <div><label className={lbl}>Select Customer</label>
                  <select value={form.customer_id} onChange={e => set('customer_id', e.target.value)} className={inp}>
                    <option value="">— select —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
                  </select></div>
              ) : (
                <>
                  <div><label className={lbl}>Full Name *</label><input className={inp} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="John Smith" /></div>
                  <div><label className={lbl}>Phone</label><input className={inp} value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} placeholder="(718) 555-0100" /></div>
                  <div><label className={lbl}>Email</label><input className={inp} type="email" value={form.customer_email} onChange={e => set('customer_email', e.target.value)} placeholder="john@email.com" /></div>
                </>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Step 2 - {t('common.vehicle')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className={lbl}>{t('common.year')} *</label><input className={inp} value={form.year} onChange={e => set('year', e.target.value)} placeholder="2021" /></div>
                <div><label className={lbl}>{t('common.make')} *</label><input className={inp} value={form.make} onChange={e => set('make', e.target.value)} placeholder="Toyota" /></div>
                <div><label className={lbl}>{t('common.model')} *</label><input className={inp} value={form.model} onChange={e => set('model', e.target.value)} placeholder="Camry" /></div>
              </div>
              <div><label className={lbl}>{t('common.vin')}</label><input className={inp} value={form.vin} onChange={e => set('vin', e.target.value)} placeholder="1HGCV1F30KA..." /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label className={lbl}>Color</label><input className={inp} value={form.color} onChange={e => set('color', e.target.value)} placeholder="Silver" /></div>
                <div><label className={lbl}>Plate</label><input className={inp} value={form.plate} onChange={e => set('plate', e.target.value)} placeholder="ABC1234" /></div>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wide">Step 3 — Job Details</h3>
              <div><label className={lbl}>Job Type</label>
                <select className={inp} value={form.job_type} onChange={e => set('job_type', e.target.value)}>
                  {JOB_TYPES.map(j => <option key={j} value={j}>{j.replace('_',' ')}</option>)}
                </select></div>
              <div><label className={lbl}>Damage Type</label>
                <select className={inp} value={form.damage_type} onChange={e => set('damage_type', e.target.value)}>
                  {DAMAGE_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-4">
                <p className="text-xs font-semibold text-indigo-400 mb-3">Mark Damaged Panels</p>
                <VehicleDiagram
                  value={form.damaged_panels}
                  onChange={panels => set('damaged_panels', panels)}
                />
              </div>
              <div className="flex gap-2">
                {['insurance','cash'].map(t => (
                  <button key={t} onClick={() => set('payment_type', t)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors capitalize ${form.payment_type===t ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-400 border border-[#2a2d3e]'}`}>{t}</button>
                ))}
              </div>
              {form.payment_type === 'insurance' && (
                <>
                  <div>
                    <label className={lbl}>Insurer</label>
                    <LibraryAutocomplete
                      value={form.insurer}
                      onChange={v => set('insurer', v)}
                      onSelect={ins => {
                        set('insurer', ins.name)
                        if (!form.adjuster_phone && ins.claims_phone) set('adjuster_phone', ins.claims_phone)
                      }}
                      searchFn={searchInsurers}
                      placeholder="State Farm, GEICO, Progressive..."
                      renderItem={ins => (
                        <div>
                          <div className="text-xs text-white font-medium">{ins.name}</div>
                          {ins.claims_phone && <div className="text-[10px] text-indigo-400">{ins.claims_phone}</div>}
                        </div>
                      )}
                    />
                  </div>
                  <div><label className={lbl}>Claim #</label><input className={inp} value={form.claim_number} onChange={e => set('claim_number', e.target.value)} placeholder="CLM-2026-XXXXX" /></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div><label className={lbl}>Adjuster Name</label><input className={inp} value={form.adjuster_name} onChange={e => set('adjuster_name', e.target.value)} /></div>
                    <div><label className={lbl}>Adjuster Phone</label><input className={inp} value={form.adjuster_phone} onChange={e => set('adjuster_phone', e.target.value)} /></div>
                  </div>
                  <div><label className={lbl}>Deductible ($)</label><input className={inp} type="number" value={form.deductible} onChange={e => set('deductible', e.target.value)} placeholder="500" /></div>
                </>
              )}
              <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-indigo-300 font-semibold inline-flex items-center gap-1"><Sparkles size={13} /> AI Estimate Suggestions</p>
                  {suggestionSummary && (
                    <p className="text-[10px] text-slate-500">
                      {suggestionSummary.estimated_labor_hours.toFixed(1)} hr · ~${Number(suggestionSummary.estimated_parts_cost || 0).toLocaleString()} parts
                    </p>
                  )}
                </div>
                {loadingSuggestions ? (
                  <p className="text-[11px] text-slate-500">Loading suggestions...</p>
                ) : suggestions.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No suggestions available for this combination.</p>
                ) : (
                  <div className="space-y-1.5">
                    {suggestions.map((item) => (
                      <button
                        type="button"
                        key={item.code}
                        onClick={() => addSuggestionLineItem(item)}
                        disabled={addedCodes.includes(item.code)}
                        className="w-full text-left bg-[#1a1d2e] border border-[#2a2d3e] hover:border-indigo-500 rounded-lg px-2.5 py-2 text-xs text-slate-200 disabled:opacity-40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>{item.description}</span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-indigo-300">
                            <Plus size={10} /> {addedCodes.includes(item.code) ? 'Added' : 'Add'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <TurnaroundEstimator
                jobType={form.job_type}
                onAccept={(date) => setForm(f => ({ ...f, estimated_delivery: date }))}
              />
              <div><label className={lbl}>Est. Delivery Date</label><input className={inp} type="date" value={form.estimated_delivery} onChange={e => set('estimated_delivery', e.target.value)} /></div>
              <div><label className={lbl}>Notes</label><textarea className={inp} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional details..." /></div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between p-5 border-t border-[#2a2d3e]">
          <button onClick={() => step > 1 ? setStep(s=>s-1) : onClose()} className="text-slate-400 hover:text-white text-sm transition-colors">
            {step > 1 ? `← ${t('common.back')}` : t('common.cancel')}
          </button>
          <div className="flex items-center gap-2">
            {[1,2,3].map(i => <div key={i} className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${step>=i ? 'bg-indigo-500' : 'bg-[#2a2d3e]'}`} />)}
          </div>
          {step < 3 ? (
            <button onClick={() => {
              if (step === 1) {
                if (!form.new_customer && !form.customer_id) { alert('Please select a customer or choose New.'); return }
                if (form.new_customer && !form.customer_name.trim()) { alert(`${t('common.name')} is required.`); return }
              }
              if (step === 2) {
                if (!form.year || !form.make.trim() || !form.model.trim()) { alert(`${t('common.year')}, ${t('common.make').toLowerCase()}, and ${t('common.model').toLowerCase()} are required.`); return }
              }
              setStep(s=>s+1)
            }} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">Next →</button>
          ) : (
            <button onClick={submit} disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50">{loading ? 'Creating...' : <span className="inline-flex items-center gap-1">{t('ro.addRO')} <CheckCircle size={13} /></span>}</button>
          )}
        </div>
      </div>
    </div>
  )
}
