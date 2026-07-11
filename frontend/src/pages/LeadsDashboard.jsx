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
    } catch {
      console.error('[LeadsDashboard] Failed to fetch leads')
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Users size={22} className="text-brand" />
          <h1 className="font-display text-2xl font-bold text-ink">Leads</h1>
          <span className="rounded-full bg-brand/10 px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-brand">
            {leads.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={fetchLeads}
            className="inline-flex items-center gap-2 rounded-instrument border border-line-2 bg-raised px-3 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-ink"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={exportCSV}
            disabled={leads.length === 0}
            className="inline-flex items-center gap-2 rounded-instrument bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted" role="status">Loading leads...</div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-instrument border border-line-2 bg-panel py-20 text-muted">
          <Users size={40} className="mb-3 opacity-40" />
          <p>No leads yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-instrument border border-line-2 bg-panel">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line-2 bg-void">
                <th className="px-4 py-3 font-semibold text-muted">Date</th>
                <th className="px-4 py-3 font-semibold text-muted">Name</th>
                <th className="px-4 py-3 font-semibold text-muted">Email</th>
                <th className="px-4 py-3 font-semibold text-muted">Phone</th>
                <th className="px-4 py-3 font-semibold text-muted">Business</th>
                <th className="px-4 py-3 font-semibold text-muted">Message</th>
                <th className="px-4 py-3 font-semibold text-muted">Source</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-line transition-colors hover:bg-raised">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-muted">{formatDate(lead.createdAt)}</td>
                  <td className="px-4 py-3 font-medium text-ink">{lead.name}</td>
                  <td className="px-4 py-3 text-brand">{lead.email}</td>
                  <td className="px-4 py-3 text-muted">{lead.phone || '—'}</td>
                  <td className="px-4 py-3 text-muted">{lead.businessName || '—'}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-muted">{lead.message || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
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
