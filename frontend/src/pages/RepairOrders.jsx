import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Shield, AlertTriangle, Trash2 } from 'lucide-react'
import api from '../lib/api'
import { isAdmin, isAssistant, isOwner } from '../lib/auth'
import AddROModal from '../components/AddROModal'
import StatusBadge from '../components/StatusBadge'

export const STATUS_COLORS = {
  intake: '#64748b', estimate: '#3b82f6', approval: '#eab308',
  parts: '#f97316', repair: '#22c55e', paint: '#a855f7',
  qc: '#06b6d4', delivery: '#10b981', closed: '#374151',
  total_loss: '#dc2626', siu_hold: '#7c3aed'
}
export const STATUS_LABELS = {
  intake: 'Intake', estimate: 'Estimate', approval: 'Approval',
  parts: 'Parts', repair: 'Repair', paint: 'Paint',
  qc: 'QC Check', delivery: 'Delivery', closed: 'Closed',
  total_loss: 'Total Loss', siu_hold: 'SIU Hold'
}
export default function RepairOrders() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [ros, setRos] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [techs, setTechs] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [errorToast, setErrorToast] = useState('')
  const assistant = isAssistant()
  const canBulk = isAdmin() || isOwner()

  const filters = useMemo(() => ({
    search: searchParams.get('search') || '',
    status: searchParams.get('status') || 'all',
    type: searchParams.get('type') || 'all',
    tech: searchParams.get('assigned_to') || 'all',
    dateFrom: searchParams.get('date_from') || '',
    dateTo: searchParams.get('date_to') || '',
  }), [searchParams])

  const apiParams = useMemo(() => {
    const params = {}
    if (filters.search.trim()) params.search = filters.search.trim()
    if (filters.status !== 'all') params.status = filters.status
    if (filters.type !== 'all') params.type = filters.type
    if (filters.tech !== 'all') params.assigned_to = filters.tech
    if (filters.dateFrom) params.date_from = filters.dateFrom
    if (filters.dateTo) params.date_to = filters.dateTo
    return params
  }, [filters])

  useEffect(() => {
    api.get('/users')
      .then((r) => setTechs((r.data.users || []).filter((u) => ['owner', 'admin', 'employee', 'staff'].includes(u.role))))
      .catch(() => setTechs([]))
  }, [])

  useEffect(() => {
    api.get('/ros', { params: apiParams })
      .then((r) => setRos(r.data.ros || []))
      .catch(() => setRos([]))
  }, [apiParams])

  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => ros.some((ro) => ro.id === id))))
  }, [ros])

  useEffect(() => {
    if (!errorToast) return undefined
    const t = setTimeout(() => setErrorToast(''), 3500)
    return () => clearTimeout(t)
  }, [errorToast])

  const techById = useMemo(() => Object.fromEntries(techs.map((t) => [t.id, t.name])), [techs])
  const filteredRos = ros

  function hasInsuranceClaim(ro) {
    return !!(ro.insurance_claim_number || ro.claim_number)
  }

  function hasOpenSupplement(ro) {
    return ['requested', 'pending'].includes(String(ro.supplement_status || '').toLowerCase())
  }

  function clearFilters() {
    setSearchParams({})
  }

  function updateFilter(key, value) {
    const next = new URLSearchParams(searchParams)
    if (!value || value === 'all') {
      next.delete(key)
    } else {
      next.set(key, value)
    }
    setSearchParams(next)
  }

  function toggleSelect(id) {
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (selected.size === filteredRos.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredRos.map((r) => r.id)))
    }
  }

  function canDeleteRO(ro) {
    return !assistant
  }

  const panel = 'bg-white border border-slate-200 dark:bg-[#1a1d2e] dark:border-[#2a2d3e]'
  const input = 'w-full bg-slate-50 dark:bg-[#0f1117] border border-slate-300 dark:border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#EAB308]'

  async function deleteRO(ro) {
    const roNumber = ro.ro_number || 'this RO'
    if (!window.confirm(`Delete ${roNumber}? This cannot be undone.`)) return
    try {
      await api.delete(`/ros/${ro.id}`)
      setRos((prev) => prev.filter((item) => item.id !== ro.id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(ro.id)
        return next
      })
    } catch (e) {
      setErrorToast(e?.response?.data?.error || 'Could not delete RO')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Repair Orders</h1>
          <p className="text-slate-500 text-sm">{ros.length} total · {ros.filter((r) => r.status !== 'delivery' && r.status !== 'closed').length} active</p>
        </div>
        {!assistant && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <Plus size={16} /> New RO
          </button>
        )}
      </div>

          <div className="md:col-span-2 relative w-full">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
            <input
              value={filters.search}
            />
          </div>
          <select
            value={filters.status}
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="in-progress">In Progress</option>
            <option value="ready">Ready</option>
            <option value="delivery">Delivery</option>
            <option value="closed">Closed</option>
          </select>
          <select
          >
            <option value="all">All Job Types</option>
            <option value="collision">Collision</option>
            <option value="mechanical">Mechanical</option>
            <option value="body">Body</option>
            <option value="paint">Paint</option>
            <option value="adas">ADAS</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {selected.size > 0 && canBulk && !assistant && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-indigo-900/20 border border-indigo-700/40 rounded-xl">
          <input
            type="checkbox"
            checked={selected.size === filteredRos.length && filteredRos.length > 0}
            onChange={toggleAll}
            className="accent-indigo-500 cursor-pointer"
          />
          <span className="text-xs font-semibold text-indigo-300">{selected.size} selected</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-[#0f1117] border border-slate-300 dark:border-[#2a2d3e] text-slate-900 dark:text-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Change status to...</option>
            <option value="intake">Intake</option>
            <option value="estimate">Estimate</option>
            <option value="approval">Approval</option>
            <option value="in-progress">In Progress</option>
            <option value="parts-hold">Parts Hold</option>
            <option value="qc">QC</option>
            <option value="ready">Ready</option>
            <option value="closed">Closed</option>
          </select>
          <button
            disabled={!bulkStatus || bulkLoading}
            onClick={async () => {
              if (!bulkStatus) return
              setBulkLoading(true)
              try {
                await api.patch('/ros/bulk', { ids: [...selected], status: bulkStatus })
                setSelected(new Set())
                setBulkStatus('')
                api.get('/ros', { params: apiParams }).then((r) => setRos(r.data.ros || []))
              } catch (e) {
                console.error('Bulk update failed', e)
              }
              setBulkLoading(false)
            }}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            {bulkLoading ? 'Updating...' : 'Apply'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {filteredRos.length === 0 ? (
        <div className={`flex flex-col items-center justify-center py-16 gap-4 ${panel} rounded-xl`}>
          <img src="/empty-ros.png" alt="No repair orders" className="w-40 h-40 opacity-80 object-contain" />
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">No repair orders match your filters.</p>
          <p className="text-slate-500 dark:text-slate-600 text-xs">Try clearing filters or creating a new RO.</p>
        </div>
      ) : (
        <div className="space-y-3">
                <th className="px-3 py-2">RO #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Assigned</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRos.map((ro) => (
                <tr key={ro.id} className="border-b border-slate-200 dark:border-[#2a2d3e] last:border-b-0 hover:bg-slate-100 dark:hover:bg-[#1e2235]">
                  {canBulk && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(ro.id)}
                        onChange={() => toggleSelect(ro.id)}
                        className="accent-indigo-500 cursor-pointer"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 text-xs font-bold text-[#EAB308]">
                    <div className="inline-flex items-center gap-1.5">
                      <span>{ro.ro_number || '—'}</span>
                      {hasInsuranceClaim(ro) && <Shield size={12} className="text-sky-400" />}
                      {hasOpenSupplement(ro) && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-900/40 border border-yellow-700/40 text-yellow-300 text-[10px] font-semibold">
                          <AlertTriangle size={10} /> Supp
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-900 dark:text-white">{ro.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={ro.status} /></td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{techById[ro.assigned_to] || 'Unassigned'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      {canDeleteRO(ro) && (
                        <button
                          onClick={() => deleteRO(ro)}
                          className="inline-flex items-center justify-center bg-red-900/30 border border-red-600/40 hover:border-red-500 text-red-300 p-1.5 rounded-lg transition-colors"
                          title="Delete RO"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => navigate(`/ros/${ro.id}`)}
                        className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="md:hidden space-y-2">
            {filteredRos.map((ro) => (
              <div key={ro.id} className={`${panel} rounded-xl p-3`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[#EAB308] text-xs font-bold flex items-center gap-1.5">
                      <span>{ro.ro_number || '—'}</span>
                      {hasInsuranceClaim(ro) && <Shield size={11} className="text-sky-400" />}
                    </p>
                    <p className="text-slate-900 dark:text-white font-semibold text-sm">{ro.customer_name || '—'}</p>
                    <p className="text-slate-500 dark:text-slate-400 text-xs">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || '—'}</p>
                    {hasOpenSupplement(ro) && (
                      <p className="text-yellow-300 text-[10px] mt-1 inline-flex items-center gap-1">
                        <AlertTriangle size={10} /> Supplement {String(ro.supplement_status).toLowerCase()}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={ro.status} />
                </div>
                <div className="mt-3">
                  <div className="flex gap-2">
                    {canDeleteRO(ro) && (
                      <button
                        onClick={() => deleteRO(ro)}
                        className="w-11 inline-flex items-center justify-center bg-red-900/30 border border-red-600/40 hover:border-red-500 text-red-300 text-xs font-semibold rounded-lg transition-colors"
                        title="Delete RO"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/ros/${ro.id}`)}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                    >
                      View
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && !assistant && <AddROModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
      {errorToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-900/90 border border-red-600/60 text-red-100 text-sm px-4 py-2 rounded-lg shadow-lg">
          {errorToast}
        </div>
      )}
    </div>
  )
}
