import { useEffect, useMemo, useState } from 'react'
import { Package, Receipt, CircleDollarSign, PlusCircle } from 'lucide-react'
import api from '../lib/api'
import { isAdmin, isAssistant } from '../lib/auth'

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
    try {
      const [storageRes, summaryRes] = await Promise.all([
        api.get('/storage'),
        api.get('/storage/summary'),
      ])
      setRows(storageRes.data.ros || [])
      setSummary(summaryRes.data || { unpaid_total: 0 })
    } catch (err) {
      console.error('[StorageHold] Failed to load:', err.message)
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
      console.error('[StorageHold] Failed to load charges:', err.message)
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
      alert(err?.response?.data?.error || 'Could not create storage charge')
    } finally {
      setSubmitting(false)
    }
  }

  async function markPaid(roId, chargeId) {
    try {
      await api.patch(`/storage/${roId}/charges/${chargeId}`)
      await loadCharges(roId)
      await load()
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not mark charge paid')
    }
  }

  async function saveStorageHold(e) {
    e.preventDefault()
    setSavingHold(true)
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
      alert(err?.response?.data?.error || 'Could not update storage hold')
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
        <Package size={20} className="text-amber-400" />
        <h1 className="text-xl font-bold text-white">Storage Hold</h1>
      </div>

      <div className={`grid gap-3 ${canViewFinancialTotals ? 'sm:grid-cols-3' : 'sm:grid-cols-1'}`}>
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
          <div className="text-xs text-slate-500">Vehicles in Storage</div>
          <div className="text-2xl font-bold text-white mt-1">{totalVehicles}</div>
        </div>
        {canViewFinancialTotals && (
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
            <div className="text-xs text-slate-500">Total Unpaid Charges</div>
            <div className="text-2xl font-bold text-amber-300 mt-1">{formatCurrency(summary.unpaid_total)}</div>
          </div>
        )}
        {canViewFinancialTotals && (
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
            <div className="text-xs text-slate-500">Total Accrued</div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">{formatCurrency(totalAccrued)}</div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-slate-400">Loading storage vehicles...</div>
      ) : rows.length === 0 ? (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-6 text-sm text-slate-400">
          No vehicles are currently marked as storage hold.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((ro) => {
            const days = daysStored(ro.storage_start_date)
            const accrued = days * Number(ro.storage_rate_per_day || 0)
            const charges = chargesByRo[ro.id] || []
            return (
              <div key={ro.id} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-amber-300 font-semibold">{ro.ro_number || 'RO'}</div>
                    <div className="text-white font-semibold text-sm">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || 'Vehicle'}</div>
                    <div className="text-xs text-slate-400">{ro.storage_company || ro.customer_name || 'No billed company set'}</div>
                  </div>
                  <div className="text-right text-xs space-y-1">
                    <div className="text-slate-400">Start: {ro.storage_start_date || '—'}</div>
                    <div className="text-slate-400">Days: {days}</div>
                    <div className="text-slate-400">Rate: {formatCurrency(ro.storage_rate_per_day || 0)}/day</div>
                    {canViewFinancialTotals && (
                      <div className="text-emerald-300 font-semibold">Accrued: {formatCurrency(accrued)}</div>
                    )}
                    {canViewFinancialTotals && (
                      <div className={Number(ro.unpaid_total || 0) > 0 ? 'text-amber-300 font-semibold' : 'text-slate-500'}>
                        Unpaid: {formatCurrency(ro.unpaid_total || 0)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canEditStorageHold && (
                    <button
                      onClick={() => openEditModal(ro)}
                      className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg"
                    >
                      Edit Hold
                    </button>
                  )}
                  <button
                    onClick={() => openBillModal(ro)}
                    className="text-xs bg-amber-400 hover:bg-amber-300 text-[#0f1117] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
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
                    className="text-xs bg-[#0f1117] border border-[#2a2d3e] text-slate-300 px-3 py-1.5 rounded-lg"
                  >
                    {expandedRoId === ro.id ? 'Hide Charges' : 'View Charges'}
                  </button>
                </div>

                {expandedRoId === ro.id && (
                  <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg overflow-hidden">
                    {charges.length === 0 ? (
                      <div className="text-xs text-slate-500 p-3">No charge records yet.</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-[#121521] text-slate-400">
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
                            <tr key={charge.id} className="border-t border-[#2a2d3e]">
                              <td className="px-3 py-2 text-slate-300">{charge.billed_date || '—'}</td>
                              <td className="px-3 py-2 text-slate-300">{charge.days}</td>
                              <td className="px-3 py-2 text-slate-300">{formatCurrency(charge.rate_per_day)}</td>
                              <td className="px-3 py-2 text-white">{formatCurrency(charge.total_amount)}</td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-1 rounded-full border ${charge.paid ? 'text-emerald-300 border-emerald-700/40 bg-emerald-900/20' : 'text-amber-300 border-amber-700/40 bg-amber-900/20'}`}>
                                  {charge.paid ? 'Paid' : 'Unpaid'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                {!charge.paid && (
                                  <button
                                    onClick={() => markPaid(ro.id, charge.id)}
                                    className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-1 rounded"
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <form onSubmit={submitCharge} className="w-full max-w-md bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-white font-semibold">
              <Receipt size={16} className="text-amber-300" />
              Bill Storage
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Days</label>
              <input
                type="number"
                min="1"
                value={billing.days}
                onChange={(e) => setBilling((prev) => ({ ...prev, days: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Rate Per Day</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={billing.rate_per_day}
                onChange={(e) => setBilling((prev) => ({ ...prev, rate_per_day: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Bill To</label>
              <input
                value={billing.billed_to}
                onChange={(e) => setBilling((prev) => ({ ...prev, billed_to: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Notes</label>
              <textarea
                value={billing.notes}
                onChange={(e) => setBilling((prev) => ({ ...prev, notes: e.target.value }))}
                rows={2}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="text-sm text-amber-300 font-semibold flex items-center gap-2">
              <CircleDollarSign size={15} />
              Total: {formatCurrency(Number(billing.days || 0) * Number(billing.rate_per_day || 0))}
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowBillModal(false)} className="flex-1 bg-[#0f1117] border border-[#2a2d3e] text-slate-300 py-2 rounded-lg text-sm">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="flex-1 bg-amber-400 hover:bg-amber-300 text-[#0f1117] py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                {submitting ? 'Saving...' : 'Create Charge'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <form onSubmit={saveStorageHold} className="w-full max-w-md bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-3">
            <div className="text-white font-semibold">Edit Storage Hold</div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={!!editingHold.storage_hold}
                onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_hold: e.target.checked }))}
                className="accent-amber-400"
              />
              Storage hold active
            </label>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Rental Company</label>
              <input
                value={editingHold.storage_company}
                onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_company: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Contact</label>
              <input
                value={editingHold.storage_contact}
                onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_contact: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Rate / Day</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingHold.storage_rate_per_day}
                  onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_rate_per_day: e.target.value }))}
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Start Date</label>
                <input
                  type="date"
                  value={editingHold.storage_start_date}
                  onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_start_date: e.target.value }))}
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Notes</label>
              <textarea
                rows={3}
                value={editingHold.storage_notes}
                onChange={(e) => setEditingHold((prev) => ({ ...prev, storage_notes: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 bg-[#0f1117] border border-[#2a2d3e] text-slate-300 py-2 rounded-lg text-sm">
                Cancel
              </button>
              <button type="submit" disabled={savingHold} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                {savingHold ? 'Saving...' : 'Save Hold'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
