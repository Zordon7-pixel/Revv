import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, DollarSign, CheckCircle, TrendingUp, Hand, AlertCircle, CalendarDays, ChevronRight, Radar, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import Chart from 'chart.js/auto'
import api from '../lib/api'
import { isAdmin } from '../lib/auth'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'
import StatusBadge from '../components/StatusBadge'
import CarryoverModal from '../components/CarryoverModal'

function useCountUp(target, duration = 1000) {
  const [count, setCount] = React.useState(0)
  React.useEffect(() => {
    if (!target) return
    let start = 0
    const step = target / (duration / 16)
    const timer = setInterval(() => {
      start += step
      if (start >= target) {
        setCount(target)
        clearInterval(timer)
      } else setCount(Math.floor(start))
    }, 16)
    return () => clearInterval(timer)
  }, [target, duration])
  return count
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [weekly, setWeekly] = useState(null)
  const [goal, setGoal] = useState(null)
  const [pendingCarryover, setPendingCarryover] = useState([])
  const [pendingAppointments, setPendingAppointments] = useState(0)
  const [adasQueue, setAdasQueue] = useState([])
  const [showCarryoverModal, setShowCarryoverModal] = useState(false)
  const weeklyChartRef = useRef(null)
  const weeklyChartInstanceRef = useRef(null)
  const navigate = useNavigate()

  const yearMonth = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })()

  async function loadDashboardData() {
    const [summaryRes, carryoverRes, appointmentsRes, goalsRes, adasRes, weeklyRes] = await Promise.all([
      api.get('/reports/summary'),
      api.get('/ros/carryover-pending').catch(() => ({ data: { ros: [] } })),
      api.get('/appointments').catch(() => ({ data: { requests: [] } })),
      api.get(`/goals/${yearMonth}`).catch(() => ({ data: { goal: null } })),
      api.get('/adas/queue').catch(() => ({ data: { queue: [] } })),
      api.get('/dashboard/weekly').catch(() => ({ data: null })),
    ])
    setData(summaryRes.data)
    setPendingCarryover(carryoverRes.data?.ros || [])
    setPendingAppointments(appointmentsRes.data?.requests?.length || 0)
    setGoal(goalsRes.data?.goal || null)
    setAdasQueue(adasRes.data?.queue || [])
    setWeekly(weeklyRes.data || null)
  }

  useEffect(() => {
    loadDashboardData().catch(err => console.error('Failed to load dashboard:', err))
  }, [])

  const admin = isAdmin()
  const hour = new Date().getHours()
  const nowLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const greetingText = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const displayActive = useCountUp(data?.active || 0)
  const displayCompleted = useCountUp(data?.completed || 0)
  const displayRevenue = useCountUp(data?.revenue || 0)
  const displayProfit = useCountUp(data?.profit || 0)
  const revenueGoal = Number(goal?.revenue_goal || 0)
  const roGoal = Number(goal?.ro_goal || 0)
  const revenueProgress = revenueGoal > 0 ? Math.min((data?.revenue || 0) / revenueGoal, 1) * 100 : 0
  const roProgress = roGoal > 0 ? Math.min((data?.total || 0) / roGoal, 1) * 100 : 0
  const weeklyTrendDirection = weekly?.ro_opened?.trend_direction || 'flat'
  const weeklyTrendPercent = Number(weekly?.ro_opened?.trend_percent || 0)

  useEffect(() => {
    if (!weekly?.chart || !weeklyChartRef.current) return undefined
    if (weeklyChartInstanceRef.current) {
      weeklyChartInstanceRef.current.destroy()
      weeklyChartInstanceRef.current = null
    }

    weeklyChartInstanceRef.current = new Chart(weeklyChartRef.current, {
      type: 'bar',
      data: {
        labels: weekly.chart.labels || [],
        datasets: [{
          label: 'ROs Opened',
          data: weekly.chart.data || [],
          backgroundColor: ['rgba(99, 102, 241, 0.85)', 'rgba(14, 165, 233, 0.85)'],
          borderRadius: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#cbd5e1' },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: '#94a3b8', precision: 0 },
            grid: { color: 'rgba(148, 163, 184, 0.15)' },
          },
          x: {
            ticks: { color: '#94a3b8' },
            grid: { display: false },
          },
        },
      },
    })

    return () => {
      if (weeklyChartInstanceRef.current) {
        weeklyChartInstanceRef.current.destroy()
        weeklyChartInstanceRef.current = null
      }
    }
  }, [weekly])

  const stats = [
    {
      label: 'Active Jobs',
      value: displayActive,
      icon: ClipboardList,
      color: 'text-indigo-300',
      accent: 'bg-indigo-500',
      card: 'bg-gradient-to-br from-indigo-900/40 to-[#1a1d2e]'
    },
    {
      label: 'Completed',
      value: displayCompleted,
      icon: CheckCircle,
      color: 'text-emerald-300',
      accent: 'bg-emerald-500',
      card: 'bg-gradient-to-br from-slate-800/60 to-[#1a1d2e]'
    },
    ...(admin ? [
      {
        label: 'Total Revenue',
        value: `$${displayRevenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
        icon: DollarSign,
        color: 'text-emerald-300',
        accent: 'bg-emerald-500',
        card: 'bg-gradient-to-br from-emerald-900/40 to-[#1a1d2e]'
      },
      {
        label: 'True Profit',
        value: `$${displayProfit.toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
        icon: TrendingUp,
        color: 'text-amber-300',
        accent: 'bg-amber-500',
        card: 'bg-gradient-to-br from-amber-900/40 to-[#1a1d2e]'
      },
    ] : []),
  ]

  if (!data) return <div className="flex items-center justify-center h-64 text-slate-500">Loading your shop data...</div>

  return (
    <div className="space-y-6">
      <div>
        <p className="text-slate-400 text-sm font-medium mb-1 flex items-center gap-1.5">{greetingText} <Hand size={14} /></p>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm text-slate-300">
          <CalendarDays size={15} className="text-indigo-300" />
          Current Period: <span className="text-white font-semibold">{nowLabel}</span>
        </div>
        {admin && (
          <button
            onClick={() => navigate('/monthly-report')}
            className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200 transition-colors"
          >
            View Report
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {goal && (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Monthly Goals</h2>
            <button
              onClick={() => navigate('/settings')}
              className="text-xs text-indigo-300 hover:text-indigo-200"
            >
              Edit Goals
            </button>
          </div>

          <div>
            <div className="text-xs text-slate-300 mb-1">
              Revenue: ${(data?.revenue || 0).toLocaleString()} / ${revenueGoal.toLocaleString()} - {Math.round(revenueProgress)}%
            </div>
            <div className="h-2 bg-[#0f1117] rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${revenueProgress}%` }} />
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-300 mb-1">
              RO Count: {(data?.total || 0).toLocaleString()} / {roGoal.toLocaleString()} - {Math.round(roProgress)}%
            </div>
            <div className="h-2 bg-[#0f1117] rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${roProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className={`${s.card} rounded-xl p-4 border border-[#2a2d3e] shadow-sm`}>
            <div className={`h-1.5 w-10 rounded-full ${s.accent} mb-3 opacity-90`} />
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-400">{s.label}</div>
              <s.icon size={18} className={s.color} />
            </div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {weekly && (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Weekly</h2>
            <span className="text-xs text-slate-400">This week vs last week</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">ROs Opened</div>
              <div className="text-2xl font-bold text-white">{weekly.ro_opened?.this_week || 0}</div>
              <div className="mt-1 inline-flex items-center gap-1 text-xs">
                {weeklyTrendDirection === 'up' && <ArrowUpRight size={14} className="text-emerald-300" />}
                {weeklyTrendDirection === 'down' && <ArrowDownRight size={14} className="text-rose-300" />}
                {weeklyTrendDirection === 'flat' && <Minus size={14} className="text-slate-300" />}
                <span className={weeklyTrendDirection === 'down' ? 'text-rose-300' : weeklyTrendDirection === 'up' ? 'text-emerald-300' : 'text-slate-300'}>
                  {weeklyTrendPercent > 0 ? '+' : ''}{weeklyTrendPercent}% vs last week ({weekly.ro_opened?.last_week || 0})
                </span>
              </div>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Revenue Collected</div>
              <div className="text-2xl font-bold text-emerald-300">
                ${(Number(weekly.revenue_collected_this_week || 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs text-slate-500 mt-1">Paid invoices this week</div>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 md:col-span-2">
              <div className="text-xs text-slate-400 mb-2">Top Techs by Jobs Completed</div>
              {weekly.top_techs?.length ? (
                <div className="space-y-2">
                  {weekly.top_techs.map((tech, idx) => (
                    <div key={tech.tech_id} className="flex items-center justify-between text-sm">
                      <span className="text-white">{idx + 1}. {tech.tech_name}</span>
                      <span className="text-indigo-300 font-semibold">{tech.jobs_completed}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500">No completed jobs yet this week.</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-400">RO Opened Trend</div>
                <div className="text-xs text-slate-500">This week vs last 7 days</div>
              </div>
              <div className="h-48">
                <canvas ref={weeklyChartRef} />
              </div>
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
              <div className="text-xs text-slate-400 mb-1">Pending Parts</div>
              <div className="text-3xl font-bold text-amber-300">{weekly.pending_parts_count || 0}</div>
              <div className="text-xs text-slate-500 mt-1">ROs with parts ordered or awaiting</div>
            </div>
          </div>
        </div>
      )}

      {pendingCarryover.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm text-amber-200">
            <AlertCircle size={16} />
            {pendingCarryover.length} job(s) carried over from last month. Assign revenue period.
          </div>
          <button
            onClick={() => setShowCarryoverModal(true)}
            className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-100 text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
          >
            Review Now
          </button>
        </div>
      )}

      {admin && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-cyan-200 inline-flex items-center gap-1.5">
              <Radar size={14} /> ADAS Calibration Queue
            </h2>
            <p className="text-slate-300 text-xs mt-1">
              {adasQueue.length} vehicle{adasQueue.length === 1 ? '' : 's'} need post-repair calibration.
            </p>
          </div>
          <button
            onClick={() => navigate('/adas')}
            className="text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-100 border border-cyan-500/30 font-semibold px-3 py-1.5 rounded-lg"
          >
            Open Tracker
          </button>
        </div>
      )}

      {admin && (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Appointment Requests</h2>
            <p className="text-slate-400 text-xs mt-1">{pendingAppointments} pending request{pendingAppointments === 1 ? '' : 's'}</p>
          </div>
          <button
            onClick={() => navigate('/book')}
            className="text-xs bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold px-3 py-1.5 rounded-lg"
          >
            Open Booking Form
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="font-semibold text-sm text-white mb-3">Jobs by Stage</h2>
          <div className="space-y-2">
            {['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery'].map(s => {
              const found = data.byStatus?.find(x => x.status === s)
              const count = found?.count || 0
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0`} style={{ background: STATUS_COLORS[s] }} />
                  <span className="text-xs text-slate-400 w-20 capitalize">{STATUS_LABELS[s]}</span>
                  <div className="flex-1 bg-[#0f1117] rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min((count / (data.total || 1)) * 100, 100)}%`, background: STATUS_COLORS[s] }} />
                  </div>
                  <span className="text-xs text-slate-400 w-4 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="font-semibold text-sm text-white mb-3">Recent Activity</h2>
          <div className="space-y-2">
            {data.recent?.slice(0, 6).map(ro => (
              <div key={ro.id} onClick={() => navigate(`/ros/${ro.id}`)}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#2a2d3e] cursor-pointer transition-colors">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[ro.status] }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white truncate">{ro.ro_number} — {ro.year} {ro.make} {ro.model}</div>
                  <div className="text-[10px] text-slate-500">{ro.customer_name}</div>
                </div>
                <StatusBadge status={ro.status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCarryoverModal && (
        <CarryoverModal
          ros={pendingCarryover}
          onClose={() => setShowCarryoverModal(false)}
          onDone={async () => {
            setShowCarryoverModal(false)
            await loadDashboardData()
          }}
        />
      )}
    </div>
  )
}
