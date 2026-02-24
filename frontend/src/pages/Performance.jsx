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
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart2 size={24} /> Performance Dashboard
          </h1>
          <p className="text-slate-500 text-sm mt-1">Employee productivity & revenue metrics</p>
        </div>
      </div>

      {/* Month Picker */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex items-center gap-4 justify-center">
          <button onClick={handlePrevMonth} className="text-slate-400 hover:text-white px-3 py-2 rounded-lg hover:bg-[#2a2d3e] transition-colors">
            Previous
          </button>
          <div>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
            <p className="text-center text-sm text-slate-500 mt-2">{monthLabel}</p>
          </div>
          <button onClick={handleNextMonth} className="text-slate-400 hover:text-white px-3 py-2 rounded-lg hover:bg-[#2a2d3e] transition-colors">
            Next
          </button>
        </div>
      </div>

      {/* Stats Table */}
      {error && (
        <div className="bg-red-900/30 border border-red-700/40 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64 text-slate-500">
          Loading performance data...
        </div>
      ) : stats.length === 0 ? (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-12 text-center">
          <BarChart2 size={32} className="mx-auto mb-4 text-slate-600" />
          <p className="text-slate-400">No performance data available for {monthLabel}</p>
          <p className="text-slate-600 text-sm mt-1">Employees with completed repair orders will appear here.</p>
        </div>
      ) : (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2d3e] text-left">
                <th className="text-xs font-bold text-slate-400 uppercase tracking-wide px-4 py-3">Name</th>
                <th className="text-xs font-bold text-slate-400 uppercase tracking-wide px-4 py-3 text-right">ROs Completed</th>
                <th className="text-xs font-bold text-slate-400 uppercase tracking-wide px-4 py-3 text-right">Avg Hours/RO</th>
                <th className="text-xs font-bold text-slate-400 uppercase tracking-wide px-4 py-3 text-right">Labor Revenue</th>
                <th className="text-xs font-bold text-slate-400 uppercase tracking-wide px-4 py-3 text-right">Parts Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2d3e]">
              {stats.map((stat, i) => (
                <tr key={i} className="hover:bg-[#0f1117]/50 transition-colors">
                  <td className="text-white font-medium px-4 py-3">{stat.name}</td>
                  <td className="text-right px-4 py-3">
                    <span className="bg-indigo-900/30 text-indigo-400 px-2 py-1 rounded-lg font-semibold text-xs">
                      {stat.ros_completed}
                    </span>
                  </td>
                  <td className="text-right text-slate-300 px-4 py-3">{stat.avg_hours_per_ro.toFixed(1)} hrs</td>
                  <td className="text-right text-emerald-400 font-medium px-4 py-3">${parseFloat(stat.total_labor_revenue).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  <td className="text-right text-slate-400 px-4 py-3">${parseFloat(stat.total_parts_cost).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary Footer */}
          <div className="border-t border-[#2a2d3e] mt-4 pt-4">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-slate-500">Total ROs</p>
                <p className="text-lg font-bold text-white mt-1">
                  {stats.reduce((sum, s) => sum + s.ros_completed, 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Avg Hours/RO</p>
                <p className="text-lg font-bold text-white mt-1">
                  {stats.length > 0 ? (stats.reduce((sum, s) => sum + s.avg_hours_per_ro * s.ros_completed, 0) / stats.reduce((sum, s) => sum + s.ros_completed, 0)).toFixed(1) : '0.0'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Labor Revenue</p>
                <p className="text-lg font-bold text-emerald-400 mt-1">
                  ${stats.reduce((sum, s) => sum + parseFloat(s.total_labor_revenue), 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Parts Cost</p>
                <p className="text-lg font-bold text-slate-300 mt-1">
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
