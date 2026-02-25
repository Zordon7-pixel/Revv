import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Wrench, ChevronRight, Save } from 'lucide-react'
import api from '../lib/api'
import { getRole, getTokenPayload, isAdmin } from '../lib/auth'
import { STATUS_LABELS } from './RepairOrders'

const STAGES = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed']

export default function TechView() {
  const [ros, setRos] = useState([])
  const [notes, setNotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [advancingId, setAdvancingId] = useState(null)
  const me = getTokenPayload()?.id
  const role = getRole()

  const isTechRole = ['employee', 'staff'].includes(role)
  if (!isTechRole) {
    if (isAdmin()) return <Navigate to="/ros" replace />
    return <Navigate to="/" replace />
  }

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/ros')
      const myRos = (data.ros || []).filter((ro) => ro.assigned_to === me)
      setRos(myRos)
      setNotes(Object.fromEntries(myRos.map((ro) => [ro.id, ro.tech_notes || ''])))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openRos = useMemo(() => ros.filter((ro) => ro.status !== 'closed'), [ros])

  async function saveNotes(roId) {
    setSavingId(roId)
    try {
      await api.patch(`/ros/${roId}`, { tech_notes: notes[roId] || '' })
    } finally {
      setSavingId(null)
    }
  }

  async function advanceStatus(ro) {
    const idx = STAGES.indexOf(ro.status)
    if (idx < 0 || idx >= STAGES.length - 1) return
    setAdvancingId(ro.id)
    try {
      await api.put(`/ros/${ro.id}/status`, { status: STAGES[idx + 1] })
      await load()
    } finally {
      setAdvancingId(null)
    }
  }

  if (loading) return <div className="text-slate-400 text-sm">Loading my jobs...</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">My Jobs</h1>
        <p className="text-slate-500 text-sm">{openRos.length} active jobs assigned to you</p>
      </div>

      {openRos.length === 0 ? (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-8 text-center text-slate-500 text-sm">
          No jobs assigned right now.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {openRos.map((ro) => {
            const idx = STAGES.indexOf(ro.status)
            const next = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null
            return (
              <div key={ro.id} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[#EAB308] text-xs font-bold">{ro.ro_number}</p>
                    <p className="text-white font-semibold text-sm">{ro.customer_name || 'Customer'}</p>
                    <p className="text-slate-400 text-xs">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || 'Vehicle unavailable'}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full border border-[#EAB308]/40 bg-yellow-900/20 text-yellow-300 text-xs font-semibold">
                    {STATUS_LABELS[ro.status] || ro.status}
                  </span>
                </div>

                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">Tech Notes</label>
                  <textarea
                    rows={4}
                    value={notes[ro.id] || ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [ro.id]: e.target.value }))}
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
                    placeholder="Update your repair notes..."
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveNotes(ro.id)}
                    disabled={savingId === ro.id}
                    className="inline-flex items-center gap-1 bg-[#2a2d3e] hover:bg-[#34384d] text-slate-200 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
                  >
                    <Save size={13} />
                    {savingId === ro.id ? 'Saving...' : 'Save Notes'}
                  </button>

                  {next && ro.status !== 'closed' && (
                    <button
                      onClick={() => advanceStatus(ro)}
                      disabled={advancingId === ro.id}
                      className="inline-flex items-center gap-1 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
                    >
                      <Wrench size={13} />
                      {advancingId === ro.id ? 'Updating...' : `Move to ${STATUS_LABELS[next] || next}`}
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
