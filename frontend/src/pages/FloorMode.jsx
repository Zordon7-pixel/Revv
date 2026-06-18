import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Camera, ChevronRight, Clock, RefreshCw, Wrench } from 'lucide-react'
import api from '../lib/api'
import { getRole, getTokenPayload, isAdmin } from '../lib/auth'
import ROPhotos from '../components/ROPhotos'
import StatusBadge from '../components/StatusBadge'
import { STATUS_LABELS } from './RepairOrders'

const FLOOR_STATUSES = ['parts', 'repair', 'paint', 'qc']
const NEXT_STATUS = {
  parts: 'repair',
  repair: 'paint',
  paint: 'qc',
  qc: 'delivery',
}

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
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('Location access is required for clock actions.')),
      { timeout: 10000, maximumAge: 0 }
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
      const { data } = await api.get('/ros', {
        params: { assigned_to: currentUser.id, status: 'open' },
      })
      const activeFloorRos = (data.ros || []).filter((ro) => FLOOR_STATUSES.includes(ro.status))
      setRos(activeFloorRos)
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

  const grouped = useMemo(() => {
    return Object.fromEntries(FLOOR_STATUSES.map((status) => [
      status,
      ros.filter((ro) => ro.status === status),
    ]))
  }, [ros])

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
    setRos((current) => current.map((item) => (
      item.id === ro.id ? { ...item, status: next } : item
    )).filter((item) => FLOOR_STATUSES.includes(item.status)))

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
      const loc = await getLocation()
      if (clockStatus?.clocked_in) {
        await api.post('/timeclock/out', loc)
      } else {
        await api.post('/timeclock/in', loc)
      }
      await loadClockStatus()
    } catch (err) {
      setClockError(err?.response?.data?.message || err?.response?.data?.error || err.message || 'Clock action failed.')
    } finally {
      setClockLoading(false)
    }
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Floor Mode</h1>
          <p className="text-sm text-slate-400">{today} - {ros.length} active assigned ROs</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button
            type="button"
            onClick={loadFloor}
            disabled={loading}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#2a2d3e] bg-[#1a1d2e] px-4 text-sm font-semibold text-slate-200 hover:bg-[#24283a] disabled:opacity-50"
          >
            <RefreshCw size={18} />
            Refresh
          </button>
          <button
            type="button"
            onClick={toggleClock}
            disabled={clockLoading}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold disabled:opacity-50 ${
              clockStatus?.clocked_in
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-indigo-600 text-white hover:bg-indigo-500'
            }`}
          >
            <Clock size={18} />
            {clockLoading ? 'Checking...' : clockStatus?.clocked_in ? 'Clock Out' : 'Clock In'}
          </button>
        </div>
      </div>

      {(error || clockError) && (
        <div className="rounded-lg border border-red-700/40 bg-red-900/25 px-4 py-3 text-sm text-red-200">
          {error || clockError}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] p-8 text-center text-sm text-slate-400">
          Loading floor board...
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {FLOOR_STATUSES.map((status) => (
            <section key={status} className="min-w-0 rounded-xl border border-[#2a2d3e] bg-[#151827] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-200">
                  {STATUS_LABELS[status] || status}
                </h2>
                <span className="rounded-full bg-[#0f1117] px-2.5 py-1 text-xs font-semibold text-slate-400">
                  {grouped[status]?.length || 0}
                </span>
              </div>

              {grouped[status]?.length ? (
                <div className="space-y-3">
                  {grouped[status].map((ro) => {
                    const next = NEXT_STATUS[ro.status]
                    const photosOpen = photoRoId === ro.id
                    return (
                      <article key={ro.id} className="min-w-0 rounded-xl border border-[#2a2d3e] bg-[#0f1117] p-4">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link to={`/ros/${ro.id}`} className="block truncate text-lg font-bold text-white hover:text-indigo-300">
                              {ro.ro_number || 'RO'}
                            </Link>
                            <div className="truncate text-sm font-semibold text-slate-300">{ro.customer_name || 'Customer'}</div>
                            <div className="truncate text-sm text-slate-500">{vehicleLabel(ro)}</div>
                          </div>
                          <StatusBadge status={ro.status} />
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-2">
                          <button
                            type="button"
                            onClick={() => advanceRo(ro)}
                            disabled={!next || advancingId === ro.id}
                            className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#EAB308] px-4 text-base font-bold text-[#0f1117] hover:bg-yellow-400 disabled:opacity-50"
                          >
                            <Wrench size={20} />
                            {advancingId === ro.id ? 'Updating...' : `Move to ${STATUS_LABELS[next] || next}`}
                            <ChevronRight size={20} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPhotoRoId((value) => value === ro.id ? '' : ro.id)}
                            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] px-4 text-sm font-semibold text-slate-200 hover:bg-[#24283a]"
                          >
                            <Camera size={18} />
                            {photosOpen ? 'Hide Photos' : 'Quick Photos'}
                          </button>
                        </div>

                        {photosOpen && (
                          <div className="mt-3">
                            <ROPhotos roId={ro.id} isAdmin={false} />
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[#2a2d3e] px-3 py-8 text-center text-sm text-slate-500">
                  No assigned ROs here
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
