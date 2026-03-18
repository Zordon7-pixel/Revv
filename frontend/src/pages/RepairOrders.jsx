import { useCallback, useEffect, useMemo, useState } from 'react'
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

const JOB_TYPES = [
  'collision',
  'paint',
  'detailing',
  'glass',
  'towing',
  'key_programming',
  'wheel_recon',
  'car_wrap',
]

const PAYMENT_STATUSES = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'pending', label: 'Payment Pending' },
  { value: 'requires_payment_method', label: 'Action Required' },
  { value: 'failed', label: 'Payment Failed' },
  { value: 'canceled', label: 'Payment Canceled' },
  { value: 'succeeded', label: 'Paid' },
]

export default function RepairOrders() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [ros, setRos] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [techs, setTechs] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '')
  const [successToast, setSuccessToast] = useState('')
  const [errorToast, setErrorToast] = useState('')
  const assistant = isAssistant()
  const canBulk = isAdmin() || isOwner()

  const filters = useMemo(() => ({
    search: searchParams.get('search') || '',
    status: searchParams.get('status') || 'all',
    techId: searchParams.get('tech_id') || 'all',
    jobType: searchParams.get('job_type') || searchParams.get('type') || 'all',
    paymentStatus: searchParams.get('payment_status') || 'all',
    dateFrom: searchParams.get('date_from') || '',
    dateTo: searchParams.get('date_to') || '',
  }), [searchParams])

  const apiParams = useMemo(() => {
    const params = {}
    if (filters.search.trim()) params.search = filters.search.trim()
    if (filters.status !== 'all') params.status = filters.status
    if (filters.techId !== 'all') params.tech_id = filters.techId
    if (filters.jobType !== 'all') params.job_type = filters.jobType
    if (filters.paymentStatus !== 'all') params.payment_status = filters.paymentStatus
    if (filters.dateFrom) params.date_from = filters.dateFrom
    if (filters.dateTo) params.date_to = filters.dateTo
    return params
  }, [filters])

  useEffect(() => {
    api.get('/users')
      .then((r) => setTechs((r.data.users || []).filter((u) => ['owner', 'admin', 'employee', 'staff'].includes(u.role))))
      .catch(() => setTechs([]))
  }, [])

  const loadRos = useCallback(async () => {
    try {
      const r = await api.get('/repair-orders', { params: apiParams })
      setRos(r.data.ros || [])
    } catch (_) {
      setRos([])
    }
  }, [apiParams])

  useEffect(() => {
    loadRos()
  }, [loadRos])

  useEffect(() => {
    setSearchInput(filters.search)
  }, [filters.search])

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      if (searchInput.trim()) {
        next.set('search', searchInput)
      } else {
        next.delete('search')
      }
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, searchParams, setSearchParams])

  useEffect(() => {
    if (!errorToast) return undefined
    const t = setTimeout(() => setErrorToast(''), 3500)
    return () => clearTimeout(t)
  }, [errorToast])

  useEffect(() => {
    if (!successToast) return undefined
    const t = setTimeout(() => setSuccessToast(''), 3500)
    return () => clearTimeout(t)
  }, [successToast])

  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev
      const validIds = new Set(ros.map((ro) => ro.id))
      const next = new Set([...prev].filter((id) => validIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [ros])

  const techById = useMemo(() => Object.fromEntries(techs.map((t) => [t.id, t.name])), [techs])
  const allVisibleSelected = ros.length > 0 && ros.every((ro) => selected.has(ro.id))

  function hasInsuranceClaim(ro) {
    return !!(ro.insurance_claim_number || ro.claim_number)
  }

  function hasOpenSupplement(ro) {
    return ['requested', 'pending'].includes(String(ro.supplement_status || '').toLowerCase())
  }

  function clearFilters() {
    setSearchInput('')
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
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set()
      return new Set(ros.map((ro) => ro.id))
    })
  }

  async function applyBulkStatus() {
    if (!bulkStatus || selected.size === 0) return
    setBulkLoading(true)
    try {
      const { data } = await api.post('/repair-orders/bulk-status', {
        ids: [...selected],
        new_status: bulkStatus,
      })
      await loadRos()
      setSelected(new Set())
      setBulkStatus('')
      setSuccessToast(`Updated ${Number(data?.updated || 0)} repair order(s).`)
    } catch (e) {
      setErrorToast(e?.response?.data?.error || 'Bulk update failed')
    } finally {
      setBulkLoading(false)
    }
  }

  async function deleteRO(ro) {
    const roNumber = ro.ro_number || 'this RO'
    if (!window.confirm(`Delete ${roNumber}? This cannot be undone.`)) return
    try {
      await api.delete(`/ros/${ro.id}`)
      setRos((prev) => prev.filter((item) => item.id !== ro.id))
    } catch (e) {
      setErrorToast(e?.response?.data?.error || 'Could not delete RO')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Repair Orders</h1>
          <p className="text-slate-500 text-sm">{ros.length} total · {ros.filter((r) => r.status !== 'delivery' && r.status !== 'closed').length} active</p>
        </div>
        {!assistant && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <Plus size={16} /> New RO
          </button>
        )}
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
        <div className="grid grid-cols-1 md:grid-cols-8 gap-2">
          <div className="md:col-span-2 relative w-full">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search RO#, customer, make, or model"
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="in-progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="closed">Closed</option>
          </select>
          <select
            value={filters.techId}
            onChange={(e) => updateFilter('tech_id', e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
          >
            <option value="all">All Techs</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select
            value={filters.jobType}
            onChange={(e) => updateFilter('job_type', e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
          >
            <option value="all">All Job Types</option>
            {JOB_TYPES.map((jobType) => (
              <option key={jobType} value={jobType}>
                {jobType.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <select
            value={filters.paymentStatus}
            onChange={(e) => updateFilter('payment_status', e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
          >
            <option value="all">All Payments</option>
            {PAYMENT_STATUSES.map((paymentStatus) => (
              <option key={paymentStatus.value} value={paymentStatus.value}>
                {paymentStatus.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('date_from', e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('date_to', e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
          />
          <button
            onClick={clearFilters}
            className="w-full md:col-span-6 bg-[#0f1117] border border-[#2a2d3e] hover:border-[#EAB308]/60 text-slate-300 text-sm px-3 py-2 rounded-lg"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {ros.length === 0 ? (
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
                {canBulk && !assistant && (
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      className="accent-indigo-500 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-3 py-2">RO #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Assigned</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {ros.map((ro) => (
                <tr key={ro.id} className="border-b border-[#2a2d3e] last:border-b-0 hover:bg-[#1e2235]">
                  {canBulk && !assistant && (
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
                  <td className="px-3 py-2 text-sm text-white">{ro.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-sm text-slate-300">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={ro.status} /></td>
                  <td className="px-3 py-2 text-xs text-slate-400">{techById[ro.assigned_to] || 'Unassigned'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      {!assistant && (
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
            {ros.map((ro) => (
              <div key={ro.id} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {canBulk && !assistant && (
                      <label className="inline-flex items-center gap-2 text-xs text-slate-400 mb-2">
                        <input
                          type="checkbox"
                          checked={selected.has(ro.id)}
                          onChange={() => toggleSelect(ro.id)}
                          className="accent-indigo-500 cursor-pointer"
                        />
                        Select
                      </label>
                    )}
                    <p className="text-[#EAB308] text-xs font-bold flex items-center gap-1.5">
                      <span>{ro.ro_number || '—'}</span>
                      {hasInsuranceClaim(ro) && <Shield size={11} className="text-sky-400" />}
                    </p>
                    <p className="text-white font-semibold text-sm">{ro.customer_name || '—'}</p>
                    <p className="text-slate-400 text-xs">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || '—'}</p>
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
                    {!assistant && (
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

      {showAdd && !assistant && (
        <AddROModal
          onClose={() => setShowAdd(false)}
          onSaved={async () => {
            setShowAdd(false)
            await loadRos()
          }}
        />
      )}
      {selected.size > 0 && canBulk && !assistant && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] md:w-auto md:min-w-[520px] bg-[#121427] border border-indigo-500/40 rounded-xl shadow-xl px-3 py-2">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="text-xs md:text-sm text-white font-semibold">{selected.size} selected</div>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="flex-1 md:w-56 bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-2.5 py-1.5 text-xs md:text-sm text-white focus:outline-none focus:border-indigo-400"
            >
              <option value="">Update Status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button
              disabled={!bulkStatus || bulkLoading}
              onClick={applyBulkStatus}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs md:text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              {bulkLoading ? 'Updating...' : 'Apply'}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs md:text-sm text-slate-400 hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {successToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-emerald-900/90 border border-emerald-600/60 text-emerald-100 text-sm px-4 py-2 rounded-lg shadow-lg">
          {successToast}
        </div>
      )}
      {errorToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-900/90 border border-red-600/60 text-red-100 text-sm px-4 py-2 rounded-lg shadow-lg">
          {errorToast}
        </div>
      )}
    </div>
  )
}
