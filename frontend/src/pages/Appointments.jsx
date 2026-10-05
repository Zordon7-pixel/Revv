import { useEffect, useState } from 'react'
import api from '../lib/api'
import { PageHeader, Panel } from '../components/ui'

export default function Appointments() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/appointments')
      if (!Array.isArray(data?.requests)) throw new Error('Invalid queue')
      setRequests(data.requests)
    } catch { setError('Could not load appointment requests. Please try again.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function update(id, status) {
    if (saving) return
    setSaving(id)
    setError('')
    try {
      await api.put(`/appointments/${encodeURIComponent(id)}`, { status })
      setRequests(previous => previous.filter(request => request.id !== id))
    } catch { setError('Could not update this appointment request. Please try again.') }
    finally { setSaving('') }
  }

  return <div className="mx-auto w-full max-w-4xl space-y-5">
    <PageHeader title="Appointment requests" description="Review requests and contact customers to confirm availability." />
    {error && <div role="alert" className="space-y-2 text-sm text-crit"><p>{error}</p><button type="button" disabled={loading || !!saving} onClick={load} className="rounded-instrument border border-line-2 px-3 py-2">Reload requests</button></div>}
    {loading ? <p role="status" className="text-sm text-muted">Loading appointment requests…</p> : <>
      {!error && requests.length === 0 && <p role="status" className="text-sm text-muted">No pending appointment requests.</p>}
      {requests.map(request => <Panel key={request.id} className="min-w-0 space-y-3 p-4 sm:p-5">
        <h2 className="break-words font-display font-semibold text-ink">{request.name}</h2>
        <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
          {[['Phone', request.phone], ['Email', request.email], ['Vehicle', request.vehicle_info], ['Service', request.service], ['Preferred date', request.preferred_date?.slice(0, 10)], ['Preferred time', request.preferred_time], ['Notes', request.notes]].map(([label, value]) => value && <div key={label} className="min-w-0"><dt className="text-muted">{label}</dt><dd className="whitespace-pre-wrap break-words text-ink">{value}</dd></div>)}
        </dl>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!saving} onClick={() => update(request.id, 'confirmed')} className="rounded-instrument bg-brand px-3 py-2 text-sm text-white disabled:opacity-50">Mark confirmed</button>
          <button type="button" disabled={!!saving} onClick={() => update(request.id, 'declined')} className="rounded-instrument border border-line-2 px-3 py-2 text-sm text-ink disabled:opacity-50">Decline request</button>
        </div>
      </Panel>)}
    </>}
  </div>
}
