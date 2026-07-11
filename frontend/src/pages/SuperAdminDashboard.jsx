import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, Clipboard, LayoutDashboard, LogOut, MessageSquare, Search, Send, UserCog } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const ISSUE_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'triaged', label: 'Triaged' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'ready_for_qa', label: 'Ready for QA' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'qa_passed', label: 'QA Passed' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'closed', label: 'Closed' },
  { value: 'wont_fix', label: "Won't Fix" },
]

const AGENTS = ['Codex', 'Claude Code', 'Hermes', 'Bryan', 'Linear']
const CLAUDE_QA_ELIGIBLE_STATUSES = new Set(['new', 'assigned', 'triaging', 'triaged'])

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function defaultAgentForIssue(issue) {
  if (issue.routed_to) return issue.routed_to
  if (['feature', 'idea', 'question'].includes(String(issue.category || '').toLowerCase())) return 'Hermes'
  return 'Codex'
}

function statusLabel(value) {
  return ISSUE_STATUSES.find((item) => item.value === value)?.label || value || 'New'
}

function statusClass(value) {
  const normalized = String(value || 'new').toLowerCase()
  if (['shipped', 'closed', 'wont_fix'].includes(normalized)) return 'border-line-2 bg-raised/40 text-muted'
  if (normalized === 'ready_for_qa') return 'border-brand/50 bg-brand/10 text-brand'
  if (normalized === 'qa_passed') return 'border-good/50 bg-good/10 text-good'
  if (normalized === 'fixed') return 'border-good/50 bg-good/10 text-good'
  if (['assigned', 'in_progress'].includes(normalized)) return 'border-brand/50 bg-brand/10 text-brand'
  if (normalized === 'triaged') return 'border-brand/50 bg-brand/10 text-brand'
  return 'border-crit/50 bg-crit/10 text-crit'
}

