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
  if (status === 'converted') return 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40'
  if (status === 'contacted') return 'bg-blue-900/30 text-blue-300 border-blue-700/40'
  return 'bg-amber-900/30 text-amber-300 border-amber-700/40'
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
          <h1 className="text-xl font-semibold text-white">Estimate Requests</h1>
          <p className="text-sm text-slate-400">Incoming public estimate leads from customers</p>
        </div>
        <button
          onClick={() => loadRequests(statusFilter)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:border-blue-500"
        >
          <RefreshCcw size={14} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              statusFilter === status
                ? 'bg-blue-600 text-white'
                : 'border border-slate-700 bg-slate-800 text-slate-300 hover:border-blue-500'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        {loading ? (
          <div className="flex h-44 items-center justify-center gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading requests...
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-300">{error}</div>
        ) : requests.length === 0 ? (
          <div className="flex h-44 items-center justify-center text-slate-500">{emptyLabel}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/70 text-slate-400">
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
                  <tr key={row.id} className="border-t border-slate-700 text-slate-200 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{row.name}</div>
                      <div className="text-xs text-slate-400">{row.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5">
                        <Phone size={13} className="text-blue-400" />
                        {row.phone}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5">
                        <Car size={13} className="text-blue-400" />
                        {formatVehicle(row)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="capitalize">{row.damage_type}</div>
                      {row.preferred_date && <div className="text-xs text-slate-400 mt-1">Drop-off: {row.preferred_date}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2 py-1 text-xs capitalize ${statusPill(row.status)}`}>
                          {row.status}
                        </span>
                        <select
                          value={row.status}
                          disabled={updatingId === row.id}
                          onChange={(e) => updateStatus(row.id, e.target.value)}
                          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
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
        )}
      </div>
    </div>
  )
}
