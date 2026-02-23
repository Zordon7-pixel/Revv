import { useEffect, useState } from 'react'
import { Search, Phone, Shield, X } from 'lucide-react'
import api from '../lib/api'

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [q, setQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name:'', phone:'', email:'', address:'', insurance_company:'', policy_number:'' })
  const [loading, setLoading] = useState(false)

  useEffect(() => { api.get('/customers').then(r => setCustomers(r.data.customers)) }, [])

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.phone || '').includes(q) ||
    (c.insurance_company || '').toLowerCase().includes(q.toLowerCase())
  )

  async function addCustomer() {
    if (!form.name.trim()) return alert('Name is required')
    setLoading(true)
    try {
      await api.post('/customers', form)
      const r = await api.get('/customers')
      setCustomers(r.data.customers)
      setShowAdd(false)
      setForm({ name:'', phone:'', email:'', address:'', insurance_company:'', policy_number:'' })
    } catch(e) { alert('Error saving customer') } finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Customers</h1>
          <p className="text-slate-500 text-sm">{customers.length} on file</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
          + Add Customer
        </button>
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, phone, insurer..."
          className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
      </div>

      {customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl">
          <img src="/empty-customers.png" alt="No customers" className="w-40 h-40 opacity-80 object-contain" />
          <p className="text-slate-400 text-sm font-medium">Your customer book is waiting.</p>
          <p className="text-slate-600 text-xs">No customers on file yet.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-10 border border-dashed border-[#2a2d3e] rounded-xl">
          No customers match your search yet.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => (
            <div key={c.id} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 hover:border-indigo-500/40 transition-colors">
              <div className="font-semibold text-white text-sm mb-2">{c.name}</div>
              {c.phone && <div className="flex items-center gap-2 text-xs text-slate-400 mb-1"><Phone size={11} /> {c.phone}</div>}
              {c.insurance_company && <div className="flex items-center gap-2 text-xs text-slate-400"><Shield size={11} /> {c.insurance_company} {c.policy_number ? `· ${c.policy_number}` : ''}</div>}
              {c.address && <div className="text-xs text-slate-500 mt-1.5">{c.address}</div>}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-md">
            <div className="border-b border-[#2a2d3e] px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">New Customer</h2>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Full Name</label>
                <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="John Doe"
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Phone</label>
                <input type="text" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="(212) 555-0100"
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="john@example.com"
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Address</label>
                <input type="text" value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="123 Main St"
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Insurance Company</label>
                <input type="text" value={form.insurance_company} onChange={e => setForm({...form, insurance_company: e.target.value})} placeholder="State Farm, GEICO..."
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Policy Number</label>
                <input type="text" value={form.policy_number} onChange={e => setForm({...form, policy_number: e.target.value})} placeholder="POL123456"
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
            <div className="border-t border-[#2a2d3e] px-6 py-4 flex items-center gap-3 justify-end">
              <button onClick={() => setShowAdd(false)} disabled={loading} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={addCustomer} disabled={loading} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                {loading ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
