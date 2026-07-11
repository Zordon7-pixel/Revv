import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Camera, ChevronRight, Clock, RefreshCw, Wrench } from 'lucide-react'
import api from '../lib/api'
import { getRole, getTokenPayload, isAdmin } from '../lib/auth'
import ROPhotos from '../components/ROPhotos'
import { PageHeader, Panel, StatusBadge } from '../components/ui'
import { STATUS_LABELS } from './RepairOrders'

const FLOOR_STATUSES = ['parts', 'repair', 'paint', 'qc']
const NEXT_STATUS = { parts: 'repair', repair: 'paint', paint: 'qc', qc: 'delivery' }

function vehicleLabel(ro) {
  return [ro.year, ro.make, ro.model].filter(Boolean).join(' ') || 'Vehicle not set'
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not available on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => reject(new Error('Location access is required for clock actions.')),
      { timeout: 10000, maximumAge: 0 },
    )
  })
}

export default function FloorMode() {
  const role = getRole()
  const currentUser = getTokenPayload()
  const isTechRole = ['technician', 'employee', 'staff'].includes(role)
  const [ros, setRos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [advancingId, setAdvancingId] = useState('')
  const [photoRoId, setPhotoRoId] = useState('')
  const [clockStatus, setClockStatus] = useState(null)
  const [clockLoading, setClockLoading] = useState(false)
  const [clockError, setClockError] = useState('')

  async function loadFloor() {
    if (!currentUser?.id || !isTechRole) return
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/ros', { params: { assigned_to: currentUser.id, status: 'open' } })
      setRos((data.ros || []).filter((ro) => FLOOR_STATUSES.includes(ro.status)))
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load floor mode.')
    } finally {
      setLoading(false)
    }
  }

  async function loadClockStatus() {
    try {
      const { data } = await api.get('/timeclock/status')
      setClockStatus(data)
      setClockError('')
    } catch (err) {
      setClockError(err?.response?.data?.error || 'Could not load clock status.')
    }
  }

  useEffect(() => {
    loadFloor()
    if (isTechRole) loadClockStatus()
  }, [])

  const grouped = useMemo(() => Object.fromEntries(FLOOR_STATUSES.map((status) => [status, ros.filter((ro) => ro.status === status)])), [ros])

  if (!isTechRole) {
    if (isAdmin()) return <Navigate to="/ros" replace />
    return <Navigate to="/" replace />
  }

  async function advanceRo(ro) {
    const next = NEXT_STATUS[ro.status]
    if (!next) return
    const previous = ros
    setAdvancingId(ro.id)
    setError('')
    setRos((current) => current.map((item) => item.id === ro.id ? { ...item, status: next } : item).filter((item) => FLOOR_STATUSES.includes(item.status)))
    try {
      await api.put(`/ros/${ro.id}/status`, { status: next })
    } catch (err) {
      setRos(previous)
      setError(err?.response?.data?.error || `Could not move ${ro.ro_number || 'RO'} forward.`)
    } finally {
      setAdvancingId('')
    }
  }

  async function toggleClock() {
    setClockLoading(true)
    setClockError('')
    try {
      const location = await getLocation()
      if (clockStatus?.clocked_in) await api.post('/timeclock/out', location)
      else await api.post('/timeclock/in', location)
      await loadClockStatus()
    } catch (err) {
      setClockError(err?.response?.data?.message || err?.response?.data?.error || err.message || 'Clock action failed.')
    } finally {
      setClockLoading(false)
    }
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const headerActions = (
    <>
      <button type="button" onClick={loadFloor} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-2 bg-panel px-4 text-sm font-semibold text-ink transition-colors hover:border-brand disabled:opacity-50"><RefreshCw size={17} /> Refresh</button>
      <button type="button" onClick={toggleClock} disabled={clockLoading} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold text-white transition-colors disabled:opacity-50 ${clockStatus?.clocked_in ? 'bg-crit hover:bg-crit/80' : 'bg-brand hover:bg-brand-lit'}`}><Clock size={17} />{clockLoading ? 'Checking...' : clockStatus?.clocked_in ? 'Clock Out' : 'Clock In'}</button>
    </>
  )

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      <PageHeader eyebrow="Production floor" title="Floor mode" description={`${today} - ${ros.length} active assigned RO${ros.length === 1 ? '' : 's'}`} actions={headerActions} />

      {(error || clockError) && <div className="rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit" role="alert">{error || clockError}</div>}

      {loading ? (
        <Panel><div className="grid min-h-52 place-items-center text-sm text-muted" role="status">Loading floor board...</div></Panel>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {FLOOR_STATUSES.map((status) => (
            <Panel key={status} className="min-w-0 bg-panel-2">
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
                <h2 className="font-display text-sm font-semibold text-ink">{STATUS_LABELS[status] || status}</h2>
                <span className="rounded-full border border-line bg-panel px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-muted">{grouped[status]?.length || 0}</span>
              </div>

              {grouped[status]?.length ? (
                <div className="space-y-3 p-3">
                  {grouped[status].map((ro) => {
                    const next = NEXT_STATUS[ro.status]
                    const photosOpen = photoRoId === ro.id
                    return (
                      <article key={ro.id} className="min-w-0 rounded-instrument border border-line bg-panel p-4">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link to={`/ros/${ro.id}`} className="block truncate font-mono text-base font-bold text-brand hover:text-brand-lit">{ro.ro_number || 'RO'}</Link>
                            <div className="truncate text-sm font-semibold text-ink">{ro.customer_name || 'Customer'}</div>
                            <div className="truncate text-sm text-muted">{vehicleLabel(ro)}</div>
                          </div>
                          <StatusBadge status={ro.status} />
                        </div>

                        <div className="mt-4 grid gap-2">
                          <button type="button" onClick={() => advanceRo(ro)} disabled={!next || advancingId === ro.id} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"><Wrench size={18} />{advancingId === ro.id ? 'Updating...' : `Move to ${STATUS_LABELS[next] || next}`}<ChevronRight size={18} /></button>
                          <button type="button" onClick={() => setPhotoRoId((value) => value === ro.id ? '' : ro.id)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line-2 bg-raised px-4 text-sm font-semibold text-ink transition-colors hover:border-brand"><Camera size={17} />{photosOpen ? 'Hide Photos' : 'Quick Photos'}</button>
                        </div>

                        {photosOpen && <div className="mt-3"><ROPhotos roId={ro.id} isAdmin={false} /></div>}
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="m-3 rounded-lg border border-dashed border-line-2 px-3 py-8 text-center text-sm text-faint">No assigned ROs here</div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
