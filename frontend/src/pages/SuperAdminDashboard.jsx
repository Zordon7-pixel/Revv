import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, LayoutDashboard, LogOut, MessageSquare, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function SuperAdminDashboard() {
  const [shops, setShops] = useState([])
  const [issues, setIssues] = useState([])
  const [summary, setSummary] = useState({ total_issues: 0, total_errors: 0, total_feedback: 0 })
  const [selectedShopId, setSelectedShopId] = useState('')
  const [issueFilter, setIssueFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const token = localStorage.getItem('superadmin_token')
  const navigate = useNavigate()

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error('Request failed')
    return res.json()
  }

  useEffect(() => {
    let active = true
    async function loadHelpdesk() {
      setLoading(true)
      setError('')
      try {
        const qs = selectedShopId ? `?shop_id=${encodeURIComponent(selectedShopId)}` : ''
        const data = await fetchJson(`/api/superadmin/helpdesk${qs}`)
        if (!active) return
        setShops(data.shops || [])
        setIssues(data.issues || [])
        setSummary({
          total_issues: data?.summary?.total_issues || 0,
          total_errors: data?.summary?.total_errors || 0,
          total_feedback: data?.summary?.total_feedback || 0,
        })
      } catch {
        if (active) setError('Unable to load help desk data.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadHelpdesk()
    return () => { active = false }
  }, [selectedShopId])

  const filteredIssues = useMemo(() => {
    const query = search.trim().toLowerCase()
    return issues.filter((issue) => {
      if (issueFilter !== 'all' && issue.issue_type !== issueFilter) return false
      if (!query) return true
      const haystack = [
        issue.shop_name,
        issue.message,
        issue.page,
        issue.category,
        issue.tester_name,
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [issues, issueFilter, search])

  function logoutMaster() {
    localStorage.removeItem('superadmin_token')
    navigate('/superadmin/login')
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-7xl mx-auto px-5 py-7">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-yellow-300">Master Support Console</div>
            <h1 className="text-2xl font-bold mt-1">REVV Help Desk Dashboard</h1>
          </div>
          <button
            type="button"
            onClick={logoutMaster}
            className="inline-flex items-center justify-center gap-2 text-xs bg-[#1a1d2e] hover:bg-[#23283f] border border-[#2a2d3e] px-3 py-2 rounded-lg text-slate-200"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>

        <div className="bg-[#141824] border border-[#242837] rounded-xl px-3 py-2 mb-4">
          <button
            type="button"
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-indigo-200 bg-indigo-600/20 border border-indigo-500/40 rounded-lg px-3 py-2"
          >
            <LayoutDashboard size={14} />
            Dashboard
          </button>
        </div>

        {error && (
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] text-red-300 text-sm rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-[#141824] border border-[#242837] rounded-xl p-4">
            <div className="text-xs text-slate-400">Registered Shops</div>
            <div className="text-2xl font-semibold text-white mt-1">{shops.length}</div>
          </div>
          <div className="bg-[#141824] border border-[#242837] rounded-xl p-4">
            <div className="text-xs text-slate-400">Issues</div>
            <div className="text-2xl font-semibold text-white mt-1">{summary.total_issues}</div>
          </div>
          <div className="bg-[#141824] border border-[#242837] rounded-xl p-4">
            <div className="text-xs text-slate-400">Errors</div>
            <div className="text-2xl font-semibold text-red-300 mt-1">{summary.total_errors}</div>
          </div>
          <div className="bg-[#141824] border border-[#242837] rounded-xl p-4">
            <div className="text-xs text-slate-400">Feedback</div>
            <div className="text-2xl font-semibold text-indigo-200 mt-1">{summary.total_feedback}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="lg:col-span-1 bg-[#141824] border border-[#242837] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#242837]">
              <h2 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
                <Building2 size={14} />
                Registered Shops
              </h2>
            </div>
            <div className="max-h-[620px] overflow-y-auto">
              <button
                type="button"
                onClick={() => setSelectedShopId('')}
                className={`w-full text-left px-4 py-3 border-b border-[#242837] hover:bg-[#1c2233] ${selectedShopId === '' ? 'bg-[#1c2233]' : ''}`}
              >
                <div className="font-medium">All Shops</div>
                <div className="text-xs text-slate-500 mt-0.5">Show issues across every shop</div>
              </button>
              {shops.map((shop) => (
                <button
                  key={shop.id}
                  type="button"
                  onClick={() => setSelectedShopId(shop.id)}
                  className={`w-full text-left px-4 py-3 border-b border-[#242837] hover:bg-[#1c2233] ${selectedShopId === shop.id ? 'bg-[#1c2233]' : ''}`}
                >
                  <div className="font-medium">{shop.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{shop.city || '—'} / {shop.state || '—'}</div>
                  <div className="text-[11px] mt-1 text-slate-400">
                    {shop.error_count || 0} errors • {shop.feedback_count || 0} feedback
                  </div>
                </button>
              ))}
              {!shops.length && !loading && (
                <div className="px-4 py-5 text-sm text-slate-500">No shops found.</div>
              )}
            </div>
          </section>

          <section className="lg:col-span-2 bg-[#141824] border border-[#242837] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#242837]">
              <h2 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
                <AlertTriangle size={14} />
                App Issues and Feedback
              </h2>
            </div>
            <div className="p-4 border-b border-[#242837] bg-[#10131d]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="md:col-span-2 relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search issue message, page, tester, or shop..."
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <select
                  value={issueFilter}
                  onChange={(e) => setIssueFilter(e.target.value)}
                  className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">All Issue Types</option>
                  <option value="error">Errors Only</option>
                  <option value="feedback">Feedback Only</option>
                </select>
              </div>
            </div>

            <div className="max-h-[560px] overflow-y-auto">
              {loading && (
                <div className="px-4 py-8 text-sm text-slate-500">Loading help desk feed...</div>
              )}

              {!loading && filteredIssues.map((issue) => (
                <div key={issue.id} className="px-4 py-3 border-b border-[#242837]">
                  <div className="flex flex-wrap items-center gap-2 text-xs mb-1.5">
                    <span className={`px-2 py-0.5 rounded-full border ${issue.issue_type === 'error' ? 'text-red-300 border-red-800 bg-red-950/40' : 'text-indigo-200 border-indigo-700 bg-indigo-900/30'}`}>
                      {issue.issue_type === 'error' ? 'Error' : 'Feedback'}
                    </span>
                    <span className="text-slate-300 font-medium">{issue.shop_name || 'Unknown Shop'}</span>
                    <span className="text-slate-500">{formatDate(issue.created_at)}</span>
                  </div>
                  <div className="text-sm text-slate-100">{issue.message || 'No message provided.'}</div>
                  <div className="text-[11px] text-slate-500 mt-1.5 flex flex-wrap items-center gap-2">
                    <span>Tester: {issue.tester_name || 'Anonymous'}</span>
                    <span>Category: {issue.category || 'general'}</span>
                    <span>Priority: {issue.priority || 'medium'}</span>
                    {issue.page ? <span>Page: {issue.page}</span> : null}
                  </div>
                </div>
              ))}

              {!loading && !filteredIssues.length && (
                <div className="px-4 py-8 text-sm text-slate-500">
                  <MessageSquare size={14} className="inline mr-1.5 -mt-0.5" />
                  No issues found for current filters.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
