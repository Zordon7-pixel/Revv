import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Shield, TriangleAlert } from 'lucide-react'
import api from '../lib/api'
import { isAdmin, isOwner } from '../lib/auth'
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
  const [ros, setRos] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [techs, setTechs] = useState([])
  const [filters, setFilters] = useState({ search: '', status: 'all', tech: 'all' })
  const [selected, setSelected] = useState(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const navigate = useNavigate()
  const canBulk = isAdmin() || isOwner()

  const load = () => api.get('/ros').then((r) => setRos(r.data.ros || []))

  useEffect(() => {
    load()
    api.get('/users')
      .then((r) => setTechs((r.data.users || []).filter((u) => ['owner', 'admin', 'employee', 'staff'].includes(u.role))))
      .catch(() => setTechs([]))
  }, [])

  const techById = useMemo(() => Object.fromEntries(techs.map((t) => [t.id, t.name])), [techs])

  const filteredRos = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return ros.filter((ro) => {
      if (filters.status !== 'all' && ro.status !== filters.status) return false
      if (filters.tech !== 'all' && ro.assigned_to !== filters.tech) return false
      if (!q) return true
      const customer = String(ro.customer_name || '').toLowerCase()
      const roNum = String(ro.ro_number || '').toLowerCase()
      const vehicle = `${ro.year || ''} ${ro.make || ''} ${ro.model || ''}`.toLowerCase()
      return customer.includes(q) || roNum.includes(q) || vehicle.includes(q)
    })
  }, [ros, filters])

  function hasInsuranceClaim(ro) {
    return !!(ro.insurance_claim_number || ro.claim_number)
  }

  function hasOpenSupplement(ro) {
    return ['requested', 'pending'].includes(String(ro.supplement_status || '').toLowerCase())
  }

  function clearFilters() {
    setFilters({ search: '', status: 'all', tech: 'all' })
  }

  function toggleSelect(id) {
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (selected.size === ros.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(ros.map((r) => r.id)))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Repair Orders</h1>
          <p className="text-slate-500 text-sm">{ros.length} total · {ros.filter((r) => r.status !== 'delivery' && r.status !== 'closed').length} active</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          <Plus size={16} /> New RO
        </button>
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="md:col-span-2 relative w-full">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
            <input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Search customer, vehicle, or RO#"
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
          >
            <option value="all">All Statuses</option>
            <option value="intake">Intake</option>
            <option value="estimate">Estimate</option>
            <option value="approval">Approval</option>
            <option value="parts">Parts</option>
            <option value="repair">Repair</option>
            <option value="paint">Paint</option>
            <option value="qc">QC</option>
            <option value="delivery">Delivery</option>
          </select>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={filters.tech}
              onChange={(e) => setFilters((f) => ({ ...f, tech: e.target.value }))}
              className="w-full flex-1 bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
            >
              <option value="all">All Techs</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              onClick={clearFilters}
              className="w-full sm:w-auto bg-[#0f1117] border border-[#2a2d3e] hover:border-[#EAB308]/60 text-slate-300 text-sm px-3 py-2 rounded-lg"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {selected.size > 0 && canBulk && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-indigo-900/20 border border-indigo-700/40 rounded-xl">
          <input
            type="checkbox"
            checked={selected.size === ros.length && ros.length > 0}
            onChange={toggleAll}
            className="accent-indigo-500 cursor-pointer"
          />
          <span className="text-xs font-semibold text-indigo-300">{selected.size} selected</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            className="text-xs bg-[#0f1117] border border-[#2a2d3e] text-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500"
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
                load()
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
            className="text-xs text-slate-400 hover:text-white ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {filteredRos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl">
          <img src="/empty-ros.png" alt="No repair orders" className="w-40 h-40 opacity-80 object-contain" />
          <p className="text-slate-400 text-sm font-medium">No repair orders match your filters.</p>
          <p className="text-slate-600 text-xs">Try clearing filters or creating a new RO.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <table className="hidden md:table w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl overflow-hidden">
            <thead className="bg-[#0f1117] border-b border-[#2a2d3e]">
              <tr className="text-left text-xs text-slate-400">
                {canBulk && <th className="px-3 py-2 w-10"><input type="checkbox" checked={selected.size === ros.length && ros.length > 0} onChange={toggleAll} className="accent-indigo-500 cursor-pointer" /></th>}
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
                <tr key={ro.id} className="border-b border-[#2a2d3e] last:border-b-0 hover:bg-[#1e2235]">
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
                          <TriangleAlert size={10} /> Supp
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-white">{ro.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-sm text-slate-300">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={ro.status} /></td>
                  <td className="px-3 py-2 text-xs text-slate-400">{techById[ro.assigned_to] || 'Unassigned'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => navigate(`/ros/${ro.id}`)}
                      className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="md:hidden space-y-2">
            {filteredRos.map((ro) => (
              <div key={ro.id} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[#EAB308] text-xs font-bold flex items-center gap-1.5">
                      <span>{ro.ro_number || '—'}</span>
                      {hasInsuranceClaim(ro) && <Shield size={11} className="text-sky-400" />}
                    </p>
                    <p className="text-white font-semibold text-sm">{ro.customer_name || '—'}</p>
                    <p className="text-slate-400 text-xs">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || '—'}</p>
                    {hasOpenSupplement(ro) && (
                      <p className="text-yellow-300 text-[10px] mt-1 inline-flex items-center gap-1">
                        <TriangleAlert size={10} /> Supplement {String(ro.supplement_status).toLowerCase()}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={ro.status} />
                </div>
                <div className="mt-3">
                  <button
                    onClick={() => navigate(`/ros/${ro.id}`)}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && <AddROModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
    </div>
  )
}
