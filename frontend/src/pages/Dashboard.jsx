import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Hand, AlertCircle, CalendarDays, ChevronRight, Radar, ArrowUpRight, ArrowDownRight, Minus, ChevronLeft, Truck } from 'lucide-react'
import api from '../lib/api'
import { getRole, getTokenPayload, isAdmin } from '../lib/auth'
import { STATUS_COLORS, STATUS_LABELS } from './RepairOrders'
import StatusBadge from '../components/StatusBadge'
import CarryoverModal from '../components/CarryoverModal'
import { Money, StatInstrument } from '../components/ui'

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
const PRODUCTION_STAGES = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery']

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

function buildNeedsNow(ros) {
  const safeRos = Array.isArray(ros) ? ros : []
  const items = []
  const seen = new Set()
  const today = toDateKey(new Date())

  function add(ro, item) {
    if (!ro?.id || seen.has(ro.id) || items.length >= 3) return
    seen.add(ro.id)
    items.push({ ro, ...item })
  }

  safeRos
    .filter((ro) => ['paid', 'succeeded'].includes(String(ro.payment_status || '').toLowerCase())
      && ['ready', 'delivery'].includes(normalizeRoStatus(ro.status)))
    .forEach((ro) => add(ro, {
      tag: 'Close',
      tone: 'good',
      title: `${ro.ro_number} is paid and ready to close`,
      detail: ro.customer_name || 'Customer on file',
      path: `/ros/${ro.id}`,
    }))

  safeRos
    .filter((ro) => String(ro.supplement_status || 'none').toLowerCase() === 'none'
      && (Number(ro.supplement_amount || 0) > 0 || String(ro.supplement_notes || '').trim()))
    .forEach((ro) => add(ro, {
      tag: 'File',
      tone: 'gold',
      title: `${ro.ro_number} has an unfiled supplement`,
      detail: ro.customer_name || 'Insurance repair',
      path: `/ros/${ro.id}?tab=insurance`,
    }))

  safeRos
    .filter((ro) => !isClosedRoStatus(ro.status) && toDateKey(ro.estimated_delivery) && toDateKey(ro.estimated_delivery) < today)
    .sort((a, b) => String(a.estimated_delivery).localeCompare(String(b.estimated_delivery)))
    .forEach((ro) => add(ro, {
      tag: 'Text',
      tone: 'crit',
      title: `${ro.ro_number} missed its promise date`,
      detail: `${ro.customer_name || 'Customer'} · due ${toDateLabel(toDateKey(ro.estimated_delivery))}`,
      path: `/ros/${ro.id}?tab=comms`,
    }))

  return items
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [techData, setTechData] = useState(null)
  const [weekly, setWeekly] = useState(null)
  const [instruments, setInstruments] = useState(null)
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

  async function loadDashboardData() {
    const [summaryRes, carryoverRes, appointmentsRes, adasRes, weeklyRes, instrumentsRes, rosRes] = await Promise.all([
      api.get('/reports/summary?scope=all').catch((err) => { console.error('[Dashboard] /reports/summary?scope=all failed:', err?.response?.status, err?.response?.data?.error || err?.message); return { data: {} } }),
      api.get('/ros/carryover-pending').catch(() => ({ data: { ros: [] } })),
      api.get('/appointments').catch(() => ({ data: { requests: [] } })),
      api.get('/adas/queue').catch(() => ({ data: { queue: [] } })),
      api.get('/dashboard/weekly').catch(() => ({ data: null })),
      api.get('/dashboard/instruments').catch((err) => { console.error('[Dashboard] /dashboard/instruments failed:', err?.response?.status, err?.response?.data?.error || err?.message); return { data: null } }),
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
    })
    setPendingCarryover(carryoverRes.data?.ros || [])
    setPendingAppointments(appointmentsRes.data?.requests?.length || 0)
    setAdasQueue(adasRes.data?.queue || [])
    setWeekly(weeklyRes.data || null)
    setInstruments(instrumentsRes.data || null)
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
  const revenueMtdCents = Number(instruments?.revenue_mtd_cents || 0)
  const revenueGoalCents = Number(instruments?.revenue_goal_cents || 0)
  const trueProfitCents = Number(instruments?.true_profit_cents || 0)
  const profitMargin = Number(instruments?.profit_margin_percent || 0)
  const supplementOpportunityCents = Number(instruments?.supplement_opportunity_cents || 0)
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
      <div className="bg-panel border border-line-2 rounded-instrument p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-sm font-semibold text-ink">RO Calendar</h2>
            <p className="text-xs text-faint">Estimated dates are editable here. Deliveries can be marked sooner anytime.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftCalendarMonth(-1)}
              aria-label="Previous calendar month"
              data-testid="ro-calendar-prev-month"
              className="h-8 w-8 rounded-lg border border-line-2 bg-void text-ink hover:text-ink"
            >
              <ChevronLeft size={14} />
            </button>
            <div
              className="text-xs font-semibold text-ink min-w-[120px] text-center"
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
              className="h-8 w-8 rounded-lg border border-line-2 bg-void text-ink hover:text-ink"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {calendarError && (
          <div className="text-xs text-crit bg-crit/20 border border-crit/40 rounded-lg px-3 py-2">
            {calendarError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
          <div className="bg-void border border-line-2 rounded-instrument p-2">
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="text-[10px] text-faint text-center py-1">{label}</div>
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
                        ? 'border-brand bg-brand/10'
                        : 'border-line-2 bg-panel-2 hover:border-brand/50'
                    } ${!inMonth ? 'opacity-45' : ''}`}
                  >
                    <div className={`text-[10px] font-semibold ${selected ? 'text-brand' : 'text-ink'}`}>{date.getDate()}</div>
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 2).map((ro) => (
                        <div
                          key={ro.id}
                          className="text-[9px] px-1 py-0.5 rounded truncate border"
                          style={{ borderColor: STATUS_COLORS[ro.status] || 'var(--muted)', color: 'var(--ink)' }}
                        >
                          {ro.ro_number}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[9px] text-muted">+{dayEvents.length - 2} more</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="bg-void border border-line-2 rounded-instrument p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-ink" data-no-auto-i18n="true">{toDateLabel(selectedCalendarDate)}</div>
              <div className="text-[10px] text-faint" data-no-auto-i18n="true">{selectedDayEvents.length} RO(s)</div>
            </div>
            {selectedDayEvents.length === 0 ? (
              <p className="text-xs text-faint">No repair orders scheduled for this day.</p>
            ) : (
              <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
                {selectedDayEvents.map((ro) => {
                  const estimateSaveKey = `estimate:${ro.id}`
                  const deliverSaveKey = `deliver:${ro.id}`
                  const status = String(ro.status || '').toLowerCase()
                  const canDeliverSooner = canEditCalendar && !['delivery', 'closed'].includes(status)
                  return (
                    <div key={ro.id} className="rounded-lg border border-line-2 bg-panel-2 p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/ros/${ro.id}`)}
                          className="text-xs font-semibold text-brand hover:text-brand truncate"
                        >
                          {ro.ro_number}
                        </button>
                        <StatusBadge status={ro.status} />
                      </div>
                      <div className="text-[11px] text-muted truncate">
                        {ro.customer_name || 'No customer'} · {[ro.year, ro.make, ro.model].filter(Boolean).join(' ')}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-faint block">Estimated Delivery</label>
                        <input
                          type="date"
                          value={toDateKey(ro.estimated_delivery)}
                          onChange={(e) => updateCalendarEstimate(ro.id, e.target.value)}
                          disabled={!canEditCalendar || calendarSavingKey === estimateSaveKey || calendarSavingKey === deliverSaveKey}
                          className="w-full rounded-instrument border border-line-2 bg-void px-2 py-1.5 font-mono text-xs text-ink focus:border-brand focus:outline-none disabled:opacity-60"
                        />
                      </div>
                      {ro.eventSource === 'actual_delivery' && (
                        <div className="text-[10px] text-good">Delivered on {toDateLabel(toDateKey(ro.actual_delivery))}</div>
                      )}
                      {ro.eventSource === 'unscheduled' && (
                        <div className="text-[10px] text-crit">No estimated delivery set — set a date above</div>
                      )}
                      <div className="flex items-center gap-2">
                        {canDeliverSooner && (
                          <button
                            type="button"
                            onClick={() => markDeliveredSooner(ro.id)}
                            disabled={calendarSavingKey === deliverSaveKey || calendarSavingKey === estimateSaveKey}
                            className="text-[10px] bg-good hover:bg-good disabled:opacity-60 text-white font-semibold px-2 py-1 rounded-md inline-flex items-center gap-1"
                          >
                            <Truck size={11} /> {calendarSavingKey === deliverSaveKey ? 'Saving...' : 'Deliver Sooner'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate(`/ros/${ro.id}`)}
                          className="text-[10px] bg-raised hover:bg-raised text-ink px-2 py-1 rounded-md"
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
            <p className="text-xs text-faint text-center pt-1" data-no-auto-i18n="true">
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

      const theme = getComputedStyle(document.documentElement)
      const brand = theme.getPropertyValue('--brand').trim()
      const brandLit = theme.getPropertyValue('--brand-lit').trim()
      const muted = theme.getPropertyValue('--muted').trim()
      const line = theme.getPropertyValue('--line-2').trim()

      weeklyChartInstanceRef.current = new Chart(weeklyChartRef.current, {
        type: 'bar',
        data: {
          labels: weekly.chart.labels || [],
          datasets: [{
            label: 'ROs Opened',
            data: weekly.chart.data || [],
            backgroundColor: [brand, brandLit],
            borderRadius: 8,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: muted },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: muted, precision: 0 },
              grid: { color: line },
            },
            x: {
              ticks: { color: muted },
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
    if (techLoadError) return <div className="flex items-center justify-center h-64 text-crit text-sm">Failed to load tech dashboard. Please refresh the page.</div>
    if (!techData) return <div className="flex items-center justify-center h-64 text-faint">Loading your assigned repair orders...</div>

    return (
      <div className="space-y-6">
        <div>
          <p className="text-muted text-sm font-medium mb-1 flex items-center gap-1.5">{greetingText} <Hand size={14} /></p>
          <h1 className="text-xl font-bold text-ink">Tech Dashboard</h1>
          <p className="text-xs text-faint mt-1">Your assigned repair orders and work queue.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button type="button" onClick={() => navigate('/ros')} className="bg-panel border border-line-2 rounded-instrument p-3 text-left hover:border-brand/50">
            <div className="text-[11px] text-faint">Assigned</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-ink">{techData.totalAssigned}</div>
          </button>
          <button type="button" onClick={() => navigate('/ros?status=open')} className="bg-panel border border-line-2 rounded-instrument p-3 text-left hover:border-brand/50">
            <div className="text-[11px] text-faint">Active</div>
            <div className="text-2xl font-bold text-brand">{techData.activeAssigned}</div>
          </button>
          <button type="button" onClick={() => navigate('/ros?status=completed')} className="bg-panel border border-line-2 rounded-instrument p-3 text-left hover:border-brand/50">
            <div className="text-[11px] text-faint">Completed</div>
            <div className="text-2xl font-bold text-good">{techData.completedAssigned}</div>
          </button>
          <button type="button" onClick={() => navigate('/ros')} className="bg-panel border border-line-2 rounded-instrument p-3 text-left hover:border-brand/50">
            <div className="text-[11px] text-faint">Due Today</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-brand">{techData.dueToday}</div>
          </button>
          <button type="button" onClick={() => navigate('/timeclock')} className="bg-panel border border-line-2 rounded-instrument p-3 text-left hover:border-brand/50">
            <div className="text-[11px] text-faint">Clock Status</div>
            <div className={`text-sm font-semibold mt-1 ${techData.timeClock?.clocked_in ? 'text-good' : 'text-ink'}`}>
              {techData.timeClock?.clocked_in ? 'Clocked In' : 'Clocked Out'}
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-panel rounded-instrument border border-line-2 p-4">
            <h2 className="font-semibold text-sm text-ink mb-3">My Jobs by Stage</h2>
            <div className="space-y-2">
              {techData.byStage.map((row) => (
                <button
                  key={row.status}
                  type="button"
                  onClick={() => navigate(`/ros?status=${row.status}`)}
                  className="w-full flex items-center gap-3 hover:bg-raised rounded px-1 transition-colors"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[row.status] }} />
                  <span className="text-xs text-muted w-20 text-left capitalize">{STATUS_LABELS[row.status]}</span>
                  <div className="flex-1 bg-void rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${Math.min((row.count / Math.max(techData.activeAssigned || 1, 1)) * 100, 100)}%`,
                        background: STATUS_COLORS[row.status],
                      }}
                    />
                  </div>
                  <span className="text-xs text-ink w-4 text-right">{row.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-panel rounded-instrument border border-line-2 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm text-ink">Recent Assigned Jobs</h2>
              <button type="button" onClick={() => navigate('/ros')} className="text-xs text-brand hover:text-brand">View All</button>
            </div>
            {techData.recentAssigned.length === 0 ? (
              <p className="text-sm text-faint">No jobs assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {techData.recentAssigned.map((ro) => (
                  <button
                    key={ro.id}
                    type="button"
                    onClick={() => navigate(`/ros/${ro.id}`)}
                    className="w-full text-left flex items-center gap-3 p-2 rounded-lg hover:bg-raised transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[ro.status] }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-ink truncate">{ro.ro_number} — {ro.year} {ro.make} {ro.model}</div>
                      <div className="text-[10px] text-faint">{ro.customer_name || 'No customer'}{ro.estimated_delivery ? ` · Due ${ro.estimated_delivery}` : ''}</div>
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

  const needsNow = buildNeedsNow(calendarRos)
  const productionStages = PRODUCTION_STAGES.map((status) => {
    const count = Number(data?.byStatus?.find((row) => normalizeRoStatus(row.status) === status)?.count || 0)
    const overdue = calendarRos.filter((ro) => normalizeRoStatus(ro.status) === status
      && toDateKey(ro.estimated_delivery)
      && toDateKey(ro.estimated_delivery) < todayDateKey).length
    return { status, count, overdue }
  })
  const maxStageCount = Math.max(1, ...productionStages.map((stage) => stage.count))
  const revenueGaugeMax = revenueGoalCents > 0 ? revenueGoalCents : Math.max(revenueMtdCents, 1)

  if (loadError) return <div className="flex items-center justify-center h-64 text-crit text-sm">Failed to load dashboard. Please refresh the page.</div>
  if (!data) return <div className="flex items-center justify-center h-64 text-faint">Loading your shop data...</div>

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <p className="text-muted text-sm font-medium mb-1 flex items-center gap-1.5">{greetingText} <Hand size={14} /></p>
        <h1 className="text-xl font-bold text-ink">Dashboard</h1>
      </div>

      {/* 2. Instrument KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatInstrument
          label="Active Jobs"
          value={(
            <span>
              <span className="font-mono tabular-nums" data-testid="stat-value-active-jobs">{displayActive}</span>
              <span className="mt-3 grid grid-cols-8 gap-1" aria-label="Active jobs across eight production stages">
                {productionStages.map((stage) => (
                  <span key={stage.status} className="h-1.5 rounded-full bg-brand" style={{ opacity: 0.22 + (stage.count / maxStageCount) * 0.78 }} />
                ))}
              </span>
            </span>
          )}
          detail={<span><span className="font-mono tabular-nums" data-testid="stat-value-completed">{displayCompleted}</span> completed</span>}
          onClick={() => navigate('/ros?status=open')}
        />
        {admin && (
          <StatInstrument
            label="Revenue MTD"
            value={<Money cents={revenueMtdCents} data-testid="stat-value-total-revenue" />}
            detail={revenueGoalCents > 0 ? 'Against this month’s goal' : 'Set a monthly revenue goal'}
            gauge={{ value: revenueMtdCents, max: revenueGaugeMax, tone: 'brand' }}
            onClick={() => navigate('/monthly-report')}
          />
        )}
        {admin && (
          <StatInstrument
            label="True Profit"
            value={<Money cents={trueProfitCents} data-testid="stat-value-true-profit" />}
            detail="Server-authoritative month-to-date margin"
            gauge={{ value: Math.max(profitMargin, 0), max: 100, tone: 'good', label: `${profitMargin.toFixed(1)}%` }}
            onClick={() => navigate('/monthly-report')}
          />
        )}
        {admin && (
          <StatInstrument
            label="Supplement Opportunity"
            value={<Money cents={supplementOpportunityCents} data-testid="stat-value-supplement-opportunity" className="text-gold" />}
            detail={`${Number(instruments?.supplement_ro_count || 0)} ROs with labor-rate gaps`}
            tone="gold"
            className="border-gold/40 bg-[color-mix(in_srgb,var(--gold)_7%,var(--panel))] hover:border-gold"
            onClick={() => navigate('/ros?status=estimate')}
          />
        )}
      </div>

      {/* 3. Production line tachometer */}
      <section className="rounded-instrument border border-line bg-panel p-4" aria-labelledby="production-line-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-lit">Production line</p>
            <h2 id="production-line-heading" className="mt-1 font-display text-lg font-semibold text-ink">Shop load by stage</h2>
          </div>
          <p className="text-xs text-muted"><span className="text-gold">Gold</span> marks an over-promise stage</p>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 lg:grid-cols-8" data-testid="production-line">
          {productionStages.map((stage) => {
            const redlined = stage.overdue > 0
            const height = `${Math.max(12, Math.round((stage.count / maxStageCount) * 100))}%`
            return (
              <button
                key={stage.status}
                type="button"
                onClick={() => navigate(`/ros?status=${stage.status}`)}
                className="group min-w-0 rounded-md border border-line bg-panel-2 p-2 text-left transition-colors hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                aria-label={`${STATUS_LABELS[stage.status]}: ${stage.count} jobs${redlined ? `, ${stage.overdue} overdue` : ''}`}
              >
                <span className="flex h-14 items-end rounded-sm bg-void/50 p-1">
                  <span className={`block w-full rounded-sm ${redlined ? 'bg-gold' : 'bg-brand'}`} style={{ height }} />
                </span>
                <span className="mt-2 block truncate text-[10px] font-semibold uppercase text-muted">{STATUS_LABELS[stage.status]}</span>
                <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-ink">{stage.count}</span>
                {redlined && <span className="block font-mono text-[9px] text-gold">{stage.overdue} late</span>}
              </button>
            )
          })}
        </div>
      </section>

      {/* 4. Focus list */}
      <section className="rounded-instrument border border-line bg-panel p-4" aria-labelledby="needs-now-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Needs you now</p>
            <h2 id="needs-now-heading" className="mt-1 font-display text-lg font-semibold text-ink">Three moves that unblock the shop</h2>
          </div>
          <span className="font-mono text-xs tabular-nums text-faint">{needsNow.length}/3</span>
        </div>
        {needsNow.length === 0 ? (
          <p role="status" className="mt-4 rounded-md border border-line bg-panel-2 px-3 py-4 text-sm text-muted">No payment-ready closeouts, unfiled supplements, or overdue promises need action.</p>
        ) : (
          <div className="mt-4 grid gap-2 lg:grid-cols-3">
            {needsNow.map((item) => {
              const toneColor = item.tone === 'gold' ? 'var(--gold)' : item.tone === 'good' ? 'var(--good)' : 'var(--crit)'
              const actionClass = item.tone === 'gold'
                ? 'border-gold bg-gold text-void hover:bg-gold-lit'
                : item.tone === 'good'
                  ? 'border-good/40 bg-good/10 text-good hover:bg-good/15'
                  : 'border-brand/40 bg-brand/10 text-brand-lit hover:bg-brand/15'
              return (
                <article key={`${item.tag}-${item.ro.id}`} className="grid grid-cols-[3px_1fr_auto] gap-3 rounded-md border border-line bg-panel-2 p-3">
                  <span className="rounded-full" style={{ backgroundColor: toneColor }} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                    <span className="mt-1 block truncate text-xs text-muted">{item.detail}</span>
                  </span>
                  <button type="button" onClick={() => navigate(item.path)} className={`self-center rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${actionClass}`}>
                    {item.tag}
                  </button>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* 5. Alert strip (conditional) */}
      {(pendingCarryover.length > 0 || (admin && adasQueue.length > 0) || (admin && pendingAppointments > 0)) && (
        <div className="flex flex-wrap gap-2">
          {pendingCarryover.length > 0 && (
            <button
              onClick={() => setShowCarryoverModal(true)}
              className="inline-flex items-center gap-2 rounded-instrument border border-gold/30 bg-gold/10 px-3 py-2 text-xs font-medium text-gold transition-colors hover:bg-gold/15"
            >
              <AlertCircle size={13} />
              {pendingCarryover.length} carryover{pendingCarryover.length !== 1 ? 's' : ''} need revenue assignment
            </button>
          )}
          {admin && adasQueue.length > 0 && (
            <button
              onClick={() => navigate('/adas')}
              className="inline-flex items-center gap-2 text-xs bg-brand/10 hover:bg-brand/20 border border-brand/30 text-brand font-medium px-3 py-2 rounded-lg transition-colors"
            >
              <Radar size={13} />
              {adasQueue.length} ADAS calibration{adasQueue.length !== 1 ? 's' : ''} pending
            </button>
          )}
          {admin && pendingAppointments > 0 && (
            <button
              onClick={() => navigate('/book')}
              className="inline-flex items-center gap-2 rounded-instrument border border-brand/30 bg-brand/10 px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/15"
            >
              <CalendarDays size={13} />
              {pendingAppointments} appointment request{pendingAppointments !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {/* 6. RO Calendar */}
      {renderRoCalendar()}

      {/* 7. Weekly operations */}
      <div className="grid grid-cols-1 gap-4">
        {weekly && (
          <div className="bg-panel border border-line-2 rounded-instrument p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-ink">Weekly</h2>
              <span className="text-xs text-muted">This week vs last week</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => navigate('/ros')}
                className="bg-void border border-line-2 rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-brand/40 transition"
              >
                <div className="text-xs text-muted mb-1">ROs Opened</div>
                <div className="font-mono text-2xl font-bold tabular-nums text-ink">{weekly.ro_opened?.this_week || 0}</div>
                <div className="mt-1 inline-flex items-center gap-1 text-xs">
                  {weeklyTrendDirection === 'up' && <ArrowUpRight size={14} className="text-good" />}
                  {weeklyTrendDirection === 'down' && <ArrowDownRight size={14} className="text-crit" />}
                  {weeklyTrendDirection === 'flat' && <Minus size={14} className="text-ink" />}
                  <span className={weeklyTrendDirection === 'down' ? 'text-crit' : weeklyTrendDirection === 'up' ? 'text-good' : 'text-ink'}>
                    {weeklyTrendPercent > 0 ? '+' : ''}{weeklyTrendPercent}% vs last week ({weekly.ro_opened?.last_week || 0})
                  </span>
                </div>
              </div>
              <div
                onClick={() => navigate('/monthly-report')}
                className="bg-void border border-line-2 rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-brand/40 transition"
              >
                <div className="text-xs text-muted mb-1">Revenue Collected</div>
                <Money cents={weekly.revenue_collected_this_week_cents || 0} className="text-2xl font-bold text-gold" />
                <div className="text-xs text-faint mt-1">Paid invoices this week</div>
              </div>
              <div
                onClick={() => navigate('/performance')}
                className="bg-void border border-line-2 rounded-lg p-3 sm:col-span-2 cursor-pointer hover:ring-1 hover:ring-brand/40 transition"
              >
                <div className="text-xs text-muted mb-2">Top Techs by Jobs Completed</div>
                {weekly.top_techs?.length ? (
                  <div className="space-y-2">
                    {weekly.top_techs.map((tech, idx) => (
                      <div key={tech.tech_id || `${tech.tech_name || 'tech'}-${idx}`} className="flex items-center justify-between text-sm">
                        <span className="text-ink">{idx + 1}. {tech.tech_name}</span>
                        <span className="font-mono font-semibold tabular-nums text-brand">{tech.jobs_completed}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-faint">No completed jobs yet this week.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-void border border-line-2 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-muted">RO Opened Trend</div>
                  <div className="text-xs text-faint">This week vs last 7 days</div>
                </div>
                <div className="h-48">
                  <canvas ref={weeklyChartRef} />
                </div>
              </div>
              <div
                onClick={() => navigate('/parts-on-order')}
                className="bg-void border border-line-2 rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-brand/40 transition"
              >
                <div className="text-xs text-muted mb-1">Pending Parts</div>
                <div className="font-mono text-3xl font-bold tabular-nums text-brand">{weekly.pending_parts_count || 0}</div>
                <div className="text-xs text-faint mt-1">ROs with parts ordered or awaiting</div>
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
