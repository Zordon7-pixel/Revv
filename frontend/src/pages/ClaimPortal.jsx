import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import api from '../lib/api'

export default function ClaimPortal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [data, setData] = useState(null)
  const [form, setForm] = useState({
    adjustor_name: '',
    adjustor_company: '',
    adjustor_email: '',
    approved_labor: '',
    approved_parts: '',
    supplement_amount: '',
    adjustor_notes: '',
  })
  const [assessmentFile, setAssessmentFile] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const { data } = await api.get(`/claim-link/${token}`)
        setData(data)
      } catch {
        setError('This claim link is invalid or unavailable.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  async function onSubmit(e) {
    e.preventDefault()
    if (!form.adjustor_name.trim() || !form.adjustor_company.trim()) {
      alert('Adjustor name and company are required.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      if (assessmentFile) fd.append('assessment', assessmentFile)
      await api.post(`/claim-link/${token}/submit`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setSuccess(true)
      setData(prev => ({ ...prev, link: { ...(prev?.link || {}), submitted_at: new Date().toISOString() } }))
    } catch (e2) {
      setError(e2?.response?.data?.error || 'Could not submit assessment.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-[#0f1117] text-slate-300 flex items-center justify-center">Loading portal…</div>
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-[#0f1117] text-slate-200 p-6">
        <div className="max-w-3xl mx-auto mt-10 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-6">
          <h1 className="text-xl font-bold text-white">REVV · Insurance Assessment Portal</h1>
          <p className="text-red-400 mt-4">{error}</p>
        </div>
      </div>
    )
  }

  if (data?.link?.submitted_at || success) {
    return (
      <div className="min-h-screen bg-[#0f1117] text-slate-200 p-6">
        <div className="max-w-3xl mx-auto mt-10 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-6 text-center">
          <h1 className="text-xl font-bold text-white">REVV · Insurance Assessment Portal</h1>
          <p className="text-emerald-400 mt-6 text-lg font-semibold flex items-center justify-center gap-2"><CheckCircle2 size={20} /> Assessment received. Thank you.</p>
          <p className="text-slate-400 mt-2">Assessment submitted successfully. The shop has been notified.</p>
        </div>
      </div>
    )
  }

  const ro = data?.ro || {}
  const vehicle = data?.vehicle || {}
  const customer = data?.customer || {}
  const shop = data?.shop || {}

  const inputCls = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500'

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-200 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <header className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5">
          <h1 className="text-xl font-bold text-white">REVV</h1>
          <p className="text-slate-400 text-sm mt-1">Insurance Assessment Portal</p>
        </header>

        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-2 text-sm">
          <h2 className="text-white font-semibold">Repair Order Details</h2>
          <div className="grid md:grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-500">Shop</span><p className="text-white">{shop.name || '—'}</p></div>
            <div><span className="text-slate-500">RO Number</span><p className="text-white">{ro.ro_number || '—'}</p></div>
            <div><span className="text-slate-500">Vehicle</span><p className="text-white">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}</p></div>
            <div><span className="text-slate-500">VIN</span><p className="text-white">{vehicle.vin || '—'}</p></div>
            <div><span className="text-slate-500">Customer</span><p className="text-white">{customer.name || '—'}</p></div>
            <div><span className="text-slate-500">Contact</span><p className="text-white">{shop.phone || '—'}</p></div>
          </div>
        </div>

        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 text-sm">
          <h2 className="text-white font-semibold mb-3">Shop Estimate</h2>
          <div className="grid md:grid-cols-3 gap-3 text-xs">
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3"><span className="text-slate-500">Parts</span><p className="text-white text-base mt-1">${Number(ro.parts_cost || 0).toLocaleString()}</p></div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3"><span className="text-slate-500">Labor</span><p className="text-white text-base mt-1">${Number(ro.labor_cost || 0).toLocaleString()}</p></div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3"><span className="text-slate-500">Total</span><p className="text-emerald-400 text-base mt-1 font-semibold">${Number(ro.total || 0).toLocaleString()}</p></div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-4">
          <h2 className="text-white font-semibold">Your Assessment</h2>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Adjustor Name *</label>
              <input className={inputCls} value={form.adjustor_name} onChange={e => set('adjustor_name', e.target.value)} required />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Company *</label>
              <input className={inputCls} value={form.adjustor_company} onChange={e => set('adjustor_company', e.target.value)} required />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 block mb-1">Email</label>
              <input type="email" className={inputCls} value={form.adjustor_email} onChange={e => set('adjustor_email', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Approved Labor Amount</label>
              <div className="relative"><span className="absolute left-3 top-2 text-slate-500">$</span><input type="number" step="0.01" className={inputCls + ' pl-7'} value={form.approved_labor} onChange={e => set('approved_labor', e.target.value)} /></div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Approved Parts Amount</label>
              <div className="relative"><span className="absolute left-3 top-2 text-slate-500">$</span><input type="number" step="0.01" className={inputCls + ' pl-7'} value={form.approved_parts} onChange={e => set('approved_parts', e.target.value)} /></div>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 block mb-1">Supplement Amount</label>
              <div className="relative"><span className="absolute left-3 top-2 text-slate-500">$</span><input type="number" step="0.01" placeholder="0.00" className={inputCls + ' pl-7'} value={form.supplement_amount} onChange={e => set('supplement_amount', e.target.value)} /></div>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 block mb-1">Notes / Comments</label>
              <textarea rows={4} className={inputCls} value={form.adjustor_notes} onChange={e => set('adjustor_notes', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 block mb-1">Upload Assessment PDF</label>
              <input type="file" accept="application/pdf,.pdf" className={inputCls} onChange={e => setAssessmentFile(e.target.files?.[0] || null)} />
            </div>
          </div>

          <button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            {submitting ? 'Submitting...' : 'Submit Assessment'}
          </button>
        </form>
      </div>
    </div>
  )
}
