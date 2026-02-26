import { useEffect, useState } from 'react'
import { Clock, TrendingUp } from 'lucide-react'
import api from '../lib/api'

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
    <div className="mt-3 bg-indigo-900/20 border border-indigo-700/40 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <Clock size={13} className="text-indigo-400" />
        <span className="text-xs font-semibold text-indigo-300">Estimated Turnaround</span>
        {est?.basedOnSamples >= 3 && (
          <span className="text-[10px] text-indigo-500 ml-auto flex items-center gap-1">
            <TrendingUp size={10} /> based on {est.basedOnSamples} past jobs
          </span>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-slate-400">Calculating...</p>
      ) : est ? (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">{est.label}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {est.minDays === est.maxDays
                ? `~${est.minDays} business day${est.minDays !== 1 ? 's' : ''}`
                : `${est.minDays}–${est.maxDays} business days`}
              {est.activeROs > 5 && ` · +buffer (${est.activeROs} active ROs)`}
            </p>
          </div>
          {onAccept && (
            <button
              type="button"
              onClick={() => onAccept(est.endDate)}
              className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-700/50 hover:border-indigo-500 px-2 py-1 rounded-lg transition-colors"
            >
              Use this date →
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
