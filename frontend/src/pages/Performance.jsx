import { useState, useEffect } from 'react'
import { BarChart2, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

export default function Performance() {
  const navigate = useNavigate()
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadStats = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/performance', { params: { month } })
      setStats(data.stats || [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load performance data')
      setStats([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStats()
  }, [month])

  const handlePrevMonth = () => {
    const [y, m] = month.split('-')
    const d = new Date(y, parseInt(m) - 2)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const handleNextMonth = () => {
    const [y, m] = month.split('-')
    const d = new Date(y, parseInt(m))
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthLabel = new Date(`${month}-01`).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate('/')} aria-label="Back to dashboard" className="text-muted transition-colors hover:text-ink">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 font-display text-xl font-bold text-ink sm:text-2xl">
            <BarChart2 size={24} /> Performance Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">Tech productivity & revenue metrics</p>
        </div>
      </div>

      {/* Month Picker */}
      <div className="rounded-instrument border border-line-2 bg-panel p-4">
        <div className="flex items-center gap-4 justify-center">
          <button type="button" onClick={handlePrevMonth} className="rounded-instrument px-3 py-2 text-muted transition-colors hover:bg-raised hover:text-ink">
            Previous
          </button>
          <div>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-instrument border border-line-2 bg-void px-4 py-2 font-mono tabular-nums text-ink focus:border-brand focus:outline-none"
            />
            <p className="mt-2 text-center text-sm text-muted">{monthLabel}</p>
          </div>
          <button type="button" onClick={handleNextMonth} className="rounded-instrument px-3 py-2 text-muted transition-colors hover:bg-raised hover:text-ink">
            Next
          </button>
        </div>
      </div>

      {/* Stats Table */}
      {error && (
        <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 p-4">
          <p className="text-sm text-crit">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-faint" role="status">
          Loading performance data...
        </div>
      ) : stats.length === 0 ? (
        <div className="rounded-instrument border border-line-2 bg-panel p-12 text-center">
          <BarChart2 size={32} className="mx-auto mb-4 text-faint" />
          <p className="text-muted">No performance data available for {monthLabel}</p>
          <p className="mt-1 text-sm text-faint">Techs with completed repair orders will appear here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-instrument border border-line-2 bg-panel p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-2 text-left">
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">Name</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-muted">ROs Completed</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-muted">Avg Hours/RO</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-muted">Labor Revenue</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-muted">Parts Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {stats.map((stat, i) => (
                <tr key={i} className="transition-colors hover:bg-void/50">
                  <td className="px-4 py-3 font-medium text-ink">{stat.name}</td>
                  <td className="text-right px-4 py-3">
                    <span className="rounded-instrument bg-brand/10 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-brand">
                      {stat.ros_completed}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{Number(stat.avg_hours_per_ro || 0).toFixed(1)} hrs</td>
                  <td className="px-4 py-3 text-right font-mono font-medium tabular-nums text-gold">${parseFloat(stat.total_labor_revenue).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">${parseFloat(stat.total_parts_cost).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary Footer */}
          <div className="mt-4 border-t border-line-2 pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-faint">Total ROs</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
                  {stats.reduce((sum, s) => sum + s.ros_completed, 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-faint">Avg Hours/RO</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
                  {stats.length > 0 ? (stats.reduce((sum, s) => sum + Number(s.avg_hours_per_ro || 0) * s.ros_completed, 0) / stats.reduce((sum, s) => sum + s.ros_completed, 0)).toFixed(1) : '0.0'}
                </p>
              </div>
              <div>
                <p className="text-xs text-faint">Total Labor Revenue</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums text-gold">
                  ${stats.reduce((sum, s) => sum + parseFloat(s.total_labor_revenue), 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </p>
              </div>
              <div>
                <p className="text-xs text-faint">Total Parts Cost</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums text-muted">
                  ${stats.reduce((sum, s) => sum + parseFloat(s.total_parts_cost), 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
