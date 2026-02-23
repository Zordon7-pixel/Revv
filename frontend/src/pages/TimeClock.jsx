import { useEffect, useState } from 'react'
import { Clock, CheckCircle, AlertCircle, Edit2, Trash2, Save, X, MapPin } from 'lucide-react'
import api from '../lib/api'
import { getTokenPayload, isAdmin } from '../lib/auth'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true })
}
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true })
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
}
function fmtHours(h) {
  if (h == null) return '—'
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return hrs > 0 ? `${hrs}h ${min}m` : `${min}m`
}

function LiveTimer({ clockIn }) {
  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    function tick() {
      const ms = Date.now() - new Date(clockIn).getTime()
      const h = Math.floor(ms / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      setElapsed(`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [clockIn])
  return <span className="font-mono text-4xl font-bold text-indigo-400">{elapsed}</span>
}

function AdminAdjustModal({ entry, onClose, onSaved }) {
  const [form, setForm] = useState({
    clock_in:  entry.clock_in  ? entry.clock_in.slice(0,16)  : '',
    clock_out: entry.clock_out ? entry.clock_out.slice(0,16) : '',
    admin_note: entry.admin_note || ''
  })
  const [saving, setSaving] = useState(false)
  const inp = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1'

  async function save() {
    setSaving(true)
    try {
      await api.put(`/timeclock/${entry.id}`, {
        clock_in:  form.clock_in  ? new Date(form.clock_in).toISOString()  : undefined,
        clock_out: form.clock_out ? new Date(form.clock_out).toISOString() : undefined,
        admin_note: form.admin_note
      })
      onSaved()
    } catch { alert('Error saving') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">Adjust Time Entry</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16}/></button>
        </div>
        <div className="text-xs text-slate-500 bg-[#0f1117] rounded-lg px-3 py-2">
          {entry.user?.name} · {fmtDate(entry.clock_in)}
        </div>
        <div className="space-y-3">
          <div><label className={lbl}>Clock In</label>
            <input className={inp} type="datetime-local" value={form.clock_in} onChange={e => setForm(f=>({...f,clock_in:e.target.value}))} /></div>
          <div><label className={lbl}>Clock Out</label>
            <input className={inp} type="datetime-local" value={form.clock_out} onChange={e => setForm(f=>({...f,clock_out:e.target.value}))} /></div>
          <div><label className={lbl}>Admin Note (reason for adjustment)</label>
            <input className={inp} placeholder="e.g. System error at clock-out" value={form.admin_note} onChange={e => setForm(f=>({...f,admin_note:e.target.value}))} /></div>
        </div>
        <div className="flex justify-between pt-2">
          <button onClick={onClose} className="text-slate-400 text-sm hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            <Save size={14}/> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EarlyOverrideModal({ onClose, onSubmit, error, submitting }) {
  const [password, setPassword] = useState('')

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">Admin Password Required</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16}/></button>
        </div>
        <label className="block text-xs text-slate-400">Admin Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          placeholder="Enter admin password"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-slate-400 text-sm hover:text-white">Cancel</button>
          <button
            onClick={() => onSubmit(password)}
            disabled={!password || submitting}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TimeClock() {
  const [status, setStatus]   = useState(null)
  const [entries, setEntries] = useState([])
  const [todayShift, setTodayShift] = useState(null)
  const [locError, setLocError] = useState('')
  const [actionErr, setActionErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [adjustEntry, setAdjustEntry] = useState(null)
  const [earlyBlock, setEarlyBlock] = useState(null)
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [overrideError, setOverrideError] = useState('')
  const [overrideSubmitting, setOverrideSubmitting] = useState(false)

  const admin = isAdmin()
  const currentUser = getTokenPayload()

  async function refresh() {
    const [s, e, sh] = await Promise.all([
      api.get('/timeclock/status'),
      api.get('/timeclock/entries'),
      api.get('/schedule/today'),
    ])
    setStatus(s.data)
    setEntries(e.data.entries || [])
    setTodayShift(sh.data.shift)
  }
  useEffect(() => { refresh() }, [])

  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject('Geolocation not supported by this browser.'); return }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject('Location access denied. Please allow location access and try again.'),
        { timeout: 10000, maximumAge: 0 }
      )
    })
  }

  async function clockIn() {
    setLoading(true); setActionErr(''); setLocError(''); setEarlyBlock(null)
    try {
      const { lat, lng } = await getLocation().catch(e => { setLocError(e); setLoading(false); throw e })
      await api.post('/timeclock/in', { lat, lng })
      await refresh()
    } catch (e) {
      if (e?.response?.status === 403 && e?.response?.data?.error === 'early') {
        setEarlyBlock(e.response.data)
      } else if (e?.response?.data?.error) {
        setActionErr(e.response.data.error)
      }
    } finally { setLoading(false) }
  }

  async function submitOverride(password) {
    if (!currentUser?.id) return
    setOverrideSubmitting(true)
    setOverrideError('')
    try {
      await api.post('/timeclock/authorize-early', {
        employee_id: currentUser.id,
        admin_password: password,
      })
      setShowOverrideModal(false)
      setEarlyBlock(null)
      await clockIn()
    } catch (e) {
      setOverrideError(e?.response?.data?.message || 'Incorrect admin password')
    } finally {
      setOverrideSubmitting(false)
    }
  }

  async function clockOut() {
    setLoading(true); setActionErr(''); setLocError('')
    try {
      const { lat, lng } = await getLocation().catch(e => { setLocError(e); setLoading(false); throw e })
      await api.post('/timeclock/out', { lat, lng })
      await refresh()
    } catch (e) {
      if (e?.response?.data?.error) setActionErr(e.response.data.error)
    } finally { setLoading(false) }
  }

  async function deleteEntry(id) {
    if (!confirm('Delete this time entry?')) return
    await api.delete(`/timeclock/${id}`)
    await refresh()
  }

  if (!status) return <div className="flex items-center justify-center h-64 text-slate-500">Loading…</div>

  const clocked = status.clocked_in
  const open    = status.entry

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold text-white">Time Clock</h1>

      {todayShift ? (
        <div className="bg-indigo-900/20 border border-indigo-700/40 rounded-xl p-4 flex items-center gap-3">
          <Clock size={18} className="text-indigo-400 flex-shrink-0" />
          <div>
            <div className="text-sm font-semibold text-white">Today's Shift: {todayShift.start_time} — {todayShift.end_time}</div>
            {todayShift.notes && <div className="text-xs text-slate-400 mt-0.5">{todayShift.notes}</div>}
          </div>
        </div>
      ) : (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 text-xs text-slate-500 flex items-center gap-2">
          <Clock size={14}/> No shift scheduled for today.
        </div>
      )}

      <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] p-6 flex flex-col items-center gap-5">
        {clocked ? (
          <>
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Clocked in since {fmtTime(open?.clock_in)}
            </div>
            <LiveTimer clockIn={open?.clock_in} />
            {open?.is_late ? (
              <div className="flex items-center gap-2 text-amber-400 text-xs">
                <AlertCircle size={14}/> Clocked in {open.late_minutes} min late
              </div>
            ) : (
              <div className="flex items-center gap-2 text-emerald-400 text-xs">
                <CheckCircle size={14}/> On time
              </div>
            )}
            <button onClick={clockOut} disabled={loading}
              className="w-full max-w-xs bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl py-4 text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              <Clock size={18}/> {loading ? 'Getting location…' : 'Clock Out'}
            </button>
          </>
        ) : (
          <>
            <div className="text-slate-500 text-sm">You are not clocked in</div>
            <div className="font-mono text-4xl font-bold text-slate-600">
              {new Date().toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true })}
            </div>
            <button onClick={clockIn} disabled={loading}
              className="w-full max-w-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl py-4 text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              <Clock size={18}/> {loading ? 'Getting location…' : 'Clock In'}
            </button>
          </>
        )}

        {earlyBlock && (
          <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-3 w-full text-xs text-amber-200 space-y-2">
            <div>Your shift doesn't start until {earlyBlock.shiftStart}. Early clock-in is not authorized.</div>
            <button
              onClick={() => { setOverrideError(''); setShowOverrideModal(true) }}
              className="bg-amber-700/30 hover:bg-amber-700/50 border border-amber-700/50 text-amber-100 px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              Request Admin Override
            </button>
          </div>
        )}

        {(locError || actionErr) && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-3 flex items-start gap-2 text-xs text-red-300 w-full">
            <MapPin size={14} className="text-red-400 flex-shrink-0 mt-0.5"/>
            <span>{locError || actionErr}</span>
          </div>
        )}
        <p className="text-[10px] text-slate-600 flex items-center gap-1"><MapPin size={10}/> Location is verified at clock-in and clock-out</p>
      </div>

      <div className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] p-4">
        <h2 className="text-sm font-bold text-white mb-3">{admin ? 'All Time Entries' : 'My Time Entries'}</h2>
        {entries.length === 0 && <p className="text-xs text-slate-500 py-4 text-center">No entries yet.</p>}
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.id} className="bg-[#0f1117] rounded-xl p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                {admin && <div className="text-xs font-semibold text-indigo-400 mb-0.5">{e.user?.name}</div>}
                <div className="text-xs text-white">
                  {fmtDate(e.clock_in)} · In: {fmtTime(e.clock_in)} → Out: {fmtTime(e.clock_out)}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-xs text-slate-400">{fmtHours(e.total_hours)}</span>
                  {e.is_late ? (
                    <span className="text-[10px] bg-amber-900/40 text-amber-400 px-2 py-0.5 rounded-full font-semibold">
                      Late {e.late_minutes}min
                    </span>
                  ) : e.clock_in ? (
                    <span className="text-[10px] bg-emerald-900/40 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">
                      On Time
                    </span>
                  ) : null}
                  {!e.clock_out && (
                    <span className="text-[10px] bg-indigo-900/40 text-indigo-400 px-2 py-0.5 rounded-full font-semibold animate-pulse">
                      Active
                    </span>
                  )}
                  {e.adjusted_by && (
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                      <Edit2 size={10} /> Adjusted
                    </span>
                  )}
                </div>
                {e.admin_note && <div className="text-[10px] text-slate-500 mt-1 italic">{e.admin_note}</div>}
              </div>
              {admin && (
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setAdjustEntry(e)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-900/20 transition-colors">
                    <Edit2 size={14}/>
                  </button>
                  <button onClick={() => deleteEntry(e.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-colors">
                    <Trash2 size={14}/>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {adjustEntry && (
        <AdminAdjustModal
          entry={adjustEntry}
          onClose={() => setAdjustEntry(null)}
          onSaved={() => { setAdjustEntry(null); refresh() }}
        />
      )}

      {showOverrideModal && (
        <EarlyOverrideModal
          onClose={() => setShowOverrideModal(false)}
          onSubmit={submitOverride}
          error={overrideError}
          submitting={overrideSubmitting}
        />
      )}
    </div>
  )
}
