import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, DollarSign, CheckCircle, TrendingUp } from 'lucide-react'
import api from '../lib/api'
import { isAdmin } from '../lib/auth'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { api.get('/reports/summary').then(r => setData(r.data)) }, [])

  if (!data) return <div className="flex items-center justify-center h-64 text-slate-500">Loading...</div>

  const admin = isAdmin()
  const stats = [
    { label: 'Active Jobs', value: data.active,    icon: ClipboardList, color: 'text-indigo-400',  bg: 'bg-indigo-900/30'  },
    { label: 'Completed',   value: data.completed, icon: CheckCircle,   color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
    ...(admin ? [
      { label: 'Total Revenue', value: `$${data.revenue?.toLocaleString('en-US',{minimumFractionDigits:0})}`, icon: DollarSign,  color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
      { label: 'True Profit',   value: `$${data.profit?.toLocaleString('en-US',{minimumFractionDigits:0})}`,  icon: TrendingUp, color: 'text-pink-400',   bg: 'bg-pink-900/30'   },
    ] : []),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-xs text-indigo-400 italic mt-0.5">Every repair tracked. Every dollar counted. Every customer impressed.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-[#1a1d2e] rounded-xl p-4 border border-[#2a2d3e]">
            <div className={`w-9 h-9 ${s.bg} rounded-lg flex items-center justify-center mb-3`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="font-semibold text-sm text-white mb-3">Jobs by Stage</h2>
          <div className="space-y-2">
            {['intake','estimate','approval','parts','repair','paint','qc','delivery'].map(s => {
              const found = data.byStatus?.find(x => x.status === s)
              const count = found?.count || 0
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0`} style={{background: STATUS_COLORS[s]}} />
                  <span className="text-xs text-slate-400 w-20 capitalize">{STATUS_LABELS[s]}</span>
                  <div className="flex-1 bg-[#0f1117] rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all" style={{width: `${Math.min((count/data.total)*100,100)}%`, background: STATUS_COLORS[s]}} />
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
            {data.recent?.slice(0,6).map(ro => (
              <div key={ro.id} onClick={() => navigate(`/ros/${ro.id}`)}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#2a2d3e] cursor-pointer transition-colors">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background: STATUS_COLORS[ro.status]}} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white truncate">{ro.ro_number} — {ro.year} {ro.make} {ro.model}</div>
                  <div className="text-[10px] text-slate-500">{ro.customer_name}</div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase" style={{background: STATUS_COLORS[ro.status]+'22', color: STATUS_COLORS[ro.status]}}>
                  {STATUS_LABELS[ro.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
