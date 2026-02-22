import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ChevronRight } from 'lucide-react'
import api from '../lib/api'
import AddROModal from '../components/AddROModal'
import StatusBadge from '../components/StatusBadge'

export const STATUS_COLORS = {
  intake: '#64748b', estimate: '#3b82f6', approval: '#eab308',
  parts: '#f97316', repair: '#22c55e', paint: '#a855f7',
  qc: '#06b6d4', delivery: '#10b981', closed: '#374151'
}
export const STATUS_LABELS = {
  intake: 'Intake', estimate: 'Estimate', approval: 'Approval',
  parts: 'Parts', repair: 'Repair', paint: 'Paint',
  qc: 'QC Check', delivery: 'Delivery', closed: 'Closed'
}
const STAGES = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery']

export default function RepairOrders() {
  const [ros, setRos] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const navigate = useNavigate()

  const load = () => api.get('/ros').then(r => setRos(r.data.ros))
  useEffect(() => { load() }, [])

  async function advanceStatus(ro, e) {
    e.stopPropagation()
    const idx = STAGES.indexOf(ro.status)
    if (idx < STAGES.length - 1) {
      await api.put(`/ros/${ro.id}/status`, { status: STAGES[idx + 1] })
      load()
    }
  }

  const byStatus = stage => ros.filter(r => r.status === stage)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Repair Orders</h1>
          <p className="text-slate-500 text-sm">{ros.length} total · {ros.filter(r => r.status !== 'delivery' && r.status !== 'closed').length} active</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus size={16} /> New RO
        </button>
      </div>

      {ros.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl">
          <img src="/empty-ros.png" alt="No repair orders" className="w-40 h-40 opacity-80 object-contain" />
          <p className="text-slate-400 text-sm font-medium">Quiet day at the shop.</p>
          <p className="text-slate-600 text-xs">No repair orders yet — create one to get started.</p>
        </div>
      ) : (
        <div className="kanban-scroll">
          <div className="flex gap-3 min-w-max pb-2">
            {STAGES.map(stage => (
              <div key={stage} className="w-64 flex-shrink-0">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[stage] }} />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">{STATUS_LABELS[stage]}</span>
                  <span className="ml-auto text-xs bg-[#2a2d3e] text-slate-400 px-2 py-0.5 rounded-full">{byStatus(stage).length}</span>
                </div>
                <div className="space-y-2">
                  {byStatus(stage).map(ro => {
                    const daysIn = ro.intake_date ? Math.floor((Date.now() - new Date(ro.intake_date)) / 86400000) : 0
                    const daysColor = daysIn > 14 ? 'text-red-400 bg-red-900/20' : daysIn > 7 ? 'text-yellow-400 bg-yellow-900/20' : 'text-emerald-400 bg-emerald-900/20'
                    return (
                      <div key={ro.id} onClick={() => navigate(`/ros/${ro.id}`)}
                        className="bg-[#1a1d2e] border border-[#2a2d3e] hover:border-indigo-500/50 rounded-xl p-3 transition-all duration-150 hover:bg-[#1e2235] hover:scale-[1.01] cursor-pointer group"
                        style={{ borderLeft: `3px solid ${STATUS_COLORS[stage]}` }}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-xs font-bold text-indigo-400">{ro.ro_number}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${ro.payment_type === 'cash' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-blue-900/40 text-blue-400'}`}>
                            {ro.payment_type}
                          </span>
                        </div>
                        <div className="mb-2">
                          <StatusBadge status={ro.status} />
                        </div>
                        <div className="text-sm font-bold text-white leading-tight">{ro.year} {ro.make} {ro.model}</div>
                        <div className="text-xs text-slate-300 mt-0.5 truncate">{ro.customer_name}</div>
                        <div className="text-[10px] text-slate-500 mt-1 capitalize">{ro.color} · {ro.job_type}</div>
                        <div className="flex items-center justify-between mt-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${daysColor}`}>
                            {daysIn}d in shop
                          </span>
                          {ro.total > 0 && <span className="text-[10px] text-slate-400 font-medium">${ro.total?.toLocaleString()}</span>}
                        </div>
                        {ro.estimated_delivery && (
                          <div className="text-[9px] text-slate-600 mt-1">Est: {ro.estimated_delivery}</div>
                        )}
                        {stage !== 'delivery' && (
                          <button onClick={e => advanceStatus(ro, e)}
                            className="mt-2 w-full flex items-center justify-center gap-1 text-[10px] text-slate-500 hover:text-indigo-400 hover:bg-indigo-900/20 rounded-lg py-1.5 transition-all opacity-0 group-hover:opacity-100 border border-transparent hover:border-indigo-900/50">
                            Move to {STATUS_LABELS[STAGES[STAGES.indexOf(stage) + 1]]} <ChevronRight size={10} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {byStatus(stage).length === 0 && (
                    <div className="text-center text-slate-600 text-xs py-8 border border-dashed border-[#2a2d3e] rounded-xl leading-relaxed">
                      No repair orders in this stage yet.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && <AddROModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
    </div>
  )
}
