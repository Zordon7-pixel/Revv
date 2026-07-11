import { useState } from 'react'
import { CheckCircle, AlertTriangle, XCircle, Loader } from 'lucide-react'
import api from '../lib/api'

const OPTIONS = [
  {
    value: 'approved',
    label: 'Approved for Work',
    icon: CheckCircle,
    bg: 'bg-good/10',
    border: 'border-good/40',
    text: 'text-good',
    iconColor: 'text-good',
    desc: 'Claim approved. Repair workflow continues normally.',
  },
  {
    value: 'total_loss',
    label: 'Total Loss',
    icon: XCircle,
    bg: 'bg-crit/10',
    border: 'border-crit/40',
    text: 'text-crit',
    iconColor: 'text-crit',
    desc: 'Vehicle is a total loss. All repair steps are skipped. Awaiting tow pickup or release.',
  },
  {
    value: 'siu',
    label: 'Under Investigation (SIU)',
    icon: AlertTriangle,
    bg: 'bg-crit/10',
    border: 'border-crit/40',
    text: 'text-crit',
    iconColor: 'text-crit',
    desc: 'Claim is under Special Investigation. All repair steps paused until SIU hold is cleared.',
  },
]

export default function ClaimStatusCard({ ro, onUpdate, isAdmin, onOpenStorage }) {
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
    <div className="col-span-full rounded-instrument border border-line-2 bg-panel p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
          <AlertTriangle size={12} />
          Claim Status
        </h2>
        {current && activeOpt && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${activeOpt.bg} ${activeOpt.text} border ${activeOpt.border}`}>
            {activeOpt.label}
          </span>
        )}
        {saving && <Loader size={14} className="animate-spin text-muted" />}
      </div>

      {/* SIU Banner */}
      {(ro.status === 'siu_hold' || ro.claim_status === 'siu') && (
        <div className="mb-4 flex items-start gap-2 rounded-instrument border border-crit/40 bg-crit/10 p-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-crit" />
          <div>
            <p className="text-xs font-semibold text-crit">SIU Hold Active</p>
            <p className="mt-0.5 text-xs text-muted">All repair steps are paused. Update claim status to Approved or Total Loss to resume workflow.</p>
          </div>
        </div>
      )}

      {/* Total Loss Banner */}
      {(ro.status === 'total_loss' || ro.claim_status === 'total_loss') && (
        <div className="mb-4 flex items-start gap-2 rounded-instrument border border-crit/40 bg-crit/10 p-3">
          <XCircle size={14} className="mt-0.5 shrink-0 text-crit" />
          <div>
            <p className="text-xs font-semibold text-crit">Total Loss — Storage + Pickup / Release</p>
            <p className="mt-0.5 text-xs text-muted">No repair labor or deductible is collected. Track storage charges, then coordinate tow pickup or customer release.</p>
            {onOpenStorage && (
              <button
                type="button"
                onClick={onOpenStorage}
                className="mt-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/15"
              >
                Open Storage Hold
              </button>
            )}
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
                type="button"
                key={opt.value}
                onClick={() => select(opt.value)}
                disabled={saving}
                className={`text-left p-4 rounded-xl border transition-all ${
                  isSelected
                    ? `${opt.bg} ${opt.border}`
                    : 'border-line-2 bg-void hover:border-brand/50'
                } disabled:opacity-50`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon size={16} className={isSelected ? opt.iconColor : 'text-faint'} />
                  <span className={`text-sm font-semibold ${isSelected ? opt.text : 'text-ink'}`}>
                    {opt.label}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-faint">{opt.desc}</p>
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
        <div className="text-sm text-muted">
          {activeOpt ? (
            <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${activeOpt.bg} border ${activeOpt.border}`}>
              <activeOpt.icon size={14} className={activeOpt.iconColor} />
              <span className={activeOpt.text}>{activeOpt.label}</span>
            </div>
          ) : (
            <span className="text-xs text-faint">Claim status not yet set</span>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-crit" role="alert">{error}</p>
      )}
    </div>
  )
}
