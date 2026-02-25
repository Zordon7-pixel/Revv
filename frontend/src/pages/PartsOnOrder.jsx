import { useEffect, useState } from 'react'
import { ExternalLink, Package } from 'lucide-react'
import api from '../lib/api'

const STATUS_BADGES = {
  ordered: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  backordered: 'bg-red-900/40 text-red-300 border-red-700/50',
  received: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
}

export default function PartsOnOrder() {
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/parts/all-pending')
      .then((r) => setParts(r.data.parts || []))
      .catch((e) => setError(e?.response?.data?.error || 'Could not load parts on order'))
      .finally(() => setLoading(false))
  }, [])

  async function openTracking(part) {
    if (!part.tracking_number) return
    if (part.tracking_url) {
      window.open(part.tracking_url, '_blank', 'noopener,noreferrer')
      return
    }
    try {
      const { data } = await api.get(`/tracking/url?carrier=${part.carrier || ''}&num=${encodeURIComponent(part.tracking_number)}`)
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch {
      // no-op
    }
  }

  if (loading) return <div className="text-slate-400 text-sm">Loading parts on order...</div>
  if (error) return <div className="text-red-300 text-sm">{error}</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Parts On Order</h1>
        <p className="text-slate-500 text-sm">{parts.length} pending parts across open repair orders</p>
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-[#141824] text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-3 font-semibold">RO#</th>
                <th className="text-left px-3 py-3 font-semibold">Customer</th>
                <th className="text-left px-3 py-3 font-semibold">Vehicle</th>
                <th className="text-left px-3 py-3 font-semibold">Part Name</th>
                <th className="text-left px-3 py-3 font-semibold">Part#</th>
                <th className="text-left px-3 py-3 font-semibold">Vendor</th>
                <th className="text-left px-3 py-3 font-semibold">Status</th>
                <th className="text-left px-3 py-3 font-semibold">Expected Date</th>
                <th className="text-left px-3 py-3 font-semibold">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.id} className="border-t border-[#2a2d3e]">
                  <td className="px-3 py-3 text-[#EAB308] font-semibold">{part.ro_number || '—'}</td>
                  <td className="px-3 py-3 text-white">{part.customer_name || '—'}</td>
                  <td className="px-3 py-3 text-slate-300">{[part.year, part.make, part.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-3 text-white">{part.part_name || '—'}</td>
                  <td className="px-3 py-3 text-slate-300">{part.part_number || '—'}</td>
                  <td className="px-3 py-3 text-slate-300">{part.vendor || '—'}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-semibold ${STATUS_BADGES[part.status] || 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                      {part.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{part.expected_date || '—'}</td>
                  <td className="px-3 py-3">
                    {part.tracking_number ? (
                      <button
                        onClick={() => openTracking(part)}
                        className="inline-flex items-center gap-1 text-[#EAB308] hover:text-yellow-300 text-xs font-medium"
                      >
                        {part.tracking_number}
                        <ExternalLink size={12} />
                      </button>
                    ) : (
                      <span className="text-slate-500 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {parts.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-sm">
            <Package size={16} />
            No pending parts orders.
          </div>
        )}
      </div>
    </div>
  )
}
