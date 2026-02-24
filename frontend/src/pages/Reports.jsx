import { useEffect, useState } from 'react'
import api from '../lib/api'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'ros', label: 'ROs' },
]

export default function Reports() {
  const [activeTab, setActiveTab] = useState('summary')
  const [summaryData, setSummaryData] = useState(null)
  const [tabData, setTabData] = useState(null)
  const [shop, setShop] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [s, r] = await Promise.all([
          api.get('/reports/summary'),
          activeTab !== 'summary' ? api.get(`/reports/${activeTab}`) : Promise.resolve({ data: null })
        ])
        setSummaryData(s.data)
        setTabData(r.data)
      } catch (e) {
        console.error('Failed to load reports:', e)
      }
      setLoading(false)
    }
    load()
    api.get('/market/shop').then(r => setShop(r.data))
  }, [activeTab])

  if (!summaryData || !shop) return <div className="flex items-center justify-center h-64 text-slate-500">Loading...</div>

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500">Loading...</div>

  const TARGET = shop.monthly_revenue_target || 85000
  const revPct = Math.min(Math.round((summaryData.revenue / TARGET) * 100), 100)
  const margin = summaryData.revenue > 0 ? Math.round((summaryData.profit / summaryData.revenue) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Reports</h1>
          <p className="text-slate-500 text-sm">Shop performance overview</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'summary' && (
        <>
          {/* Revenue vs Target */}
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Monthly Revenue vs Target</div>
                <div className="text-3xl font-bold text-white mt-1">${summaryData.revenue?.toLocaleString()}</div>
                <div className="text-xs text-slate-500">Target: ${TARGET.toLocaleString()}/month</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-emerald-400">{revPct}%</div>
                <div className="text-xs text-slate-500">of goal</div>
              </div>
            </div>
            <div className="w-full bg-[#0f1117] rounded-full h-3">
              <div className="h-3 rounded-full transition-all" style={{width:`${revPct}%`, background: revPct >= 100 ? '#10b981' : revPct >= 70 ? '#6366f1' : '#f97316'}} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-600 mt-1">
              <span>$0</span><span>${TARGET.toLocaleString()}</span>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {label:'Total Jobs', value: summaryData.total, color:'text-indigo-400'},
              {label:'Completed', value: summaryData.completed, color:'text-emerald-400'},
              {label:'True Profit', value: `$${summaryData.profit?.toLocaleString()}`, color:'text-yellow-400'},
              {label:'Profit Margin', value: `${margin}%`, color:'text-pink-400'},
            ].map(m => (
              <div key={m.label} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
                <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>

          {/* By Job Type */}
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Revenue by Job Type</h2>
            <div className="space-y-3">
              {summaryData.byType?.map(t => {
                const pct = summaryData.revenue > 0 ? Math.round((t.revenue / summaryData.revenue) * 100) : 0
                return (
                  <div key={t.job_type}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 capitalize">{t.job_type} <span className="text-slate-600">({t.count} jobs)</span></span>
                      <span className="text-white font-medium">${t.revenue?.toLocaleString()} <span className="text-slate-500">({pct}%)</span></span>
                    </div>
                    <div className="w-full bg-[#0f1117] rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{width:`${pct}%`}} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Pipeline by Stage */}
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Pipeline by Stage</h2>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {['intake','estimate','approval','parts','repair','paint','qc','delivery'].map(s => {
                const found = summaryData.byStatus?.find(x => x.status === s)
                return (
                  <div key={s} className="text-center">
                    <div className="text-xl font-bold" style={{color: STATUS_COLORS[s]}}>{found?.count || 0}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">{STATUS_LABELS[s]}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {activeTab === 'revenue' && tabData && (
        <>
          {/* Revenue Tab */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">Total Revenue</div>
              <div className="text-2xl font-bold text-emerald-400">${tabData.total?.toLocaleString()}</div>
            </div>
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">Avg RO Value</div>
              <div className="text-2xl font-bold text-indigo-400">${tabData.avg?.toLocaleString()}</div>
            </div>
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">Top Month</div>
              <div className="text-lg font-bold text-yellow-400">{tabData.topMonths?.[0]?.month || '-'}</div>
            </div>
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">Top Month Revenue</div>
              <div className="text-lg font-bold text-emerald-400">${tabData.topMonths?.[0]?.revenue?.toLocaleString() || 0}</div>
            </div>
          </div>

          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Monthly Revenue</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-[#2a2d3e]">
                    <th className="text-left py-2 px-2">Month</th>
                    <th className="text-right py-2 px-2">ROs</th>
                    <th className="text-right py-2 px-2">Revenue</th>
                    <th className="text-right py-2 px-2">Avg RO</th>
                  </tr>
                </thead>
                <tbody>
                  {tabData.monthly?.map(m => (
                    <tr key={m.month} className="border-b border-[#2a2d3e]/50 text-slate-300">
                      <td className="py-2 px-2 font-medium">{m.label}</td>
                      <td className="text-right py-2 px-2">{m.count}</td>
                      <td className="text-right py-2 px-2 text-emerald-400">${Number(m.revenue).toLocaleString()}</td>
                      <td className="text-right py-2 px-2">${Number(m.avg_ro).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === 'ros' && tabData && (
        <>
          {/* ROs Tab */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">This Month</div>
              <div className="text-2xl font-bold text-indigo-400">{tabData.thisMonth}</div>
            </div>
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">Last Month</div>
              <div className="text-2xl font-bold text-slate-400">{tabData.lastMonth}</div>
            </div>
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">Avg Days to Close</div>
              <div className="text-2xl font-bold text-amber-400">{tabData.avgDays}</div>
            </div>
            <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">Total Statuses</div>
              <div className="text-2xl font-bold text-emerald-400">{tabData.byStatus?.length || 0}</div>
            </div>
          </div>

          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <h2 className="text-sm font-semibold text-white mb-3">ROs by Status</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-[#2a2d3e]">
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {tabData.byStatus?.map(s => (
                    <tr key={s.status} className="border-b border-[#2a2d3e]/50">
                      <td className="py-2 px-2">
                        <span className={`font-medium ${STATUS_COLORS[s.status] || 'text-slate-400'}`}>
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                      </td>
                      <td className="text-right py-2 px-2 text-white font-semibold">{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
