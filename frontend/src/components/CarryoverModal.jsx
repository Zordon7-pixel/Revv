import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Calendar, ChevronRight, X } from 'lucide-react'
import api from '../lib/api'

function monthLabel(yearMonth) {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return yearMonth || '-'
  return new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function CarryoverModal({ ros, onClose, onDone }) {
  const [items, setItems] = useState(ros || [])
  const [savingId, setSavingId] = useState(null)

  useEffect(() => {
    setItems(ros || [])
  }, [ros])

  const currentMonth = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])
  const previousMonth = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])

  async function assignRevenuePeriod(roId, revenuePeriod) {
    try {
      setSavingId(roId)
      await api.put(`/ros/${roId}/revenue-period`, { revenue_period: revenuePeriod })
      setItems(prev => {
        const next = prev.filter(ro => ro.id !== roId)
        if (next.length === 0) {
          onDone?.()
        }
        return next
      })
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to update revenue period')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#2a2d3e]">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-amber-300" />
            <h2 className="font-bold text-white">Assign Carryover Revenue Period</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {!items.length && (
            <div className="text-sm text-slate-400">No carried-over jobs pending.</div>
          )}

          {items.map(ro => (
            <div key={ro.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{ro.customer_name || 'Unknown Customer'}</div>
                  <div className="text-xs text-slate-400">{ro.vehicle || 'Vehicle not set'}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    RO {ro.ro_number || ro.id.slice(0, 8)} · ${Number(ro.total_cost || 0).toLocaleString()}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1">
                  <Calendar size={12} />
                  Original: {monthLabel(ro.billing_month)}
                </div>
              </div>

              <div className="mt-4 grid sm:grid-cols-2 gap-2">
                <button
                  disabled={savingId === ro.id}
                  onClick={() => assignRevenuePeriod(ro.id, 'previous')}
                  className="inline-flex items-center justify-center gap-1 bg-[#23273a] hover:bg-[#2a2d3e] text-slate-200 text-xs font-medium px-3 py-2 rounded-lg border border-[#30344a] transition-colors disabled:opacity-60"
                >
                  Last Month ({monthLabel(previousMonth)})
                  <ChevronRight size={14} />
                </button>
                <button
                  disabled={savingId === ro.id}
                  onClick={() => assignRevenuePeriod(ro.id, 'current')}
                  className="inline-flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
                >
                  This Month ({monthLabel(currentMonth)})
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
