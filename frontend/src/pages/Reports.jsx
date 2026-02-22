import { useEffect, useState } from 'react'
import api from '../lib/api'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'

const TARGET = 85000

export default function Reports() {
  const [data, setData] = useState(null)
  useEffect(() => { api.get('/reports/summary').then(r => setData(r.data)) }, [])
  if (!data) return <div className="flex items-center justify-center h-64 text-slate-500">Loading...</div>

  const revPct = Math.min(Math.round((data.revenue / TARGET) * 100), 100)
  const margin = data.revenue > 0 ? Math.round((data.profit / data.revenue) * 100) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Reports</h1>
        <p className="text-slate-500 text-sm">Shop performance overview</p>
      </div>

      {/* Revenue vs Target */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Monthly Revenue vs Target</div>
            <div className="text-3xl font-bold text-white mt-1">${data.revenue?.toLocaleString()}</div>
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
          {label:'Total Jobs', value: data.total, color:'text-indigo-400'},
          {label:'Completed', value: data.completed, color:'text-emerald-400'},
          {label:'True Profit', value: `$${data.profit?.toLocaleString()}`, color:'text-yellow-400'},
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
          {data.byType?.map(t => {
            const pct = data.revenue > 0 ? Math.round((t.revenue / data.revenue) * 100) : 0
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
            const found = data.byStatus?.find(x => x.status === s)
            return (
              <div key={s} className="text-center">
                <div className="text-xl font-bold" style={{color: STATUS_COLORS[s]}}>{found?.count || 0}</div>
                <div className="text-[9px] text-slate-500 mt-0.5">{STATUS_LABELS[s]}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
