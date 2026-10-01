import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Calculator, Car, Eye, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import api from '../lib/api'
import { getRole, isAdmin } from '../lib/auth'
import VehicleDiagram, { vehiclePanelLabel } from './VehicleDiagram'
import CustomerPanelQuote, { quoteMoney } from './CustomerPanelQuote'

const sellFields = ['body_hours', 'refinish_hours', 'body_rate_cents', 'refinish_rate_cents', 'parts_sell_cents', 'materials_sell_cents', 'sublet_sell_cents']
const costFields = ['body_cost_rate_cents', 'refinish_cost_rate_cents', 'parts_cost_cents', 'materials_cost_cents', 'sublet_cost_cents']
const names = { body_hours: 'Body hours', refinish_hours: 'Refinish hours', body_rate_cents: 'Body sell rate', refinish_rate_cents: 'Refinish sell rate', parts_sell_cents: 'Parts sell', materials_sell_cents: 'Materials sell', sublet_sell_cents: 'Sublet sell', body_cost_rate_cents: 'Body cost rate', refinish_cost_rate_cents: 'Refinish cost rate', parts_cost_cents: 'Parts cost', materials_cost_cents: 'Materials cost', sublet_cost_cents: 'Sublet cost' }
const inputClass = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-2 bg-raised px-3 py-2 text-ink'
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-2 bg-raised px-4 py-2 text-sm font-medium text-ink disabled:opacity-40'
const blankPanel = id => ({ panel_id: id, label: vehiclePanelLabel(id), body_style: null, severity: null, damage_type: null, area: null, operation: null, refinish: false, ...Object.fromEntries(sellFields.map(key => [key, null])), customer_notes: '', reviewed: false, preset_version_id: null, photo_ids: [] })
const configured = panel => panel.severity && panel.operation && panel.body_style && sellFields.every(key => panel[key] !== null && panel[key] !== undefined && panel[key] !== '' && Number.isFinite(Number(panel[key])) && Number(panel[key]) >= 0)
const status = panel => !configured(panel) || panel.operation === 'inspection-required' ? 'Incomplete' : panel.reviewed ? 'Reviewed' : 'Configured'
const defaultScenario = { payer: 'cash', provenance: 'shop_prepared', allocation: null }
function NumericField({ name, value, onChange, money = true, unit, max = 99999999.99 }) {
  return <label className="block min-w-0 text-sm text-muted">{name}{unit ?? (money ? ' ($)' : '')}<input className={inputClass} type="number" min="0" max={max} step="0.01" placeholder="Not supplied" value={value == null ? '' : money ? value / 100 : value} onChange={event => {
    const raw = event.target.value
    if (raw === '') onChange(null)
    else if (/^\d+(\.\d{0,2})?$/.test(raw) && Number(raw) <= max) onChange(money ? Math.round(Number(raw) * 100) : Number(raw))
  }} /></label>
}

