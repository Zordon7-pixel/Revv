import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, DollarSign, CheckCircle, TrendingUp, Hand, AlertCircle, CalendarDays, ChevronRight, Radar, ArrowUpRight, ArrowDownRight, Minus, ChevronLeft, Truck } from 'lucide-react'
import api from '../lib/api'
import { getRole, getTokenPayload, isAdmin } from '../lib/auth'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'
import StatusBadge from '../components/StatusBadge'
import CarryoverModal from '../components/CarryoverModal'

function useCountUp(target, duration = 1000) {
  const [count, setCount] = React.useState(0)
  React.useEffect(() => {
    const safeTarget = Number(target) || 0
    if (safeTarget <= 0) {
      setCount(0)
      return
    }
    let start = 0
    const step = safeTarget / (duration / 16)
    const timer = setInterval(() => {
      start += step
      if (start >= safeTarget) {
        setCount(safeTarget)
        clearInterval(timer)
      } else setCount(Math.floor(start))
    }, 16)
    return () => clearInterval(timer)
  }, [target, duration])
  return count
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toDateKey(value) {
  if (!value) return ''
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const asText = String(value).trim()
  const isoMatch = asText.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) return isoMatch[1]
  const parsed = new Date(asText)
  if (Number.isNaN(parsed.getTime())) return ''
  return toDateKey(parsed)
}

