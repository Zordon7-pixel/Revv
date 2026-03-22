import { useEffect, useState } from 'react'
import { Users as UsersIcon, Plus, X, Shield, Wrench, Trash2, Info, Pencil } from 'lucide-react'
import api from '../lib/api'

const ROLES = ['admin', 'employee', 'staff']
const ROLE_META = {
  owner:    { label: 'Owner',    icon: Shield, cls: 'text-purple-400 bg-purple-900/30 border-purple-700' },
  admin:    { label: 'Admin',    icon: Shield, cls: 'text-indigo-400 bg-indigo-900/30 border-indigo-700' },
  employee: { label: 'Employee', icon: Wrench, cls: 'text-orange-400 bg-orange-900/30 border-orange-700'  },
  staff:    { label: 'Staff',    icon: Wrench, cls: 'text-blue-400   bg-blue-900/30   border-blue-700'   },
  assistant:{ label: 'Assistant',icon: Wrench, cls: 'text-yellow-300 bg-yellow-900/30 border-yellow-700' },
}

export default function Users() {
  const [users,   setUsers]   = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [showAddAssistant, setShowAddAssistant] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [savingAssistant, setSavingAssistant] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [editForm, setEditForm] = useState({ name:'', email:'', phone:'', role:'employee', password:'' })
  const [savingEdit, setSavingEdit] = useState(false)
  const empty = { name:'', email:'', password:'', role:'employee', customer_id:'' }
  const emptyAssistant = { name:'', email:'', password:'' }
  const [form, setForm] = useState(empty)
  const [assistantForm, setAssistantForm] = useState(emptyAssistant)

  useEffect(() => { load() }, [])
  function load() {
    api.get('/users').then(r => setUsers(r.data.users || []))
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
  function closeAssistant() { setShowAddAssistant(false); setAssistantForm(emptyAssistant) }
  function closeEdit() {
    setEditUser(null)
    setEditForm({ name:'', email:'', phone:'', role:'employee', password:'' })
  }

  function openEdit(u) {
    setEditUser(u)
    setEditForm({
      name: u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      role: u.role || 'employee',
      password: '',
    })
  }

  async function saveAssistant(e) {
    e.preventDefault()
    setSavingAssistant(true)
    try {
      await api.post('/users/assistant', assistantForm)
      load()
      closeAssistant()
    } catch (err) {
      alert(err?.response?.data?.error || 'Error creating assistant')
    } finally {
      setSavingAssistant(false)
    }
  }

  async function saveEdit(e) {
    e.preventDefault()
    if (!editUser) return
    setSavingEdit(true)
    try {
      const payload = {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone || null,
      }
      if (editUser.role !== 'owner') {
        payload.role = editForm.role
      }
      if ((editForm.password || '').trim()) {
        payload.password = editForm.password
      }
      await api.put(`/users/${editUser.id}`, payload)
      load()
      closeEdit()
    } catch (err) {
      alert(err?.response?.data?.error || 'Error updating user')
    } finally {
      setSavingEdit(false)
    }
  }

  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1.5'

  const admins    = users.filter(u => ['owner','admin'].includes(u.role))
  const employees = users.filter(u => ['employee','staff'].includes(u.role))
  const assistants = users.filter(u => u.role === 'assistant')

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
                <button
                  onClick={() => openEdit(u)}
                  className="text-slate-500 hover:text-indigo-300 transition-colors ml-1"
                  title="Edit user"
                >
                  <Pencil size={15} />
                </button>
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

      <div className="bg-yellow-900/10 border border-yellow-700/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-yellow-300">Assistant Access</h3>
            <p className="text-xs text-slate-400 mt-1">Assistants can only view Dashboard, Repair Orders, and Customers. They cannot edit records, billing, reports, users, settings, or payments.</p>
          </div>
          <button
            onClick={() => setShowAddAssistant(true)}
            className="flex-shrink-0 flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-[#0f1117] font-semibold px-3 py-2 rounded-lg text-xs transition-colors"
          >
            <Plus size={13} /> Add Assistant
          </button>
        </div>
      </div>

      {/* Role explainer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { role:'admin',    desc:'Full access — dashboard, reports, profit, settings, RO management' },
          { role:'employee', desc:'Work access — update RO status, add notes. No financial data visible.' },
          { role:'assistant', desc:'Read-only helper access to dashboard, repair orders, and customers.' },
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
      <Section title="Assistants" list={assistants} />

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
              <p className="text-[10px] text-slate-500 bg-[#0f1117] rounded-lg px-3 py-2 border border-[#2a2d3e] flex items-center gap-2">
                <Info size={12} className="flex-shrink-0 text-slate-400" /> Customers do not get team accounts. Add customer email in the RO and send tracking/payment links.
              </p>
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

      {showAddAssistant && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[#2a2d3e]">
              <h3 className="font-bold text-white">Add Assistant</h3>
              <button onClick={closeAssistant} className="text-slate-400 hover:text-white"><X size={18}/></button>
            </div>
            <form onSubmit={saveAssistant} className="p-5 space-y-4">
              <div><label className={lbl}>Full Name *</label><input className={inp} required value={assistantForm.name} onChange={e => setAssistantForm(f => ({ ...f, name: e.target.value }))} placeholder="Alex Rivera"/></div>
              <div><label className={lbl}>Email *</label><input className={inp} required type="email" value={assistantForm.email} onChange={e => setAssistantForm(f => ({ ...f, email: e.target.value }))} placeholder="alex@example.com"/></div>
              <div><label className={lbl}>Temp Password *</label><input className={inp} required type="password" value={assistantForm.password} onChange={e => setAssistantForm(f => ({ ...f, password: e.target.value }))} placeholder="Temporary password"/></div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeAssistant} className="flex-1 bg-[#0f1117] text-slate-400 rounded-lg py-2.5 text-sm border border-[#2a2d3e]">Cancel</button>
                <button type="submit" disabled={savingAssistant} className="flex-1 bg-yellow-400 hover:bg-yellow-300 text-[#0f1117] font-bold rounded-lg py-2.5 text-sm disabled:opacity-50">
                  {savingAssistant ? 'Creating...' : 'Create Assistant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editUser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[#2a2d3e]">
              <h3 className="font-bold text-white">Edit User</h3>
              <button onClick={closeEdit} className="text-slate-400 hover:text-white"><X size={18}/></button>
            </div>
            <form onSubmit={saveEdit} className="p-5 space-y-4">
              <div><label className={lbl}>Full Name *</label><input className={inp} required value={editForm.name} onChange={e=>setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label className={lbl}>Email *</label><input className={inp} required type="email" value={editForm.email} onChange={e=>setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><label className={lbl}>Phone</label><input className={inp} value={editForm.phone} onChange={e=>setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" /></div>
              {editUser.role !== 'owner' && (
                <div>
                  <label className={lbl}>Role *</label>
                  <select className={inp} value={editForm.role} onChange={e=>setEditForm(f => ({ ...f, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className={lbl}>New Password (optional)</label>
                <input className={inp} type="password" value={editForm.password} onChange={e=>setEditForm(f => ({ ...f, password: e.target.value }))} placeholder="Leave blank to keep current password" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeEdit} className="flex-1 bg-[#0f1117] text-slate-400 rounded-lg py-2.5 text-sm border border-[#2a2d3e]">Cancel</button>
                <button type="submit" disabled={savingEdit} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg py-2.5 text-sm disabled:opacity-50">
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