// A keyed session discards RO-specific state and all late responses on navigation.
export default function PanelEstimator(props) { return <EstimatorSession key={`${props.roId}:${getRole()}`} {...props} /> }
function EstimatorSession({ roId, vehicle, photos = [] }) {
  const base = `/estimate-items/${encodeURIComponent(roId)}/panel-estimator`
  const owner = isAdmin()
  const readOnly = ['customer', 'technician'].includes(getRole()) || !getRole()
  const [availablePhotos, setAvailablePhotos] = useState(photos)
  const [state, setState] = useState(null)
  const [panels, setPanels] = useState([])
  const [scenario, setScenario] = useState(defaultScenario)
  const [adjustments, setAdjustments] = useState({})
  const [active, setActive] = useState(null)
  const [busy, setBusy] = useState('Loading estimator')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(null)
  const [reviewed, setReviewed] = useState(false)
  const [quote, setQuote] = useState(null)
  const [revision, setRevision] = useState(null)
  const [warning, setWarning] = useState(null)
  const [costs, setCosts] = useState(null)
  const [costOpen, setCostOpen] = useState(false)
  const [costDraft, setCostDraft] = useState(null)
  const lock = useRef(false)
  const alive = useRef(true)
  const identity = useRef(null)
  const retry = useRef(null)
  const panel = panels.find(item => item.panel_id === active)
  const draft = { expected_version: state?.version, assessments: panels, scenario, adjustments }
  const invalidate = () => { setError(null); retry.current = null; setPreview(null); setReviewed(false); setQuote(null); setCosts(null); setCostDraft(null); setCostOpen(false); setDirty(true); setNotice(''); identity.current = null }
  function edit(next) { invalidate(); setPanels(next) }
  function patchPanel(patch) { edit(panels.map(item => item.panel_id === active ? { ...item, ...patch, reviewed: patch.reviewed ?? false } : item)) }
  function accept(data) {
    if (data.version == null || !Array.isArray(data.assessments)) throw new Error('Invalid estimator response')
    setState(data); setPanels(data.assessments); const selectedScenario = data.scenario || data.scenarios?.[0] || defaultScenario; setScenario({ payer: selectedScenario.payer, provenance: selectedScenario.provenance, allocation: selectedScenario.allocation ?? null }); setAdjustments(data.adjustments || {}); setRevision(data.active_revision_id || null); setDirty(false)
  }
  async function run(name, task) {
    if (lock.current) return
    lock.current = true; setBusy(name); setError(null); retry.current = () => run(name, task)
    try { await task() } catch (err) {
      if (alive.current) setError(err.response?.status === 409 ? 'This draft changed on the server. Reload before saving; your local edits are still here.' : `${name} failed. The estimator service may be unavailable. Your local edits are preserved.`)
    } finally { if (alive.current) { lock.current = false; setBusy('') } }
  }
  const load = () => run('Load estimator', async () => { const { data } = await api.get(base); if (alive.current) { accept(data); setPreview(null); setReviewed(false); setQuote(null); setCosts(null); setCostDraft(null); setCostOpen(false); setWarning(null); identity.current = null } })
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false } }, []) // Session is keyed by RO and role.
  useEffect(() => {
    if (!dirty) return
    const prevent = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  const save = () => run('Save draft', async () => { const { data } = await api.put(`${base}/draft`, draft); if (alive.current) { accept(data); setPreview(null); setReviewed(false); setNotice('Draft saved. Calculate a fresh preview before committing.') } })
  const calculate = () => run('Preview calculation', async () => {
    const { data } = await api.post(`${base}/preview`, draft)
    if (alive.current) {
      if (!data.input_hash || data.version !== state.version || !data.quote) throw new Error('Invalid preview')
      setPreview(data); setReviewed(false); setNotice('Preview calculated. Check the scope and selling amounts before review.')
    }
  })
  const commit = () => run('Commit reviewed draft', async () => {
    const signature = JSON.stringify({ ...draft, input_hash: preview.input_hash })
    if (identity.current?.signature !== signature) identity.current = { signature, key: crypto.randomUUID() }
    const { data } = await api.post(`${base}/commit`, { ...draft, input_hash: preview.input_hash, idempotency_key: identity.current.key, reviewed: true })
    if (alive.current) { setRevision(data.revision_id); setState(previous => ({ ...previous, version: data.version })); setPreview(null); setReviewed(false); setDirty(false); setNotice('Reviewed revision saved. Customer authorization and carrier approval remain separate.') }
  })
  const loadPhotos = () => run('Load repair-order photos', async () => { const { data } = await api.get(`/photos/${encodeURIComponent(roId)}`); if (alive.current) setAvailablePhotos(data.photos || []) })
  const getQuote = () => run('Load customer quote', async () => { const { data } = await api.get(`${base}/quote?revision_id=${encodeURIComponent(revision)}`); if (alive.current) setQuote(data) })
  const getCosts = () => run('Load private costs', async () => {
    const { data } = await api.get(`${base}/cost-summary`)
    if (alive.current) {
      setCosts(data); setCostOpen(true)
      setCostDraft({ lines: panels.map(item => { const saved = data.lines?.find(line => line.panel_id === item.panel_id); return { panel_id: item.panel_id, ...Object.fromEntries(costFields.map(key => [key, saved?.[key] ?? null])) } }), target_margin_bps: data.target_margin_bps ?? null, overhead_cents: data.overhead_cents ?? null, reason: '' })
    }
  })
  function changeCosts(update) { setPreview(null); setReviewed(false); setQuote(null); identity.current = null; setCostDraft(update) }
  const saveCosts = () => run('Save private costs', async () => {
    const { data } = await api.put(`${base}/cost-settings`, { expected_version: state.version, ...costDraft })
    if (alive.current) { invalidate(); setState(previous => ({ ...previous, version: data.version ?? previous.version })); setNotice('Cost settings saved. Reload private costs and recalculate before review.') }
  })
  function selection(ids) {
    const removed = panels.find(item => !ids.includes(item.panel_id))
    if (removed) { setWarning({ type: 'remove', id: removed.panel_id }); return }
    const added = ids.find(id => !panels.some(item => item.panel_id === id))
    if (added) { edit([...panels, blankPanel(added)]); setActive(added) }
  }
  const blocked = !panels.length || panels.some(item => status(item) !== 'Reviewed') || (preview?.review_flags || []).length > 0 || (preview?.quote?.review_flags || []).length > 0
  const preset = state?.presets?.find(item => (item.version_id || item.id) === panel?.preset_version_id)
  return <section className="min-w-0 space-y-5 text-ink" aria-label="Visual panel estimator">
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-instrument bg-panel p-5"><div><p className="text-xs font-semibold uppercase tracking-widest text-brand">Visual panels</p><h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold"><Car />Build a clear repair scope</h2><p className="mt-2 text-sm text-muted">{vehicle || 'Confirm vehicle on the repair order'} · Generic selection diagram, not VIN-exact. Confirm panel applicability.</p></div><span className="rounded-full bg-raised px-3 py-2 text-sm text-gold">{dirty ? 'Unsaved changes' : revision ? `Revision ${revision}` : 'Draft estimate'}</span></header>
    {busy && <p role="status" className="text-brand">{busy}…</p>}
    {error && <div role="alert" className="rounded-instrument border border-gold/40 bg-panel p-4"><p className="flex items-center gap-2 text-gold"><AlertTriangle size={18} />{error}</p><button className={buttonClass} disabled={!!busy} onClick={() => retry.current?.()}>Retry</button><button className={buttonClass} disabled={!!busy} onClick={() => dirty ? setWarning({ type: 'reload' }) : load()}>Reload saved draft</button></div>}
    {notice && <p role="status" className="text-brand">{notice}</p>}
    {warning && <div role="alertdialog" aria-label="Preserve unsaved edits" className="space-y-3 rounded-instrument border border-gold/40 bg-raised p-4"><p>{warning.type === 'remove' ? `Remove ${vehiclePanelLabel(warning.id)} from this draft? Generated lines require reconciliation at commit; saved revisions remain unchanged.` : 'Discard unsaved changes and reload the saved draft?'}</p><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => setWarning(null)}>Keep editing</button><button className={buttonClass} onClick={() => { if (warning.type === 'remove') { edit(panels.filter(item => item.panel_id !== warning.id)); if (active === warning.id) setActive(null); setWarning(null) } else load() }}>{warning.type === 'remove' ? 'Remove from draft' : 'Discard and reload'}</button></div></div>}
    {state && <><fieldset disabled={!!busy || readOnly} className="min-w-0 space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(240px,0.85fr)_minmax(280px,1.2fr)_minmax(240px,0.85fr)]">
        <div className="min-w-0 space-y-4 rounded-instrument border border-line-2 bg-panel p-4"><h3 className="font-semibold">1. Select damaged panels</h3><VehicleDiagram value={panels.map(item => item.panel_id)} onChange={selection} readOnly={readOnly || !!busy} /><div className="space-y-2">{panels.map(item => <button key={item.panel_id} className={`${buttonClass} w-full justify-between ${active === item.panel_id ? 'border-brand text-brand' : ''}`} onClick={() => setActive(item.panel_id)}><span>{item.label || vehiclePanelLabel(item.panel_id)}</span><span className="text-xs">{status(item)}</span></button>)}</div></div>
        <div className="min-w-0 rounded-instrument border border-line-2 bg-panel p-5"><h3 className="font-semibold">2. Configure panel work</h3>{!panel ? <p className="py-16 text-center text-muted">Select a panel to specify its scope, hours, and selling amounts.</p> : <div className="mt-4 space-y-4"><h4 className="text-lg text-brand">{panel.label || vehiclePanelLabel(panel.panel_id)}</h4>
          <label className="block text-sm text-muted">Body style<select className={inputClass} value={panel.body_style || ''} onChange={event => patchPanel({ body_style: event.target.value || null })}><option value="">Confirm body style</option>{['sedan', 'coupe', 'hatchback', 'suv', 'truck', 'van', 'other'].map(value => <option key={value}>{value}</option>)}</select></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['Severity', 'severity', ['light', 'moderate', 'heavy']], ['Operation', 'operation', ['repair', 'replace', 'paint-only', 'blend', 'inspection-required']]].map(([name, key, values]) => <label key={key} className="text-sm text-muted">{name}<select className={inputClass} value={panel[key] || ''} onChange={event => patchPanel({ [key]: event.target.value || null })}><option value="">Select {name.toLowerCase()}</option>{values.map(value => <option key={value}>{value}</option>)}</select></label>)}</div>
          {panel.operation === 'inspection-required' && <p className="text-gold">Inspection required — this scope cannot be committed.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['Damage type', 'damage_type'], ['Damage area', 'area']].map(([name, key]) => <label key={key} className="text-sm text-muted">{name}<input className={inputClass} value={panel[key] || ''} onChange={event => patchPanel({ [key]: event.target.value || null })} /></label>)}</div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={!!panel.refinish} onChange={event => patchPanel({ refinish: event.target.checked })} />Include refinish work</label>
          <label className="block text-sm text-muted">Shop preset<select className={inputClass} value={panel.preset_version_id || ''} onChange={event => { const selected = state.presets?.find(item => String(item.version_id || item.id) === event.target.value); patchPanel({ preset_version_id: selected?.version_id || selected?.id || null }) }}><option value="">Manual reviewed inputs</option>{(state.presets || []).map(item => <option key={item.version_id || item.id} value={item.version_id || item.id}>{item.label || item.name} · {item.version || item.version_id}</option>)}</select></label>
          {preset && <div className="rounded-lg bg-raised p-3 text-sm"><p>Preset version: {preset.version || preset.version_id || preset.id}</p><p>Includes: {(preset.inclusions || preset.included_operations || []).map(item => typeof item === 'string' ? item : item.label || item.operation_id).join(', ') || 'Not supplied — review required'}</p><p className="text-muted">Verify manual values against this version. The server validates preset compatibility.</p></div>}
          <p className="text-xs text-muted">Blank means unknown. Enter explicit zero where no charge applies. Rates are shop inputs.</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{sellFields.map(key => <NumericField key={key} name={names[key]} value={panel[key]} money={key.endsWith('_cents')} max={key.endsWith('_hours') ? 1000000 : undefined} onChange={value => patchPanel({ [key]: value })} />)}</div>
          <label className="block text-sm text-muted">Customer-visible notes<textarea className={inputClass} rows="3" value={panel.customer_notes || ''} onChange={event => patchPanel({ customer_notes: event.target.value })} /></label>
          <div className="space-y-2 text-sm"><p className="text-muted">Linked photo IDs: {(panel.photo_ids || []).join(', ') || 'None selected'}</p><button type="button" className={buttonClass} onClick={loadPhotos}>Load repair-order photos</button>{availablePhotos.length ? availablePhotos.map(photo => <label key={photo.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={panel.photo_ids?.includes(photo.id) || false} onChange={event => patchPanel({ photo_ids: event.target.checked ? [...(panel.photo_ids || []), photo.id] : panel.photo_ids.filter(id => id !== photo.id) })} />{photo.label || photo.caption || photo.filename || `Photo ${photo.id}`}</label>) : <p className="text-muted">No repair-order photos supplied.</p>}</div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={!!panel.reviewed} disabled={!configured(panel) || panel.operation === 'inspection-required'} onChange={event => patchPanel({ reviewed: event.target.checked })} />I reviewed this panel’s inputs and applicability</label>
        </div>}</div>
        <aside className="min-w-0 space-y-4 rounded-instrument border border-line-2 bg-panel p-5"><h3 className="font-semibold">3. Review estimate</h3><label className="block text-sm text-muted">Payer<select className={inputClass} value={scenario.payer} onChange={event => { invalidate(); setScenario({ ...scenario, payer: event.target.value, provenance: 'shop_prepared', allocation: null }) }}><option value="cash">Customer Pay</option><option value="insurance">Insurance</option></select></label><p className="text-sm text-muted">{scenario.provenance === 'imported_carrier' ? 'Imported carrier estimate — approval status not implied.' : 'Shop-prepared estimate — not insurer-approved.'} Payer changes preserve panel scope and rates.</p><p className="text-sm">Customer responsibility: {quoteMoney(scenario.allocation?.customer_cents)}</p>
          <p>{panels.length} panels · {panels.filter(item => status(item) === 'Reviewed').length} reviewed</p>
          {preview ? <div className="space-y-2 border-y border-line-2 py-4"><p className="text-sm text-muted">Calculated sell preview</p>{[['Net', 'net_cents'], ['Tax', 'tax_cents'], ['Repair total', 'total_cents']].map(([name, key]) => <p key={key} className="flex justify-between gap-2"><span>{name}</span><strong className="font-mono">{quoteMoney(preview.quote.totals?.[key])}</strong></p>)}<div className="space-y-2 text-sm" aria-label="Calculated sell lines">{(preview.quote.lines || []).map((line, index) => <div key={line.id || index} className="border-t border-line-2 pt-2"><p>{line.description || line.operation_id}</p><p className="text-muted">{line.panel_label || vehiclePanelLabel(line.panel_id)} · {line.preset_version_id ? `Preset ${line.preset_version_id}` : 'Manual inputs'}{line.shared_key ? ` · Shared ${line.shared_key}` : ''}</p><p>{line.included ? 'Included in package' : `${line.quantity ?? 'Unknown'} × ${quoteMoney(line.unit_price_cents)}`} · Net {quoteMoney(line.net_cents)}</p></div>)}</div><ul className="text-sm text-gold">{[...(preview.review_flags || []), ...(preview.quote.review_flags || [])].map((flag, i) => <li key={i}>{typeof flag === 'string' ? flag : flag.message || flag.code}</li>)}</ul></div> : <p className="rounded-lg bg-raised p-4 text-sm text-muted">Calculate a preview to see current selling totals. Edits invalidate earlier calculations.</p>}
          <div className="flex flex-col gap-2"><button className={buttonClass} onClick={save}><Save size={16} />Save draft</button><button className={buttonClass} disabled={!panels.length} onClick={calculate}><Calculator size={16} />Preview calculation</button><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={!preview || blocked} onChange={event => setReviewed(event.target.checked)} />I reviewed this calculated draft</label><button className={`${buttonClass} text-brand`} disabled={!preview || !reviewed || blocked} onClick={commit}><ShieldCheck size={16} />Commit reviewed draft</button><button className={buttonClass} disabled={!dirty} onClick={() => setWarning({ type: 'cancel' })}>Cancel unsaved changes</button></div>
        </aside>
      </div>
    </fieldset>
    <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={!!busy || !revision || dirty} onClick={getQuote}><Eye size={16} />Preview customer quote</button>{owner && <button className={buttonClass} disabled={!!busy || dirty} onClick={() => costDraft ? setCostOpen(true) : getCosts()}><SlidersHorizontal size={16} />Owner cost drawer</button>}</div>
    {owner && costOpen && costs && costDraft && <section aria-label="Private owner costs" className="space-y-4 rounded-instrument border border-line-2 bg-panel p-5"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Private owner / admin cost settings</h3><button className={buttonClass} onClick={() => setCostOpen(false)}>Close cost drawer</button></div><p className="text-muted">Estimated direct cost: {quoteMoney(costs.direct_cost_cents)} · Known subtotal: {quoteMoney(costs.known_subtotal_cents)}</p><p className="text-gold">{costs.complete === true ? 'Cost inputs complete' : 'Cost inputs incomplete — no complete estimate claimed'}</p><ul>{(costs.missing || []).map((item, index) => <li key={index}>{item.panel_id || item.id || 'Estimate'}: {item.reason || item.field}</li>)}</ul><p>Gross contribution: {quoteMoney(costs.contribution_cents)} · Gross margin: {costs.margin_bps == null ? 'Unknown' : `${(costs.margin_bps / 100).toFixed(2)}%`}</p><p>After allocated overhead: {quoteMoney(costs.after_overhead_cents)}</p><p>Target price / floor: {quoteMoney(costs.target_revenue_cents)} · {costs.include_overhead_in_target ? 'Includes overhead' : 'Excludes overhead'}</p>{costs.below_floor && <p className="text-gold">Selling price is below the target floor.</p>}{costs.private_notes && <p className="whitespace-pre-wrap">Private notes: {costs.private_notes}</p>}
      <fieldset disabled={!!busy} className="space-y-4">{costDraft.lines.map((line, index) => <div key={line.panel_id}><h4>{vehiclePanelLabel(line.panel_id)}</h4><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{costFields.map(key => <NumericField key={key} name={names[key]} value={line[key]} onChange={value => changeCosts(previous => ({ ...previous, lines: previous.lines.map((item, i) => i === index ? { ...item, [key]: value } : item) }))} />)}</div></div>)}<div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><NumericField name="Target margin" unit=" (%)" value={costDraft.target_margin_bps} max={99.99} onChange={value => changeCosts({ ...costDraft, target_margin_bps: value })} /><NumericField name="Allocated overhead" value={costDraft.overhead_cents} onChange={value => changeCosts({ ...costDraft, overhead_cents: value })} /></div><label className="block text-sm text-muted">Private cost review note / reason<textarea className={inputClass} value={costDraft.reason} onChange={event => changeCosts({ ...costDraft, reason: event.target.value })} /></label><button className={buttonClass} disabled={!costDraft.reason.trim()} onClick={saveCosts}>Save private cost settings</button></fieldset>
    </section>}
    {quote && <CustomerPanelQuote quote={quote} />}
    </>}
  </section>
}
