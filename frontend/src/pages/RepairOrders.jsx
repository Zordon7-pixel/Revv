import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Shield, AlertTriangle, Trash2, ArrowUpRight } from 'lucide-react'
import api from '../lib/api'
import { isAdmin, isAssistant, isOwner } from '../lib/auth'
import AddROModal from '../components/AddROModal'
import { Money, StatusBadge } from '../components/ui'

export const STATUS_COLORS = {
  intake: 'var(--muted)', estimate: 'var(--brand)', approval: 'var(--brand)',
  parts: 'var(--brand)', repair: 'var(--brand)', paint: 'var(--brand)',
  qc: 'var(--brand)', delivery: 'var(--brand)', closed: 'var(--good)',
  total_loss: 'var(--crit)', siu_hold: 'var(--crit)',
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

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'completed', label: 'Complete' },
  { value: 'total_loss', label: 'Total loss' },
]

function promiseMeta(ro) {
  if (!ro.estimated_delivery) return { label: 'Not set', overdue: false }
  const promise = new Date(`${String(ro.estimated_delivery).slice(0, 10)}T12:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdue = promise < today && !['closed', 'completed', 'total_loss'].includes(String(ro.status || '').toLowerCase())
  return {
    label: promise.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    overdue,
  }
}

function paymentMeta(ro) {
  const normalized = String(ro.payment_status || '').trim().toLowerCase()
  if (ro.payment_received === 1 || ['paid', 'succeeded'].includes(normalized)) {
    return { label: 'Paid', className: 'border-good/30 bg-good/10 text-good' }
  }
  if (normalized === 'partial') {
    return { label: 'Partial', className: 'border-brand/30 bg-brand/10 text-brand-lit' }
  }
  return { label: 'Due', className: 'border-line-2 bg-raised text-muted' }
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
    } catch (error) {
      setRos([])
      setErrorToast(error?.response?.data?.error || 'Could not load repair orders')
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

  const allVisibleSelected = ros.length > 0 && ros.every((ro) => selected.has(ro.id))
  const loadedPaymentStatuses = useMemo(() => {
    return new Set(ros
      .map((ro) => String(ro.payment_status || '').trim().toLowerCase())
      .map((status) => status === 'paid' ? 'succeeded' : status)
      .filter(Boolean))
  }, [ros])
  const loadedJobTypes = useMemo(() => {
    return new Set(ros.map((ro) => String(ro.job_type || '').trim().toLowerCase()).filter(Boolean))
  }, [ros])
  const visiblePaymentStatuses = useMemo(() => {
    return PAYMENT_STATUSES.filter((paymentStatus) => (
      loadedPaymentStatuses.has(paymentStatus.value) || paymentStatus.value === filters.paymentStatus
    ))
  }, [filters.paymentStatus, loadedPaymentStatuses])
  const visibleJobTypes = useMemo(() => {
    return JOB_TYPES.filter((jobType) => loadedJobTypes.has(jobType) || jobType === filters.jobType)
  }, [filters.jobType, loadedJobTypes])
  const showJobTypeFilter = loadedJobTypes.size > 1 || filters.jobType !== 'all'

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

  function openNewRepairOrder() {
    const root = document?.documentElement
    const isTouchDevice = root?.dataset?.touch === 'true'
    const deviceMode = root?.dataset?.deviceMode || ''
    if (isTouchDevice || ['phone', 'tablet'].includes(deviceMode)) {
      navigate('/ros/new')
      return
    }
    setShowAdd(true)
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
          <h1 className="font-display text-xl font-bold text-ink">Repair Orders</h1>
          <p className="text-faint text-sm">{ros.length} total · {ros.filter((r) => r.status !== 'closed').length} active</p>
        </div>
        {!assistant && (
          <button type="button" onClick={openNewRepairOrder} className="flex items-center gap-2 rounded-instrument bg-gold px-4 py-2 text-sm font-semibold text-on-gold transition-colors hover:bg-gold-lit">
            <Plus size={16} /> New RO
          </button>
        )}
      </div>

      <div className="bg-panel border border-line-2 rounded-instrument p-3">
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Repair order status filters">
          {STATUS_FILTERS.map((filter) => {
            const active = filters.status === filter.value
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => updateFilter('status', filter.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-line bg-panel-2 text-muted hover:border-brand/50 hover:text-ink'
                }`}
              >
                {filter.label}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-8 gap-2">
          <div className="md:col-span-2 relative w-full">
            <Search size={14} className="absolute left-3 top-2.5 text-faint" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search RO#, customer, make, or model"
              className="w-full rounded-instrument border border-line-2 bg-void py-2 pl-9 pr-3 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
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
            className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="all">All Techs</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {showJobTypeFilter && (
            <select
              value={filters.jobType}
              onChange={(e) => updateFilter('job_type', e.target.value)}
              className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
            >
              <option value="all">All Job Types</option>
              {visibleJobTypes.map((jobType) => (
                <option key={jobType} value={jobType}>
                  {jobType.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          )}
          <select
            value={filters.paymentStatus}
            onChange={(e) => updateFilter('payment_status', e.target.value)}
            className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="all">All Payments</option>
            {visiblePaymentStatuses.map((paymentStatus) => (
              <option key={paymentStatus.value} value={paymentStatus.value}>
                {paymentStatus.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('date_from', e.target.value)}
            className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('date_to', e.target.value)}
            className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
          />
          <button
            onClick={clearFilters}
            className="w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink transition-colors hover:border-brand/60 md:col-span-6"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {ros.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-panel border border-line-2 rounded-instrument">
          <img src="/empty-ros.png" alt="No repair orders" className="w-40 h-40 opacity-80 object-contain" />
          <p className="text-muted text-sm font-medium">No repair orders match your filters.</p>
          <p className="text-faint text-xs">Try clearing filters or creating a new RO.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <table className="hidden w-full overflow-hidden rounded-instrument border border-line bg-panel xl:table">
            <thead className="bg-void border-b border-line-2">
              <tr className="text-left text-xs text-muted">
                {canBulk && !assistant && (
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all visible repair orders"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      className="accent-brand cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-3 py-2">RO #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Promise</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Pay</th>
                <th className="px-3 py-2 text-right"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {ros.map((ro) => {
                const promise = promiseMeta(ro)
                const payment = paymentMeta(ro)
                return (
                <tr key={ro.id} className="border-b border-line last:border-b-0 hover:bg-raised/60">
                  {canBulk && !assistant && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${ro.ro_number || 'repair order'}`}
                        checked={selected.has(ro.id)}
                        onChange={() => toggleSelect(ro.id)}
                        className="accent-brand cursor-pointer"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-brand-lit">
                    <div className="inline-flex items-center gap-1.5">
                      <span>{ro.ro_number || '—'}</span>
                      {hasInsuranceClaim(ro) && <Shield size={12} className="text-brand" />}
                      {hasOpenSupplement(ro) && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                          <AlertTriangle size={10} /> Supp
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm font-medium text-ink">{ro.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-sm text-muted">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={ro.status} claimStatus={ro.claim_status} /></td>
                  <td className={`px-3 py-2 font-mono text-xs tabular-nums ${promise.overdue ? 'font-semibold text-crit' : 'text-muted'}`}>
                    {promise.label}{promise.overdue ? ' overdue' : ''}
                  </td>
                  <td className="px-3 py-2 text-right text-sm text-ink"><Money cents={ro.amount_owed_cents ?? 0} /></td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${payment.className}`}>{payment.label}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      {!assistant && (
                        <button
                          onClick={() => deleteRO(ro)}
                          aria-label={`Delete ${ro.ro_number || 'repair order'}`}
                          className="inline-flex items-center justify-center rounded-instrument border border-crit/40 bg-crit/10 p-1.5 text-crit transition-colors hover:border-crit"
                          title="Delete RO"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => navigate(`/ros/${ro.id}`)}
                        className="inline-flex items-center gap-1 rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand-lit transition-colors hover:bg-brand/20"
                      >
                        View <ArrowUpRight size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>

          <div className="space-y-2 xl:hidden">
            {ros.map((ro) => {
              const promise = promiseMeta(ro)
              const payment = paymentMeta(ro)
              return (
              <div key={ro.id} className="bg-panel border border-line rounded-instrument p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {canBulk && !assistant && (
                      <label className="inline-flex items-center gap-2 text-xs text-muted mb-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${ro.ro_number || 'repair order'}`}
                          checked={selected.has(ro.id)}
                          onChange={() => toggleSelect(ro.id)}
                          className="accent-brand cursor-pointer"
                        />
                        Select
                      </label>
                    )}
                    <p className="font-mono text-brand-lit text-xs font-semibold flex items-center gap-1.5">
                      <span>{ro.ro_number || '—'}</span>
                      {hasInsuranceClaim(ro) && <Shield size={11} className="text-brand" />}
                    </p>
                    <p className="text-ink font-semibold text-sm">{ro.customer_name || '—'}</p>
                    <p className="text-muted text-xs">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ') || '—'}</p>
                    {hasOpenSupplement(ro) && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-gold">
                        <AlertTriangle size={10} /> Supplement {String(ro.supplement_status).toLowerCase()}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={ro.status} claimStatus={ro.claim_status} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                  <div><p className="text-faint">Promise</p><p className={`font-mono ${promise.overdue ? 'font-semibold text-crit' : 'text-ink'}`}>{promise.label}</p></div>
                  <div><p className="text-faint">Total</p><Money cents={ro.amount_owed_cents ?? 0} className="text-ink" /></div>
                  <div><p className="text-faint">Payment</p><span className={payment.className.split(' ').at(-1)}>{payment.label}</span></div>
                </div>
                <div className="mt-3">
                  <div className="flex gap-2">
                    {!assistant && (
                      <button
                        onClick={() => deleteRO(ro)}
                        aria-label={`Delete ${ro.ro_number || 'repair order'}`}
                        className="inline-flex w-11 items-center justify-center rounded-instrument border border-crit/40 bg-crit/10 text-xs font-semibold text-crit transition-colors hover:border-crit"
                        title="Delete RO"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/ros/${ro.id}`)}
                      className="flex-1 bg-brand hover:bg-brand-lit text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                    >
                      View
                    </button>
                  </div>
                </div>
              </div>
            )})}
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
        <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-instrument border border-brand/40 bg-panel px-3 py-2 shadow-xl md:w-auto md:min-w-[520px]">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="text-xs font-semibold text-ink md:text-sm">{selected.size} selected</div>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="flex-1 rounded-instrument border border-line-2 bg-void px-2.5 py-1.5 text-xs text-ink focus:border-brand focus:outline-none md:w-56 md:text-sm"
            >
              <option value="">Update Status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button
              disabled={!bulkStatus || bulkLoading}
              onClick={applyBulkStatus}
              className="bg-brand hover:bg-brand-lit disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs md:text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              {bulkLoading ? 'Updating...' : 'Apply'}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs md:text-sm text-muted hover:text-ink"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {successToast && (
        <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 rounded-instrument border border-good/40 bg-panel px-4 py-2 text-sm text-good shadow-lg">
          {successToast}
        </div>
      )}
      {errorToast && (
        <div role="alert" className="fixed bottom-4 right-4 z-50 rounded-instrument border border-crit/40 bg-panel px-4 py-2 text-sm text-crit shadow-lg">
          {errorToast}
        </div>
      )}
    </div>
  )
}
