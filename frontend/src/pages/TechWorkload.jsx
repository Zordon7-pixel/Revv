import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Wrench } from 'lucide-react'
import api from '../lib/api'
import StatusBadge from '../components/StatusBadge'

function moveRo(columns, roId, fromTechId, toTechId) {
  if (!fromTechId || !toTechId || fromTechId === toTechId) return columns;
  const next = columns.map((col) => ({ ...col, ros: [...(col.ros || [])] }));
  const from = next.find((col) => col.tech_id === fromTechId);
  const to = next.find((col) => col.tech_id === toTechId);
  if (!from || !to) return columns;
  const idx = from.ros.findIndex((ro) => ro.id === roId);
  if (idx < 0) return columns;
  const [card] = from.ros.splice(idx, 1);
  to.ros.unshift(card);
  return next.map((col) => ({ ...col, count: col.ros.length }));
}

export default function TechWorkload() {
  const navigate = useNavigate()
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(null)
  const [hoveredColumn, setHoveredColumn] = useState('')
  const [savingRoId, setSavingRoId] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/reports/tech-workload')
      setColumns(data.columns || [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load workload.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const totalActive = useMemo(
    () => columns.reduce((sum, col) => sum + Number(col.count || 0), 0),
    [columns]
  )

  async function onDrop(targetTechId) {
    if (!dragging || !targetTechId || dragging.fromTechId === targetTechId) {
      setHoveredColumn('')
      return;
    }

    const prev = columns
    setColumns((curr) => moveRo(curr, dragging.ro.id, dragging.fromTechId, targetTechId))
    setSavingRoId(dragging.ro.id)
    setDragging(null)
    setHoveredColumn('')

    try {
      await api.patch(`/ros/${dragging.ro.id}/assign`, {
        user_id: targetTechId === 'unassigned' ? null : targetTechId,
      })
    } catch (err) {
      setColumns(prev)
      setError(err?.response?.data?.error || 'Could not reassign RO.')
    } finally {
      setSavingRoId('')
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500">Loading workload…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Tech Workload</h1>
          <p className="text-slate-500 text-sm">{totalActive} active ROs across all techs</p>
        </div>
        <button
          onClick={load}
          className="text-xs bg-[#2a2d3e] hover:bg-[#3a3d4e] text-slate-200 px-3 py-1.5 rounded-lg"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-xs bg-red-900/30 border border-red-700/40 text-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {columns.map((column) => (
            <section
              key={column.tech_id}
              onDragOver={(e) => {
                e.preventDefault()
                if (hoveredColumn !== column.tech_id) setHoveredColumn(column.tech_id)
              }}
              onDragLeave={() => setHoveredColumn((v) => (v === column.tech_id ? '' : v))}
              onDrop={(e) => {
                e.preventDefault()
                onDrop(column.tech_id)
              }}
              className={`w-80 rounded-xl border p-3 transition-colors ${
                hoveredColumn === column.tech_id
                  ? 'border-indigo-500 bg-indigo-900/20'
                  : 'border-[#2a2d3e] bg-[#1a1d2e]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  {column.tech_id === 'unassigned'
                    ? <User size={14} className="text-amber-300" />
                    : <Wrench size={14} className="text-indigo-300" />}
                  <h2 className="text-sm font-semibold text-white truncate">{column.tech_name}</h2>
                </div>
                <span className="text-[11px] text-slate-400">{column.count || 0}</span>
              </div>

              {column.ros?.length ? (
                <div className="space-y-2">
                  {column.ros.map((ro) => (
                    <article
                      key={ro.id}
                      draggable
                      onDragStart={() => setDragging({ ro, fromTechId: column.tech_id })}
                      onDragEnd={() => {
                        setDragging(null)
                        setHoveredColumn('')
                      }}
                      className={`rounded-lg border border-[#2a2d3e] bg-[#0f1117] p-3 cursor-grab active:cursor-grabbing ${
                        savingRoId === ro.id ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <button
                          onClick={() => navigate(`/ros/${ro.id}`)}
                          className="text-sm text-white font-semibold hover:text-indigo-300 text-left"
                        >
                          {ro.ro_number || 'RO'}
                        </button>
                        <StatusBadge status={ro.status} />
                      </div>
                      <div className="text-xs text-slate-300 truncate">{ro.customer_name || 'Unknown customer'}</div>
                      <div className="text-[11px] text-slate-500 truncate">{ro.vehicle || 'Vehicle not set'}</div>
                      {ro.estimated_delivery && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          ETA: {new Date(ro.estimated_delivery).toLocaleDateString()}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[#2a2d3e] p-6 text-center text-xs text-slate-500">
                  Drop RO cards here
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
