import { useMemo, useState } from 'react'

const SERVICES = [
  'Oil Change',
  'Brake Service',
  'Tire Rotation',
  'Engine Repair',
  'Body Work',
  'Inspection',
  'Other',
]

export default function BookAppointment() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const shopName = params.get('name') || 'Book an Appointment'
  const shopId = params.get('shop') || ''

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    vehicle_year: '',
    vehicle_make: '',
    vehicle_model: '',
    service: SERVICES[0],
    preferred_date: '',
    preferred_time: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const inputCls = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#EAB308]'

  function setField(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const query = shopId ? `?shop=${encodeURIComponent(shopId)}` : ''
      const res = await fetch(`/api/appointments/request${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not submit request')
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[#0f1117] text-slate-200 px-4 py-10">
        <div className="max-w-lg mx-auto bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-6 text-center">
          <h1 className="text-2xl font-bold text-white">Request received!</h1>
          <p className="text-slate-400 mt-2">We will call you to confirm.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-200 px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-4">
        <header className="text-center space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold text-white">{shopName}</h1>
          <p className="text-slate-400 text-sm">Complete this form and the shop will contact you to confirm your appointment.</p>
        </header>

        <form onSubmit={submit} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 md:p-6 space-y-4">
          {error && <p className="text-red-300 text-sm">{error}</p>}

          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 block mb-1">Customer Name *</label>
              <input required value={form.name} onChange={(e) => setField('name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Phone *</label>
              <input required value={form.phone} onChange={(e) => setField('phone', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Vehicle Year</label>
              <input value={form.vehicle_year} onChange={(e) => setField('vehicle_year', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Vehicle Make</label>
              <input value={form.vehicle_make} onChange={(e) => setField('vehicle_make', e.target.value)} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 block mb-1">Vehicle Model</label>
              <input value={form.vehicle_model} onChange={(e) => setField('vehicle_model', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Service Needed *</label>
              <select value={form.service} onChange={(e) => setField('service', e.target.value)} className={inputCls}>
                {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Preferred Date</label>
              <input type="date" value={form.preferred_date} onChange={(e) => setField('preferred_date', e.target.value)} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 block mb-1">Preferred Time</label>
              <input type="time" value={form.preferred_time} onChange={(e) => setField('preferred_time', e.target.value)} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-400 block mb-1">Notes</label>
              <textarea rows={4} value={form.notes} onChange={(e) => setField('notes', e.target.value)} className={inputCls} />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold rounded-lg py-2.5 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  )
}
