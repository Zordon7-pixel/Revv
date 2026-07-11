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
  queued: 'border border-line-2 bg-raised text-muted',
  in_progress: 'border border-brand/40 bg-brand/10 text-brand',
  done: 'border border-good/40 bg-good/10 text-good',
  blocked: 'border border-crit/40 bg-crit/10 text-crit',
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
  body: 'border border-brand/30 bg-brand/10 text-brand',
  paint: 'border border-brand/30 bg-brand/10 text-brand',
  assembly: 'border border-brand/30 bg-brand/10 text-brand',
  molding: 'border border-brand/30 bg-brand/10 text-brand',
  glass: 'border border-brand/30 bg-brand/10 text-brand',
  mechanical: 'border border-brand/30 bg-brand/10 text-brand',
  detail: 'border border-brand/30 bg-brand/10 text-brand',
  general: 'border border-line-2 bg-raised text-muted',
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
    setError(null)
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
      console.error('[ROOperations] Add operation failed')
      setError(err?.response?.data?.error || 'Could not add operation')
    } finally {
      setSaving(false)
    }
  }

  async function cycleStatus(op) {
    const currentIdx = STATUS_CYCLE.indexOf(op.status)
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length]
    setCyclingId(op.id)
    setError(null)
    try {
      const { data } = await api.put(`/ro-operations/${roId}/${op.id}`, { status: nextStatus })
      setOperations((prev) => prev.map((o) => o.id === op.id ? data.operation : o))
    } catch (err) {
      console.error('[ROOperations] Status update failed')
      setError(err?.response?.data?.error || 'Could not update operation status')
    } finally {
      setCyclingId(null)
    }
  }

  async function updateTech(op, technicianId) {
    setError(null)
    try {
      const { data } = await api.put(`/ro-operations/${roId}/${op.id}`, { technician_id: technicianId || null })
      setOperations((prev) => prev.map((o) => o.id === op.id ? data.operation : o))
    } catch (err) {
      console.error('[ROOperations] Technician update failed')
      setError(err?.response?.data?.error || 'Could not update operation technician')
    }
  }

  async function deleteOp(opId) {
    if (!window.confirm('Delete this operation?')) return
    setDeletingId(opId)
    setError(null)
    try {
      await api.delete(`/ro-operations/${roId}/${opId}`)
      setOperations((prev) => prev.filter((o) => o.id !== opId))
    } catch (err) {
      console.error('[ROOperations] Delete operation failed')
      setError(err?.response?.data?.error || 'Could not delete operation')
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
    try {
      setError(null)
      await Promise.all([
        api.put(`/ro-operations/${roId}/${newOps[idx].id}`, { sort_order: idx }),
        api.put(`/ro-operations/${roId}/${newOps[swapIdx].id}`, { sort_order: swapIdx }),
      ])
    } catch {
      console.error('[ROOperations] Reorder failed')
      setError('Could not save the new operation order')
    }
  }

  return (
    <div className="rounded-instrument border border-line-2 bg-panel p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted transition-colors hover:text-ink"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          Job Operations
          <span className="font-mono font-normal normal-case tabular-nums text-faint">({operations.length})</span>
        </button>
        {!readOnly && !collapsed && (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-brand-lit"
          >
            <Plus size={11} /> Add Operation
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {error && (
            <div role="alert" className="mb-3 rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-xs text-crit">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-faint">Loading operations...</p>
          ) : operations.length === 0 && !showAddForm ? (
            <p className="text-xs text-faint">No job operations yet.{!readOnly && ' Add one to assign work by tech.'}</p>
          ) : (
            <div className="space-y-2">
              {operations.map((op, idx) => (
                <div
                  key={op.id}
                  className="flex flex-col gap-2 rounded-instrument border border-line-2 bg-void px-3 py-2.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Type badge */}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${TYPE_COLORS[op.operation_type] || TYPE_COLORS.general}`}>
                      {TYPE_LABELS[op.operation_type] || op.operation_type}
                    </span>

                    {/* Title */}
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{op.title}</span>

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
                        <button type="button" onClick={() => moveOp(op.id, 'up')} disabled={idx === 0} className="text-faint transition-colors hover:text-ink disabled:opacity-30" aria-label={`Move ${op.title} up`}><ChevronUp size={11} /></button>
                        <button type="button" onClick={() => moveOp(op.id, 'down')} disabled={idx === operations.length - 1} className="text-faint transition-colors hover:text-ink disabled:opacity-30" aria-label={`Move ${op.title} down`}><ChevronDown size={11} /></button>
                      </div>
                    )}

                    {/* Delete */}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => deleteOp(op.id)}
                        disabled={deletingId === op.id}
                        className="rounded-md p-1 text-faint transition-colors hover:bg-crit/10 hover:text-crit disabled:opacity-40"
                        aria-label={`Delete ${op.title || 'operation'}`}
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
                        className="rounded-lg border border-line-2 bg-panel px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                        aria-label={`Assign technician for ${op.title}`}
                      >
                        <option value="">Unassigned</option>
                        {technicians.map((t) => (
                          <option key={t.id} value={t.id}>{t.name || t.email}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-faint">
                        {op.technician_name || op.technician_email || 'Unassigned'}
                      </span>
                    )}

                    {op.estimated_hours != null && (
                      <span className="font-mono text-[10px] tabular-nums text-faint">{op.estimated_hours}h est.</span>
                    )}
                    {op.labor_rate != null && (
                      <span className="font-mono text-[10px] tabular-nums text-gold">${op.labor_rate}/hr</span>
                    )}
                    {op.notes && (
                      <span className="max-w-[200px] truncate text-[10px] italic text-faint" title={op.notes}>{op.notes}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          {showAddForm && !readOnly && (
            <form onSubmit={addOperation} className="mt-3 space-y-3 rounded-instrument border border-line-2 bg-void p-3">
              <p className="text-xs font-semibold text-ink">New Operation</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] text-faint">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setField('title', e.target.value)}
                    placeholder="e.g. Paint roof"
                    className="w-full rounded-lg border border-line-2 bg-panel px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                    required
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-faint">Type</label>
                  <select
                    value={form.operation_type}
                    onChange={(e) => setField('operation_type', e.target.value)}
                    className="w-full rounded-lg border border-line-2 bg-panel px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  >
                    {OPERATION_TYPES.map((t) => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                {technicians.length > 0 && (
                  <div>
                    <label className="mb-0.5 block text-[10px] text-faint">Assign Tech</label>
                    <select
                      value={form.technician_id}
                      onChange={(e) => setField('technician_id', e.target.value)}
                      className="w-full rounded-lg border border-line-2 bg-panel px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                    >
                      <option value="">Unassigned</option>
                      {technicians.map((t) => (
                        <option key={t.id} value={t.id}>{t.name || t.email}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="mb-0.5 block text-[10px] text-faint">Est. Hours</label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={form.estimated_hours}
                    onChange={(e) => setField('estimated_hours', e.target.value)}
                    placeholder="0.0"
                    className="w-full rounded-lg border border-line-2 bg-panel px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-faint">Labor Rate ($/hr)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.labor_rate}
                    onChange={(e) => setField('labor_rate', e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-line-2 bg-panel px-2 py-1.5 font-mono text-xs tabular-nums text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-0.5 block text-[10px] text-faint">Notes</label>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setField('notes', e.target.value)}
                    placeholder="Optional notes"
                    className="w-full rounded-lg border border-line-2 bg-panel px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving || !form.title.trim()}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
                >
                  {saving ? 'Adding...' : 'Add Operation'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); setForm(emptyForm) }}
                  className="rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
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
