import { useEffect, useState } from 'react'
import { Search, Radar, Wrench } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

const DEFAULT_LOOKUP = { year: '', make: '', model: '' }

export default function ADASCalibration() {
  const navigate = useNavigate()
  const [form, setForm] = useState(DEFAULT_LOOKUP)
  const [loadingLookup, setLoadingLookup] = useState(false)
  const [lookup, setLookup] = useState(null)
  const [queue, setQueue] = useState([])
  const [loadingQueue, setLoadingQueue] = useState(true)

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  async function loadQueue() {
    setLoadingQueue(true)
    try {
      const { data } = await api.get('/adas/queue')
      setQueue(data.queue || [])
    } finally {
      setLoadingQueue(false)
    }
  }

  useEffect(() => {
    loadQueue().catch(() => setQueue([]))
  }, [])

  async function runLookup(e) {
    e.preventDefault()
    if (!form.year || !form.make.trim() || !form.model.trim()) return
    setLoadingLookup(true)
    try {
      const { data } = await api.get('/adas/lookup', { params: form })
      setLookup(data)
    } catch (err) {
      setLookup({
        found: false,
        systems: [],
        recommendation: err?.response?.data?.error || 'Lookup failed',
      })
    } finally {
      setLoadingLookup(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold text-ink">ADAS Calibration Tracker</h1>
        <p className="text-sm text-muted">Lookup calibration requirements and monitor vehicles in ADAS queue.</p>
      </div>

      <div className="rounded-instrument border border-line-2 bg-panel p-4">
        <form onSubmit={runLookup} className="grid md:grid-cols-4 gap-2">
          <input
            value={form.year}
            onChange={(e) => setField('year', e.target.value)}
            placeholder="Year"
            className="rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
          <input
            value={form.make}
            onChange={(e) => setField('make', e.target.value)}
            placeholder="Make"
            className="rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
          <input
            value={form.model}
            onChange={(e) => setField('model', e.target.value)}
            placeholder="Model"
            className="rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
          <button
            type="submit"
            disabled={loadingLookup}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
          >
            <Search size={14} /> {loadingLookup ? 'Checking...' : 'Lookup'}
          </button>
        </form>

        {lookup && (
          <div className="mt-4 rounded-instrument border border-line-2 bg-void p-4">
            <div className="flex items-center gap-2 mb-2">
              <Radar size={14} className="text-cyan-300" />
              <p className="text-sm font-semibold text-ink">
                {lookup.found ? 'Calibration Profile Found' : 'No Direct Profile Match'}
              </p>
            </div>
            <p className="mb-3 text-xs text-muted">{lookup.recommendation}</p>
            {lookup.systems?.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-2">
                {lookup.systems.map((system) => (
                  <div key={system} className="rounded-lg border border-line-2 bg-panel px-3 py-2 text-xs text-ink">
                    {system}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-faint">Use OEM procedures for verification.</p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-instrument border border-line-2 bg-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-sm font-semibold text-ink">Vehicles Needing ADAS Calibration</h2>
          <button onClick={() => loadQueue().catch(() => {})} className="text-xs text-brand transition-colors hover:text-brand-lit">Refresh</button>
        </div>
        {loadingQueue ? (
          <p className="text-sm text-faint">Loading queue...</p>
        ) : queue.length === 0 ? (
          <p className="text-sm text-faint">No active vehicles currently flagged for ADAS calibration.</p>
        ) : (
          <div className="space-y-2">
            {queue.map((item, idx) => (
              <button
                key={item.ro_id || `${item.ro_number || 'ro'}-${idx}`}
                type="button"
                onClick={() => item.ro_id && navigate(`/ros/${item.ro_id}`)}
                className="w-full rounded-instrument border border-line-2 bg-void p-3 text-left transition-colors hover:border-brand/60 hover:bg-brand/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{item.ro_number} · {item.vehicle}</p>
                    <p className="text-xs text-faint">{item.customer_name || 'Unknown customer'} · Stage: {item.status}</p>
                    <p className="mt-1 text-[11px] text-brand">Click to open RO</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs bg-cyan-900/30 text-cyan-300 border border-cyan-700/40 px-2 py-1 rounded-full">
                    <Wrench size={12} /> {item.systems_count} systems
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
