import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, TrendingDown, DollarSign, Percent, List } from 'lucide-react'
import api from '../lib/api'

function fmt(n) { return `$${parseFloat(n || 0).toFixed(2)}` }
function pct(n) { return `${parseFloat(n || 0).toFixed(1)}%` }

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-xs text-slate-400 mb-1">{label}</p>
        <p className="text-xl font-bold text-white">{value}</p>
      </div>
    </div>
  )
}

export default function JobCosting() {
  const navigate = useNavigate()
  const today = new Date().toISOString().split('T')[0]
  const firstOfMonth = today.slice(0, 8) + '01'

  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get(`/ros/job-cost/summary?from=${from}&to=${to}`)
      setData(r.data)
    } catch (e) {
      setError('Failed to load job costing data.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const profitable = data?.profitableCount || 0
  const total = data?.totalJobs || 0

  return (
    <div className="min-h-screen bg-[#0f1117] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp size={24} className="text-indigo-400" />
            Job Costing
          </h1>
          <p className="text-slate-400 text-sm mt-1">Track profitability per repair order</p>
        </div>

        {/* Date Range */}
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <button
            onClick={load}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Apply
          </button>
        </div>

        {/* Summary Cards */}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard icon={DollarSign} label="Total Revenue" value={fmt(data.totalRevenue)} color="bg-indigo-600" />
            <StatCard icon={List} label="Total Cost" value={fmt(data.totalCost)} color="bg-slate-600" />
            <StatCard
              icon={data.grossProfit >= 0 ? TrendingUp : TrendingDown}
              label="Gross Profit"
              value={fmt(data.grossProfit)}
              color={data.grossProfit >= 0 ? 'bg-emerald-600' : 'bg-red-600'}
            />
            <StatCard icon={Percent} label="Avg Margin" value={pct(data.avgMargin)} color="bg-violet-600" />
          </div>
        )}

        {/* Sub-stats */}
        {data && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-white">{total}</p>
              <p className="text-slate-400 text-sm mt-1">Total Jobs</p>
            </div>
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-emerald-400">{total > 0 ? Math.round((profitable / total) * 100) : 0}%</p>
              <p className="text-slate-400 text-sm mt-1">Jobs Profitable</p>
            </div>
          </div>
        )}

        {/* RO Table */}
        {loading && (
          <div className="text-center text-slate-400 py-12">Loading...</div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>
        )}

        {data && data.rows && data.rows.length > 0 && (
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#2a2d3e]">
              <h2 className="text-sm font-semibold text-white">Repair Orders — {from} to {to}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2a2d3e]">
                    <th className="text-left px-4 py-3 text-slate-400 font-medium">RO #</th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Customer</th>
                    <th className="text-left px-4 py-3 text-slate-400 font-medium">Vehicle</th>
                    <th className="text-right px-4 py-3 text-slate-400 font-medium">Revenue</th>
                    <th className="text-right px-4 py-3 text-slate-400 font-medium">Cost</th>
                    <th className="text-right px-4 py-3 text-slate-400 font-medium">Profit</th>
                    <th className="text-right px-4 py-3 text-slate-400 font-medium">Margin</th>
                    <th className="text-center px-4 py-3 text-slate-400 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(row => {
                    const revenue = parseFloat(row.total || 0)
                    const cost = parseFloat(row.parts_cost || 0) + parseFloat(row.labor_cost || 0) + parseFloat(row.sublet_cost || 0)
                    const profit = parseFloat(row.true_profit || 0)
                    const margin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '0.0'
                    const isProfit = profit >= 0

                    return (
                      <tr
                        key={row.id}
                        onClick={() => navigate(`/ros/${row.id}`)}
                        className="border-b border-[#2a2d3e] hover:bg-[#0f1117] cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-indigo-400 font-mono text-xs">{row.ro_number}</td>
                        <td className="px-4 py-3 text-white">{row.customer_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-300 text-xs">{[row.year, row.make, row.model].filter(Boolean).join(' ') || '—'}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{fmt(revenue)}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{fmt(cost)}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isProfit ? '+' : ''}{fmt(profit)}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {margin}%
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            row.status === 'closed' ? 'bg-slate-700 text-slate-300' :
                            row.status === 'repair' ? 'bg-indigo-900 text-indigo-300' :
                            'bg-yellow-900 text-yellow-300'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && data.rows && data.rows.length === 0 && !loading && (
          <div className="text-center text-slate-500 py-12">No repair orders found for this date range.</div>
        )}
      </div>
    </div>
  )
}
