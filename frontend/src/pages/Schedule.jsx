import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Save } from 'lucide-react'
import api from '../lib/api'
import { isAdmin } from '../lib/auth'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

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

function AddShiftModal({ employees, prefill, onClose, onSaved }) {
  const [form, setForm] = useState({
    user_id: prefill?.user_id || (employees[0]?.id || ''),
    shift_date: prefill?.date || '',
    start_time: '08:00',
    end_time: '17:00',
    notes: ''
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1'

  async function save() {
    if (!form.user_id || !form.shift_date) { setErr('Select employee and date.'); return }
    setSaving(true); setErr('')
    try {
      await api.post('/schedule', form)
      onSaved()
    } catch (e) {
      setErr(e?.response?.data?.error || 'Error saving shift')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">Add Shift</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16}/></button>
        </div>
        <div className="space-y-3">
          <div><label className={lbl}>Employee</label>
            <select className={inp} value={form.user_id} onChange={e => setForm(f=>({...f,user_id:e.target.value}))}>
              <option value="">— select —</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select></div>
          <div><label className={lbl}>Date</label>
            <input className={inp} type="date" value={form.shift_date} onChange={e => setForm(f=>({...f,shift_date:e.target.value}))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Start Time</label>
              <input className={inp} type="time" value={form.start_time} onChange={e => setForm(f=>({...f,start_time:e.target.value}))} /></div>
            <div><label className={lbl}>End Time</label>
              <input className={inp} type="time" value={form.end_time} onChange={e => setForm(f=>({...f,end_time:e.target.value}))} /></div>
          </div>
          <div><label className={lbl}>Notes (optional)</label>
            <input className={inp} placeholder="Any instructions…" value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} /></div>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-between pt-2">
          <button onClick={onClose} className="text-slate-400 text-sm hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            <Save size={14}/> {saving ? 'Saving…' : 'Add Shift'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Schedule() {
  const [monday, setMonday] = useState(getMonday())
  const [shifts, setShifts] = useState([])
  const [employees, setEmployees] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [prefill, setPrefill] = useState(null)
  const admin = isAdmin()

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })

  async function load() {
    const [s, e] = await Promise.all([
      api.get(`/schedule?week=${isoDate(monday)}`),
      admin ? api.get('/schedule/employees') : Promise.resolve({ data: { employees: [] } })
    ])
    setShifts(s.data.shifts || [])
    setEmployees(e.data.employees || [])
  }
  useEffect(() => { load() }, [monday])

  function prevWeek() { const d = new Date(monday); d.setDate(d.getDate()-7); setMonday(d) }
  function nextWeek() { const d = new Date(monday); d.setDate(d.getDate()+7); setMonday(d) }
  function thisWeek() { setMonday(getMonday()) }

  function shiftsFor(date) {
    const iso = isoDate(date)
    return shifts.filter(s => s.shift_date === iso)
  }

  async function deleteShift(id) {
    if (!confirm('Remove this shift?')) return
    await api.delete(`/schedule/${id}`)
    load()
  }

  function openAdd(date = null, user_id = null) {
    setPrefill({ date: date ? isoDate(date) : '', user_id: user_id || '' })
    setShowAdd(true)
  }

  const today = isoDate(new Date())

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Schedule</h1>
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#2a2d3e] transition-colors"><ChevronLeft size={16}/></button>
          <button onClick={thisWeek} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-[#2a2d3e] border border-[#2a2d3e] transition-colors">This Week</button>
          <button onClick={nextWeek} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#2a2d3e] transition-colors"><ChevronRight size={16}/></button>
          {admin && (
            <button onClick={() => openAdd()} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
              <Plus size={14}/> Add Shift
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-500">
        Week of {fmtHeader(monday)} — {fmtHeader(weekDates[6])}
      </div>

      {/* Weekly grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {weekDates.map((date, i) => {
          const dayShifts = shiftsFor(date)
          const isToday = isoDate(date) === today
          return (
            <div key={i} className={`bg-[#1a1d2e] rounded-xl border ${isToday ? 'border-indigo-600/60' : 'border-[#2a2d3e]'} p-2 min-h-[120px] flex flex-col`}>
              <div className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${isToday ? 'text-indigo-400' : 'text-slate-500'}`}>
                {DAYS[i]}<br/>
                <span className={`text-xs ${isToday ? 'text-indigo-300' : 'text-slate-400'}`}>{fmtHeader(date)}</span>
              </div>
              <div className="flex-1 space-y-1">
                {dayShifts.map(s => (
                  <div key={s.id} className="bg-indigo-900/30 border border-indigo-700/40 rounded-lg px-2 py-1.5 group relative">
                    <div className="text-[10px] font-semibold text-indigo-300 truncate">{s.user?.name?.split(' ')[0]}</div>
                    <div className="text-[9px] text-slate-400">{s.start_time} – {s.end_time}</div>
                    {s.notes && <div className="text-[9px] text-slate-500 truncate mt-0.5">{s.notes}</div>}
                    {admin && (
                      <button onClick={() => deleteShift(s.id)}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-red-400 transition-all">
                        <Trash2 size={10}/>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {admin && (
                <button onClick={() => openAdd(date)}
                  className="mt-1 w-full text-[9px] text-slate-600 hover:text-indigo-400 hover:bg-indigo-900/20 rounded py-1 transition-colors flex items-center justify-center gap-1">
                  <Plus size={9}/> Add
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Employee summary (admin only) */}
      {admin && shifts.length > 0 && (
        <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] p-4">
          <h2 className="text-xs font-bold text-white uppercase tracking-wide mb-3">This Week — Staffing Summary</h2>
          <div className="space-y-2">
            {employees.map(emp => {
              const empShifts = shifts.filter(s => s.user_id === emp.id)
              if (empShifts.length === 0) return null
              const totalHours = empShifts.reduce((sum, s) => {
                const [sh, sm] = s.start_time.split(':').map(Number)
                const [eh, em] = s.end_time.split(':').map(Number)
                return sum + (eh + em/60) - (sh + sm/60)
              }, 0)
              return (
                <div key={emp.id} className="flex items-center justify-between text-xs">
                  <span className="text-white font-medium">{emp.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">{empShifts.length} shift{empShifts.length!==1?'s':''}</span>
                    <span className="text-indigo-400 font-semibold">{totalHours.toFixed(1)}h scheduled</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showAdd && (
        <AddShiftModal
          employees={employees}
          prefill={prefill}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}
    </div>
  )
}
