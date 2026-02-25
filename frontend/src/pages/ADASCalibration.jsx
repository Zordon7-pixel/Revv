import { useEffect, useState } from 'react'
import { Search, Radar, Wrench } from 'lucide-react'
import api from '../lib/api'

const DEFAULT_LOOKUP = { year: '', make: '', model: '' }

export default function ADASCalibration() {
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
        <h1 className="text-xl font-bold text-white">ADAS Calibration Tracker</h1>
        <p className="text-sm text-slate-400">Lookup calibration requirements and monitor vehicles in ADAS queue.</p>
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
        <form onSubmit={runLookup} className="grid md:grid-cols-4 gap-2">
          <input
            value={form.year}
            onChange={(e) => setField('year', e.target.value)}
            placeholder="Year"
            className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white"
          />
          <input
            value={form.make}
            onChange={(e) => setField('make', e.target.value)}
            placeholder="Make"
            className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white"
          />
          <input
            value={form.model}
            onChange={(e) => setField('model', e.target.value)}
            placeholder="Model"
            className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white"
          />
          <button
            type="submit"
            disabled={loadingLookup}
            className="inline-flex items-center justify-center gap-2 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
          >
            <Search size={14} /> {loadingLookup ? 'Checking...' : 'Lookup'}
          </button>
        </form>

        {lookup && (
          <div className="mt-4 bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Radar size={14} className="text-cyan-300" />
              <p className="text-sm font-semibold text-white">
                {lookup.found ? 'Calibration Profile Found' : 'No Direct Profile Match'}
              </p>
            </div>
            <p className="text-xs text-slate-400 mb-3">{lookup.recommendation}</p>
            {lookup.systems?.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-2">
                {lookup.systems.map((system) => (
                  <div key={system} className="text-xs text-slate-200 bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-3 py-2">
                    {system}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Use OEM procedures for verification.</p>
            )}
          </div>
        )}
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Vehicles Needing ADAS Calibration</h2>
          <button onClick={() => loadQueue()} className="text-xs text-indigo-300 hover:text-indigo-200">Refresh</button>
        </div>
        {loadingQueue ? (
          <p className="text-sm text-slate-500">Loading queue...</p>
        ) : queue.length === 0 ? (
          <p className="text-sm text-slate-500">No active vehicles currently flagged for ADAS calibration.</p>
        ) : (
          <div className="space-y-2">
            {queue.map((item) => (
              <div key={item.ro_id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{item.ro_number} · {item.vehicle}</p>
                    <p className="text-xs text-slate-500">{item.customer_name || 'Unknown customer'} · Stage: {item.status}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs bg-cyan-900/30 text-cyan-300 border border-cyan-700/40 px-2 py-1 rounded-full">
                    <Wrench size={12} /> {item.systems_count} systems
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
