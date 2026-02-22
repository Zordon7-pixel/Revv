import { useEffect, useState } from 'react'
import { Users as UsersIcon, Plus, X, Shield, Wrench, Car, Trash2 } from 'lucide-react'
import api from '../lib/api'

const ROLES = ['admin', 'employee', 'staff', 'customer']
const ROLE_META = {
  owner:    { label: 'Owner',    icon: Shield, cls: 'text-purple-400 bg-purple-900/30 border-purple-700' },
  admin:    { label: 'Admin',    icon: Shield, cls: 'text-indigo-400 bg-indigo-900/30 border-indigo-700' },
  employee: { label: 'Employee', icon: Wrench, cls: 'text-amber-400  bg-amber-900/30  border-amber-700'  },
  staff:    { label: 'Staff',    icon: Wrench, cls: 'text-blue-400   bg-blue-900/30   border-blue-700'   },
  customer: { label: 'Customer', icon: Car,    cls: 'text-emerald-400 bg-emerald-900/30 border-emerald-700' },
}

export default function Users() {
  const [users,     setUsers]     = useState([])
  const [customers, setCustomers] = useState([])
  const [showAdd,   setShowAdd]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const empty = { name:'', email:'', password:'', role:'employee', customer_id:'' }
  const [form, setForm] = useState(empty)

  useEffect(() => { load() }, [])
  function load() {
    api.get('/users').then(r => setUsers(r.data.users || []))
    api.get('/customers').then(r => setCustomers(r.data.customers || []))
  }

  function set(k,v) { setForm(f=>({...f,[k]:v})) }

  async function save(e) {
    e.preventDefault(); setSaving(true)
    try {
      await api.post('/users', { ...form, customer_id: form.customer_id || undefined })
      load(); close()
    } catch (err) {
      alert(err?.response?.data?.error || 'Error creating user')
    } finally { setSaving(false) }
  }

  async function deleteUser(id, name) {
    if (!confirm(`Remove ${name}? This cannot be undone.`)) return
    await api.delete(`/users/${id}`)
    load()
  }

  function close() { setShowAdd(false); setForm(empty) }

  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1.5'

  const admins    = users.filter(u => ['owner','admin'].includes(u.role))
  const employees = users.filter(u => ['employee','staff'].includes(u.role))
  const customerU = users.filter(u => u.role === 'customer')

  function Section({ title, list }) {
    if (!list.length) return null
    return (
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">{title}</h3>
        <div className="space-y-2">
          {list.map(u => {
            const meta = ROLE_META[u.role] || ROLE_META.staff
            const Icon = meta.icon
            return (
              <div key={u.id} className="bg-[#1a1d2e] rounded-xl p-4 border border-[#2a2d3e] flex items-center gap-4">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${meta.cls}`}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm">{u.name}</div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                  {u.customer_name && <div className="text-xs text-emerald-400 mt-0.5">Linked: {u.customer_name}</div>}
                </div>
                <div className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${meta.cls}`}>
                  {meta.label}
                </div>
                {u.role !== 'owner' && (
                  <button onClick={() => deleteUser(u.id, u.name)}
                    className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Team & Access</h1>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2.5 rounded-lg text-sm transition-colors">
          <Plus size={15} /> Add User
        </button>
      </div>

      {/* Role explainer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { role:'admin',    desc:'Full access — dashboard, reports, profit, settings, RO management' },
          { role:'employee', desc:'Work access — update RO status, add notes. No financial data visible.' },
          { role:'customer', desc:'Portal only — sees their own vehicle status in plain English + SMS button.' },
        ].map(({ role, desc }) => {
          const meta = ROLE_META[role]
          const Icon = meta.icon
          return (
            <div key={role} className={`rounded-xl p-3 border ${meta.cls}`}>
              <div className={`flex items-center gap-2 font-semibold text-xs mb-1 ${meta.cls.split(' ')[0]}`}>
                <Icon size={12}/> {meta.label}
              </div>
              <p className="text-[11px] text-slate-500">{desc}</p>
            </div>
          )
        })}
      </div>

      <Section title="Admins" list={admins} />
      <Section title="Employees" list={employees} />
      <Section title="Customer Logins" list={customerU} />

      {users.length === 0 && (
        <div className="bg-[#1a1d2e] rounded-xl p-8 text-center border border-[#2a2d3e]">
          <UsersIcon size={32} className="text-slate-600 mx-auto mb-3"/>
          <p className="text-slate-500 text-sm">No users yet.</p>
        </div>
      )}

      {/* Add User Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[#2a2d3e]">
              <h3 className="font-bold text-white">Add User</h3>
              <button onClick={close} className="text-slate-400 hover:text-white"><X size={18}/></button>
            </div>
            <form onSubmit={save} className="p-5 space-y-4">
              <div><label className={lbl}>Full Name *</label><input className={inp} required value={form.name} onChange={e=>set('name',e.target.value)} placeholder="John Smith"/></div>
              <div><label className={lbl}>Email *</label><input className={inp} required type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="john@example.com"/></div>
              <div><label className={lbl}>Password *</label><input className={inp} required type="password" value={form.password} onChange={e=>set('password',e.target.value)} placeholder="Temporary password"/></div>
              <div>
                <label className={lbl}>Role *</label>
                <select className={inp} value={form.role} onChange={e=>set('role',e.target.value)}>
                  {ROLES.map(r=><option key={r} value={r}>{ROLE_META[r]?.label || r}</option>)}
                </select>
              </div>
              {form.role === 'customer' && (
                <div>
                  <label className={lbl}>Link to Customer Record</label>
                  <select className={inp} value={form.customer_id} onChange={e=>set('customer_id',e.target.value)}>
                    <option value="">— select customer —</option>
                    {customers.map(c=><option key={c.id} value={c.id}>{c.name} {c.phone ? `· ${c.phone}` : ''}</option>)}
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">Link this login to a customer record so they can see their repair orders in the portal.</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={close} className="flex-1 bg-[#0f1117] text-slate-400 rounded-lg py-2.5 text-sm border border-[#2a2d3e]">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg py-2.5 text-sm disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
