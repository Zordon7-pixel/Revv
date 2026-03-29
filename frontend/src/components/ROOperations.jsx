import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2, ChevronRight } from 'lucide-react'
import api from '../lib/api'

const STATUS_CYCLE = ['queued', 'in_progress', 'done', 'blocked']
const STATUS_LABELS = {
  queued: 'Queued',
  in_progress: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
}
const STATUS_COLORS = {
  queued: 'bg-slate-700 text-slate-300',
  in_progress: 'bg-indigo-600/30 text-indigo-300 border border-indigo-600/40',
  done: 'bg-emerald-600/30 text-emerald-300 border border-emerald-600/40',
  blocked: 'bg-red-600/30 text-red-300 border border-red-600/40',
}
const OPERATION_TYPES = ['body', 'paint', 'assembly', 'molding', 'glass', 'mechanical', 'detail', 'general']
const TYPE_LABELS = {
  body: 'Body',
  paint: 'Paint',
  assembly: 'Assembly',
  molding: 'Molding',
  glass: 'Glass',
  mechanical: 'Mechanical',
  detail: 'Detail',
  general: 'General',
}
const TYPE_COLORS = {
  body: 'bg-blue-700/30 text-blue-300',
  paint: 'bg-purple-700/30 text-purple-300',
  assembly: 'bg-cyan-700/30 text-cyan-300',
  molding: 'bg-amber-700/30 text-amber-300',
  glass: 'bg-sky-700/30 text-sky-300',
  mechanical: 'bg-orange-700/30 text-orange-300',
  detail: 'bg-pink-700/30 text-pink-300',
  general: 'bg-slate-700/30 text-slate-300',
}

const emptyForm = {
  title: '',
  operation_type: 'general',
  technician_id: '',
  estimated_hours: '',
  labor_rate: '',
  notes: '',
}

