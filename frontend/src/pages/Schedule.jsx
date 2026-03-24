import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Save, CheckCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { isAdmin, isAssistant } from '../lib/auth'

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
  return d.toISOString().slice(0, 10)
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
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
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
  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1'

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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">{isEdit ? 'Edit Shift' : 'Add Shift'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16}/></button>
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
          <p className="text-[10px] text-slate-500 -mt-1">
            If end time is earlier than start time, REVV treats the shift as ending the next day.
          </p>
          <div><label className={lbl}>Lunch (min)</label>
            <input className={inp} type="number" min="0" max="120" value={form.lunch_break_minutes} onChange={e => setForm(f=>({...f,lunch_break_minutes:parseInt(e.target.value)||30}))} /></div>
          <div><label className={lbl}>Notes (optional)</label>
            <input className={inp} placeholder="Any instructions…" value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} /></div>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-between pt-2">
          {isEdit ? (
            <button onClick={deleteShift} disabled={deleting || saving} className="text-red-300 text-sm hover:text-red-200 disabled:opacity-60">
              {deleting ? 'Removing…' : 'Delete Shift'}
            </button>
          ) : (
            <button onClick={onClose} className="text-slate-400 text-sm hover:text-white">Cancel</button>
          )}
          <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            <Save size={14}/> {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Shift')}
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">Admin Password Required</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16}/></button>
        </div>
        <div className="text-xs text-slate-400">Authorize early clock-in for <span className="text-white font-semibold">{employee.name}</span> today.</div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin Password"
          className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-slate-400 text-sm hover:text-white">Cancel</button>
          <button onClick={submit} disabled={saving || !password} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-50">
            {saving ? 'Authorizing…' : 'Authorize'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Schedule() {
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState('week') // 'week' or 'month'
  const [monday, setMonday] = useState(getMonday())
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [shifts, setShifts] = useState([])
  const [employees, setEmployees] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [prefill, setPrefill] = useState(null)
  const [editingShift, setEditingShift] = useState(null)
  const [authModalEmployee, setAuthModalEmployee] = useState(null)
  const [authorizedToday, setAuthorizedToday] = useState({})
  const [creatingRoShiftId, setCreatingRoShiftId] = useState('')
  const [createRoError, setCreateRoError] = useState('')
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
    const d = new Date(currentMonth)
    d.setMonth(d.getMonth() - 1)
    setCurrentMonth(d)
  }

  function nextMonth() {
    const d = new Date(currentMonth)
    d.setMonth(d.getMonth() + 1)
    setCurrentMonth(d)
  }

  function goToWeek(date) {
    const d = new Date(date)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Get Monday
    setMonday(d)
    setViewMode('week')
  }

  async function loadMonthShifts() {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const from = new Date(year, month, 1).toISOString().slice(0, 10)
    const to = new Date(year, month + 1, 0).toISOString().slice(0, 10)
    const [s, e] = await Promise.all([
      api.get(`/schedule?from=${from}&to=${to}`),
      canManage ? api.get('/schedule/employees') : Promise.resolve({ data: { employees: [] } }),
    ])
    setShifts(s.data.shifts || [])
    if (canManage) setEmployees(e.data.employees || [])
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
    const [s, e] = await Promise.all([
      api.get(`/schedule?week=${isoDate(monday)}`),
      canManage ? api.get('/schedule/employees') : Promise.resolve({ data: { employees: [] } })
    ])
    setShifts(s.data.shifts || [])
    setEmployees(e.data.employees || [])
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
    setMonday(getMonday())
    setCurrentMonth(new Date())
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Schedule</h1>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'week'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'month'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Month
            </button>
          </div>
          <button onClick={() => viewMode === 'month' ? prevMonth() : prevWeek()} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#2a2d3e] transition-colors"><ChevronLeft size={16}/></button>
          <button onClick={thisWeek} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-[#2a2d3e] border border-[#2a2d3e] transition-colors">This Week</button>
          <button onClick={() => viewMode === 'month' ? nextMonth() : nextWeek()} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#2a2d3e] transition-colors"><ChevronRight size={16}/></button>
          {canManage && (
            <button onClick={() => openAdd()} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
              <Plus size={14}/> Add Shift
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-500">
        {viewMode === 'week' 
          ? `Week of ${fmtHeader(monday)} — ${fmtHeader(weekDates[6])}`
          : currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        }
      </div>

      {createRoError && (
        <div className="fixed right-4 top-4 z-[90] max-w-xs rounded-lg border border-red-500/40 bg-red-900/85 px-3 py-2 text-xs text-red-100 shadow-lg">
          {createRoError}
        </div>
      )}

      {canManage && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Scheduled Shifts</p>
            <p className="text-lg font-bold text-white mt-1">{shifts.length}</p>
          </div>
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Staff Scheduled</p>
            <p className="text-lg font-bold text-white mt-1">{uniqueScheduledEmployees}</p>
          </div>
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Scheduled Hours</p>
            <p className="text-lg font-bold text-indigo-300 mt-1">{totalScheduledHours.toFixed(1)}h</p>
          </div>
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Coverage</p>
            <p className="text-sm font-semibold text-white mt-1">{staffedDays}/{periodDates.length} days staffed</p>
            <p className="text-[10px] text-slate-500 mt-1">
              Peak: {maxStaffedDay.date ? `${fmtHeader(maxStaffedDay.date)} (${maxStaffedDay.count})` : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Month navigation - only show in month view */}
      {viewMode === 'month' && (
        <div className="flex items-center justify-center gap-4 mb-2">
          <button onClick={prevMonth} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#2a2d3e] transition-colors">
            <ChevronLeft size={16}/>
          </button>
          <button onClick={() => setCurrentMonth(new Date())} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-[#2a2d3e] border border-[#2a2d3e] transition-colors">
            Today
          </button>
          <button onClick={nextMonth} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#2a2d3e] transition-colors">
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
            <div key={i} className={`bg-[#1a1d2e] rounded-xl border ${isToday ? 'border-indigo-600/60' : 'border-[#2a2d3e]'} p-2 min-h-[120px] flex flex-col`}>
              <div className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${isToday ? 'text-indigo-400' : 'text-slate-500'}`}>
                {DAYS[i]}<br/>
                <span className={`text-xs ${isToday ? 'text-indigo-300' : 'text-slate-400'}`}>{fmtHeader(date)}</span>
              </div>
              <div className="flex-1 space-y-1">
                {dayShifts.map(s => (
                  <div
                    key={`${s.id}-${dayIso}`}
                    onClick={() => openEdit(s)}
                    className={`w-full text-left bg-indigo-900/30 border border-indigo-700/40 rounded-lg px-2 py-1.5 group relative ${canManage ? 'cursor-pointer hover:border-indigo-400/70 hover:bg-indigo-900/40 transition-colors' : ''}`}
                  >
                    <div className="text-[10px] font-semibold text-indigo-300 truncate">{s.user?.name?.split(' ')[0]}</div>
                    <div className="text-[9px] text-slate-400">{shiftTimeLabel(s)}</div>
                    {s.shift_date !== dayIso && (
                      <div className="text-[9px] text-cyan-300">Carryover from previous day</div>
                    )}
                    {s.notes && <div className="text-[9px] text-slate-500 truncate mt-0.5">{s.notes}</div>}
                    {canCreateRo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          createRoFromShift(s.id)
                        }}
                        disabled={creatingRoShiftId === s.id}
                        className="mt-1 rounded-md border border-emerald-600/40 bg-emerald-900/25 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-60"
                      >
                        {creatingRoShiftId === s.id ? 'Creating…' : 'Create RO'}
                      </button>
                    )}
                    {canManage && (
                      <button onClick={(e) => { e.stopPropagation(); deleteShift(s.id) }}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-red-400 transition-all">
                        <Trash2 size={10}/>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {canManage && (
                <button onClick={() => openAdd(date)}
                  className="mt-1 w-full text-[9px] text-slate-600 hover:text-indigo-400 hover:bg-indigo-900/20 rounded py-1 transition-colors flex items-center justify-center gap-1">
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
            <div key={day} className="text-[10px] font-bold text-slate-500 uppercase text-center py-2">
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
                className={`bg-[#1a1d2e] rounded-lg border min-h-[80px] p-1.5 cursor-pointer hover:border-indigo-500/50 transition-colors ${
                  isCurrentMonth 
                    ? (isToday ? 'border-indigo-600/60' : 'border-[#2a2d3e]') 
                    : 'border-transparent bg-[#0f1117]'
                }`}
              >
                <div className={`text-[10px] font-medium mb-1 ${
                  isCurrentMonth 
                    ? (isToday ? 'text-indigo-400' : 'text-slate-400')
                    : 'text-slate-700'
                }`}>
                  {date.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayShifts.slice(0, 2).map(s => (
                    <div
                      key={`${s.id}-${isoDate(date)}`}
                      className="w-full rounded border border-indigo-700/40 bg-indigo-900/30 px-1.5 py-0.5"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(s)
                        }}
                        title={shiftTimeLabel(s)}
                        className={`w-full text-left ${canManage ? 'hover:text-indigo-100 transition-colors' : ''}`}
                      >
                        <div className="text-[8px] font-semibold text-indigo-300 truncate">{s.user?.name?.split(' ')[0]}</div>
                      </button>
                      {canCreateRo && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            createRoFromShift(s.id)
                          }}
                          disabled={creatingRoShiftId === s.id}
                          className="mt-0.5 text-[8px] font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-60"
                        >
                          {creatingRoShiftId === s.id ? 'Creating…' : 'Create RO'}
                        </button>
                      )}
                    </div>
                  ))}
                  {dayShifts.length > 2 && (
                    <div className="text-[8px] text-slate-500 text-center">+{dayShifts.length - 2} more</div>
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
        <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-white uppercase tracking-wide mb-3">
            {viewMode === 'week' ? 'This Week — Team Schedule' : 'This Month — Team Schedule'}
          </h2>
          {shifts.length === 0 ? (
            <p className="text-xs text-slate-500">No shifts scheduled in this view yet.</p>
          ) : (
          <div className="space-y-2">
            {employees.map(emp => {
              const empShifts = shifts.filter(s => s.user_id === emp.id)
              if (empShifts.length === 0) return null
              const totalHours = empShifts.reduce((sum, s) => sum + shiftDurationHours(s), 0)
              const hasShiftToday = empShifts.some(s => s.shift_date === today)

              return (
                <div key={emp.id} className="flex items-center justify-between text-xs gap-3">
                  <span className="text-white font-medium">{emp.name}</span>
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    <span className="text-slate-500">{empShifts.length} shift{empShifts.length!==1?'s':''}</span>
                    <span className="text-indigo-400 font-semibold">{totalHours.toFixed(1)}h scheduled</span>
                    {hasShiftToday && canAuthorizeEarly && (
                      authorizedToday[emp.id] ? (
                        <span className="text-[10px] bg-emerald-900/40 text-emerald-400 px-2 py-1 rounded-full font-semibold inline-flex items-center gap-1"><CheckCircle size={10} /> Authorized for today</span>
                      ) : (
                        <button
                          onClick={() => setAuthModalEmployee(emp)}
                          className="text-[10px] bg-amber-900/40 text-amber-300 border border-amber-700/40 px-2 py-1 rounded-full hover:bg-amber-800/40"
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
