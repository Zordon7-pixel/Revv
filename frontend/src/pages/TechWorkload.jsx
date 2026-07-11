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

  if (loading) return <div className="flex h-64 items-center justify-center text-faint" role="status">Loading workload…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">Tech Workload</h1>
          <p className="text-sm text-muted">{totalActive} active ROs across all techs</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-instrument border border-line-2 bg-raised px-3 py-1.5 text-xs text-ink transition-colors hover:border-brand"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">
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
                  ? 'border-brand bg-brand/10'
                  : 'border-line-2 bg-panel'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  {column.tech_id === 'unassigned'
                    ? <User size={14} className="text-muted" />
                    : <Wrench size={14} className="text-brand" />}
                  <h2 className="truncate text-sm font-semibold text-ink">{column.tech_name}</h2>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-muted">{column.count || 0}</span>
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
                      className={`cursor-grab rounded-instrument border border-line-2 bg-void p-3 active:cursor-grabbing ${
                        savingRoId === ro.id ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/ros/${ro.id}`)}
                          className="text-left text-sm font-semibold text-ink transition-colors hover:text-brand"
                        >
                          {ro.ro_number || 'RO'}
                        </button>
                        <StatusBadge status={ro.status} />
                      </div>
                      <div className="truncate text-xs text-muted">{ro.customer_name || 'Unknown customer'}</div>
                      <div className="truncate text-[11px] text-faint">{ro.vehicle || 'Vehicle not set'}</div>
                      {ro.estimated_delivery && (
                        <div className="mt-1 font-mono text-[11px] text-faint">
                          ETA: {new Date(ro.estimated_delivery).toLocaleDateString()}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-instrument border border-dashed border-line-2 p-6 text-center text-xs text-faint">
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
