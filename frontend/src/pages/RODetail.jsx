import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import api from '../lib/api'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'

const STAGES = ['intake','estimate','approval','parts','repair','paint','qc','delivery']

export default function RODetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [ro, setRo] = useState(null)

  const load = () => api.get(`/ros/${id}`).then(r => setRo(r.data))
  useEffect(() => { load() }, [id])

  async function advance() {
    const idx = STAGES.indexOf(ro.status)
    if (idx < STAGES.length - 1) {
      await api.put(`/ros/${id}/status`, { status: STAGES[idx+1] })
      load()
    }
  }

  if (!ro) return <div className="flex items-center justify-center h-64 text-slate-500">Loading...</div>

  const p = ro.profit || {}
  const currentIdx = STAGES.indexOf(ro.status)

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/ros')} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">{ro.ro_number}</h1>
          <p className="text-slate-500 text-sm">{ro.vehicle?.year} {ro.vehicle?.make} {ro.vehicle?.model} · {ro.customer?.name}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs px-3 py-1.5 rounded-full font-bold uppercase" style={{background: STATUS_COLORS[ro.status]+'22', color: STATUS_COLORS[ro.status]}}>
            {STATUS_LABELS[ro.status]}
          </span>
          {currentIdx < STAGES.length - 1 && (
            <button onClick={advance} className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
              → {STATUS_LABELS[STAGES[currentIdx+1]]}
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Job Progress</span>
          <span className="text-xs text-slate-500">{currentIdx + 1} of {STAGES.length} stages</span>
        </div>
        <div className="flex gap-1">
          {STAGES.map((s, i) => (
            <div key={s} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full h-1.5 rounded-full" style={{background: i <= currentIdx ? STATUS_COLORS[s] : '#2a2d3e'}} />
              <span className="text-[8px] text-slate-600 hidden sm:block">{STATUS_LABELS[s]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Vehicle Info */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Vehicle</h2>
          <div className="space-y-2">
            {[
              ['Year/Make/Model', `${ro.vehicle?.year} ${ro.vehicle?.make} ${ro.vehicle?.model}`],
              ['Color', ro.vehicle?.color],
              ['VIN', ro.vehicle?.vin],
              ['Plate', ro.vehicle?.plate],
              ['Intake Date', ro.intake_date],
              ['Est. Delivery', ro.estimated_delivery || '—'],
              ['Job Type', ro.job_type],
            ].map(([k,v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-slate-500">{k}</span>
                <span className="text-white font-medium text-right ml-4 truncate">{v || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Insurance / Payment */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">
            {ro.payment_type === 'cash' ? '💵 Cash Job' : '🏢 Insurance Claim'}
          </h2>
          <div className="space-y-2">
            {ro.payment_type === 'insurance' ? [
              ['Insurer', ro.insurer],
              ['Claim #', ro.claim_number],
              ['Adjuster', ro.adjuster_name],
              ['Adj. Phone', ro.adjuster_phone],
              ['Deductible', ro.deductible ? `$${ro.deductible}` : '—'],
            ].map(([k,v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-slate-500">{k}</span>
                <span className="text-white font-medium">{v || '—'}</span>
              </div>
            )) : (
              <div className="text-xs text-slate-400">Customer pay — no insurance claim.</div>
            )}
          </div>
        </div>

        {/* Profit Breakdown */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">💰 Profit Breakdown (NY Market)</h2>
          <div className="space-y-2">
            {[
              ['Parts Cost', `$${ro.parts_cost?.toFixed(2)}`],
              ['Labor', `$${ro.labor_cost?.toFixed(2)}`],
              ['Sublet', `$${ro.sublet_cost?.toFixed(2)}`],
              ['Total Billed', `$${ro.total?.toFixed(2)}`],
            ].map(([k,v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-slate-500">{k}</span>
                <span className="text-white">{v}</span>
              </div>
            ))}
            <div className="border-t border-[#2a2d3e] pt-2 space-y-1">
              {ro.deductible_waived > 0 && <div className="flex justify-between text-xs"><span className="text-red-400">Deductible Waived</span><span className="text-red-400">-${ro.deductible_waived}</span></div>}
              {ro.referral_fee > 0 && <div className="flex justify-between text-xs"><span className="text-red-400">Referral Fee</span><span className="text-red-400">-${ro.referral_fee}</span></div>}
              {ro.goodwill_repair_cost > 0 && <div className="flex justify-between text-xs"><span className="text-red-400">Goodwill Repair</span><span className="text-red-400">-${ro.goodwill_repair_cost}</span></div>}
            </div>
            <div className="border-t border-[#2a2d3e] pt-2 flex justify-between text-sm font-bold">
              <span className="text-emerald-400">True Profit</span>
              <span className="text-emerald-400">${ro.true_profit?.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">📋 Status Timeline</h2>
          <div className="space-y-2">
            {ro.log?.map((entry, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{background: STATUS_COLORS[entry.to_status]}} />
                <div className="flex-1">
                  <div className="text-xs text-white font-medium">{STATUS_LABELS[entry.to_status]}</div>
                  <div className="text-[10px] text-slate-500">{new Date(entry.created_at).toLocaleString()}</div>
                  {entry.note && <div className="text-[10px] text-slate-400 italic">{entry.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {ro.notes && (
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Notes</h2>
          <p className="text-sm text-slate-300">{ro.notes}</p>
        </div>
      )}
    </div>
  )
}
