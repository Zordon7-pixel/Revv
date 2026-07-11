import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Save, CheckCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { isAdmin, isAssistant } from '../lib/auth'
import AppOverlay from '../components/AppOverlay'
import { PageHeader } from '../components/ui'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const MONTH_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function getMonday(d = new Date()) {
  const day = d.getDay()
  const diff = d.getDate() - ((day + 6) % 7)
  const m = new Date(d)
  m.setDate(diff)
  m.setHours(0,0,0,0)
  return m
}

function isoDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fromIsoDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m || !d) return null
  const parsed = new Date(y, m - 1, d)
  if (Number.isNaN(parsed.getTime())) return null
  parsed.setHours(0, 0, 0, 0)
  return parsed
}

function fmtHeader(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function parseTimeToMinutes(value) {
  const text = String(value || '')
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function shiftCrossesNextDay(shift) {
  const start = parseTimeToMinutes(shift?.start_time)
  const end = parseTimeToMinutes(shift?.end_time)
  if (start == null || end == null) return false
  return end < start
}

function shiftDurationHours(shift) {
  const start = parseTimeToMinutes(shift?.start_time)
  const end = parseTimeToMinutes(shift?.end_time)
  if (start == null || end == null) return 0
  let minutes = end - start
  if (minutes < 0) minutes += 24 * 60
  return Math.max(0, minutes / 60)
}

function shiftTimeLabel(shift) {
  if (!shift) return ''
  return `${shift.start_time} – ${shift.end_time}${shiftCrossesNextDay(shift) ? ' (+1d)' : ''}`
}

function addDaysToIso(iso, days) {
  const date = fromIsoDate(iso)
  if (!date) return iso
  date.setDate(date.getDate() + days)
  return isoDate(date)
}

function shiftMatchesDate(shift, iso) {
  if (!shift || !iso) return false
  if (shift.shift_date === iso) return true
  if (!shiftCrossesNextDay(shift)) return false
  return shift.shift_date === addDaysToIso(iso, -1)
}

function ShiftModal({ employees, prefill, shift, onClose, onSaved, onDeleted }) {
  const isEdit = !!shift
  const [form, setForm] = useState({
    user_id: shift?.user_id || prefill?.user_id || (employees[0]?.id || ''),
    shift_date: shift?.shift_date || prefill?.date || '',
    start_time: shift?.start_time || '08:00',
    end_time: shift?.end_time || '17:00',
    lunch_break_minutes: shift?.lunch_break_minutes ?? 30,
    notes: shift?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState(false)
  const inp = 'w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand'
  const lbl = 'block text-xs font-medium text-muted mb-1'

  async function save() {
    if (!form.user_id || !form.shift_date) { setErr('Select tech and date.'); return }
    if (form.start_time === form.end_time) { setErr('Start and end time cannot be the same.'); return }
    setSaving(true); setErr('')
    try {
      if (isEdit) {
        await api.put(`/schedule/${shift.id}`, {
          start_time: form.start_time,
          end_time: form.end_time,
          lunch_break_minutes: form.lunch_break_minutes,
          notes: form.notes,
        })
      } else {
        await api.post('/schedule', form)
      }
      onSaved()
    } catch (e) {
      setErr(e?.response?.data?.error || 'Error saving shift')
    } finally { setSaving(false) }
  }

  async function deleteShift() {
    if (!shift?.id) return
    if (!confirm('Remove this shift?')) return
    setDeleting(true)
    setErr('')
    try {
      await api.delete(`/schedule/${shift.id}`)
      onDeleted?.()
    } catch (e) {
      setErr(e?.response?.data?.error || 'Error deleting shift')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AppOverlay label={isEdit ? 'Edit shift' : 'Add shift'} onClose={onClose} className="bg-void/75 p-4">
      <div className="bg-panel rounded-instrument border border-line-2 w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-ink text-sm">{isEdit ? 'Edit Shift' : 'Add Shift'}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={16}/></button>
        </div>
        <div className="space-y-3">
          <div><label className={lbl}>Tech</label>
            <select className={inp} value={form.user_id} onChange={e => setForm(f=>({...f,user_id:e.target.value}))}>
              <option value="">— select —</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select></div>
          <div><label className={lbl}>Date</label>
            <input className={inp} type="date" value={form.shift_date} onChange={e => setForm(f=>({...f,shift_date:e.target.value}))} disabled={isEdit} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Start Time</label>
              <input className={inp} type="time" value={form.start_time} onChange={e => setForm(f=>({...f,start_time:e.target.value}))} /></div>
            <div><label className={lbl}>End Time</label>
              <input className={inp} type="time" value={form.end_time} onChange={e => setForm(f=>({...f,end_time:e.target.value}))} /></div>
          </div>
          <p className="text-[10px] text-faint -mt-1">
            If end time is earlier than start time, REVV treats the shift as ending the next day.
          </p>
          <div><label className={lbl}>Lunch (min)</label>
            <input className={inp} type="number" min="0" max="120" value={form.lunch_break_minutes} onChange={e => setForm(f=>({...f,lunch_break_minutes:parseInt(e.target.value)||30}))} /></div>
          <div><label className={lbl}>Notes (optional)</label>
            <input className={inp} placeholder="Any instructions…" value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} /></div>
        </div>
        {err && <p role="alert" className="text-xs text-crit">{err}</p>}
        <div className="flex justify-between pt-2">
          {isEdit ? (
            <button type="button" onClick={deleteShift} disabled={deleting || saving} className="text-sm text-crit transition-colors hover:opacity-80 disabled:opacity-60">
              {deleting ? 'Removing…' : 'Delete Shift'}
            </button>
          ) : (
            <button onClick={onClose} className="text-muted text-sm hover:text-ink">Cancel</button>
          )}
          <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-brand hover:bg-brand-lit text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            <Save size={14}/> {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Shift')}
          </button>
        </div>
      </div>
    </AppOverlay>
  )
}

function EarlyAuthModal({ employee, onClose, onSuccess }) {
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!password) return
    setSaving(true)
    setError('')
    try {
      await api.post('/timeclock/authorize-early', {
        employee_id: employee.id,
        admin_password: password,
      })
      onSuccess(employee.id)
    } catch (e) {
      setError(e?.response?.data?.message || 'Incorrect admin password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppOverlay label="Authorize early clock-in" onClose={onClose} className="bg-void/75 p-4">
      <div className="bg-panel rounded-instrument border border-line-2 w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-ink text-sm">Admin Password Required</h3>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={16}/></button>
        </div>
        <div className="text-xs text-muted">Authorize early clock-in for <span className="text-ink font-semibold">{employee.name}</span> today.</div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin Password"
          className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand"
        />
        {error && <p role="alert" className="text-xs text-crit">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-muted text-sm hover:text-ink">Cancel</button>
          <button onClick={submit} disabled={saving || !password} className="bg-brand hover:bg-brand-lit text-white text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-50">
            {saving ? 'Authorizing…' : 'Authorize'}
          </button>
        </div>
      </div>
    </AppOverlay>
  )
}

export default function Schedule() {
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState('week') // 'week' or 'month'
  const [monday, setMonday] = useState(getMonday())
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [shifts, setShifts] = useState([])
  const [employees, setEmployees] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [prefill, setPrefill] = useState(null)
  const [editingShift, setEditingShift] = useState(null)
  const [authModalEmployee, setAuthModalEmployee] = useState(null)
  const [authorizedToday, setAuthorizedToday] = useState({})
  const [creatingRoShiftId, setCreatingRoShiftId] = useState('')
  const [createRoError, setCreateRoError] = useState('')
  const [loadError, setLoadError] = useState('')
  const canManage = isAdmin() || isAssistant()
  const canCreateRo = isAdmin()
  const canAuthorizeEarly = isAdmin()

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })

  // Month view helpers
  function getMonthDays() {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const days = []
    
    // Start from Sunday of the week containing the first day
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - firstDay.getDay())
    
    // End on Saturday of the week containing the last day
    const endDate = new Date(lastDay)
    endDate.setDate(endDate.getDate() + (6 - lastDay.getDay()))
    
    let current = new Date(startDate)
    while (current <= endDate) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    return days
  }

  function prevMonth() {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  function nextMonth() {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  function goToWeek(date) {
    const d = new Date(date)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Get Monday
    setMonday(d)
    setViewMode('week')
  }

  async function loadMonthShifts() {
    setLoadError('')
    try {
      const year = currentMonth.getFullYear()
      const month = currentMonth.getMonth()
      const from = isoDate(new Date(year, month, 1))
      const to = isoDate(new Date(year, month + 1, 0))
      const [s, e] = await Promise.all([
        api.get(`/schedule?from=${from}&to=${to}`),
        canManage ? api.get('/schedule/employees') : Promise.resolve({ data: { employees: [] } }),
      ])
      setShifts(s.data.shifts || [])
      if (canManage) setEmployees(e.data.employees || [])
    } catch (err) {
      console.error('[Schedule] Failed to load month shifts:', err.message)
      setLoadError(err?.response?.data?.error || 'Error loading schedule')
    }
  }

  useEffect(() => {
    if (viewMode === 'month') {
      loadMonthShifts()
    }
  }, [viewMode, currentMonth])

  async function load() {
    if (viewMode === 'month') {
      await loadMonthShifts()
      return
    }
    setLoadError('')
    try {
      const [s, e] = await Promise.all([
        api.get(`/schedule?week=${isoDate(monday)}`),
        canManage ? api.get('/schedule/employees') : Promise.resolve({ data: { employees: [] } })
      ])
      setShifts(s.data.shifts || [])
      setEmployees(e.data.employees || [])
    } catch (err) {
      console.error('[Schedule] Failed to load week shifts:', err.message)
      setLoadError(err?.response?.data?.error || 'Error loading schedule')
    }
  }
  useEffect(() => { load() }, [monday, viewMode])

  useEffect(() => {
    async function loadAuthStatus() {
      if (!canAuthorizeEarly) return
      const todayIso = isoDate(new Date())
      const isCurrentWeek = weekDates.some(d => isoDate(d) === todayIso)
      if (!isCurrentWeek || employees.length === 0) return

      const statuses = {}
      await Promise.all(employees.map(async (emp) => {
        try {
          const r = await api.get(`/timeclock/early-auth-status/${emp.id}`)
          statuses[emp.id] = !!r.data?.authorized
        } catch {
          statuses[emp.id] = false
        }
      }))
      setAuthorizedToday(statuses)
    }
    loadAuthStatus()
  }, [canAuthorizeEarly, employees, monday])

  useEffect(() => {
    if (!createRoError) return undefined
    const timeout = window.setTimeout(() => setCreateRoError(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [createRoError])

  function prevWeek() { 
    const d = new Date(monday); 
    d.setDate(d.getDate()-7); 
    setMonday(d) 
  }
  function nextWeek() { 
    const d = new Date(monday); 
    d.setDate(d.getDate()+7); 
    setMonday(d) 
  }
  function thisWeek() { 
    const now = new Date()
    setMonday(getMonday())
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1))
    setViewMode('week')
  }

  function shiftsFor(date) {
    const iso = isoDate(date)
    return shifts.filter((s) => shiftMatchesDate(s, iso))
  }

  async function deleteShift(id) {
    if (!confirm('Remove this shift?')) return
    await api.delete(`/schedule/${id}`)
    load()
  }

  async function createRoFromShift(shiftId) {
    if (!canCreateRo || !shiftId || creatingRoShiftId) return
    setCreatingRoShiftId(shiftId)
    setCreateRoError('')
    try {
      const { data } = await api.post(`/ros/from-schedule/${shiftId}`)
      if (!data?.id) throw new Error('New RO id missing from response')
      navigate(`/ros/${data.id}`)
    } catch (e) {
      setCreateRoError(e?.response?.data?.error || 'Could not create RO from schedule')
    } finally {
      setCreatingRoShiftId('')
    }
  }

  function openAdd(date = null, user_id = null) {
    setPrefill({ date: date ? isoDate(date) : '', user_id: user_id || '' })
    setShowAdd(true)
  }

  function openEdit(shift) {
    if (!canManage) return
    setEditingShift(shift)
  }

  const today = isoDate(new Date())
  const periodDates = viewMode === 'week'
    ? weekDates
    : getMonthDays().filter((d) => d.getMonth() === currentMonth.getMonth())
  const uniqueScheduledEmployees = new Set(shifts.map((s) => s.user_id).filter(Boolean)).size
  const totalScheduledHours = shifts.reduce((sum, s) => sum + shiftDurationHours(s), 0)
  const staffedDays = periodDates.reduce((count, d) => (shiftsFor(d).length > 0 ? count + 1 : count), 0)
  const maxStaffedDay = periodDates.reduce((best, d) => {
    const count = shiftsFor(d).length
    if (count > best.count) return { date: d, count }
    return best
  }, { date: null, count: 0 })

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Floor coverage"
        title="Schedule"
        description={viewMode === 'week'
          ? `Week of ${fmtHeader(monday)} — ${fmtHeader(weekDates[6])}`
          : currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        actions={(
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-panel border border-line-2 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('week')}
              aria-pressed={viewMode === 'week'}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'week'
                  ? 'bg-brand text-white'
                  : 'text-muted hover:text-ink'
              }`}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              aria-pressed={viewMode === 'month'}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'month'
                  ? 'bg-brand text-white'
                  : 'text-muted hover:text-ink'
              }`}
            >
              Month
            </button>
          </div>
          <button type="button" aria-label="Previous schedule period" onClick={() => viewMode === 'month' ? prevMonth() : prevWeek()} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-raised transition-colors"><ChevronLeft size={16}/></button>
          <button type="button" onClick={thisWeek} className="px-3 py-1.5 rounded-lg text-xs text-muted hover:bg-raised border border-line-2 transition-colors">This Week</button>
          <button type="button" aria-label="Next schedule period" onClick={() => viewMode === 'month' ? nextMonth() : nextWeek()} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-raised transition-colors"><ChevronRight size={16}/></button>
          {canManage && (
            <button type="button" onClick={() => openAdd()} className="flex items-center gap-1.5 bg-brand hover:bg-brand-lit text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
              <Plus size={14}/> Add Shift
            </button>
          )}
        </div>
        )}
      />

      {createRoError && (
        <div role="alert" className="fixed right-4 top-4 z-[90] max-w-xs rounded-instrument border border-crit/40 bg-panel px-3 py-2 text-xs text-crit shadow-lg">
          {createRoError}
        </div>
      )}

      {loadError && (
        <div role="alert" className="fixed right-4 top-20 z-[90] max-w-xs rounded-instrument border border-crit/40 bg-panel px-3 py-2 text-xs text-crit shadow-lg">
          {loadError}
        </div>
      )}

      {canManage && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="bg-panel border border-line-2 rounded-instrument p-3">
            <p className="text-[10px] text-faint uppercase tracking-wide">Scheduled Shifts</p>
            <p className="text-lg font-bold text-ink mt-1">{shifts.length}</p>
          </div>
          <div className="bg-panel border border-line-2 rounded-instrument p-3">
            <p className="text-[10px] text-faint uppercase tracking-wide">Staff Scheduled</p>
            <p className="text-lg font-bold text-ink mt-1">{uniqueScheduledEmployees}</p>
          </div>
          <div className="bg-panel border border-line-2 rounded-instrument p-3">
            <p className="text-[10px] text-faint uppercase tracking-wide">Scheduled Hours</p>
            <p className="text-lg font-bold text-brand-lit mt-1">{totalScheduledHours.toFixed(1)}h</p>
          </div>
          <div className="bg-panel border border-line-2 rounded-instrument p-3">
            <p className="text-[10px] text-faint uppercase tracking-wide">Coverage</p>
            <p className="text-sm font-semibold text-ink mt-1">{staffedDays}/{periodDates.length} days staffed</p>
            <p className="text-[10px] text-faint mt-1">
              Peak: {maxStaffedDay.date ? `${fmtHeader(maxStaffedDay.date)} (${maxStaffedDay.count})` : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Month navigation - only show in month view */}
      {viewMode === 'month' && (
        <div className="flex items-center justify-center gap-4 mb-2">
          <button type="button" aria-label="Previous month" onClick={prevMonth} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-raised transition-colors">
            <ChevronLeft size={16}/>
          </button>
          <button type="button" onClick={() => setCurrentMonth(new Date())} className="px-3 py-1.5 rounded-lg text-xs text-muted hover:bg-raised border border-line-2 transition-colors">
            Today
          </button>
          <button type="button" aria-label="Next month" onClick={nextMonth} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-raised transition-colors">
            <ChevronRight size={16}/>
          </button>
        </div>
      )}

      {viewMode === 'week' ? (
        /* Weekly grid */
        <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-1.5 min-w-[560px]">
        {weekDates.map((date, i) => {
          const dayIso = isoDate(date)
          const dayShifts = shiftsFor(date)
          const isToday = dayIso === today
          return (
            <div key={i} className={`bg-panel rounded-instrument border ${isToday ? 'border-brand' : 'border-line-2'} p-2 min-h-[120px] flex flex-col`}>
              <div className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${isToday ? 'text-brand' : 'text-faint'}`}>
                {DAYS[i]}<br/>
                <span className={`text-xs ${isToday ? 'text-brand-lit' : 'text-muted'}`}>{fmtHeader(date)}</span>
              </div>
              <div className="flex-1 space-y-1">
                {dayShifts.map(s => (
                  <div
                    key={`${s.id}-${dayIso}`}
                    onClick={() => openEdit(s)}
                    className={`w-full text-left bg-panel-2 border border-brand rounded-lg px-2 py-1.5 group relative ${canManage ? 'cursor-pointer hover:border-brand hover:bg-raised transition-colors' : ''}`}
                  >
                    <div className="text-[10px] font-semibold text-brand-lit truncate">{s.user?.name?.split(' ')[0]}</div>
                    <div className="text-[9px] text-muted">{shiftTimeLabel(s)}</div>
                    {s.shift_date !== dayIso && (
                      <div className="text-[9px] text-brand">Carryover from previous day</div>
                    )}
                    {s.notes && <div className="text-[9px] text-faint truncate mt-0.5">{s.notes}</div>}
                    {canCreateRo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          createRoFromShift(s.id)
                        }}
                        disabled={creatingRoShiftId === s.id}
                        className="mt-1 rounded-md border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold text-gold transition-colors hover:bg-gold/15 disabled:opacity-60"
                      >
                        {creatingRoShiftId === s.id ? 'Creating…' : 'Create RO'}
                      </button>
                    )}
                    {canManage && (
                      <button onClick={(e) => { e.stopPropagation(); deleteShift(s.id) }}
                        className="absolute right-1 top-1 rounded p-0.5 text-faint opacity-0 transition-all hover:text-crit group-hover:opacity-100">
                        <Trash2 size={10}/>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {canManage && (
                <button onClick={() => openAdd(date)}
                  className="mt-1 w-full text-[9px] text-faint hover:text-brand hover:bg-panel-2 rounded py-1 transition-colors flex items-center justify-center gap-1">
                  <Plus size={9}/> Add
                </button>
              )}
            </div>
          )
        })}
      </div>
      </div>
      ) : (
        /* Monthly grid */
        <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 min-w-[420px]">
          {/* Day headers */}
          {MONTH_DAYS.map(day => (
            <div key={day} className="text-[10px] font-bold text-faint uppercase text-center py-2">
              {day}
            </div>
          ))}
          {/* Calendar days */}
          {getMonthDays().map((date, i) => {
            const dayShifts = shiftsFor(date)
            const isToday = isoDate(date) === today
            const isCurrentMonth = date.getMonth() === currentMonth.getMonth()
            return (
              <div 
                key={i}
                onClick={() => goToWeek(date)}
                className={`bg-panel rounded-lg border min-h-[80px] p-1.5 cursor-pointer hover:border-brand transition-colors ${
                  isCurrentMonth
                    ? (isToday ? 'border-brand' : 'border-line-2')
                    : 'border-transparent bg-void'
                }`}
              >
                <div className={`text-[10px] font-medium mb-1 ${
                  isCurrentMonth 
                    ? (isToday ? 'text-brand' : 'text-muted')
                    : 'text-faint'
                }`}>
                  {date.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayShifts.slice(0, 2).map(s => (
                    <div
                      key={`${s.id}-${isoDate(date)}`}
                      className="w-full rounded border border-brand bg-panel-2 px-1.5 py-0.5"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(s)
                        }}
                        title={shiftTimeLabel(s)}
                        className={`w-full text-left ${canManage ? 'hover:text-ink transition-colors' : ''}`}
                      >
                        <div className="text-[8px] font-semibold text-brand-lit truncate">{s.user?.name?.split(' ')[0]}</div>
                      </button>
                      {canCreateRo && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            createRoFromShift(s.id)
                          }}
                          disabled={creatingRoShiftId === s.id}
                          className="mt-0.5 text-[8px] font-semibold text-gold transition-colors hover:text-gold-lit disabled:opacity-60"
                        >
                          {creatingRoShiftId === s.id ? 'Creating…' : 'Create RO'}
                        </button>
                      )}
                    </div>
                  ))}
                  {dayShifts.length > 2 && (
                    <div className="text-[8px] text-faint text-center">+{dayShifts.length - 2} more</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        </div>
      )}

      {/* Tech summary */}
      {canManage && (
        <div className="bg-panel rounded-instrument border border-line-2 p-4">
          <h2 className="text-xs font-bold text-ink uppercase tracking-wide mb-3">
            {viewMode === 'week' ? 'This Week — Team Schedule' : 'This Month — Team Schedule'}
          </h2>
          {shifts.length === 0 ? (
            <p className="text-xs text-faint">No shifts scheduled in this view yet.</p>
          ) : (
          <div className="space-y-2">
            {employees.map(emp => {
              const empShifts = shifts.filter(s => s.user_id === emp.id)
              if (empShifts.length === 0) return null
              const totalHours = empShifts.reduce((sum, s) => sum + shiftDurationHours(s), 0)
              const hasShiftToday = empShifts.some(s => s.shift_date === today)

              return (
                <div key={emp.id} className="flex items-center justify-between text-xs gap-3">
                  <span className="text-ink font-medium">{emp.name}</span>
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    <span className="text-faint">{empShifts.length} shift{empShifts.length!==1?'s':''}</span>
                    <span className="text-brand font-semibold">{totalHours.toFixed(1)}h scheduled</span>
                    {hasShiftToday && canAuthorizeEarly && (
                      authorizedToday[emp.id] ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-good/10 px-2 py-1 text-[10px] font-semibold text-good"><CheckCircle size={10} /> Authorized for today</span>
                      ) : (
                        <button
                          onClick={() => setAuthModalEmployee(emp)}
                          className="rounded-full border border-brand/40 bg-brand/10 px-2 py-1 text-[10px] text-brand transition-colors hover:bg-brand/15"
                        >
                          Allow Early Today
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          )}
        </div>
      )}

      {showAdd && (
        <ShiftModal
          employees={employees}
          prefill={prefill}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}

      {editingShift && (
        <ShiftModal
          employees={employees}
          shift={editingShift}
          onClose={() => setEditingShift(null)}
          onSaved={() => { setEditingShift(null); load() }}
          onDeleted={() => { setEditingShift(null); load() }}
        />
      )}

      {authModalEmployee && (
        <EarlyAuthModal
          employee={authModalEmployee}
          onClose={() => setAuthModalEmployee(null)}
          onSuccess={(employeeId) => {
            setAuthorizedToday(prev => ({ ...prev, [employeeId]: true }))
            setAuthModalEmployee(null)
          }}
        />
      )}
    </div>
  )
}