function toDateLabel(dateKey) {
  if (!dateKey) return ''
  const parsed = new Date(`${dateKey}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateKey
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fromDateKey(dateKey) {
  if (!dateKey) return null
  const parsed = new Date(`${dateKey}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function isSameMonthYear(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function clampDayToMonth(monthDate, preferredDay = 1) {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const monthLastDay = new Date(year, month + 1, 0).getDate()
  const safeDay = Math.max(1, Math.min(preferredDay, monthLastDay))
  return new Date(year, month, safeDay)
}

function toYearMonthKey(value) {
  if (!value) return ''
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function fromYearMonthKey(yearMonthKey) {
  const match = String(yearMonthKey || '').trim().match(/^(\d{4})-(\d{2})$/)
  if (!match) {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  return new Date(year, monthIndex, 1)
}

function shiftYearMonthKey(yearMonthKey, offset) {
  const base = fromYearMonthKey(yearMonthKey)
  return toYearMonthKey(new Date(base.getFullYear(), base.getMonth() + offset, 1))
}

function isDeliveredStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  return normalized === 'delivery' || normalized === 'closed'
}

function normalizeRoStatus(status) {
  return String(status || '').trim().toLowerCase() || 'intake'
}

function isClosedRoStatus(status) {
  const normalized = normalizeRoStatus(status)
  return normalized === 'closed' || normalized === 'completed'
}

function countFromStatusBuckets(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  return safeRows.reduce((acc, row) => {
    const count = Number(row?.count || 0)
    if (!Number.isFinite(count) || count <= 0) return acc
    if (isClosedRoStatus(row?.status)) acc.completed += count
    else acc.active += count
    return acc
  }, { active: 0, completed: 0 })
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [techData, setTechData] = useState(null)
  const [weekly, setWeekly] = useState(null)
  const [goal, setGoal] = useState(null)
  const [pendingCarryover, setPendingCarryover] = useState([])
  const [pendingAppointments, setPendingAppointments] = useState(0)
  const [adasQueue, setAdasQueue] = useState([])
  const [showCarryoverModal, setShowCarryoverModal] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [techLoadError, setTechLoadError] = useState(false)
  const [calendarRos, setCalendarRos] = useState([])
  const [calendarMonthKey, setCalendarMonthKey] = useState(() => toYearMonthKey(new Date()))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => toDateKey(new Date()))
  const [calendarSavingKey, setCalendarSavingKey] = useState('')
  const [calendarError, setCalendarError] = useState('')
  const weeklyChartRef = useRef(null)
  const weeklyChartInstanceRef = useRef(null)
  const navigate = useNavigate()
  const admin = isAdmin()
  const role = getRole()
  const currentUser = getTokenPayload()
  const isTechAccount = !admin && ['employee', 'staff', 'technician'].includes(role || '')

  const yearMonth = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })()

  async function loadDashboardData() {
    const [summaryRes, monthSummaryRes, carryoverRes, appointmentsRes, goalsRes, adasRes, weeklyRes, rosRes] = await Promise.all([
      api.get('/reports/summary?scope=all').catch((err) => { console.error('[Dashboard] /reports/summary?scope=all failed:', err?.response?.status, err?.response?.data?.error || err?.message); return { data: {} } }),
      api.get('/reports/summary').catch((err) => { console.error('[Dashboard] /reports/summary failed:', err?.response?.status, err?.response?.data?.error || err?.message); return { data: {} } }),
      api.get('/ros/carryover-pending').catch(() => ({ data: { ros: [] } })),
      api.get('/appointments').catch(() => ({ data: { requests: [] } })),
      api.get(`/goals/${yearMonth}`).catch(() => ({ data: { goal: null } })),
      api.get('/adas/queue').catch(() => ({ data: { queue: [] } })),
      api.get('/dashboard/weekly').catch(() => ({ data: null })),
      api.get('/repair-orders').catch((err) => { console.error('[Dashboard] /repair-orders failed:', err?.response?.status, err?.response?.data?.error || err?.message); return { data: { ros: [] } } }),
    ])
    const allRos = Array.isArray(rosRes?.data?.ros) ? rosRes.data.ros : []
    // Derive active/completed directly from the RO list — most reliable single source.
    // Fall back to summary API only when the RO list fetch failed (allRos is empty).
    const activeFromRos = allRos.filter((ro) => !isClosedRoStatus(ro.status)).length
    const completedFromRos = allRos.filter((ro) => isClosedRoStatus(ro.status)).length
    const summaryActive = Number(summaryRes?.data?.active ?? 0)
    const summaryCompleted = Number(summaryRes?.data?.completed ?? 0)
    const summaryStatusCounts = countFromStatusBuckets(summaryRes?.data?.byStatus)
    const resolvedActive = allRos.length > 0
      ? activeFromRos
      : (summaryActive > 0 || summaryCompleted > 0 ? summaryActive : summaryStatusCounts.active)
    const resolvedCompleted = allRos.length > 0
      ? completedFromRos
      : (summaryActive > 0 || summaryCompleted > 0 ? summaryCompleted : summaryStatusCounts.completed)

    setData({
      ...summaryRes.data,
      active: resolvedActive,
      completed: resolvedCompleted,
      monthly_total: Number(monthSummaryRes.data?.total || 0),
      monthly_revenue: Number(monthSummaryRes.data?.revenue || 0),
      monthly_profit: Number(monthSummaryRes.data?.profit || 0),
    })
    setPendingCarryover(carryoverRes.data?.ros || [])
    setPendingAppointments(appointmentsRes.data?.requests?.length || 0)
    setGoal(goalsRes.data?.goal || null)
    setAdasQueue(adasRes.data?.queue || [])
    setWeekly(weeklyRes.data || null)
    setCalendarRos(allRos)
  }

  async function loadTechDashboard() {
    const today = new Date().toISOString().slice(0, 10)
    const [rosRes, shiftRes, clockStatusRes] = await Promise.all([
      api.get('/repair-orders'),
      api.get('/schedule/today').catch(() => ({ data: { shift: null } })),
      api.get('/timeclock/status').catch(() => ({ data: { clocked_in: false, entry: null } })),
    ])

    const allRos = rosRes?.data?.ros || []
    const myId = currentUser?.id
    const assigned = myId ? allRos.filter((ro) => ro.assigned_to === myId) : []
    const activeAssigned = assigned.filter((ro) => !isClosedRoStatus(ro.status))
    const completedAssigned = assigned.filter((ro) => isClosedRoStatus(ro.status))
    const dueToday = activeAssigned.filter((ro) => toDateKey(ro.estimated_delivery) === today)
    const highPriority = activeAssigned.filter((ro) => ['repair', 'paint', 'qc'].includes(normalizeRoStatus(ro.status)))
    const recentAssigned = [...assigned]
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
      .slice(0, 6)

    const byStage = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery'].map((status) => ({
      status,
      count: activeAssigned.filter((ro) => normalizeRoStatus(ro.status) === status).length,
    }))

    setTechData({
      totalAssigned: assigned.length,
      activeAssigned: activeAssigned.length,
      completedAssigned: completedAssigned.length,
      dueToday: dueToday.length,
      highPriority: highPriority.length,
      recentAssigned,
      byStage,
      todayShift: shiftRes?.data?.shift || null,
      timeClock: clockStatusRes?.data || { clocked_in: false, entry: null },
    })
    setCalendarRos(assigned)
  }

  useEffect(() => {
    if (isTechAccount) {
      loadTechDashboard().catch(err => {
        console.error('Failed to load tech dashboard:', err)
        setTechLoadError(true)
      })
      return
    }
    loadDashboardData().catch(err => {
      console.error('Failed to load dashboard:', err)
      setLoadError(true)
    })
  }, [isTechAccount])

  const hour = new Date().getHours()
  const greetingText = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const displayActive = useCountUp(data?.active || 0)
  const displayCompleted = useCountUp(data?.completed || 0)
  const displayRevenue = useCountUp(data?.monthly_revenue || 0)
  const displayProfit = useCountUp(data?.monthly_profit || 0)
  const revenueGoal = Number(goal?.revenue_goal || 0)
  const roGoal = Number(goal?.ro_goal || 0)
  const revenueProgress = revenueGoal > 0 ? Math.min((data?.monthly_revenue || 0) / revenueGoal, 1) * 100 : 0
  const roProgress = roGoal > 0 ? Math.min((data?.monthly_total || 0) / roGoal, 1) * 100 : 0
  const weeklyTrendDirection = weekly?.ro_opened?.trend_direction || 'flat'
  const weeklyTrendPercent = Number(weekly?.ro_opened?.trend_percent || 0)
  const canEditCalendar = role !== 'assistant'
  const calendarMonth = fromYearMonthKey(calendarMonthKey)
  const monthLabel = calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const todayDateKey = toDateKey(new Date())
  const calendarEvents = calendarRos
    .map((ro) => {
      const delivered = isDeliveredStatus(ro.status)
      const actualDate = toDateKey(ro.actual_delivery)
      const estimatedDate = toDateKey(ro.estimated_delivery)
      const intakeDate = toDateKey(ro.intake_date)
      // For active ROs with no estimated_delivery: fall back to intake_date if it's current month,
      // otherwise use today so unscheduled ROs are always visible in the current calendar view.
      let eventDate
      if (delivered) {
        eventDate = actualDate || estimatedDate || intakeDate
      } else if (estimatedDate) {
        eventDate = estimatedDate
      } else {
        eventDate = (intakeDate && intakeDate.startsWith(calendarMonthKey)) ? intakeDate : todayDateKey
      }
      const eventSource = delivered && actualDate ? 'actual_delivery' : estimatedDate ? 'estimated_delivery' : 'unscheduled'
      return {
        ...ro,
        eventDate,
        eventSource,
      }
    })
    .filter((ro) => !!ro.eventDate)

  const calendarEventsByDate = calendarEvents.reduce((acc, ro) => {
    if (!acc[ro.eventDate]) acc[ro.eventDate] = []
    acc[ro.eventDate].push(ro)
    return acc
  }, {})

  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
  const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0)
  const calendarGridStart = new Date(monthStart)
  calendarGridStart.setDate(monthStart.getDate() - monthStart.getDay())
  const calendarGridEnd = new Date(monthEnd)
  calendarGridEnd.setDate(monthEnd.getDate() + (6 - monthEnd.getDay()))
  const calendarDays = []
  for (let day = new Date(calendarGridStart); day <= calendarGridEnd; day.setDate(day.getDate() + 1)) {
    calendarDays.push(new Date(day))
  }
  const selectedDayEvents = (calendarEventsByDate[selectedCalendarDate] || [])
    .slice()
    .sort((a, b) => {
      const aDelivered = isDeliveredStatus(a.status)
      const bDelivered = isDeliveredStatus(b.status)
      if (aDelivered !== bDelivered) return aDelivered ? 1 : -1
      return String(a.ro_number || '').localeCompare(String(b.ro_number || ''))
    })

  useEffect(() => {
    const selectedDate = fromDateKey(selectedCalendarDate)
    if (selectedDate && isSameMonthYear(selectedDate, calendarMonth)) return
    const preferredDay = selectedDate ? selectedDate.getDate() : 1
    setSelectedCalendarDate(toDateKey(clampDayToMonth(calendarMonth, preferredDay)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonthKey])

  function shiftCalendarMonth(offset) {
    setCalendarMonthKey((prev) => shiftYearMonthKey(prev, offset))
  }

  async function updateCalendarEstimate(roId, nextDate) {
    setCalendarError('')
    setCalendarSavingKey(`estimate:${roId}`)
    try {
      await api.patch(`/ros/${roId}`, { estimated_delivery: nextDate || null })
      if (isTechAccount) await loadTechDashboard()
      else await loadDashboardData()
    } catch (err) {
      setCalendarError(err?.response?.data?.error || 'Could not update estimated date.')
    } finally {
      setCalendarSavingKey('')
    }
  }

  async function markDeliveredSooner(roId) {
    if (!window.confirm('Mark this RO as delivered now?')) return
    setCalendarError('')
    setCalendarSavingKey(`deliver:${roId}`)
    try {
      await api.put(`/ros/${roId}/status`, { status: 'delivery', note: 'Delivered sooner from dashboard calendar' })
      if (isTechAccount) await loadTechDashboard()
      else await loadDashboardData()
    } catch (err) {
      setCalendarError(err?.response?.data?.error || 'Could not mark this RO as delivered.')
    } finally {
      setCalendarSavingKey('')
    }
  }

  function renderRoCalendar() {
    return (
      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-sm text-white">RO Calendar</h2>
            <p className="text-xs text-slate-500">Estimated dates are editable here. Deliveries can be marked sooner anytime.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftCalendarMonth(-1)}
              aria-label="Previous calendar month"
              data-testid="ro-calendar-prev-month"
              className="h-8 w-8 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white"
            >
              <ChevronLeft size={14} />
            </button>
            <div
              className="text-xs font-semibold text-slate-200 min-w-[120px] text-center"
              data-no-auto-i18n="true"
              data-testid="ro-calendar-month-label"
            >
              {monthLabel}
            </div>
            <button
              type="button"
              onClick={() => shiftCalendarMonth(1)}
              aria-label="Next calendar month"
              data-testid="ro-calendar-next-month"
              className="h-8 w-8 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {calendarError && (
          <div className="text-xs text-rose-300 bg-rose-900/20 border border-rose-700/40 rounded-lg px-3 py-2">
            {calendarError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
          <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-2">
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="text-[10px] text-slate-500 text-center py-1">{label}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1" data-no-auto-i18n="true">
              {calendarDays.map((date) => {
                const key = toDateKey(date)
                const inMonth = isSameMonthYear(date, calendarMonth)
                const dayEvents = calendarEventsByDate[key] || []
                const selected = key === selectedCalendarDate
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedCalendarDate(key)
                      if (!inMonth) {
                        setCalendarMonthKey(toYearMonthKey(date))
                      }
                    }}
                    className={`min-h-[86px] rounded-lg border px-1.5 py-1 text-left transition-colors ${
                      selected
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-[#2a2d3e] bg-[#121625] hover:border-indigo-500/50'
                    } ${!inMonth ? 'opacity-45' : ''}`}
                  >
                    <div className={`text-[10px] font-semibold ${selected ? 'text-indigo-300' : 'text-slate-300'}`}>{date.getDate()}</div>
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 2).map((ro) => (
                        <div
                          key={ro.id}
                          className="text-[9px] px-1 py-0.5 rounded truncate border"
                          style={{ borderColor: STATUS_COLORS[ro.status] || '#334155', color: '#e2e8f0' }}
                        >
                          {ro.ro_number}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[9px] text-slate-400">+{dayEvents.length - 2} more</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-white" data-no-auto-i18n="true">{toDateLabel(selectedCalendarDate)}</div>
              <div className="text-[10px] text-slate-500" data-no-auto-i18n="true">{selectedDayEvents.length} RO(s)</div>
            </div>
            {selectedDayEvents.length === 0 ? (
              <p className="text-xs text-slate-500">No repair orders scheduled for this day.</p>
            ) : (
              <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
                {selectedDayEvents.map((ro) => {
                  const estimateSaveKey = `estimate:${ro.id}`
                  const deliverSaveKey = `deliver:${ro.id}`
                  const status = String(ro.status || '').toLowerCase()
                  const canDeliverSooner = canEditCalendar && !['delivery', 'closed'].includes(status)
                  return (
                    <div key={ro.id} className="rounded-lg border border-[#2a2d3e] bg-[#161b2c] p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/ros/${ro.id}`)}
                          className="text-xs font-semibold text-indigo-300 hover:text-indigo-200 truncate"
                        >
                          {ro.ro_number}
                        </button>
                        <StatusBadge status={ro.status} />
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {ro.customer_name || 'No customer'} · {[ro.year, ro.make, ro.model].filter(Boolean).join(' ')}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 block">Estimated Delivery</label>
                        <input
                          type="date"
                          value={toDateKey(ro.estimated_delivery)}
                          onChange={(e) => updateCalendarEstimate(ro.id, e.target.value)}
                          disabled={!canEditCalendar || calendarSavingKey === estimateSaveKey || calendarSavingKey === deliverSaveKey}
                          className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                        />
                      </div>
                      {ro.eventSource === 'actual_delivery' && (
                        <div className="text-[10px] text-emerald-300">Delivered on {toDateLabel(toDateKey(ro.actual_delivery))}</div>
                      )}
                      {ro.eventSource === 'unscheduled' && (
                        <div className="text-[10px] text-amber-400">No estimated delivery set — set a date above</div>
                      )}
                      <div className="flex items-center gap-2">
                        {canDeliverSooner && (
                          <button
                            type="button"
                            onClick={() => markDeliveredSooner(ro.id)}
                            disabled={calendarSavingKey === deliverSaveKey || calendarSavingKey === estimateSaveKey}
                            className="text-[10px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold px-2 py-1 rounded-md inline-flex items-center gap-1"
                          >
                            <Truck size={11} /> {calendarSavingKey === deliverSaveKey ? 'Saving...' : 'Deliver Sooner'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate(`/ros/${ro.id}`)}
                          className="text-[10px] bg-[#2a2d3e] hover:bg-[#3a3d4e] text-slate-200 px-2 py-1 rounded-md"
                        >
                          Open RO
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        {(() => {
          const unscheduled = calendarRos.filter(
            (ro) => !toDateKey(ro.estimated_delivery) && !isDeliveredStatus(ro.status)
          ).length
          if (unscheduled === 0) return null
          return (
            <p className="text-xs text-slate-500 text-center pt-1" data-no-auto-i18n="true">
              {unscheduled} active RO{unscheduled !== 1 ? 's' : ''} {unscheduled !== 1 ? 'have' : 'has'} no estimated delivery date — showing on today
            </p>
          )
        })()}
      </div>
    )
  }

  useEffect(() => {
    if (isTechAccount || !weekly?.chart || !weeklyChartRef.current) return undefined
    
    let destroyed = false
    
    // Lazy-load Chart.js to reduce initial bundle size
    import('chart.js/auto').then(({ default: Chart }) => {
      if (destroyed || !weeklyChartRef.current) return
      
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
    }).catch(err => {
      console.error('Failed to load Chart.js:', err)
      // Dashboard still renders without the chart
    })

    return () => {
      destroyed = true
      if (weeklyChartInstanceRef.current) {
        weeklyChartInstanceRef.current.destroy()
        weeklyChartInstanceRef.current = null
      }
    }
  }, [isTechAccount, weekly])

  if (isTechAccount) {
    if (techLoadError) return <div className="flex items-center justify-center h-64 text-red-400 text-sm">Failed to load tech dashboard. Please refresh the page.</div>
    if (!techData) return <div className="flex items-center justify-center h-64 text-slate-500">Loading your assigned repair orders...</div>

    return (
      <div className="space-y-6">
        <div>
          <p className="text-slate-400 text-sm font-medium mb-1 flex items-center gap-1.5">{greetingText} <Hand size={14} /></p>
          <h1 className="text-xl font-bold text-white">Tech Dashboard</h1>
          <p className="text-xs text-slate-500 mt-1">Your assigned repair orders and work queue.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button type="button" onClick={() => navigate('/ros')} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3 text-left hover:border-indigo-500/50">
            <div className="text-[11px] text-slate-500">Assigned</div>
            <div className="text-2xl font-bold text-white">{techData.totalAssigned}</div>
          </button>
          <button type="button" onClick={() => navigate('/ros?status=open')} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3 text-left hover:border-indigo-500/50">
            <div className="text-[11px] text-slate-500">Active</div>
            <div className="text-2xl font-bold text-indigo-300">{techData.activeAssigned}</div>
          </button>
          <button type="button" onClick={() => navigate('/ros?status=completed')} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3 text-left hover:border-indigo-500/50">
            <div className="text-[11px] text-slate-500">Completed</div>
            <div className="text-2xl font-bold text-emerald-300">{techData.completedAssigned}</div>
          </button>
          <button type="button" onClick={() => navigate('/ros')} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3 text-left hover:border-indigo-500/50">
            <div className="text-[11px] text-slate-500">Due Today</div>
            <div className="text-2xl font-bold text-amber-300">{techData.dueToday}</div>
          </button>
          <button type="button" onClick={() => navigate('/timeclock')} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3 text-left hover:border-indigo-500/50">
            <div className="text-[11px] text-slate-500">Clock Status</div>
            <div className={`text-sm font-semibold mt-1 ${techData.timeClock?.clocked_in ? 'text-emerald-300' : 'text-slate-300'}`}>
              {techData.timeClock?.clocked_in ? 'Clocked In' : 'Clocked Out'}
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <h2 className="font-semibold text-sm text-white mb-3">My Jobs by Stage</h2>
            <div className="space-y-2">
              {techData.byStage.map((row) => (
                <button
                  key={row.status}
                  type="button"
                  onClick={() => navigate(`/ros?status=${row.status}`)}
                  className="w-full flex items-center gap-3 hover:bg-[#2a2d3e] rounded px-1 transition-colors"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[row.status] }} />
                  <span className="text-xs text-slate-400 w-20 text-left capitalize">{STATUS_LABELS[row.status]}</span>
                  <div className="flex-1 bg-[#0f1117] rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${Math.min((row.count / Math.max(techData.activeAssigned || 1, 1)) * 100, 100)}%`,
                        background: STATUS_COLORS[row.status],
                      }}
                    />
                  </div>
                  <span className="text-xs text-slate-300 w-4 text-right">{row.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm text-white">Recent Assigned Jobs</h2>
              <button type="button" onClick={() => navigate('/ros')} className="text-xs text-indigo-300 hover:text-indigo-200">View All</button>
            </div>
            {techData.recentAssigned.length === 0 ? (
              <p className="text-sm text-slate-500">No jobs assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {techData.recentAssigned.map((ro) => (
                  <button
                    key={ro.id}
                    type="button"
                    onClick={() => navigate(`/ros/${ro.id}`)}
                    className="w-full text-left flex items-center gap-3 p-2 rounded-lg hover:bg-[#2a2d3e] transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[ro.status] }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{ro.ro_number} — {ro.year} {ro.make} {ro.model}</div>
                      <div className="text-[10px] text-slate-500">{ro.customer_name || 'No customer'}{ro.estimated_delivery ? ` · Due ${ro.estimated_delivery}` : ''}</div>
                    </div>
                    <StatusBadge status={ro.status} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {renderRoCalendar()}
      </div>
    )
  }

  const stats = [
    {
      id: 'active-jobs',
      label: 'Active Jobs',
      value: displayActive,
      icon: ClipboardList,
      color: 'text-indigo-300',
      accent: 'bg-indigo-500',
      card: 'bg-gradient-to-br from-indigo-900/40 to-[#1a1d2e]',
      to: '/ros?status=open',
      goalProgress: roGoal > 0 ? Math.round(roProgress) : null,
    },
    {
      id: 'completed',
      label: 'Completed',
      value: displayCompleted,
      icon: CheckCircle,
      color: 'text-emerald-300',
      accent: 'bg-emerald-500',
      card: 'bg-gradient-to-br from-slate-800/60 to-[#1a1d2e]',
      to: '/ros?status=completed',
      goalProgress: null,
    },
    ...(admin ? [
      {
        id: 'total-revenue',
        label: 'Total Revenue',
        value: `$${displayRevenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
        icon: DollarSign,
        color: 'text-emerald-300',
        accent: 'bg-emerald-500',
        card: 'bg-gradient-to-br from-emerald-900/40 to-[#1a1d2e]',
        to: '/monthly-report',
        goalProgress: revenueGoal > 0 ? Math.round(revenueProgress) : null,
      },
      {
        id: 'true-profit',
        label: 'True Profit',
        value: `$${displayProfit.toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
        icon: TrendingUp,
        color: 'text-amber-300',
        accent: 'bg-amber-500',
        card: 'bg-gradient-to-br from-amber-900/40 to-[#1a1d2e]',
        to: '/monthly-report',
        goalProgress: null,
      },
    ] : []),
  ]

  if (loadError) return <div className="flex items-center justify-center h-64 text-red-400 text-sm">Failed to load dashboard. Please refresh the page.</div>
  if (!data) return <div className="flex items-center justify-center h-64 text-slate-500">Loading your shop data...</div>

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <p className="text-slate-400 text-sm font-medium mb-1 flex items-center gap-1.5">{greetingText} <Hand size={14} /></p>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
      </div>

      {/* 2. Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <div
            key={s.label}
            onClick={() => navigate(s.to)}
            className={`${s.card} rounded-xl p-4 border border-[#2a2d3e] shadow-sm cursor-pointer hover:opacity-90 transition-opacity`}
          >
            <div className={`h-1.5 w-10 rounded-full ${s.accent} mb-3 opacity-90`} />
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-400">{s.label}</div>
              <s.icon size={18} className={s.color} />
            </div>
            <div
              className={`text-2xl font-bold ${s.color}`}
              data-no-auto-i18n="true"
              data-testid={`stat-value-${s.id}`}
            >
              {s.value}
            </div>
            {s.goalProgress != null && (
              <div className="mt-2">
                <div className="h-1 bg-[#0f1117] rounded-full overflow-hidden">
                  <div className={`h-full ${s.accent} transition-all`} style={{ width: `${Math.min(s.goalProgress, 100)}%` }} />
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{s.goalProgress}% of goal</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 3. Alert strip (conditional) */}
      {(pendingCarryover.length > 0 || (admin && adasQueue.length > 0) || (admin && pendingAppointments > 0)) && (
        <div className="flex flex-wrap gap-2">
          {pendingCarryover.length > 0 && (
            <button
              onClick={() => setShowCarryoverModal(true)}
              className="inline-flex items-center gap-2 text-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-200 font-medium px-3 py-2 rounded-lg transition-colors"
            >
              <AlertCircle size={13} />
              {pendingCarryover.length} carryover{pendingCarryover.length !== 1 ? 's' : ''} need revenue assignment
            </button>
          )}
          {admin && adasQueue.length > 0 && (
            <button
              onClick={() => navigate('/adas')}
              className="inline-flex items-center gap-2 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-200 font-medium px-3 py-2 rounded-lg transition-colors"
            >
              <Radar size={13} />
              {adasQueue.length} ADAS calibration{adasQueue.length !== 1 ? 's' : ''} pending
            </button>
          )}
          {admin && pendingAppointments > 0 && (
            <button
              onClick={() => navigate('/book')}
              className="inline-flex items-center gap-2 text-xs bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-200 font-medium px-3 py-2 rounded-lg transition-colors"
            >
              <CalendarDays size={13} />
              {pendingAppointments} appointment request{pendingAppointments !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {/* 4. RO Calendar */}
      {renderRoCalendar()}

      {/* 5. Bottom grid: Jobs by Stage + Weekly */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="font-semibold text-sm text-white mb-3">Jobs by Stage</h2>
          <div className="space-y-2">
            {['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery'].map(s => {
              const found = data.byStatus?.find(x => x.status === s)
              const count = found?.count || 0
              return (
                <div
                  key={s}
                  onClick={() => navigate(`/ros?status=${s}`)}
                  className="flex items-center gap-3 cursor-pointer hover:bg-[#2a2d3e] rounded px-1 transition-colors"
                >
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

        {weekly && (
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Weekly</h2>
              <span className="text-xs text-slate-400">This week vs last week</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => navigate('/ros')}
                className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-indigo-500/40 transition"
              >
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
              <div
                onClick={() => navigate('/monthly-report')}
                className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-indigo-500/40 transition"
              >
                <div className="text-xs text-slate-400 mb-1">Revenue Collected</div>
                <div className="text-2xl font-bold text-emerald-300">
                  ${(Number(weekly.revenue_collected_this_week || 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs text-slate-500 mt-1">Paid invoices this week</div>
              </div>
              <div
                onClick={() => navigate('/performance')}
                className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 sm:col-span-2 cursor-pointer hover:ring-1 hover:ring-indigo-500/40 transition"
              >
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-slate-400">RO Opened Trend</div>
                  <div className="text-xs text-slate-500">This week vs last 7 days</div>
                </div>
                <div className="h-48">
                  <canvas ref={weeklyChartRef} />
                </div>
              </div>
              <div
                onClick={() => navigate('/parts-on-order')}
                className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-indigo-500/40 transition"
              >
                <div className="text-xs text-slate-400 mb-1">Pending Parts</div>
                <div className="text-3xl font-bold text-amber-300">{weekly.pending_parts_count || 0}</div>
                <div className="text-xs text-slate-500 mt-1">ROs with parts ordered or awaiting</div>
              </div>
            </div>
          </div>
        )}
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
