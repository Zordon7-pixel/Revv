import { useEffect, useMemo, useState } from 'react'
import { Package, Receipt, CircleDollarSign, PlusCircle } from 'lucide-react'
import api from '../lib/api'
import { isAdmin, isAssistant } from '../lib/auth'
import AppOverlay from '../components/AppOverlay'

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`
}

function daysStored(startDate) {
  if (!startDate) return 0
  const start = new Date(startDate)
  if (Number.isNaN(start.getTime())) return 0
  const diff = Date.now() - start.getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

export default function StorageHold() {
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({ unpaid_total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedRoId, setExpandedRoId] = useState(null)
  const [chargesByRo, setChargesByRo] = useState({})
  const [showBillModal, setShowBillModal] = useState(false)
  const [billing, setBilling] = useState({ roId: '', days: 0, rate_per_day: 0, billed_to: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingHold, setEditingHold] = useState({
    roId: '',
    storage_hold: true,
    storage_company: '',
    storage_contact: '',
    storage_rate_per_day: '',
    storage_start_date: '',
    storage_notes: '',
  })
  const [savingHold, setSavingHold] = useState(false)
  const canViewFinancialTotals = isAdmin()
  const canEditStorageHold = isAdmin() || isAssistant()

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [storageRes, summaryRes] = await Promise.all([
        api.get('/storage'),
        api.get('/storage/summary'),
      ])
      setRows(storageRes.data.ros || [])
      setSummary(summaryRes.data || { unpaid_total: 0 })
    } catch (err) {
      console.error('[StorageHold] Failed to load storage holds')
      setError(err?.response?.data?.error || 'Failed to load storage holds')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function loadCharges(roId) {
    try {
      const { data } = await api.get(`/storage/${roId}/charges`)
      setChargesByRo((prev) => ({ ...prev, [roId]: data.charges || [] }))
    } catch (err) {
      console.error('[StorageHold] Failed to load storage charges')
      setError(err?.response?.data?.error || 'Failed to load storage charges')
    }
  }

  function openBillModal(ro) {
    const days = daysStored(ro.storage_start_date)
    setBilling({
      roId: ro.id,
      days: days || 1,
      rate_per_day: Number(ro.storage_rate_per_day || 0),
      billed_to: ro.storage_company || ro.customer_name || '',
      notes: '',
    })
    setShowBillModal(true)
  }

  function openEditModal(ro) {
    setEditingHold({
      roId: ro.id,
      storage_hold: !!ro.storage_hold,
      storage_company: ro.storage_company || '',
      storage_contact: ro.storage_contact || '',
      storage_rate_per_day: ro.storage_rate_per_day ?? '',
      storage_start_date: ro.storage_start_date || '',
      storage_notes: ro.storage_notes || '',
    })
    setShowEditModal(true)
  }

  async function submitCharge(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/storage/${billing.roId}/charges`, {
        days: Number(billing.days),
        rate_per_day: Number(billing.rate_per_day),
        billed_to: billing.billed_to,
        notes: billing.notes,
      })
      if (expandedRoId === billing.roId) await loadCharges(billing.roId)
      await load()
      setShowBillModal(false)
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create storage charge')
    } finally {
      setSubmitting(false)
    }
  }

  async function markPaid(roId, chargeId) {
    setError('')
    try {
      await api.patch(`/storage/${roId}/charges/${chargeId}`)
      await loadCharges(roId)
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not mark charge paid')
    }
  }

  async function saveStorageHold(e) {
    e.preventDefault()
    setSavingHold(true)
    setError('')
    try {
      await api.patch(`/storage/${editingHold.roId}`, {
        storage_hold: !!editingHold.storage_hold,
        storage_company: editingHold.storage_company,
        storage_contact: editingHold.storage_contact,
        storage_rate_per_day: editingHold.storage_rate_per_day,
        storage_start_date: editingHold.storage_start_date,
        storage_notes: editingHold.storage_notes,
      })
      await load()
      setShowEditModal(false)
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not update storage hold')
    } finally {
      setSavingHold(false)
    }
  }

  const totalVehicles = rows.length
  const totalAccrued = useMemo(
    () => rows.reduce((sum, ro) => sum + (daysStored(ro.storage_start_date) * Number(ro.storage_rate_per_day || 0)), 0),
    [rows]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Package size={20} className="text-brand" />
        <h1 className="font-display text-xl font-bold text-ink">Storage Hold</h1>
      </div>

      {error && (
        <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-4 py-3 text-sm text-crit">
          {error}
        </div>
      )}

      <div className={`grid gap-3 ${canViewFinancialTotals ? 'sm:grid-cols-3' : 'sm:grid-cols-1'}`}>
        <div className="bg-panel border border-line-2 rounded-instrument p-4">
          <div className="text-xs text-faint">Vehicles in Storage</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">{totalVehicles}</div>
        </div>
        {canViewFinancialTotals && (
          <div className="bg-panel border border-line-2 rounded-instrument p-4">
            <div className="text-xs text-faint">Total Unpaid Charges</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-gold">{formatCurrency(summary.unpaid_total)}</div>
          </div>
        )}
        {canViewFinancialTotals && (
          <div className="bg-panel border border-line-2 rounded-instrument p-4">
            <div className="text-xs text-faint">Total Accrued</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-gold">{formatCurrency(totalAccrued)}</div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-muted">Loading storage vehicles...</div>
      ) : rows.length === 0 ? (
        <div className="bg-panel border border-line-2 rounded-instrument p-6 text-sm text-muted">
          No vehicles are currently marked as storage hold.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((ro) => {
            const days = daysStored(ro.storage_start_date)
            const accrued = days * Number(ro.storage_rate_per_day || 0)
            const charges = chargesByRo[ro.id] || []
            return (
              <div key={ro.id} className="bg-panel border border-line-2 rounded-instrument p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-brand">{ro.ro_number || 'RO'}</div>
                    <div className="text-sm font-semibold text-ink">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || 'Vehicle'}</div>
                    <div className="text-xs text-muted">{ro.storage_company || ro.customer_name || 'No billed company set'}</div>
                  </div>
                  <div className="text-right text-xs space-y-1">
                    <div className="text-muted">Start: {ro.storage_start_date || '—'}</div>
                    <div className="text-muted">Days: {days}</div>
                    <div className="text-muted">Rate: {formatCurrency(ro.storage_rate_per_day || 0)}/day</div>
                    {canViewFinancialTotals && (
                      <div className="font-mono font-semibold tabular-nums text-gold">Accrued: {formatCurrency(accrued)}</div>
                    )}
                    {canViewFinancialTotals && (
                      <div className={Number(ro.unpaid_total || 0) > 0 ? 'font-mono font-semibold tabular-nums text-gold' : 'font-mono tabular-nums text-faint'}>
                        Unpaid: {formatCurrency(ro.unpaid_total || 0)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canEditStorageHold && (
                    <button
                      onClick={() => openEditModal(ro)}
                      className="text-xs bg-brand hover:bg-brand-lit text-white font-semibold px-3 py-1.5 rounded-lg"
                    >
                      Edit Hold
                    </button>
                  )}
                  <button
                    onClick={() => openBillModal(ro)}
                    className="inline-flex items-center gap-1.5 rounded-instrument bg-gold px-3 py-1.5 text-xs font-semibold text-on-gold transition-colors hover:bg-gold-lit"
                  >
                    <PlusCircle size={12} />
                    Manual Add
                  </button>
                  <button
                    onClick={async () => {
                      const next = expandedRoId === ro.id ? null : ro.id
                      setExpandedRoId(next)
                      if (next) await loadCharges(ro.id)
                    }}
                    className="text-xs bg-void border border-line-2 text-ink px-3 py-1.5 rounded-lg"
                  >
                    {expandedRoId === ro.id ? 'Hide Charges' : 'View Charges'}
                  </button>
                </div>

                {expandedRoId === ro.id && (
                  <div className="bg-void border border-line-2 rounded-lg overflow-hidden">
                    {charges.length === 0 ? (
                      <div className="text-xs text-faint p-3">No charge records yet.</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-panel-2 text-muted">
                          <tr>
                            <th className="px-3 py-2 text-left">Date</th>
                            <th className="px-3 py-2 text-left">Days</th>
                            <th className="px-3 py-2 text-left">Rate</th>
                            <th className="px-3 py-2 text-left">Total</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            <th className="px-3 py-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {charges.map((charge) => (
                            <tr key={charge.id} className="border-t border-line-2">
                              <td className="px-3 py-2 text-ink">{charge.billed_date || '—'}</td>
                              <td className="px-3 py-2 text-ink">{charge.days}</td>
                              <td className="px-3 py-2 text-ink">{formatCurrency(charge.rate_per_day)}</td>
                              <td className="px-3 py-2 font-mono tabular-nums text-gold">{formatCurrency(charge.total_amount)}</td>
                              <td className="px-3 py-2">
                                <span className={`rounded-full border px-2 py-1 ${charge.paid ? 'border-good/40 bg-good/10 text-good' : 'border-gold/40 bg-gold/10 text-gold'}`}>
                                  {charge.paid ? 'Paid' : 'Unpaid'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                {!charge.paid && (
                                  <button
                                    onClick={() => markPaid(ro.id, charge.id)}
                                    className="rounded-instrument bg-good px-2 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                                  >
                                    Mark Paid
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showBillModal && (
        <AppOverlay label="Bill storage" onClose={() => setShowBillModal(false)} className="bg-void/75 p-4">
          <form onSubmit={submitCharge} className="w-full max-w-md bg-panel border border-line-2 rounded-instrument p-5 space-y-3">
            <div className="flex items-center gap-2 font-display font-semibold text-ink">
              <Receipt size={16} className="text-gold" />
              Bill Storage
            </div>
            {error && <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">{error}</div>}
            <div>
              <label className="text-xs text-muted block mb-1">Days</label>
              <input
                type="number"
                min="1"
                value={billing.days}
                onChange={(e) => setBilling((prev) => ({ ...prev, days: e.target.value }))}
                className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Rate Per Day</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={billing.rate_per_day}
                onChange={(e) => setBilling((prev) => ({ ...prev, rate_per_day: e.target.value }))}
                className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Bill To</label>
              <input
                value={billing.billed_to}
                onChange={(e) => setBilling((prev) => ({ ...prev, billed_to: e.target.value }))}
                className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Notes</label>
              <textarea
                value={billing.notes}
                onChange={(e) => setBilling((prev) => ({ ...prev, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 font-mono text-sm font-semibold tabular-nums text-gold">
              <CircleDollarSign size={15} />
              Total: {formatCurrency(Number(billing.days || 0) * Number(billing.rate_per_day || 0))}
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowBillModal(false)} className="flex-1 bg-void border border-line-2 text-ink py-2 rounded-lg text-sm">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="flex-1 rounded-instrument bg-gold py-2 text-sm font-semibold text-on-gold transition-colors hover:bg-gold-lit disabled:opacity-50">
                {submitting ? 'Saving...' : 'Create Charge'}
              </button>
            </div>
          </form>
        </AppOverlay>
      )}

      {showEditModal && (
        <AppOverlay label="Edit storage hold" onClose={() => setShowEditModal(false)} className="bg-void/75 p-4">
          <form onSubmit={saveStorageHold} className="w-full max-w-md bg-panel border border-line-2 rounded-instrument p-5 space-y-3">
            <div className="font-display font-semibold text-ink">Edit Storage Hold</div>
            {error && <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">{error}</div>}
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={!!editingHold.storage_hold}
                onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_hold: e.target.checked }))}
                className="accent-brand"
              />
              Storage hold active
            </label>
            <div>
              <label className="text-xs text-muted block mb-1">Rental Company</label>
              <input
                value={editingHold.storage_company}
                onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_company: e.target.value }))}
                className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Contact</label>
              <input
                value={editingHold.storage_contact}
                onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_contact: e.target.value }))}
                className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Rate / Day</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingHold.storage_rate_per_day}
                  onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_rate_per_day: e.target.value }))}
                  className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Start Date</label>
                <input
                  type="date"
                  value={editingHold.storage_start_date}
                  onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_start_date: e.target.value }))}
                  className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Notes</label>
              <textarea
                rows={3}
                value={editingHold.storage_notes}
                onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_notes: e.target.value }))}
                className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 bg-void border border-line-2 text-ink py-2 rounded-lg text-sm">
                Cancel
              </button>
              <button type="submit" disabled={savingHold} className="flex-1 bg-brand hover:bg-brand-lit text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                {savingHold ? 'Saving...' : 'Save Hold'}
              </button>
            </div>
          </form>
        </AppOverlay>
      )}
    </div>
  )
}