export default function SuperAdminDashboard() {
  const [ownerAccounts, setOwnerAccounts] = useState([])
  const [issues, setIssues] = useState([])
  const [summary, setSummary] = useState({
    total_issues: 0,
    total_errors: 0,
    total_feedback: 0,
    open_issues: 0,
    assigned_issues: 0,
    closed_issues: 0,
  })
  const [selectedShopId, setSelectedShopId] = useState('')
  const [issueFilter, setIssueFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('open')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [actionIssueId, setActionIssueId] = useState('')

  const token = localStorage.getItem('superadmin_token')
  const navigate = useNavigate()

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
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
        setOwnerAccounts(data.owner_accounts || [])
        setIssues(data.issues || [])
        setSummary({
          total_issues: data?.summary?.total_issues || 0,
          total_errors: data?.summary?.total_errors || 0,
          total_feedback: data?.summary?.total_feedback || 0,
          open_issues: data?.summary?.open_issues || 0,
          assigned_issues: data?.summary?.assigned_issues || 0,
          fixed_issues: data?.summary?.fixed_issues || 0,
          qa_passed_issues: data?.summary?.qa_passed_issues || 0,
          closed_issues: data?.summary?.closed_issues || 0,
        })
      } catch (err) {
        if (active) setError(err?.message || 'Unable to load master dashboard data.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadHelpdesk()
    return () => { active = false }
  }, [selectedShopId])

  const ownerAlerts = useMemo(
    () => ownerAccounts.filter((owner) => (owner.open_issue_count ?? ((owner.error_count || 0) + (owner.feedback_count || 0))) > 0),
    [ownerAccounts]
  )

  useEffect(() => {
    if (selectedShopId || !ownerAccounts.length) return
    const highestPriority = ownerAccounts.find((owner) => (owner.open_issue_count || owner.error_count || 0) > 0) || ownerAccounts[0]
    if (highestPriority?.shop_id) setSelectedShopId(highestPriority.shop_id)
  }, [ownerAccounts, selectedShopId])

  const filteredIssues = useMemo(() => {
    const query = search.trim().toLowerCase()
    return issues.filter((issue) => {
      if (issueFilter !== 'all' && issue.issue_type !== issueFilter) return false
      const status = String(issue.status || 'new').toLowerCase()
      if (statusFilter === 'open' && ['shipped', 'closed', 'wont_fix'].includes(status)) return false
      if (statusFilter === 'closed' && !['shipped', 'closed', 'wont_fix'].includes(status)) return false
      if (!['all', 'open', 'closed'].includes(statusFilter) && status !== statusFilter) return false
      if (!query) return true
      const haystack = [
        issue.shop_name,
        issue.message,
        issue.page,
        issue.category,
        issue.tester_name,
        issue.routed_to,
        issue.status,
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [issues, issueFilter, statusFilter, search])

  function logoutMaster() {
    localStorage.removeItem('superadmin_token')
    navigate('/superadmin/login')
  }

  async function updateIssue(issue, payload, successMessage) {
    setActionIssueId(issue.id)
    setError('')
    setNotice('')
    try {
      const data = await fetchJson(`/api/superadmin/feedback/${issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setIssues((prev) => prev.map((item) => (item.id === issue.id ? { ...item, ...data.issue } : item)))
      setNotice(successMessage || 'Issue updated.')
      return data
    } catch (err) {
      setError(err?.message || 'Could not update issue.')
      return null
    } finally {
      setActionIssueId('')
    }
  }

  async function copyText(text) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('Copy agent prompt', text)
    }
  }

  async function sendToAgent(issue) {
    const agent = defaultAgentForIssue(issue)
    const data = await updateIssue(issue, { routed_to: agent, status: 'assigned' }, `Issue assigned to ${agent}.`)
    if (data?.agent_prompt) await copyText(data.agent_prompt)
  }

  async function copyAgentPrompt(issue) {
    const data = await updateIssue(issue, {
      routed_to: defaultAgentForIssue(issue),
      status: issue.status || 'new',
      support_note: issue.support_note || '',
      linked_ref: issue.linked_ref || '',
    }, 'Agent prompt copied.')
    if (data?.agent_prompt) await copyText(data.agent_prompt)
  }

  return (
    <div className="min-h-screen bg-void text-ink">
      <div className="max-w-7xl mx-auto px-5 py-7">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-brand">Master Support Console</div>
            <h1 className="mt-1 font-display text-2xl font-bold">REVV Help Desk Dashboard</h1>
          </div>
          <button type="button" onClick={logoutMaster} className="inline-flex items-center justify-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-xs text-ink transition-colors hover:bg-raised">
            <LogOut size={14} />
            Sign Out
          </button>
        </div>

        <div className="mb-4 rounded-instrument border border-line bg-panel px-3 py-2">
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-brand">
            <LayoutDashboard size={14} />
            Dashboard
          </button>
        </div>

        {error && <div className="mb-4 rounded-lg border border-crit/40 bg-crit/10 p-3 text-sm text-crit" role="alert">{error}</div>}
        {notice && <div className="mb-4 rounded-lg border border-good/40 bg-good/10 p-3 text-sm text-good" role="status">{notice}</div>}

        <div className={`mb-4 rounded-instrument border p-3 ${ownerAlerts.length ? 'border-crit/50 bg-crit/10' : 'border-good/40 bg-good/10'}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BellRing size={14} className={ownerAlerts.length ? 'text-crit' : 'text-good'} />
            {ownerAlerts.length
              ? `${ownerAlerts.length} owner account${ownerAlerts.length === 1 ? '' : 's'} have open feedback`
              : 'No owner account alerts right now'}
          </div>
          {ownerAlerts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink">
              {ownerAlerts.slice(0, 6).map((owner) => (
                <button key={`alert-${owner.owner_id}`} type="button" onClick={() => setSelectedShopId(owner.shop_id)} className="rounded-md border border-crit/50 bg-crit/10 px-2.5 py-1 text-crit transition-colors hover:bg-crit/15">
                  {owner.owner_name || 'Owner'} - {owner.open_issue_count ?? ((owner.error_count || 0) + (owner.feedback_count || 0))} open
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-instrument border border-line bg-panel p-4">
            <div className="text-xs text-muted">Owner Accounts</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-ink">{ownerAccounts.length}</div>
          </div>
          <div className="rounded-instrument border border-line bg-panel p-4">
            <div className="text-xs text-muted">Open</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-crit">{summary.open_issues || 0}</div>
          </div>
          <div className="rounded-instrument border border-line bg-panel p-4">
            <div className="text-xs text-muted">Assigned</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-brand">{summary.assigned_issues || 0}</div>
          </div>
          <div className="rounded-instrument border border-line bg-panel p-4">
            <div className="text-xs text-muted">Closed</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-good">{summary.closed_issues || 0}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="overflow-hidden rounded-instrument border border-line bg-panel lg:col-span-1">
            <div className="border-b border-line px-4 py-3">
              <h2 className="inline-flex items-center gap-2 font-display text-sm font-semibold text-ink">
                <UserCog size={14} />
                Owner Accounts Only
              </h2>
            </div>
            <div className="max-h-[700px] overflow-y-auto">
              {ownerAccounts.map((owner) => (
                <button
                  key={owner.owner_id}
                  type="button"
                  onClick={() => setSelectedShopId(owner.shop_id)}
                  className={`w-full border-b border-line px-4 py-3 text-left transition-colors hover:bg-brand/5 ${selectedShopId === owner.shop_id ? 'bg-brand/10' : ''} ${((owner.open_issue_count ?? 0) > 0) ? 'border-l-2 border-l-crit bg-crit/5' : ''}`}
                >
                  <div className="font-medium flex items-center gap-2">
                    <span>{owner.owner_name || 'Owner'}</span>
                    {((owner.open_issue_count ?? 0) > 0) && (
                      <span className="rounded border border-crit/50 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-crit">Open</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{owner.owner_email || '-'}</div>
                  <div className="mt-1 text-xs text-faint">{owner.shop_name || '-'} - {owner.shop_city || '-'} / {owner.shop_state || '-'}</div>
                  <div className="mt-1 text-[11px] text-muted">
                    {owner.open_issue_count ?? 0} open - {owner.assigned_issue_count || 0} assigned - {owner.closed_issue_count || 0} closed
                  </div>
                </button>
              ))}
              {!ownerAccounts.length && !loading && <div className="px-4 py-5 text-sm text-faint">No owner accounts found.</div>}
            </div>
          </section>

          <section className="lg:col-span-2 space-y-4">
            <div className="overflow-hidden rounded-instrument border border-line bg-panel">
              <div className="border-b border-line px-4 py-3">
                <h2 className="inline-flex items-center gap-2 font-display text-sm font-semibold text-ink">
                  <AlertTriangle size={14} />
                  App Issues and Feedback
                </h2>
              </div>
              <div className="border-b border-line bg-panel-2 p-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div className="md:col-span-2 relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search issue message, page, tester, shop, agent..."
                      className="w-full rounded-lg border border-line-2 bg-void py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
                    />
                  </div>
                  <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)} className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink focus:border-brand focus:outline-none">
                    <option value="all">All Issue Types</option>
                    <option value="error">Errors Only</option>
                    <option value="feedback">Feedback Only</option>
                  </select>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink focus:border-brand focus:outline-none">
                    <option value="open">Open Statuses</option>
                    <option value="all">All Statuses</option>
                    {ISSUE_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                    <option value="closed">Closed + Won't Fix</option>
                  </select>
                </div>
              </div>

              <div className="max-h-[620px] overflow-y-auto">
                {loading && <div className="px-4 py-8 text-sm text-faint">Loading help desk feed...</div>}

                {!loading && filteredIssues.map((issue) => (
                  <div key={issue.id} className="space-y-3 border-b border-line px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full border px-2 py-0.5 ${issue.issue_type === 'error' ? 'border-crit/50 bg-crit/10 text-crit' : 'border-brand/50 bg-brand/10 text-brand'}`}>
                        {issue.issue_type === 'error' ? 'Error' : 'Feedback'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full border ${statusClass(issue.status)}`}>{statusLabel(issue.status || 'new')}</span>
                      {issue.status === 'shipped' ? (
                        <span className={`rounded-full border px-2 py-0.5 ${issue.linked_ref ? 'border-good/50 bg-good/10 text-good' : 'border-line-2 bg-raised/40 text-faint'}`}>
                          QA-PASS: {issue.linked_ref || '(no ref)'}
                        </span>
                      ) : null}
                      {issue.routed_to ? <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-brand">{issue.routed_to}</span> : null}
                      <span className="font-medium text-ink">{issue.shop_name || 'Unknown Shop'}</span>
                      <span className="text-faint">{formatDate(issue.created_at)}</span>
                    </div>

                    <div className="text-sm text-ink">{issue.message || 'No message provided.'}</div>
                    {issue.expected ? <div className="text-xs text-muted">Expected: {issue.expected}</div> : null}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
                      <span>Tester: {issue.tester_name || 'Anonymous'}</span>
                      <span>Category: {issue.category || 'general'}</span>
                      <span>Priority: {issue.priority || 'medium'}</span>
                      {issue.page ? <span>Page: {issue.page}</span> : null}
                      {issue.linked_ref ? <span>Fix: {issue.linked_ref}</span> : null}
                    </div>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <select
                        value={issue.routed_to || ''}
                        onChange={(e) => updateIssue(issue, { routed_to: e.target.value || null }, 'Agent updated.')}
                        disabled={actionIssueId === issue.id}
                        className="rounded-lg border border-line-2 bg-void px-2 py-2 text-xs text-ink focus:border-brand focus:outline-none"
                        aria-label={`Agent for issue ${issue.id}`}
                      >
                        <option value="">Unassigned</option>
                        {AGENTS.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                      </select>
                      <select
                        value={issue.status || 'new'}
                        onChange={(e) => updateIssue(issue, { status: e.target.value }, 'Status updated.')}
                        disabled={actionIssueId === issue.id}
                        className="rounded-lg border border-line-2 bg-void px-2 py-2 text-xs text-ink focus:border-brand focus:outline-none"
                        aria-label={`Status for issue ${issue.id}`}
                      >
                        {ISSUE_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                      </select>
                      <input
                        value={issue.linked_ref || ''}
                        onChange={(e) => setIssues((prev) => prev.map((item) => (item.id === issue.id ? { ...item, linked_ref: e.target.value } : item)))}
                        onBlur={() => updateIssue(issue, { linked_ref: issue.linked_ref || '' }, 'Linked reference saved.')}
                        placeholder="Commit, Linear, CLAUDE ref"
                        className="rounded-lg border border-line-2 bg-void px-2 py-2 text-xs text-ink placeholder:text-faint focus:border-brand focus:outline-none"
                        aria-label={`Linked fix for issue ${issue.id}`}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => sendToAgent(issue)} disabled={actionIssueId === issue.id} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
                          <Send size={12} /> Send
                        </button>
                        {CLAUDE_QA_ELIGIBLE_STATUSES.has(issue.status || 'new') ? (
                          <button
                            type="button"
                            onClick={() => updateIssue(issue, { status: 'ready_for_qa' }, 'Sent to Claude QA.')}
                            disabled={actionIssueId === issue.id}
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-brand/40 bg-brand/10 px-2 py-2 text-xs font-semibold text-brand transition-colors hover:bg-brand/15 disabled:opacity-50"
                            aria-label={`Send issue ${issue.id} to Claude QA`}
                          >
                            <Send size={12} /> Claude QA
                          </button>
                        ) : null}
                        <button type="button" onClick={() => copyAgentPrompt(issue)} disabled={actionIssueId === issue.id} className="inline-flex items-center justify-center rounded-lg border border-brand/40 bg-brand/10 px-2 py-2 text-brand transition-colors hover:bg-brand/15 disabled:opacity-50" aria-label={`Copy prompt for issue ${issue.id}`}>
                          <Clipboard size={13} />
                        </button>
                        <button type="button" onClick={() => updateIssue(issue, { status: 'closed' }, 'Issue closed.')} disabled={actionIssueId === issue.id} className="inline-flex items-center justify-center rounded-lg border border-good/50 bg-good/10 px-2 py-2 text-good transition-colors hover:bg-good/15 disabled:opacity-50" aria-label={`Close issue ${issue.id}`}>
                          <CheckCircle2 size={13} />
                        </button>
                      </div>
                    </div>

                    <textarea
                      value={issue.support_note || ''}
                      onChange={(e) => setIssues((prev) => prev.map((item) => (item.id === issue.id ? { ...item, support_note: e.target.value } : item)))}
                      onBlur={() => updateIssue(issue, { support_note: issue.support_note || '' }, 'Support note saved.')}
                      rows={2}
                      placeholder="Support note / agent handoff context..."
                      className="w-full resize-none rounded-lg border border-line-2 bg-void px-3 py-2 text-xs text-ink placeholder:text-faint focus:border-brand focus:outline-none"
                      aria-label={`Support note for issue ${issue.id}`}
                    />
                  </div>
                ))}

                {!loading && !filteredIssues.length && (
                  <div className="px-4 py-8 text-sm text-faint">
                    <MessageSquare size={14} className="inline mr-1.5 -mt-0.5" />
                    No issues found for current filters.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
