import { useEffect, useState } from 'react'
import { Clock, TrendingUp } from 'lucide-react'
import api from '../lib/api'

export function formatTurnaroundRange(estimate) {
  const minDays = Number(estimate?.minDays)
  const maxDays = Number(estimate?.maxDays)
  const hasMin = Number.isFinite(minDays) && minDays >= 0
  const hasMax = Number.isFinite(maxDays) && maxDays >= 0
  if (!hasMin && !hasMax) return 'Timing range unavailable'
  const lower = hasMin ? minDays : maxDays
  const upper = hasMax ? maxDays : minDays
  if (lower === upper) return `~${lower} business day${lower === 1 ? '' : 's'}`
  return `${Math.min(lower, upper)}–${Math.max(lower, upper)} business days`
}

export default function TurnaroundEstimator({ jobType, onAccept }) {
  const [est, setEst] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!jobType) return
    setLoading(true)
    api.get('/ros/turnaround-estimate', { params: { job_type: jobType } })
      .then(r => setEst(r.data))
      .catch(() => setEst(null))
      .finally(() => setLoading(false))
  }, [jobType])

  if (!jobType || (!loading && !est)) return null

  return (
    <div className="mt-3 rounded-instrument border border-brand bg-panel-2 p-3" role="status">
      <div className="flex items-center gap-2 mb-1">
        <Clock size={13} className="text-brand" />
        <span className="text-xs font-semibold text-brand">Estimated turnaround</span>
        {est?.basedOnSamples >= 3 && (
          <span className="text-[10px] text-muted ml-auto flex items-center gap-1">
            <TrendingUp size={10} /> based on {est.basedOnSamples} past jobs
          </span>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-muted">Calculating…</p>
      ) : est ? (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-ink">{est.label || 'Estimated completion'}</p>
            <p className="text-[10px] text-muted mt-0.5">
              {formatTurnaroundRange(est)}
              {est.activeROs > 5 && ` · +buffer (${est.activeROs} active ROs)`}
            </p>
          </div>
          {onAccept && est.endDate && (
            <button
              type="button"
              onClick={() => onAccept(est.endDate)}
              className="rounded-lg border border-brand px-2 py-1 text-xs text-brand transition-colors hover:bg-panel hover:text-brand-lit"
            >
              Use this date →
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
