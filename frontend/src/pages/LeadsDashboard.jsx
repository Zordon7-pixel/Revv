import { useState, useEffect } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { Download, RefreshCw, Users } from 'lucide-react'

export default function LeadsDashboard() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)

  async function fetchLeads() {
    setLoading(true)
    try {
      const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'))
      const snap = await getDocs(q)
      setLeads(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
    } catch (err) {
      console.error('[LeadsDashboard] Error fetching leads:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLeads() }, [])

  function formatDate(ts) {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  function exportCSV() {
    const headers = ['Date', 'Name', 'Email', 'Phone', 'Business', 'Message', 'Source']
    const rows = leads.map((l) => [
      formatDate(l.createdAt),
      l.name || '',
      l.email || '',
      l.phone || '',
      l.businessName || '',
      (l.message || '').replace(/"/g, '""'),
      l.source || '',
    ])
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `revv-leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={22} className="text-indigo-400" />
          <h1 className="text-2xl font-bold text-slate-100">Leads</h1>
          <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-semibold text-indigo-300">
            {leads.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchLeads}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 transition hover:border-indigo-500 hover:text-white"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={exportCSV}
            disabled={leads.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">Loading leads...</div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Users size={40} className="mb-3 opacity-40" />
          <p>No leads yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700/60">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700/60 bg-slate-800/50">
                <th className="px-4 py-3 font-semibold text-slate-300">Date</th>
                <th className="px-4 py-3 font-semibold text-slate-300">Name</th>
                <th className="px-4 py-3 font-semibold text-slate-300">Email</th>
                <th className="px-4 py-3 font-semibold text-slate-300">Phone</th>
                <th className="px-4 py-3 font-semibold text-slate-300">Business</th>
                <th className="px-4 py-3 font-semibold text-slate-300">Message</th>
                <th className="px-4 py-3 font-semibold text-slate-300">Source</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-slate-700/30 hover:bg-slate-800/30 transition">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">{formatDate(lead.createdAt)}</td>
                  <td className="px-4 py-3 font-medium text-white">{lead.name}</td>
                  <td className="px-4 py-3 text-indigo-300">{lead.email}</td>
                  <td className="px-4 py-3 text-slate-400">{lead.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{lead.businessName || '—'}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-400">{lead.message || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300">
                      {lead.source || 'unknown'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
