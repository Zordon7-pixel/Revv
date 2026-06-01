import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, ArrowRight, BarChart3, Clock3, DollarSign, Gauge, PackageCheck, Percent, TrendingUp, Users } from 'lucide-react'
import api from '../lib/api'
import { STATUS_LABELS } from './RepairOrders'

function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function moneyFromCents(value) {
  return money(Number(value || 0) / 100)
}

function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function monthStartKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function KpiCard({ icon: Icon, label, value, sublabel, tone = 'text-white', to }) {
  const content = (
    <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 h-full hover:border-indigo-400/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-1">{label}</div>
          <div className={`text-2xl font-bold ${tone}`}>{value}</div>
        </div>
        <div className="w-9 h-9 rounded-lg bg-[#0f1117] border border-[#2a2d3e] flex items-center justify-center text-indigo-300">
          <Icon size={18} />
        </div>
      </div>
      {sublabel && <div className="text-xs text-slate-500 mt-2">{sublabel}</div>}
    </div>
  )

  if (!to) return content
  return <Link to={to} className="block h-full">{content}</Link>
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
  const identified = Number(supplementOpportunity?.total_supplement_opportunity || 0)
  const captured = Number(capture.captured_cents || 0) / 100
  const captureRate = identified > 0 ? (captured / identified) * 100 : 0
  const recentMargins = useMemo(() => (jobCosting?.rows || []).slice(0, 6).map((row) => {
    const revenue = Number(row.total || 0)
    const profit = Number(row.true_profit || 0)
    return {
      ...row,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      revenue,
      profit,
    }
  }), [jobCosting])
  const avgStageDays = useMemo(() => {
    const rows = ownerData?.cycle_time_by_stage || []
    if (!rows.length) return 0
    return rows.reduce((sum, row) => sum + Number(row.avg_days || 0), 0) / rows.length
  }, [ownerData])

  if (loading && !ownerData) {
    return <div className="flex items-center justify-center h-64 text-slate-500">Loading owner KPIs...</div>
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            <Gauge size={24} className="text-indigo-300" />
            Owner KPIs
          </h1>
          <p className="text-slate-500 text-sm mt-1">Shop health across cycle time, supplements, margin, and throughput.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <button onClick={load} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors">
            Apply
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Clock3} label="Avg Cycle Stage" value={`${avgStageDays.toFixed(1)}d`} sublabel="Average across logged stages" tone="text-sky-300" />
        <KpiCard icon={PackageCheck} label="Supplement Capture" value={pct(captureRate)} sublabel={`${money(identified)} identified / ${money(captured)} captured`} tone="text-amber-300" />
        <KpiCard icon={Percent} label="Avg RO Margin" value={pct(jobCosting?.avgMargin)} sublabel={`${money(jobCosting?.grossProfit)} gross profit`} tone="text-emerald-300" to="/job-costing" />
        <KpiCard icon={Users} label="Tech Throughput" value={ownerData?.tech_efficiency?.reduce((sum, tech) => sum + Number(tech.ros_advanced || 0), 0) || 0} sublabel="ROs advanced this month" tone="text-indigo-300" to="/performance" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Clock3 size={16} /> Cycle Time by Stage</h2>
            <span className="text-[11px] text-slate-500">Last 120 days</span>
          </div>
          <div className="space-y-3">
            {(ownerData?.cycle_time_by_stage || []).map((stage) => {
              const width = Math.min((Number(stage.avg_days || 0) / 10) * 100, 100)
              return (
                <div key={stage.stage}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{STATUS_LABELS[stage.stage] || stage.stage}</span>
                    <span className="text-white font-medium">{Number(stage.avg_days || 0).toFixed(2)}d <span className="text-slate-500">({stage.sample_count})</span></span>
                  </div>
                  <div className="h-2 bg-[#0f1117] rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500 rounded-full" style={{ width: `${width}%` }} />
                  </div>
                </div>
              )
            })}
            {(!ownerData?.cycle_time_by_stage || ownerData.cycle_time_by_stage.length === 0) && (
              <div className="text-sm text-slate-500 py-8 text-center">No status-log timing data yet.</div>
            )}
          </div>
        </section>

        <section className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2"><DollarSign size={16} /> Margin per RO</h2>
            <Link to="/job-costing" className="text-xs text-indigo-300 hover:text-indigo-200 flex items-center gap-1">Job costing <ArrowRight size={13} /></Link>
          </div>
          <div className="space-y-2">
            {recentMargins.map((row) => (
              <button key={row.id} onClick={() => navigate(`/ros/${row.id}`)} className="w-full flex items-center justify-between gap-3 border-b border-[#2a2d3e]/70 pb-2 text-left">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{row.ro_number || 'RO'} · {row.customer_name || 'Customer'}</div>
                  <div className="text-xs text-slate-500 truncate">{[row.year, row.make, row.model].filter(Boolean).join(' ') || row.status}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={row.margin >= 0 ? 'text-sm font-semibold text-emerald-300' : 'text-sm font-semibold text-red-300'}>{pct(row.margin)}</div>
                  <div className="text-xs text-slate-500">{money(row.profit)}</div>
                </div>
              </button>
            ))}
            {recentMargins.length === 0 && <div className="text-sm text-slate-500 py-8 text-center">No RO margin data for this range.</div>}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Activity size={16} /> Supplement Capture</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Identified opportunity</span><span className="text-amber-300 font-semibold">{money(identified)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Captured approved</span><span className="text-emerald-300 font-semibold">{moneyFromCents(capture.captured_cents)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Open requested/pending</span><span className="text-slate-200 font-semibold">{moneyFromCents(Number(capture.requested_cents || 0) - Number(capture.captured_cents || 0))}</span></div>
          </div>
        </section>

        <section className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2"><BarChart3 size={16} /> Carryover</h2>
            <Link to="/monthly-report" className="text-xs text-indigo-300 hover:text-indigo-200 flex items-center gap-1">Monthly report <ArrowRight size={13} /></Link>
          </div>
          <div className="text-3xl font-bold text-white">{carryover.length}</div>
          <div className="text-xs text-slate-500 mt-1">ROs pending revenue assignment</div>
          <button onClick={() => navigate('/dashboard')} className="mt-4 text-xs text-slate-300 hover:text-white flex items-center gap-1">
            Open dashboard carryover workflow <ArrowRight size={13} />
          </button>
        </section>

        <section className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2"><TrendingUp size={16} /> Turnaround Estimator</h2>
            <select value={jobType} onChange={(e) => setJobType(e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-2 py-1 text-xs text-white">
              <option value="collision">Collision</option>
              <option value="mechanical">Mechanical</option>
              <option value="pdr">PDR</option>
              <option value="detailing">Detailing</option>
              <option value="glass">Glass</option>
            </select>
          </div>
          <div className="text-2xl font-bold text-sky-300">
            {turnaround ? `${turnaround.minDays}-${turnaround.maxDays} days` : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {turnaround?.label ? `${turnaround.label} · ${turnaround.basedOnSamples || 0} samples` : 'Uses existing estimator output'}
          </div>
        </section>
      </div>
    </div>
  )
}
