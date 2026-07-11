import { useEffect, useMemo, useState } from 'react'
import { Car, Loader2, Phone, RefreshCcw } from 'lucide-react'
import api from '../lib/api'

const STATUSES = ['pending', 'contacted', 'converted']

function formatVehicle(row) {
  return [row.year, row.make, row.model].filter(Boolean).join(' ')
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function statusPill(status) {
  if (status === 'converted') return 'border-good/40 bg-good/10 text-good'
  if (status === 'contacted') return 'border-brand/40 bg-brand/10 text-brand'
  return 'border-line-2 bg-raised text-muted'
}

export default function EstimateRequests() {
  const [statusFilter, setStatusFilter] = useState('pending')
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState('')

  async function loadRequests(status = statusFilter) {
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/estimate-requests?status=${encodeURIComponent(status)}`)
      setRequests(res.data?.requests || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load estimate requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests(statusFilter)
  }, [statusFilter])

  async function updateStatus(id, status) {
    setUpdatingId(id)
    try {
      await api.patch(`/estimate-requests/${id}/status`, { status })
      setRequests((prev) => prev.map((req) => (req.id === id ? { ...req, status } : req)))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update status')
    } finally {
      setUpdatingId('')
    }
  }

  const emptyLabel = useMemo(() => {
    if (statusFilter === 'contacted') return 'No contacted leads yet.'
    if (statusFilter === 'converted') return 'No converted leads yet.'
    return 'No pending estimate requests.'
  }, [statusFilter])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Estimate Requests</h1>
          <p className="text-sm text-muted">Incoming public estimate leads from customers</p>
        </div>
        <button
          type="button"
          onClick={() => loadRequests(statusFilter)}
          className="inline-flex items-center gap-2 rounded-instrument border border-line-2 bg-raised px-3 py-2 text-sm text-ink transition-colors hover:border-brand"
        >
          <RefreshCcw size={14} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              statusFilter === status
                ? 'bg-brand text-white'
                : 'border border-line-2 bg-raised text-muted hover:border-brand hover:text-ink'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-instrument border border-line-2 bg-panel">
        {loading ? (
          <div className="flex h-44 items-center justify-center gap-2 text-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading requests...
          </div>
        ) : error ? (
          <div role="alert" className="p-4 text-sm text-crit">{error}</div>
        ) : requests.length === 0 ? (
          <div className="flex h-44 items-center justify-center text-faint">{emptyLabel}</div>
        ) : (
          <>
            <div className="divide-y divide-line-2 md:hidden">
              {requests.map((row) => (
                <article key={row.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{row.name}</p>
                      <p className="truncate text-xs text-muted">{row.email}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-xs capitalize ${statusPill(row.status)}`}>
                      {row.status}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-faint">Phone</dt>
                      <dd className="mt-0.5 text-ink">{row.phone}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Vehicle</dt>
                      <dd className="mt-0.5 text-ink">{formatVehicle(row)}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Damage</dt>
                      <dd className="mt-0.5 capitalize text-ink">{row.damage_type}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Received</dt>
                      <dd className="mt-0.5 font-mono text-ink">{formatDate(row.created_at)}</dd>
                    </div>
                  </dl>
                  {row.preferred_date && (
                    <p className="text-xs text-muted">Preferred drop-off: <span className="font-mono text-ink">{row.preferred_date}</span></p>
                  )}
                  <label className="block text-xs text-faint">
                    Update status
                    <select
                      aria-label={`Change status for ${row.name}`}
                      value={row.status}
                      disabled={updatingId === row.id}
                      onChange={(e) => updateStatus(row.id, e.target.value)}
                      className="mt-1 w-full rounded-instrument border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                    >
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-void text-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Vehicle</th>
                  <th className="px-4 py-3 text-left font-medium">Damage</th>
                  <th className="px-4 py-3 text-left font-medium">Date Received</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((row) => (
                  <tr key={row.id} className="border-t border-line-2 align-top text-ink">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{row.name}</div>
                      <div className="text-xs text-muted">{row.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5">
                        <Phone size={13} className="text-brand" />
                        {row.phone}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5">
                        <Car size={13} className="text-brand" />
                        {formatVehicle(row)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="capitalize">{row.damage_type}</div>
                      {row.preferred_date && <div className="mt-1 text-xs text-muted">Drop-off: {row.preferred_date}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2 py-1 text-xs capitalize ${statusPill(row.status)}`}>
                          {row.status}
                        </span>
                        <select
                          value={row.status}
                          disabled={updatingId === row.id}
                          onChange={(e) => updateStatus(row.id, e.target.value)}
                          className="rounded-md border border-line-2 bg-void px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                        >
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
