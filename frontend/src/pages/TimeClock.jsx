import { useEffect, useState } from 'react'
import { Clock, CheckCircle, AlertCircle, Edit2, Trash2, Save, X, MapPin } from 'lucide-react'
import api from '../lib/api'
import { getTokenPayload, isAdmin } from '../lib/auth'
import AppOverlay from '../components/AppOverlay'
import { EmptyState, PageHeader, Panel } from '../components/ui'

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
  return <span className="font-mono text-4xl font-bold tabular-nums text-brand">{elapsed}</span>
}

function AdminAdjustModal({ entry, onClose, onSaved }) {
  const [form, setForm] = useState({
    clock_in:  entry.clock_in  ? entry.clock_in.slice(0,16)  : '',
    clock_out: entry.clock_out ? entry.clock_out.slice(0,16) : '',
    admin_note: entry.admin_note || ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inp = 'w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink outline-none focus:border-brand'
  const lbl = 'mb-1 block text-xs font-medium text-muted'

  async function save() {
    setSaving(true)
    setError('')
    try {
      await api.put(`/timeclock/${entry.id}`, {
        clock_in:  form.clock_in  ? new Date(form.clock_in).toISOString()  : undefined,
        clock_out: form.clock_out ? new Date(form.clock_out).toISOString() : undefined,
        admin_note: form.admin_note
      })
      onSaved()
    } catch (err) {
      setError(err?.response?.data?.error || 'Error saving time entry.')
    } finally { setSaving(false) }
  }

  return (
    <AppOverlay label="Adjust time entry" onClose={onClose} className="bg-black/70 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-instrument border border-line bg-panel p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-ink">Adjust time entry</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Close time adjustment"><X size={16}/></button>
        </div>
        <div className="rounded-lg bg-void px-3 py-2 text-xs text-muted">
          {entry.user?.name} - {fmtDate(entry.clock_in)}
        </div>
        <div className="space-y-3">
          <div><label className={lbl}>Clock In</label>
            <input className={inp} type="datetime-local" value={form.clock_in} onChange={e => setForm(f=>({...f,clock_in:e.target.value}))} /></div>
          <div><label className={lbl}>Clock Out</label>
            <input className={inp} type="datetime-local" value={form.clock_out} onChange={e => setForm(f=>({...f,clock_out:e.target.value}))} /></div>
          <div><label className={lbl}>Admin Note (reason for adjustment)</label>
            <input className={inp} placeholder="e.g. System error at clock-out" value={form.admin_note} onChange={e => setForm(f=>({...f,admin_note:e.target.value}))} /></div>
        </div>
        {error && <p className="text-xs text-crit" role="alert">{error}</p>}
        <div className="flex justify-between pt-2">
          <button type="button" onClick={onClose} className="text-sm text-muted hover:text-ink">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
            <Save size={14}/> {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </AppOverlay>
  )
}

function EarlyOverrideModal({ onClose, onSubmit, error, submitting }) {
  const [password, setPassword] = useState('')

  return (
    <AppOverlay label="Authorize early clock-in" onClose={onClose} className="bg-black/70 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-instrument border border-line bg-panel p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-ink">Admin password required</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Close early clock-in override"><X size={16}/></button>
        </div>
        <label className="block text-xs text-muted">Admin password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          placeholder="Enter admin password"
        />
        {error && <p className="text-xs text-crit" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-muted hover:text-ink">Cancel</button>
          <button
            onClick={() => onSubmit(password)}
            disabled={!password || submitting}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-lit disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </AppOverlay>
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
  const [lunchStatus, setLunchStatus] = useState({ on_lunch: false, lunch: null })

  const admin = isAdmin()
  const currentUser = getTokenPayload()

  async function refresh() {
    const [s, e, sh, l] = await Promise.all([
      api.get('/timeclock/status'),
      api.get('/timeclock/entries'),
      api.get('/schedule/today'),
      api.get('/timeclock/lunch/status'),
    ])
    setStatus(s.data)
    setEntries(e.data.entries || [])
    setTodayShift(sh.data.shift)
    setLunchStatus(l.data)
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
    try {
      await api.delete(`/timeclock/${id}`)
      await refresh()
    } catch (err) {
      setActionErr(err?.response?.data?.error || 'Failed to delete entry')
    }
  }

  async function startLunch() {
    setLoading(true)
    setActionErr('')
    try {
      await api.post('/timeclock/lunch/start')
      await refresh()
    } catch (e) {
      setActionErr(e?.response?.data?.error || 'Failed to start lunch')
    } finally {
      setLoading(false)
    }
  }

  async function endLunch() {
    setLoading(true)
    setActionErr('')
    try {
      await api.post('/timeclock/lunch/end')
      await refresh()
    } catch (e) {
      setActionErr(e?.response?.data?.error || 'Failed to end lunch')
    } finally {
      setLoading(false)
    }
  }

  if (!status) return <Panel><div className="grid min-h-64 place-items-center text-sm text-muted" role="status">Loading time clock...</div></Panel>

  const clocked = status.clocked_in
  const open    = status.entry

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader eyebrow="Team operations" title="Time clock" description={admin ? 'Clock status and all team entries' : 'Clock status and your recent entries'} />

      {todayShift ? (
        <div className="flex items-center gap-3 rounded-instrument border border-brand/30 bg-brand/10 p-4">
          <Clock size={18} className="flex-shrink-0 text-brand" />
          <div>
            <div className="text-sm font-semibold text-ink">
              Today's shift: {todayShift.start_time} - {todayShift.end_time}{shiftCrossesNextDay(todayShift) ? ' (+1d)' : ''}
            </div>
            {todayShift.shift_date && todayShift.shift_date !== new Date().toISOString().slice(0, 10) && (
              <div className="mt-0.5 text-[11px] text-brand">Carryover from previous day</div>
            )}
            {todayShift.notes && <div className="mt-0.5 text-xs text-muted">{todayShift.notes}</div>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-instrument border border-line bg-panel p-4 text-xs text-faint">
          <Clock size={14}/> No shift scheduled for today.
        </div>
      )}

      <Panel className="flex flex-col items-center gap-5 p-6">
        {clocked ? (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold text-good">
              <div className="h-2 w-2 animate-pulse rounded-full bg-good" />
              Clocked in since {fmtTime(open?.clock_in)}
            </div>
            <LiveTimer clockIn={open?.clock_in} />
            {open?.is_late ? (
              <div className="flex items-center gap-2 text-xs text-crit">
                <AlertCircle size={14}/> Clocked in {open.late_minutes} min late
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-good">
                <CheckCircle size={14}/> On time
              </div>
            )}
            <button onClick={clockOut} disabled={loading}
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-crit py-4 text-sm font-bold text-white transition-colors hover:bg-crit/80 disabled:opacity-50">
              <Clock size={18}/> {loading ? 'Getting location...' : 'Clock Out'}
            </button>

            {/* Lunch buttons - show when clocked in */}
            {clocked && (
              <div className="w-full max-w-xs flex gap-2">
                {lunchStatus.on_lunch ? (
                  <button onClick={endLunch} disabled={loading}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line-2 bg-raised py-3 text-sm font-bold text-ink transition-colors hover:border-brand disabled:opacity-50">
                    <Clock size={16}/> {loading ? 'Ending...' : 'End Lunch'}
                  </button>
                ) : (
                  <button onClick={startLunch} disabled={loading}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line-2 bg-raised py-3 text-sm font-bold text-ink transition-colors hover:border-brand disabled:opacity-50">
                    <Clock size={16}/> {loading ? 'Starting...' : 'Start Lunch'}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-sm text-muted">You are not clocked in</div>
            <div className="font-mono text-4xl font-bold tabular-nums text-faint">
              {new Date().toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true })}
            </div>
            <button onClick={clockIn} disabled={loading}
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-brand py-4 text-sm font-bold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
              <Clock size={18}/> {loading ? 'Getting location...' : 'Clock In'}
            </button>
          </>
        )}

        {earlyBlock && (
          <div className="w-full space-y-2 rounded-instrument border border-crit/30 bg-crit/10 p-3 text-xs text-crit" role="alert">
            <div>Your shift doesn't start until {earlyBlock.shiftStart}. Early clock-in is not authorized.</div>
            <button
              onClick={() => { setOverrideError(''); setShowOverrideModal(true) }}
              className="rounded-lg border border-crit/30 bg-panel px-3 py-1.5 text-xs font-semibold text-crit transition-colors hover:bg-crit/10"
            >
              Request Admin Override
            </button>
          </div>
        )}

        {(locError || actionErr) && (
          <div className="flex w-full items-start gap-2 rounded-instrument border border-crit/30 bg-crit/10 p-3 text-xs text-crit" role="alert">
            <MapPin size={14} className="mt-0.5 flex-shrink-0 text-crit"/>
            <span>{locError || actionErr}</span>
          </div>
        )}
        <p className="flex items-center gap-1 text-[10px] text-faint"><MapPin size={10}/> Location is verified at clock-in and clock-out</p>
      </Panel>

      <Panel title={admin ? 'All time entries' : 'My time entries'}>
        {entries.length === 0 && <EmptyState icon={Clock} title="No time entries" description="Completed clock sessions will appear here." className="min-h-40" />}
        <div className="space-y-2 p-3">
          {entries.map(e => (
            <div
              key={e.id}
              onClick={admin ? () => setAdjustEntry(e) : undefined}
              className={`flex items-start gap-3 rounded-instrument border border-line bg-panel-2 p-3 ${admin ? 'cursor-pointer transition hover:border-brand' : ''}`}
            >
              <div className="flex-1 min-w-0">
                {admin && <div className="mb-0.5 text-xs font-semibold text-brand">{e.user?.name}</div>}
                <div className="text-xs text-ink">
                  {fmtDate(e.clock_in)} - In: {fmtTime(e.clock_in)} - Out: {fmtTime(e.clock_out)}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="font-mono text-xs tabular-nums text-muted">{fmtHours(e.total_hours)}</span>
                  {e.is_late ? (
                    <span className="rounded-full bg-crit/10 px-2 py-0.5 text-[10px] font-semibold text-crit">
                      Late {e.late_minutes}min
                    </span>
                  ) : e.clock_in ? (
                    <span className="rounded-full bg-good/10 px-2 py-0.5 text-[10px] font-semibold text-good">
                      On Time
                    </span>
                  ) : null}
                  {!e.clock_out && (
                    <span className="animate-pulse rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                      Active
                    </span>
                  )}
                  {e.adjusted_by && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-[10px] text-muted">
                      <Edit2 size={10} /> Adjusted
                    </span>
                  )}
                </div>
                {e.admin_note && <div className="mt-1 text-[10px] italic text-faint">{e.admin_note}</div>}
              </div>
              {admin && (
                <div className="flex gap-1 flex-shrink-0">
                  <button type="button" onClick={(evt) => { evt.stopPropagation(); setAdjustEntry(e) }} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-brand/10 hover:text-brand" aria-label={`Adjust ${e.user?.name || 'time'} entry`}>
                    <Edit2 size={14}/>
                  </button>
                  <button type="button" onClick={(evt) => { evt.stopPropagation(); deleteEntry(e.id) }} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-crit/10 hover:text-crit" aria-label={`Delete ${e.user?.name || 'time'} entry`}>
                    <Trash2 size={14}/>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

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
