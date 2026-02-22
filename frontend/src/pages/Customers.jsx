import { useEffect, useState } from 'react'
import { Search, Phone, Shield } from 'lucide-react'
import api from '../lib/api'

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => { api.get('/customers').then(r => setCustomers(r.data.customers)) }, [])

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.phone||'').includes(q) ||
    (c.insurance_company||'').toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Customers</h1>
        <p className="text-slate-500 text-sm">{customers.length} on file</p>
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, phone, insurer..."
          className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
      </div>
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
    </div>
  )
}
