import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ChevronRight, ClipboardCheck, Save, Wrench } from 'lucide-react'
import api from '../lib/api'
import { getRole, getTokenPayload, isAdmin } from '../lib/auth'
import { STATUS_LABELS } from './RepairOrders'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../components/ui'

const STAGES = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed']

export default function TechView() {
  const [ros, setRos] = useState([])
  const [notes, setNotes] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [advancingId, setAdvancingId] = useState(null)
  const me = getTokenPayload()?.id
  const role = getRole()
  const isTechRole = ['technician', 'employee', 'staff'].includes(role)

  async function load() {
    if (!isTechRole) return
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/ros')
      const myRos = (data.ros || []).filter((ro) => ro.assigned_to === me)
      setRos(myRos)
      setNotes(Object.fromEntries(myRos.map((ro) => [ro.id, ro.tech_notes || ''])))
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load assigned jobs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openRos = useMemo(() => ros.filter((ro) => ro.status !== 'closed'), [ros])

  if (!isTechRole) {
    if (isAdmin()) return <Navigate to="/ros" replace />
    return <Navigate to="/" replace />
  }

  async function saveNotes(roId) {
    setSavingId(roId)
    setError('')
    try {
      await api.patch(`/ros/${roId}`, { tech_notes: notes[roId] || '' })
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save technician notes.')
    } finally {
      setSavingId(null)
    }
  }

  async function advanceStatus(ro) {
    const index = STAGES.indexOf(ro.status)
    if (index < 0 || index >= STAGES.length - 1) return
    setAdvancingId(ro.id)
    setError('')
    try {
      await api.put(`/ros/${ro.id}/status`, { status: STAGES[index + 1] })
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || `Could not move ${ro.ro_number || 'the RO'} forward.`)
    } finally {
      setAdvancingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader eyebrow="Production floor" title="My jobs" description={`${openRos.length} active job${openRos.length === 1 ? '' : 's'} assigned to you`} />

      {error && <div className="rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit" role="alert">{error}</div>}

      {loading ? (
        <Panel><div className="grid min-h-52 place-items-center text-sm text-muted" role="status">Loading assigned jobs...</div></Panel>
      ) : openRos.length === 0 ? (
        <Panel><EmptyState icon={ClipboardCheck} title="No jobs assigned" description="New assignments will appear here as soon as the shop routes work to you." /></Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {openRos.map((ro) => {
            const index = STAGES.indexOf(ro.status)
            const next = index >= 0 && index < STAGES.length - 1 ? STAGES[index + 1] : null
            return (
              <Panel key={ro.id} className="overflow-hidden">
                <div className="flex items-start justify-between gap-3 border-b border-line p-4">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-brand">{ro.ro_number}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-ink">{ro.customer_name || 'Customer'}</p>
                    <p className="mt-1 truncate text-xs text-muted">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || 'Vehicle unavailable'}</p>
                  </div>
                  <StatusBadge status={ro.status} label={STATUS_LABELS[ro.status]} />
                </div>

                <div className="space-y-4 p-4">
                  <div>
                    <label htmlFor={`tech-notes-${ro.id}`} className="mb-1 block text-xs font-medium text-muted">Tech notes</label>
                    <textarea
                      id={`tech-notes-${ro.id}`}
                      rows={4}
                      value={notes[ro.id] || ''}
                      onChange={(event) => setNotes((previous) => ({ ...previous, [ro.id]: event.target.value }))}
                      className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
                      placeholder="Update your repair notes..."
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => saveNotes(ro.id)} disabled={savingId === ro.id} className="inline-flex items-center gap-2 rounded-lg border border-line-2 bg-raised px-3 py-2 text-xs font-semibold text-ink transition-colors hover:border-brand disabled:opacity-50">
                      <Save size={14} /> {savingId === ro.id ? 'Saving...' : 'Save notes'}
                    </button>
                    {next && ro.status !== 'closed' && (
                      <button type="button" onClick={() => advanceStatus(ro)} disabled={advancingId === ro.id} className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
                        <Wrench size={14} /> {advancingId === ro.id ? 'Updating...' : `Move to ${STATUS_LABELS[next] || next}`} <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </Panel>
            )
          })}
        </div>
      )}
    </div>
  )
}
