import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Calendar, ChevronRight, X } from 'lucide-react'
import api from '../lib/api'
import AppOverlay from './AppOverlay'

function monthLabel(yearMonth) {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return yearMonth || '-'
  return new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function CarryoverModal({ ros, onClose, onDone }) {
  const [items, setItems] = useState(ros || [])
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')

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
      setError('')
      await api.put(`/ros/${roId}/revenue-period`, { revenue_period: revenuePeriod })
      setItems(prev => {
        const next = prev.filter(ro => ro.id !== roId)
        if (next.length === 0) {
          onDone?.()
        }
        return next
      })
    } catch (err) {
      console.error('[CarryoverModal] Revenue period update failed')
      setError(err?.response?.data?.error || 'Failed to update revenue period')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <AppOverlay label="Revenue period" onClose={onClose} className="bg-black/70 p-3 sm:p-4">
      <div className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-instrument border border-line-2 bg-panel">
        <div className="flex items-center justify-between border-b border-line-2 p-5">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-gold" />
            <h2 className="font-bold text-ink">Assign Carryover Revenue Period</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-muted transition-colors hover:bg-raised hover:text-ink" aria-label="Close revenue period dialog">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && (
            <div role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-sm text-crit">
              {error}
            </div>
          )}
          {!items.length && (
            <div className="text-sm text-muted">No carried-over jobs pending.</div>
          )}

          {items.map(ro => (
            <div key={ro.id} className="rounded-instrument border border-line-2 bg-void p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">{ro.customer_name || 'Unknown Customer'}</div>
                  <div className="text-xs text-muted">{ro.vehicle || 'Vehicle not set'}</div>
                  <div className="mt-1 text-xs text-faint">
                    RO {ro.ro_number || ro.id.slice(0, 8)} · ${Number(ro.total_cost || 0).toLocaleString()}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1 rounded-md border border-gold/30 bg-gold/10 px-2 py-1 text-[11px] text-gold">
                  <Calendar size={12} />
                  Original: {monthLabel(ro.billing_month)}
                </div>
              </div>

              <div className="mt-4 grid sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={savingId === ro.id}
                  onClick={() => assignRevenuePeriod(ro.id, 'previous')}
                  className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-brand/50 hover:text-ink disabled:opacity-60"
                >
                  Last Month ({monthLabel(previousMonth)})
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  disabled={savingId === ro.id}
                  onClick={() => assignRevenuePeriod(ro.id, 'current')}
                  className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-gold px-3 py-2 text-xs font-semibold text-[var(--on-gold)] transition-colors hover:bg-gold-lit disabled:opacity-60"
                >
                  This Month ({monthLabel(currentMonth)})
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppOverlay>
  )
}
