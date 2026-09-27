import { useEffect, useState } from 'react'
import api from '../lib/api'
import AppOverlay from './AppOverlay'

import { PART_DELIVERY_LABELS } from '../lib/partDelivery'
const inputClass='w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink'
export default function PartDeliveryEditor({part, onClose, onSaved}) {
  const [form,setForm]=useState(() => ({vendor:part.vendor||'',supplier_order_ref:part.supplier_order_ref||'',status:part.status,expected_date:part.expected_date||'',eta_source:part.eta_source||'unknown',tracking_number:part.tracking_number||'',received_quantity:part.received_quantity??0,customer_note:part.customer_note||'',notes:part.notes||''}))
  const [events,setEvents]=useState([]), [historyError,setHistoryError]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [conflict,setConflict]=useState(false)
  useEffect(()=>{let active=true;api.get(`/parts/${part.id}/delivery-history`).then(r=>{if(active)setEvents(r.data.events||[])}).catch(()=>{if(active)setHistoryError('History could not be loaded.')});return()=>{active=false}},[part.id])
  const change=(key,value)=>setForm(f=>({...f,[key]:value}))
  async function save(e) {
    e.preventDefault();setError('');setBusy(true)
    try {const {data}=await api.put(`/parts/${part.id}/delivery`,{...form,received_quantity:Number(form.received_quantity),delivery_revision:part.delivery_revision});onSaved(data)}
    catch(e) {setError(e.response?.data?.error||'Could not save delivery details.');if(e.response?.status===409)setConflict(true)} finally {setBusy(false)}
  }
  return <AppOverlay label="Update part delivery" onClose={()=>{if(!busy)onClose()}} className="bg-black/50 p-3">
    <form onSubmit={save} className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-instrument border border-line-2 bg-panel p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-ink">Update part delivery</h2><p className="break-words text-sm text-muted">{part.part_name} · {part.quantity} ordered</p></div><button type="button" onClick={onClose} disabled={busy} className="revv-btn revv-btn-secondary">Close</button></div>
      <p className="text-xs text-muted">Supplier details stay in REVV. Saving updates the customer tracking page; no text or email is sent.</p>
      {error&&<p role="alert" className="text-sm text-crit">{error}{conflict&&' Close this form and reopen it after reloading the order.'}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">Supplier<input className={inputClass} maxLength={160} value={form.vendor} onChange={e=>change('vendor',e.target.value)}/></label>
        <label className="text-xs text-muted">Supplier order reference<input className={inputClass} maxLength={160} value={form.supplier_order_ref} onChange={e=>change('supplier_order_ref',e.target.value)}/></label>
        <label className="text-xs text-muted">Order status<select className={inputClass} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value,received_quantity:e.target.value==='received'?part.quantity:f.received_quantity}))}>{Object.entries(PART_DELIVERY_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-xs text-muted">Quantity received and checked<input className={inputClass} type="number" min="0" max={part.quantity} step="1" required value={form.received_quantity} onChange={e=>change('received_quantity',e.target.value)}/></label>
        <label className="text-xs text-muted">Expected parts arrival<input className={inputClass} type="date" value={form.expected_date} onChange={e=>change('expected_date',e.target.value)}/></label>
        <label className="text-xs text-muted">ETA source<select className={inputClass} value={form.eta_source} onChange={e=>change('eta_source',e.target.value)}><option value="unknown">Not confirmed</option><option value="supplier">Supplier estimate</option><option value="carrier">Carrier estimate</option><option value="shop">Shop estimate</option></select></label>
        <label className="text-xs text-muted sm:col-span-2">Tracking number<input className={inputClass} maxLength={160} value={form.tracking_number} onChange={e=>change('tracking_number',e.target.value)}/></label>
      </div>
      {part.tracking_status==='delivered'&&<p className="rounded-lg border border-brand/30 bg-brand/10 p-3 text-sm text-ink">The carrier reports delivery. Confirm the quantity after the shop checks the shipment.</p>}
      <label className="block text-xs text-muted">Customer-visible update<textarea className={inputClass} rows={3} maxLength={500} value={form.customer_note} onChange={e=>change('customer_note',e.target.value)} placeholder="We are waiting for the remaining headlamp. The supplier is confirming its arrival date."/></label>
      <label className="block text-xs text-muted">Internal notes<textarea className={inputClass} rows={2} maxLength={3000} value={form.notes} onChange={e=>change('notes',e.target.value)}/></label>
      <p className="text-xs text-muted">Parts arrival is an estimate. This does not change the vehicle completion date or add units to general inventory.</p>
      <button type="submit" className="revv-btn revv-btn-primary w-full" disabled={busy||conflict}>{busy?'Saving…':'Save delivery update'}</button>
      <details className="border-t border-line pt-3 text-sm text-muted"><summary>Delivery history</summary>{historyError&&<p>{historyError}</p>}{!events.length&&!historyError&&<p className="mt-2">No delivery changes recorded yet.</p>}<ol className="mt-2 space-y-3">{events.map(event=><li key={event.revision}><p>{new Date(event.created_at).toLocaleString()} · {event.source==='carrier'?'Carrier update':'Shop update'}</p><p className="text-ink">{PART_DELIVERY_LABELS[event.after_state.status]||event.after_state.status} · {event.after_state.received_quantity}/{event.after_state.quantity} received · ETA {event.after_state.expected_date||'not confirmed'}</p>{event.before_state?.expected_date!==event.after_state.expected_date&&<p>Previous ETA: {event.before_state?.expected_date||'not confirmed'}</p>}</li>)}</ol></details>
    </form>
  </AppOverlay>
}
