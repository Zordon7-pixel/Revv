import { useEffect, useState } from 'react'
import { Users as UsersIcon, Plus, X, Shield, Wrench, Trash2, Info, Pencil, KeyRound } from 'lucide-react'
import api from '../lib/api'
import { getTokenPayload, isAdmin } from '../lib/auth'
import AppOverlay from '../components/AppOverlay'

const ROLES = ['admin', 'employee', 'staff']
const ROLE_META = {
  owner:     { label: 'Owner', icon: Shield, cls: 'text-brand border-brand/50 bg-brand/15' },
  admin:     { label: 'Admin', icon: Shield, cls: 'text-brand border-brand/40 bg-brand/10' },
  employee:  { label: 'Tech', icon: Wrench, cls: 'text-ink border-line-2 bg-raised' },
  staff:     { label: 'Staff', icon: Wrench, cls: 'text-muted border-line-2 bg-raised' },
  assistant: { label: 'Assistant', icon: Wrench, cls: 'text-brand border-brand/30 bg-brand/10' },
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
  const [resetUser, setResetUser] = useState(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)
  const [successToast, setSuccessToast] = useState('')
  const [errorToast, setErrorToast] = useState('')
  const canResetPasswords = isAdmin()
  const currentUserId = getTokenPayload()?.id || null

  useEffect(() => { load() }, [])
  function load() {
    api.get('/users')
      .then(r => setUsers(r.data.users || []))
      .catch((error) => setErrorToast(error?.response?.data?.error || 'Could not load users'))
  }

  useEffect(() => {
    if (!successToast) return undefined
    const t = setTimeout(() => setSuccessToast(''), 3500)
    return () => clearTimeout(t)
  }, [successToast])

  useEffect(() => {
    if (!errorToast) return undefined
    const t = setTimeout(() => setErrorToast(''), 3500)
    return () => clearTimeout(t)
  }, [errorToast])

  function set(k,v) { setForm(f=>({...f,[k]:v})) }

  async function save(e) {
    e.preventDefault(); setSaving(true)
    try {
      await api.post('/users', { ...form, customer_id: form.customer_id || undefined })
      setSuccessToast('User created successfully')
      load(); close()
    } catch (err) {
      setErrorToast(err?.response?.data?.error || 'Error creating user')
    } finally { setSaving(false) }
  }

  async function deleteUser(id, name) {
    if (!confirm(`Remove ${name}? This cannot be undone.`)) return
    try {
      await api.delete(`/users/${id}`)
      setSuccessToast('User removed')
      load()
    } catch (err) {
      setErrorToast(err?.response?.data?.error || 'Failed to remove user')
    }
  }

  function close() { setShowAdd(false); setForm(empty) }
  function closeAssistant() { setShowAddAssistant(false); setAssistantForm(emptyAssistant) }
  function closeEdit() {
    setEditUser(null)
    setEditForm({ name:'', email:'', phone:'', role:'employee', password:'' })
  }
  function closeResetPassword() {
    setResetUser(null)
    setResetPassword('')
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
      setSuccessToast('Assistant created successfully')
      load()
      closeAssistant()
    } catch (err) {
      setErrorToast(err?.response?.data?.error || 'Error creating assistant')
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
      setSuccessToast('User updated successfully')
      load()
      closeEdit()
    } catch (err) {
      setErrorToast(err?.response?.data?.error || 'Error updating user')
    } finally {
      setSavingEdit(false)
    }
  }

  async function submitResetPassword(e) {
    e.preventDefault()
    if (!resetUser) return
    if ((resetPassword || '').length < 8) {
      setErrorToast('Password must be at least 8 characters')
      return
    }
    setResettingPassword(true)
    try {
      const { data } = await api.post(`/users/${resetUser.id}/reset-password`, { password: resetPassword })
      setSuccessToast(data?.message || 'Password reset successfully')
      closeResetPassword()
    } catch (err) {
      setErrorToast(err?.response?.data?.error || 'Error resetting password')
    } finally {
      setResettingPassword(false)
    }
  }

  const inp = 'w-full rounded-instrument border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none'
  const lbl = 'block text-xs font-medium text-muted mb-1.5'

  const admins    = users.filter(u => ['owner','admin'].includes(u.role))
  const employees = users.filter(u => ['employee','staff'].includes(u.role))
  const assistants = users.filter(u => u.role === 'assistant')

  function canResetUser(u) {
    if (!canResetPasswords) return false
    if (u.role === 'superadmin') return false
    if (u.role === 'owner' && u.id !== currentUserId) return false
    return true
  }

  function Section({ title, list }) {
    if (!list.length) return null
    return (
      <div>
        <h3 className="text-xs font-semibold text-faint uppercase tracking-widest mb-3">{title}</h3>
        <div className="space-y-2">
          {list.map(u => {
            const meta = ROLE_META[u.role] || ROLE_META.staff
            const Icon = meta.icon
            return (
              <div key={u.id} className="flex flex-col gap-3 rounded-instrument border border-line-2 bg-panel p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${meta.cls}`}>
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{u.name}</div>
                    <div className="truncate text-xs text-faint">{u.email}</div>
                    {u.customer_name && <div className="mt-0.5 truncate text-xs text-good">Linked: {u.customer_name}</div>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <div className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${meta.cls}`}>
                    {meta.label}
                  </div>
                  {canResetUser(u) && (
                    <button
                      type="button"
                      onClick={() => setResetUser(u)}
                      className="rounded-instrument border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand transition-colors hover:bg-brand/15"
                      aria-label={`Reset password for ${u.name}`}
                    >
                      <span className="inline-flex items-center gap-1.5"><KeyRound size={12} /> Reset Password</span>
                    </button>
                  )}
                  <button type="button" onClick={() => openEdit(u)} className="rounded-instrument p-1.5 text-faint transition-colors hover:bg-brand/10 hover:text-brand" aria-label={`Edit ${u.name}`}>
                    <Pencil size={15} />
                  </button>
                  {u.role !== 'owner' && (
                    <button type="button" onClick={() => deleteUser(u.id, u.name)} className="rounded-instrument p-1.5 text-faint transition-colors hover:bg-crit/10 hover:text-crit" aria-label={`Remove ${u.name}`}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
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
          <h1 className="font-display text-xl font-bold text-ink">Team & Access</h1>
        </div>
        <button type="button" onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-brand hover:bg-brand-lit text-white font-bold px-4 py-2.5 rounded-lg text-sm transition-colors">
          <Plus size={15} /> Add User
        </button>
      </div>

      <div className="space-y-3 rounded-instrument border border-brand/30 bg-brand/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-brand">Assistant Access</h3>
            <p className="text-xs text-muted mt-1">Assistants can only view Dashboard, Repair Orders, and Customers. They cannot edit records, billing, reports, users, settings, or payments.</p>
          </div>
          <button
            onClick={() => setShowAddAssistant(true)}
            className="flex-shrink-0 flex items-center gap-2 rounded-instrument bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-lit"
          >
            <Plus size={13} /> Add Assistant
          </button>
        </div>
      </div>

      {/* Role explainer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { role:'admin',    desc:'Full access — dashboard, reports, profit, settings, RO management' },
          { role:'employee', desc:'Tech access — update RO status, add notes. No financial data visible.' },
          { role:'assistant', desc:'Read-only helper access to dashboard, repair orders, and customers.' },
        ].map(({ role, desc }) => {
          const meta = ROLE_META[role]
          const Icon = meta.icon
          return (
            <div key={role} className={`rounded-instrument p-3 border ${meta.cls}`}>
              <div className={`flex items-center gap-2 font-semibold text-xs mb-1 ${meta.cls.split(' ')[0]}`}>
                <Icon size={12}/> {meta.label}
              </div>
              <p className="text-[11px] text-faint">{desc}</p>
            </div>
          )
        })}
      </div>

      <Section title="Admins" list={admins} />
      <Section title="Techs" list={employees} />
      <Section title="Assistants" list={assistants} />

      {users.length === 0 && (
        <div className="bg-panel rounded-instrument p-8 text-center border border-line-2">
          <UsersIcon size={32} className="text-faint mx-auto mb-3"/>
          <p className="text-faint text-sm">No users yet.</p>
        </div>
      )}

      {/* Add User Modal */}
      {showAdd && (
        <AppOverlay label="Add user" onClose={close} className="bg-void/75 p-4">
          <div className="bg-panel rounded-instrument border border-line-2 w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-line-2">
              <h3 className="font-display font-bold text-ink">Add User</h3>
              <button type="button" onClick={close} className="text-muted hover:text-ink" aria-label="Close add user"><X size={18}/></button>
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
              <p className="text-[10px] text-faint bg-void rounded-lg px-3 py-2 border border-line-2 flex items-center gap-2">
                <Info size={12} className="flex-shrink-0 text-muted" /> Customers do not get team accounts. Add customer email in the RO and send tracking/payment links.
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={close} className="flex-1 bg-void text-muted rounded-lg py-2.5 text-sm border border-line-2">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand hover:bg-brand-lit text-white font-bold rounded-lg py-2.5 text-sm disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </AppOverlay>
      )}

      {showAddAssistant && (
        <AppOverlay label="Add assistant" onClose={closeAssistant} className="bg-void/75 p-4">
          <div className="bg-panel rounded-instrument border border-line-2 w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-line-2">
              <h3 className="font-display font-bold text-ink">Add Assistant</h3>
              <button type="button" onClick={closeAssistant} className="text-muted hover:text-ink" aria-label="Close add assistant"><X size={18}/></button>
            </div>
            <form onSubmit={saveAssistant} className="p-5 space-y-4">
              <div><label className={lbl}>Full Name *</label><input className={inp} required value={assistantForm.name} onChange={e => setAssistantForm(f => ({ ...f, name: e.target.value }))} placeholder="Alex Rivera"/></div>
              <div><label className={lbl}>Email *</label><input className={inp} required type="email" value={assistantForm.email} onChange={e => setAssistantForm(f => ({ ...f, email: e.target.value }))} placeholder="alex@example.com"/></div>
              <div><label className={lbl}>Temp Password *</label><input className={inp} required type="password" value={assistantForm.password} onChange={e => setAssistantForm(f => ({ ...f, password: e.target.value }))} placeholder="Temporary password"/></div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeAssistant} className="flex-1 bg-void text-muted rounded-lg py-2.5 text-sm border border-line-2">Cancel</button>
                <button type="submit" disabled={savingAssistant} className="flex-1 rounded-instrument bg-brand py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
                  {savingAssistant ? 'Creating...' : 'Create Assistant'}
                </button>
              </div>
            </form>
          </div>
        </AppOverlay>
      )}

      {editUser && (
        <AppOverlay label="Edit user" onClose={closeEdit} className="bg-void/75 p-4">
          <div className="bg-panel rounded-instrument border border-line-2 w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-line-2">
              <h3 className="font-display font-bold text-ink">Edit User</h3>
              <button type="button" onClick={closeEdit} className="text-muted hover:text-ink" aria-label="Close edit user"><X size={18}/></button>
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
                <button type="button" onClick={closeEdit} className="flex-1 bg-void text-muted rounded-lg py-2.5 text-sm border border-line-2">Cancel</button>
                <button type="submit" disabled={savingEdit} className="flex-1 bg-brand hover:bg-brand-lit text-white font-bold rounded-lg py-2.5 text-sm disabled:opacity-50">
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </AppOverlay>
      )}

      {resetUser && (
        <AppOverlay label="Reset password" onClose={closeResetPassword} className="bg-void/75 p-4">
          <div className="bg-panel rounded-instrument border border-line-2 w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-line-2">
              <h3 className="font-display font-bold text-ink">Reset Password</h3>
              <button type="button" onClick={closeResetPassword} className="text-muted hover:text-ink" disabled={resettingPassword} aria-label="Close reset password"><X size={18}/></button>
            </div>
            <form onSubmit={submitResetPassword} className="p-5 space-y-4">
              <div>
                <label className={lbl}>New Password</label>
                <input
                  className={inp}
                  type="password"
                  minLength={8}
                  required
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeResetPassword}
                  disabled={resettingPassword}
                  className="flex-1 bg-void text-muted rounded-lg py-2.5 text-sm border border-line-2 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="flex-1 rounded-instrument bg-brand py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
                >
                  {resettingPassword ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </AppOverlay>
      )}

      {successToast && (
        <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 rounded-instrument border border-good/40 bg-panel px-4 py-2 text-sm text-good shadow-lg">
          {successToast}
        </div>
      )}
      {errorToast && (
        <div role="alert" className="fixed bottom-4 right-4 z-50 rounded-instrument border border-crit/40 bg-panel px-4 py-2 text-sm text-crit shadow-lg">
          {errorToast}
        </div>
      )}
    </div>
  )
}
