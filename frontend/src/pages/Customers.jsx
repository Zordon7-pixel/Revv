import { useEffect, useState } from 'react'
import { Search, Phone, Shield, X, Mail, MapPin, Car, FileText, ChevronRight, User } from 'lucide-react'
import api from '../lib/api'

const LETTERS = ['All', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))]

function getLastName(name) {
  const parts = (name || '').trim().split(/\s+/)
  return parts[parts.length - 1] || ''
}

const STATUS_COLORS = {
  intake: 'text-slate-400', estimate: 'text-blue-400', approval: 'text-yellow-400',
  parts: 'text-orange-400', repair: 'text-green-400', paint: 'text-purple-400',
  qc: 'text-cyan-400', delivery: 'text-emerald-400', closed: 'text-slate-500'
}

function CustomerDrawer({ customerId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(`/customers/${customerId}/full`).then(r => {
      setData(r.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [customerId])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-md bg-[#1a1d2e] border-l border-[#2a2d3e] flex flex-col h-full overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d3e] flex-shrink-0">
          <h2 className="font-bold text-white text-sm">Customer 360</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors"><X size={18}/></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Loading...</div>
        ) : !data ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Failed to load</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Customer Info */}
            <div className="bg-[#0f1117] rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600/30 flex items-center justify-center flex-shrink-0">
                  <User size={18} className="text-indigo-400" />
                </div>
                <div>
                  <div className="font-bold text-white">{data.customer.name}</div>
                  <div className="text-xs text-slate-500">Customer ID #{data.customer.id?.slice(-6)}</div>
                </div>
              </div>
              {data.customer.phone && (
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Phone size={12} className="text-slate-500 flex-shrink-0"/>
                  <a href={`tel:${data.customer.phone}`} className="hover:text-indigo-400">{data.customer.phone}</a>
                </div>
              )}
              {data.customer.email && (
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Mail size={12} className="text-slate-500 flex-shrink-0"/>
                  <a href={`mailto:${data.customer.email}`} className="hover:text-indigo-400 truncate">{data.customer.email}</a>
                </div>
              )}
              {data.customer.address && (
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <MapPin size={12} className="text-slate-500 flex-shrink-0"/>
                  {data.customer.address}
                </div>
              )}
              {data.customer.insurance_company && (
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Shield size={12} className="text-slate-500 flex-shrink-0"/>
                  {data.customer.insurance_company} {data.customer.policy_number ? `· ${data.customer.policy_number}` : ''}
                </div>
              )}
            </div>

            {/* Vehicles */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Car size={14} className="text-indigo-400"/>
                <span className="text-xs font-bold text-white uppercase tracking-wide">Vehicles ({data.vehicles.length})</span>
              </div>
              {data.vehicles.length === 0 ? (
                <div className="text-xs text-slate-500 bg-[#0f1117] rounded-xl p-3">No vehicles on file</div>
              ) : (
                <div className="space-y-2">
                  {data.vehicles.map(v => (
                    <div key={v.id} className="bg-[#0f1117] rounded-xl p-3">
                      <div className="text-sm font-semibold text-white">{v.year} {v.make} {v.model}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {v.color && <span className="text-[10px] text-slate-500">{v.color}</span>}
                        {v.plate && <span className="text-[10px] text-slate-400 font-mono">{v.plate}</span>}
                        {v.vin && <span className="text-[10px] text-slate-600 font-mono truncate">{v.vin}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RO History */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText size={14} className="text-indigo-400"/>
                <span className="text-xs font-bold text-white uppercase tracking-wide">Repair Orders ({data.ros.length})</span>
              </div>
              {data.ros.length === 0 ? (
                <div className="text-xs text-slate-500 bg-[#0f1117] rounded-xl p-3">No repair orders</div>
              ) : (
                <div className="space-y-2">
                  {data.ros.map(ro => (
                    <div key={ro.id} className="bg-[#0f1117] rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-white">{ro.ro_number}</span>
                        <span className={`text-[10px] font-semibold capitalize ${STATUS_COLORS[ro.status] || 'text-slate-400'}`}>{ro.status}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500 capitalize">{ro.job_type} · {new Date(ro.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}</span>
                        {ro.total > 0 && <span className="text-[10px] font-semibold text-emerald-400">${Number(ro.total).toLocaleString()}</span>}
                      </div>
                      {ro.notes && <div className="text-[10px] text-slate-600 mt-1 truncate">{ro.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [q, setQ] = useState('')
  const [activeLetter, setActiveLetter] = useState('All')
  const [showAdd, setShowAdd] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState({ name:'', phone:'', email:'', address:'', insurance_company:'', policy_number:'' })
  const [loading, setLoading] = useState(false)

  useEffect(() => { api.get('/customers').then(r => setCustomers(r.data.customers)) }, [])

  // Count per letter for badges
  const letterCounts = LETTERS.reduce((acc, letter) => {
    if (letter === 'All') {
      acc['All'] = customers.length
    } else {
      acc[letter] = customers.filter(c => getLastName(c.name).toUpperCase().startsWith(letter)).length
    }
    return acc
  }, {})

  const byLetter = activeLetter === 'All'
    ? customers
    : customers.filter(c => getLastName(c.name).toUpperCase().startsWith(activeLetter))

  const filtered = byLetter.filter(c =>
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

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, phone, insurer..."
          className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
      </div>

      {/* A-Z Tabs */}
      {customers.length > 0 && (
        <div className="overflow-x-auto pb-1 -mx-1 px-1">
          <div className="flex gap-1 min-w-max">
            {LETTERS.map(letter => {
              const count = letterCounts[letter] || 0
              const active = activeLetter === letter
              const hasCustomers = count > 0
              return (
                <button
                  key={letter}
                  onClick={() => setActiveLetter(letter)}
                  disabled={!hasCustomers && letter !== 'All'}
                  className={`relative flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : hasCustomers
                        ? 'bg-[#1a1d2e] border border-[#2a2d3e] text-slate-300 hover:border-indigo-500/50 hover:text-white'
                        : 'bg-[#1a1d2e] border border-[#2a2d3e] text-slate-700 cursor-default'
                  }`}
                >
                  {letter}
                  {hasCustomers && (
                    <span className={`ml-1 text-[9px] font-bold ${active ? 'text-indigo-200' : 'text-slate-500'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl">
          <img src="/empty-customers.png" alt="No customers" className="w-40 h-40 opacity-80 object-contain" />
          <p className="text-slate-400 text-sm font-medium">Your customer book is waiting.</p>
          <p className="text-slate-600 text-xs">No customers on file yet.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-10 border border-dashed border-[#2a2d3e] rounded-xl">
          No customers match your search.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => (
            <div key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 hover:border-indigo-500/40 transition-colors cursor-pointer group">
              <div className="flex items-start justify-between">
                <div className="font-semibold text-white text-sm mb-2 group-hover:text-indigo-300 transition-colors">{c.name}</div>
                <ChevronRight size={14} className="text-slate-600 group-hover:text-indigo-400 mt-0.5 flex-shrink-0 transition-colors" />
              </div>
              {c.phone && <div className="flex items-center gap-2 text-xs text-slate-400 mb-1"><Phone size={11} /> {c.phone}</div>}
              {c.insurance_company && <div className="flex items-center gap-2 text-xs text-slate-400"><Shield size={11} /> {c.insurance_company} {c.policy_number ? `· ${c.policy_number}` : ''}</div>}
              {c.address && <div className="text-xs text-slate-500 mt-1.5">{c.address}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Add Customer Modal */}
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

      {/* Customer 360 Drawer */}
      {selectedId && (
        <CustomerDrawer customerId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