export default function ROOperations({ roId, technicians = [], readOnly = false }) {
  const [collapsed, setCollapsed] = useState(false)
  const [operations, setOperations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [cyclingId, setCyclingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    api.get(`/ro-operations/${roId}`)
      .then(({ data }) => { if (mounted) setOperations(data.operations || []) })
      .catch((err) => { if (mounted) setError(err?.response?.data?.error || 'Could not load operations') })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [roId])

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function addOperation(e) {
    e.preventDefault()
    const title = form.title.trim()
    if (!title) return
    setSaving(true)
    try {
      const { data } = await api.post(`/ro-operations/${roId}`, {
        title,
        operation_type: form.operation_type || 'general',
        technician_id: form.technician_id || null,
        estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : undefined,
        labor_rate: form.labor_rate ? Number(form.labor_rate) : undefined,
        notes: form.notes || null,
      })
      setOperations((prev) => [...prev, data.operation])
      setForm(emptyForm)
      setShowAddForm(false)
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not add operation')
    } finally {
      setSaving(false)
    }
  }

  async function cycleStatus(op) {
    const currentIdx = STATUS_CYCLE.indexOf(op.status)
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length]
    setCyclingId(op.id)
    try {
      const { data } = await api.put(`/ro-operations/${roId}/${op.id}`, { status: nextStatus })
      setOperations((prev) => prev.map((o) => o.id === op.id ? data.operation : o))
    } catch (err) {
      console.error('[ROOperations] status cycle failed:', err.message)
    } finally {
      setCyclingId(null)
    }
  }

  async function updateTech(op, technicianId) {
    try {
      const { data } = await api.put(`/ro-operations/${roId}/${op.id}`, { technician_id: technicianId || null })
      setOperations((prev) => prev.map((o) => o.id === op.id ? data.operation : o))
    } catch (err) {
      console.error('[ROOperations] tech update failed:', err.message)
    }
  }

  async function deleteOp(opId) {
    if (!window.confirm('Delete this operation?')) return
    setDeletingId(opId)
    try {
      await api.delete(`/ro-operations/${roId}/${opId}`)
      setOperations((prev) => prev.filter((o) => o.id !== opId))
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete operation')
    } finally {
      setDeletingId(null)
    }
  }

  async function moveOp(opId, direction) {
    const idx = operations.findIndex((o) => o.id === opId)
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === operations.length - 1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const newOps = [...operations]
    ;[newOps[idx], newOps[swapIdx]] = [newOps[swapIdx], newOps[idx]]
    setOperations(newOps)
    // Persist new sort orders
    await Promise.all([
      api.put(`/ro-operations/${roId}/${newOps[idx].id}`, { sort_order: idx }).catch(() => {}),
      api.put(`/ro-operations/${roId}/${newOps[swapIdx].id}`, { sort_order: swapIdx }).catch(() => {}),
    ])
  }

  return (
    <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wide hover:text-white transition-colors"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          Job Operations
          <span className="text-slate-600 font-normal normal-case">({operations.length})</span>
        </button>
        {!readOnly && !collapsed && (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-2.5 py-1 rounded-lg transition-colors"
          >
            <Plus size={11} /> Add Operation
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {error && (
            <div className="text-xs text-rose-300 bg-rose-900/20 border border-rose-700/40 rounded-lg px-3 py-2 mb-3">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-slate-500">Loading operations...</p>
          ) : operations.length === 0 && !showAddForm ? (
            <p className="text-xs text-slate-500">No job operations yet.{!readOnly && ' Add one to assign work by tech.'}</p>
          ) : (
            <div className="space-y-2">
              {operations.map((op, idx) => (
                <div
                  key={op.id}
                  className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl px-3 py-2.5 flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Type badge */}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${TYPE_COLORS[op.operation_type] || TYPE_COLORS.general}`}>
                      {TYPE_LABELS[op.operation_type] || op.operation_type}
                    </span>

                    {/* Title */}
                    <span className="text-xs text-white font-medium flex-1 min-w-0 truncate">{op.title}</span>

                    {/* Status badge — click to cycle */}
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => cycleStatus(op)}
                        disabled={cyclingId === op.id}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-50 ${STATUS_COLORS[op.status] || STATUS_COLORS.queued}`}
                        title="Click to advance status"
                      >
                        {cyclingId === op.id ? '...' : STATUS_LABELS[op.status] || op.status}
                      </button>
                    ) : (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${STATUS_COLORS[op.status] || STATUS_COLORS.queued}`}>
                        {STATUS_LABELS[op.status] || op.status}
                      </span>
                    )}

                    {/* Sort order buttons */}
                    {!readOnly && (
                      <div className="flex flex-col gap-0.5">
                        <button type="button" onClick={() => moveOp(op.id, 'up')} disabled={idx === 0} className="text-slate-600 hover:text-slate-300 disabled:opacity-30"><ChevronUp size={11} /></button>
                        <button type="button" onClick={() => moveOp(op.id, 'down')} disabled={idx === operations.length - 1} className="text-slate-600 hover:text-slate-300 disabled:opacity-30"><ChevronDown size={11} /></button>
                      </div>
                    )}

                    {/* Delete */}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => deleteOp(op.id)}
                        disabled={deletingId === op.id}
                        className="text-slate-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {/* Tech assignment + hours */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {!readOnly && technicians.length > 0 ? (
                      <select
                        value={op.technician_id || ''}
                        onChange={(e) => updateTech(op, e.target.value)}
                        className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">Unassigned</option>
                        {technicians.map((t) => (
                          <option key={t.id} value={t.id}>{t.name || t.email}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {op.technician_name || op.technician_email || 'Unassigned'}
                      </span>
                    )}

                    {op.estimated_hours != null && (
                      <span className="text-[10px] text-slate-500">{op.estimated_hours}h est.</span>
                    )}
                    {op.labor_rate != null && (
                      <span className="text-[10px] text-slate-500">${op.labor_rate}/hr</span>
                    )}
                    {op.notes && (
                      <span className="text-[10px] text-slate-500 italic truncate max-w-[200px]" title={op.notes}>{op.notes}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          {showAddForm && !readOnly && (
            <form onSubmit={addOperation} className="mt-3 bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-white">New Operation</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setField('title', e.target.value)}
                    placeholder="e.g. Paint roof"
                    className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">Type</label>
                  <select
                    value={form.operation_type}
                    onChange={(e) => setField('operation_type', e.target.value)}
                    className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {OPERATION_TYPES.map((t) => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                {technicians.length > 0 && (
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Assign Tech</label>
                    <select
                      value={form.technician_id}
                      onChange={(e) => setField('technician_id', e.target.value)}
                      className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">Unassigned</option>
                      {technicians.map((t) => (
                        <option key={t.id} value={t.id}>{t.name || t.email}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">Est. Hours</label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={form.estimated_hours}
                    onChange={(e) => setField('estimated_hours', e.target.value)}
                    placeholder="0.0"
                    className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">Labor Rate ($/hr)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.labor_rate}
                    onChange={(e) => setField('labor_rate', e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-slate-500 block mb-0.5">Notes</label>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setField('notes', e.target.value)}
                    placeholder="Optional notes"
                    className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving || !form.title.trim()}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  {saving ? 'Adding...' : 'Add Operation'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); setForm(emptyForm) }}
                  className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}
