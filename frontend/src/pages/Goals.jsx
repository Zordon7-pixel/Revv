import { useEffect, useMemo, useState } from 'react'
import { Target, TrendingUp, ClipboardList } from 'lucide-react'
import api from '../lib/api'
import { isAdmin, isAssistant, isOwner } from '../lib/auth'

function toYearMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function getCurrentAndPrevious() {
  const now = new Date()
  const current = toYearMonth(now)
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const previous = toYearMonth(prevDate)
  return { current, previous }
}

function monthLabel(yearMonth) {
  const d = new Date(`${yearMonth}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return yearMonth
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function formatCurrency(v) {
  return `$${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function toPercent(actual, goal) {
  const g = Number(goal || 0)
  if (g <= 0) return 0
  return (Number(actual || 0) / g) * 100
}

function progressMeta(percent) {
  if (percent >= 100) return { tone: 'text-good', bar: 'bg-good', label: 'On target' }
  if (percent >= 75) return { tone: 'text-brand', bar: 'bg-brand', label: 'At risk' }
  return { tone: 'text-crit', bar: 'bg-crit', label: 'Behind' }
}

function MonthCard({ title, monthData }) {
  const revenuePercent = Math.max(0, toPercent(monthData.actual_revenue, monthData.revenue_goal))
  const roPercent = Math.max(0, toPercent(monthData.actual_ro_count, monthData.ro_goal))
  const revenueMeta = progressMeta(revenuePercent)
  const roMeta = progressMeta(roPercent)

  return (
    <section className="space-y-4 rounded-instrument border border-line-2 bg-panel p-4">
      <div>
        <h2 className="font-display text-sm font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">{monthLabel(monthData.yearMonth)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-instrument border border-line-2 bg-void p-3">
          <div className="text-[11px] text-faint">Revenue Goal</div>
          <div className="font-mono text-lg font-bold tabular-nums text-gold">{formatCurrency(monthData.revenue_goal)}</div>
        </div>
        <div className="rounded-instrument border border-line-2 bg-void p-3">
          <div className="text-[11px] text-faint">RO Goal</div>
          <div className="font-mono text-lg font-bold tabular-nums text-brand">{Number(monthData.ro_goal || 0).toLocaleString()}</div>
        </div>
        <div className="rounded-instrument border border-line-2 bg-void p-3">
          <div className="text-[11px] text-faint">Actual Revenue</div>
          <div className="font-mono text-lg font-bold tabular-nums text-gold">{formatCurrency(monthData.actual_revenue)}</div>
        </div>
        <div className="rounded-instrument border border-line-2 bg-void p-3">
          <div className="text-[11px] text-faint">Actual ROs</div>
          <div className="font-mono text-lg font-bold tabular-nums text-ink">{Number(monthData.actual_ro_count || 0).toLocaleString()}</div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="inline-flex items-center gap-1 text-muted"><TrendingUp size={12} /> Revenue Progress</span>
            <span className={`${revenueMeta.tone} font-mono font-semibold tabular-nums`}>{Math.round(revenuePercent)}% · {revenueMeta.label}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div className={`h-full ${revenueMeta.bar} transition-all`} style={{ width: `${Math.min(revenuePercent, 100)}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="inline-flex items-center gap-1 text-muted"><ClipboardList size={12} /> RO Progress</span>
            <span className={`${roMeta.tone} font-mono font-semibold tabular-nums`}>{Math.round(roPercent)}% · {roMeta.label}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div className={`h-full ${roMeta.bar} transition-all`} style={{ width: `${Math.min(roPercent, 100)}%` }} />
          </div>
        </div>
      </div>
    </section>
  )
}

export default function Goals() {
  const assistant = isAssistant()
  const canView = isOwner() || isAdmin()
  const canEdit = (isOwner() || isAdmin()) && !assistant
  const months = useMemo(() => getCurrentAndPrevious(), [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [currentData, setCurrentData] = useState(null)
  const [previousData, setPreviousData] = useState(null)
  const [form, setForm] = useState({ revenue_goal: '', ro_goal: '' })

  async function loadMonth(yearMonth) {
    const [goalRes, reportRes] = await Promise.all([
      api.get(`/goals/${yearMonth}`),
      api.get(`/reports/monthly/${yearMonth}`).catch(() => ({ data: { summary: { total_revenue: 0, total_ros: 0 } } })),
    ])
    const goal = goalRes.data?.goal || {}
    const summary = reportRes.data?.summary || {}
    return {
      yearMonth,
      revenue_goal: Number(goal.revenue_goal || 0),
      ro_goal: Number(goal.ro_goal || 0),
      actual_revenue: Number(summary.total_revenue || 0),
      actual_ro_count: Number(summary.total_ros || 0),
    }
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [current, previous] = await Promise.all([
        loadMonth(months.current),
        loadMonth(months.previous),
      ])
      setCurrentData(current)
      setPreviousData(previous)
      setForm({
        revenue_goal: String(current.revenue_goal || ''),
        ro_goal: String(current.ro_goal || ''),
      })
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load goals.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canView) load()
  }, [canView])

  async function saveGoals(e) {
    e.preventDefault()
    const revenueGoal = Number(form.revenue_goal)
    const roGoal = Number(form.ro_goal)
    if (!Number.isFinite(revenueGoal) || revenueGoal < 0) {
      setError('Revenue goal must be a non-negative number')
      return
    }
    if (!Number.isInteger(roGoal) || roGoal < 0) {
      setError('RO goal must be a non-negative integer')
      return
    }

    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.put(`/goals/${months.current}`, {
        revenue_goal: revenueGoal,
        ro_goal: roGoal,
      })
      await load()
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save goals.')
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return <div className="text-sm text-muted">Admin access required.</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Target size={18} className="text-brand" />
        <div>
          <h1 className="font-display text-xl font-bold text-ink">Monthly Goals</h1>
          <p className="text-sm text-muted">Track goal performance for current and previous month.</p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-faint" role="status">Loading goals...</div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            {currentData && <MonthCard title="Current Month" monthData={currentData} />}
            {previousData && <MonthCard title="Previous Month" monthData={previousData} />}
          </div>

          <form onSubmit={saveGoals} className="space-y-3 rounded-instrument border border-line-2 bg-panel p-4">
            <h2 className="font-display text-sm font-semibold text-ink">Set Current Month Goals</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">Revenue Goal ($)</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={form.revenue_goal}
                  onChange={(e) => setForm((f) => ({ ...f, revenue_goal: e.target.value }))}
                  className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 font-mono text-sm tabular-nums text-ink focus:border-brand focus:outline-none"
                  disabled={!canEdit || saving}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">RO Goal (count)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.ro_goal}
                  onChange={(e) => setForm((f) => ({ ...f, ro_goal: e.target.value }))}
                  className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 font-mono text-sm tabular-nums text-ink focus:border-brand focus:outline-none"
                  disabled={!canEdit || saving}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-faint">
                {canEdit ? 'Admins can update monthly goals.' : 'Read-only access.'}
              </div>
              <button
                type="submit"
                disabled={!canEdit || saving}
                className="rounded-instrument bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
              >
                {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Goals'}
              </button>
            </div>
            {error && <p role="alert" className="text-xs text-crit">{error}</p>}
          </form>
        </>
      )}
    </div>
  )
}
