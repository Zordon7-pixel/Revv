import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, ArrowRight, Clock3, Gauge } from 'lucide-react'
import api from '../lib/api'
import { formatTurnaroundRange } from '../components/TurnaroundEstimator'
import {
  dollarsToCents,
  EmptyState,
  Money,
  PageHeader,
  Panel,
  StatInstrument,
  StatusBadge,
} from '../components/ui'

function percent(value) {
  const numeric = Number(value ?? 0)
  return `${Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0'}%`
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function monthStartKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function daysAgoKey(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function formatDate(value) {
  if (!value) return ''
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateRange(start, end) {
  const formattedStart = formatDate(start)
  const formattedEnd = formatDate(end)
  if (!formattedStart && !formattedEnd) return ''
  if (formattedStart === formattedEnd) return formattedStart
  return [formattedStart, formattedEnd].filter(Boolean).join(' - ')
}

function KpiLink({ to, children }) {
  return to ? <Link to={to} className="block h-full">{children}</Link> : children
}

export default function OwnerKpis() {
  const navigate = useNavigate()
  const [from, setFrom] = useState(monthStartKey())
  const [to, setTo] = useState(todayKey())
  const [jobType, setJobType] = useState('collision')
  const [ownerData, setOwnerData] = useState(null)
  const [supplementOpportunity, setSupplementOpportunity] = useState(null)
  const [jobCosting, setJobCosting] = useState(null)
  const [carryover, setCarryover] = useState([])
  const [turnaround, setTurnaround] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [ownerRes, supplementRes, jobCostRes, carryoverRes, turnaroundRes] = await Promise.all([
        api.get('/dashboard/owner-kpis'),
        api.get('/dashboard/supplements/monthly-opportunity'),
        api.get('/ros/job-cost/summary', { params: { from, to } }),
        api.get('/ros/carryover-pending').catch(() => ({ data: { ros: [] } })),
        api.get('/ros/turnaround-estimate', { params: { job_type: jobType } }).catch(() => ({ data: null })),
      ])
      setOwnerData(ownerRes.data || {})
      setSupplementOpportunity(supplementRes.data || {})
      setJobCosting(jobCostRes.data || {})
      setCarryover(carryoverRes.data?.ros || [])
      setTurnaround(turnaroundRes.data || null)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load owner KPIs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [jobType])

  const capture = ownerData?.supplement_capture || {}
  const identifiedDollars = Number(supplementOpportunity?.total_supplement_opportunity || 0)
  const captureRate = capture.capture_rate ?? 0
  const cycleTimePeriod = `Last 120 days (${formatDateRange(daysAgoKey(120), todayKey())})`
  const monthToDatePeriod = `Month to date (${formatDateRange(monthStartKey(), todayKey())})`
  const selectedPeriod = formatDateRange(from, to)
  const turnaroundPeriod = 'Last 90 days of closed ROs'
  const recentMargins = useMemo(() => (jobCosting?.rows || []).slice(0, 6).map((row) => {
    const revenue = Number(row.total || 0)
    const profit = Number(row.true_profit || 0)
    return { ...row, margin: revenue > 0 ? (profit / revenue) * 100 : 0, revenue, profit }
  }), [jobCosting])
  const averageStageDays = useMemo(() => {
    const rows = ownerData?.cycle_time_by_stage || []
    if (!rows.length) return 0
    return rows.reduce((sum, row) => sum + Number(row.avg_days || 0), 0) / rows.length
  }, [ownerData])

  const headerActions = (
    <>
      <label className="text-xs text-muted">From<input aria-label="Owner KPI from date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="ml-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-brand" /></label>
      <label className="text-xs text-muted">To<input aria-label="Owner KPI to date" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="ml-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-brand" /></label>
      <button type="button" onClick={load} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit">Apply</button>
    </>
  )

  if (loading && !ownerData) {
    return <Panel><div className="grid min-h-64 place-items-center text-sm text-muted" role="status">Loading owner KPIs...</div></Panel>
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader eyebrow="Insights" title="Owner KPIs" description="Shop health across cycle time, supplements, margin, and throughput." actions={headerActions} />

      {error && <div className="rounded-instrument border border-crit/30 bg-crit/10 p-4 text-sm text-crit" role="alert">{error}</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatInstrument label="Average cycle stage" value={<span className="font-mono tabular-nums">{averageStageDays.toFixed(1)}d</span>} detail={cycleTimePeriod} />
        <StatInstrument label="Supplement capture" value={<span className="font-mono tabular-nums text-gold" data-testid="supplement-capture-rate-value">{percent(captureRate)}</span>} detail={<><Money cents={dollarsToCents(identifiedDollars)} /> identified / <Money cents={capture.captured_cents || 0} /> captured</>} tone="gold" />
        <KpiLink to="/job-costing"><StatInstrument label="Average RO margin" value={<span className="font-mono tabular-nums text-good">{percent(jobCosting?.avgMargin)}</span>} detail={<><Money cents={dollarsToCents(jobCosting?.grossProfit)} /> gross profit</>} tone="good" /></KpiLink>
        <KpiLink to="/performance"><StatInstrument label="Tech throughput" value={<span className="font-mono tabular-nums">{ownerData?.tech_efficiency?.reduce((sum, tech) => sum + Number(tech.ros_advanced || 0), 0) || 0}</span>} detail={monthToDatePeriod} /></KpiLink>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Cycle time by stage" description={cycleTimePeriod}>
          {(ownerData?.cycle_time_by_stage || []).length ? (
            <div className="space-y-4 p-4">
              {ownerData.cycle_time_by_stage.map((stage) => {
                const width = Math.min((Number(stage.avg_days || 0) / 10) * 100, 100)
                return (
                  <div key={stage.stage}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs"><StatusBadge status={stage.stage} /><span className="font-mono tabular-nums text-ink">{Number(stage.avg_days || 0).toFixed(2)}d <span className="text-faint">({stage.sample_count})</span></span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-brand" style={{ width: `${width}%` }} /></div>
                  </div>
                )
              })}
            </div>
          ) : <EmptyState icon={Clock3} title="No cycle-time data" description="Timing appears after repair orders move through logged stages." />}
        </Panel>

        <Panel title="Margin per RO" description={selectedPeriod} actions={<Link to="/job-costing" className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-lit">Job costing <ArrowRight size={13} /></Link>}>
          {recentMargins.length ? (
            <div className="divide-y divide-line px-4">
              {recentMargins.map((row) => (
                <button key={row.id} type="button" onClick={() => navigate(`/ros/${row.id}`)} className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-panel-2">
                  <div className="min-w-0"><p className="truncate text-sm text-ink">{row.ro_number || 'RO'} - {row.customer_name || 'Customer'}</p><p className="truncate text-xs text-muted">{[row.year, row.make, row.model].filter(Boolean).join(' ') || row.status}</p></div>
                  <div className="shrink-0 text-right"><p className={`font-mono text-sm font-semibold tabular-nums ${row.margin >= 0 ? 'text-good' : 'text-crit'}`}>{percent(row.margin)}</p><Money cents={dollarsToCents(row.profit)} className="text-xs text-muted" /></div>
                </button>
              ))}
            </div>
          ) : <EmptyState icon={Gauge} title="No margin data" description="No repair-order margins were returned for this date range." />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Supplement capture" description={monthToDatePeriod}>
          <dl className="divide-y divide-line px-4 text-sm">
            <div className="flex items-center justify-between gap-3 py-3"><dt className="text-muted">Identified opportunity</dt><dd><Money cents={dollarsToCents(identifiedDollars)} className="font-semibold text-gold" /></dd></div>
            <div className="flex items-center justify-between gap-3 py-3"><dt className="text-muted">Captured approved</dt><dd><Money cents={capture.captured_cents || 0} className="font-semibold text-good" /></dd></div>
            <div className="flex items-center justify-between gap-3 py-3"><dt className="text-muted">Open requested/pending</dt><dd><Money cents={Number(capture.requested_cents || 0) - Number(capture.captured_cents || 0)} className="font-semibold text-gold" /></dd></div>
          </dl>
        </Panel>

        <Panel title="Carryover" actions={<Link to="/monthly-report" className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-lit">Monthly report <ArrowRight size={13} /></Link>}>
          <button type="button" onClick={() => navigate('/dashboard')} className="w-full p-4 text-left transition-colors hover:bg-panel-2">
            <span className="font-display text-3xl font-semibold text-ink">{carryover.length}</span>
            <span className="mt-1 block text-xs text-muted">Current carryover queue</span>
            <span className="mt-4 inline-flex items-center gap-1 text-xs text-brand">Open dashboard workflow <ArrowRight size={13} /></span>
          </button>
        </Panel>

        <Panel title="Turnaround estimator" description={turnaroundPeriod} actions={(
          <select aria-label="Turnaround job type" value={jobType} onChange={(event) => setJobType(event.target.value)} className="rounded-lg border border-line-2 bg-void px-2 py-1 text-xs text-ink outline-none focus:border-brand">
            <option value="collision">Collision</option><option value="mechanical">Mechanical</option><option value="pdr">PDR</option><option value="detailing">Detailing</option><option value="glass">Glass</option>
          </select>
        )}>
          <div className="p-4">
            <p className="font-display text-2xl font-semibold text-brand">{formatTurnaroundRange(turnaround)}</p>
            <p className="mt-2 text-xs text-muted">{turnaround?.label ? `${turnaround.label} - ${turnaround.basedOnSamples || 0} samples` : 'Uses existing estimator output'}</p>
          </div>
        </Panel>
      </div>

      <p className="flex items-center gap-2 text-xs text-faint"><Activity size={14} /> Owner KPIs use the shop's existing reporting endpoints.</p>
    </div>
  )
}
