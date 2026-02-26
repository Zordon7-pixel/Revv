import { useState } from 'react'
import { CheckCircle, AlertTriangle, XCircle, Loader } from 'lucide-react'
import api from '../lib/api'

const OPTIONS = [
  {
    value: 'approved',
    label: 'Approved for Work',
    icon: CheckCircle,
    color: 'emerald',
    bg: 'bg-emerald-900/30',
    border: 'border-emerald-700',
    text: 'text-emerald-300',
    iconColor: 'text-emerald-400',
    desc: 'Claim approved. Repair workflow continues normally.',
  },
  {
    value: 'total_loss',
    label: 'Total Loss',
    icon: XCircle,
    color: 'red',
    bg: 'bg-red-900/30',
    border: 'border-red-700',
    text: 'text-red-300',
    iconColor: 'text-red-400',
    desc: 'Vehicle is a total loss. All repair steps are skipped. Awaiting tow pickup or release.',
  },
  {
    value: 'siu',
    label: 'Under Investigation (SIU)',
    icon: AlertTriangle,
    color: 'violet',
    bg: 'bg-violet-900/30',
    border: 'border-violet-700',
    text: 'text-violet-300',
    iconColor: 'text-violet-400',
    desc: 'Claim is under Special Investigation. All repair steps paused until SIU hold is cleared.',
  },
]

export default function ClaimStatusCard({ ro, onUpdate, isAdmin }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const current = ro.claim_status || null

  async function select(value) {
    if (!isAdmin) return
    if (value === current) return
    setSaving(true)
    setError(null)
    try {
      const r = await api.patch(`/ros/${ro.id}`, { claim_status: value })
      onUpdate(r.data)
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to update claim status')
    }
    setSaving(false)
  }

  const activeOpt = OPTIONS.find(o => o.value === current)

  return (
    <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-5 col-span-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
          <AlertTriangle size={12} />
          Claim Status
        </h2>
        {current && activeOpt && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${activeOpt.bg} ${activeOpt.text} border ${activeOpt.border}`}>
            {activeOpt.label}
          </span>
        )}
        {saving && <Loader size={14} className="animate-spin text-slate-400" />}
      </div>

      {/* SIU Banner */}
      {ro.status === 'siu_hold' && (
        <div className="bg-violet-900/20 border border-violet-700/50 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle size={14} className="text-violet-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-violet-300">SIU Hold Active</p>
            <p className="text-xs text-slate-400 mt-0.5">All repair steps are paused. Update claim status to Approved or Total Loss to resume workflow.</p>
          </div>
        </div>
      )}

      {/* Total Loss Banner */}
      {ro.status === 'total_loss' && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 mb-4 flex items-start gap-2">
          <XCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-300">Total Loss — Awaiting Tow / Release</p>
            <p className="text-xs text-slate-400 mt-0.5">No repairs will be performed. Coordinate vehicle tow pickup or customer release.</p>
          </div>
        </div>
      )}

      {/* Options */}
      {isAdmin ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {OPTIONS.map(opt => {
            const Icon = opt.icon
            const isSelected = current === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => select(opt.value)}
                disabled={saving}
                className={`text-left p-4 rounded-xl border transition-all ${
                  isSelected
                    ? `${opt.bg} ${opt.border}`
                    : 'bg-[#0f1117] border-[#2a2d3e] hover:border-slate-500'
                } disabled:opacity-50`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon size={16} className={isSelected ? opt.iconColor : 'text-slate-500'} />
                  <span className={`text-sm font-semibold ${isSelected ? opt.text : 'text-slate-300'}`}>
                    {opt.label}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{opt.desc}</p>
                {isSelected && (
                  <div className={`mt-2 text-[10px] font-bold uppercase tracking-wide ${opt.text}`}>
                    ✓ Active
                  </div>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        /* Read-only for non-admins */
        <div className="text-sm text-slate-400">
          {activeOpt ? (
            <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${activeOpt.bg} border ${activeOpt.border}`}>
              <activeOpt.icon size={14} className={activeOpt.iconColor} />
              <span className={activeOpt.text}>{activeOpt.label}</span>
            </div>
          ) : (
            <span className="text-slate-500 text-xs">Claim status not yet set</span>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}
