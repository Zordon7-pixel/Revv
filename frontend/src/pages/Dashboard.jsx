import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, DollarSign, CheckCircle, TrendingUp } from 'lucide-react'
import api from '../lib/api'
import { isAdmin } from '../lib/auth'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'
import StatusBadge from '../components/StatusBadge'

function useCountUp(target, duration = 1000) {
  const [count, setCount] = React.useState(0)
  React.useEffect(() => {
    if (!target) return
    let start = 0
    const step = target / (duration / 16)
    const timer = setInterval(() => {
      start += step
      if (start >= target) {
        setCount(target)
        clearInterval(timer)
      } else setCount(Math.floor(start))
    }, 16)
    return () => clearInterval(timer)
  }, [target, duration])
  return count
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { api.get('/reports/summary').then(r => setData(r.data)) }, [])

  const admin = isAdmin()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning 👋' : hour < 18 ? 'Good afternoon 👋' : 'Good evening 👋'

  const displayActive = useCountUp(data?.active || 0)
  const displayCompleted = useCountUp(data?.completed || 0)
  const displayRevenue = useCountUp(data?.revenue || 0)
  const displayProfit = useCountUp(data?.profit || 0)

  const stats = [
    {
      label: 'Active Jobs',
      value: displayActive,
      icon: ClipboardList,
      color: 'text-indigo-300',
      accent: 'bg-indigo-500',
      card: 'bg-gradient-to-br from-indigo-900/40 to-[#1a1d2e]'
    },
    {
      label: 'Completed',
      value: displayCompleted,
      icon: CheckCircle,
      color: 'text-emerald-300',
      accent: 'bg-emerald-500',
      card: 'bg-gradient-to-br from-slate-800/60 to-[#1a1d2e]'
    },
    ...(admin ? [
      {
        label: 'Total Revenue',
        value: `$${displayRevenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
        icon: DollarSign,
        color: 'text-emerald-300',
        accent: 'bg-emerald-500',
        card: 'bg-gradient-to-br from-emerald-900/40 to-[#1a1d2e]'
      },
      {
        label: 'True Profit',
        value: `$${displayProfit.toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
        icon: TrendingUp,
        color: 'text-amber-300',
        accent: 'bg-amber-500',
        card: 'bg-gradient-to-br from-amber-900/40 to-[#1a1d2e]'
      },
    ] : []),
  ]

  if (!data) return <div className="flex items-center justify-center h-64 text-slate-500">Loading your shop data...</div>

  return (
    <div className="space-y-6">
      <div>
        <p className="text-slate-400 text-sm font-medium mb-1">{greeting}</p>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className={`${s.card} rounded-xl p-4 border border-[#2a2d3e] shadow-sm`}>
            <div className={`h-1.5 w-10 rounded-full ${s.accent} mb-3 opacity-90`} />
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-400">{s.label}</div>
              <s.icon size={18} className={s.color} />
            </div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="font-semibold text-sm text-white mb-3">Jobs by Stage</h2>
          <div className="space-y-2">
            {['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery'].map(s => {
              const found = data.byStatus?.find(x => x.status === s)
              const count = found?.count || 0
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0`} style={{ background: STATUS_COLORS[s] }} />
                  <span className="text-xs text-slate-400 w-20 capitalize">{STATUS_LABELS[s]}</span>
                  <div className="flex-1 bg-[#0f1117] rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min((count / (data.total || 1)) * 100, 100)}%`, background: STATUS_COLORS[s] }} />
                  </div>
                  <span className="text-xs text-slate-400 w-4 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="font-semibold text-sm text-white mb-3">Recent Activity</h2>
          <div className="space-y-2">
            {data.recent?.slice(0, 6).map(ro => (
              <div key={ro.id} onClick={() => navigate(`/ros/${ro.id}`)}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#2a2d3e] cursor-pointer transition-colors">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[ro.status] }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white truncate">{ro.ro_number} — {ro.year} {ro.make} {ro.model}</div>
                  <div className="text-[10px] text-slate-500">{ro.customer_name}</div>
                </div>
                <StatusBadge status={ro.status} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
