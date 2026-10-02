import { useContext, useEffect, useRef, useState } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'
import api from '../lib/api'
import { getRole } from '../lib/auth'
import VehicleDiagram, { vehiclePanelLabel } from './VehicleDiagram'
import CustomerPanelQuote, { quoteMoney } from './CustomerPanelQuote'
import PanelPresetManager from './PanelPresetManager'
import PanelWorkFields, { blankCosts, buttonClass, categories, Choice, clone, CostPolicyFields, human, MatchFields, NumericField, PrivateCostFields, safeSell, TextField } from './PanelWorkFields'

const defaultScenario = { payer: 'cash', provenance: 'shop_prepared', allocation: null }
const blankPanel = id => ({ panel_id: id, label: vehiclePanelLabel(id), body_style: null, severity: null, damage_type: null, area: null, operation: null, paint_system: null, ...safeSell({}), customer_notes: '', reviewed: false, preset_version_id: null, preset_override: null, photo_ids: [], optional_cosmetic: false, deferral: null })
// Presence badges only; the server remains responsible for validity and all arithmetic.
function configured(panel) {
  const known = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  const included = category => panel.package?.included_operations.includes(category)
  const pkg = panel.package
  return panel.body_style && panel.severity && panel.operation && typeof panel.refinish === 'boolean'
    && categories.every(key => typeof panel.taxable?.[key] === 'boolean')
    && (!['repair', 'replace'].includes(panel.operation) || (known(panel.body_hours) && (included('body') || known(panel.body_rate_cents))))
    && (!panel.refinish || (known(panel.refinish_hours) && (included('refinish') || known(panel.refinish_rate_cents))))
    && ['parts', 'sublet'].every(key => included(key) || known(panel[`${key}_sell_cents`]))
    && (included('materials') || (panel.materials_pricing?.method === 'quantity_rate'
      ? known(panel.materials_pricing.quantity) && known(panel.materials_pricing.unit_rate_cents) : known(panel.materials_sell_cents)))
    && (!pkg || (pkg.name?.trim() && known(pkg.price_cents) && pkg.included_operations.length &&
      (typeof pkg.taxable === 'boolean' || pkg.included_operations.every(key => known(pkg.sell_allocation_cents?.[key])))))
    && (panel.extras || []).every(extra => extra.key?.trim() && extra.scope?.trim() && extra.category && known(extra.quantity) && known(extra.unit_price_cents) && typeof extra.taxable === 'boolean')
}
const status = panel => panel.deferral ? 'Deferred — retained' : !configured(panel) || panel.operation === 'inspection-required' ? 'Incomplete' : panel.reviewed ? 'Reviewed' : 'Configured'
const warnings = new Set(['incomplete_insurance_allocation', 'missing_posted_payments'])
const messages = {
  VERSION_CONFLICT: 'This draft changed on the server. Reload before saving; your local edits are still here.',
  PREVIEW_CONFLICT: 'Calculation inputs changed on the server. Reload and calculate a fresh preview. Local edits are retained.',
  SCOPE_RECONCILIATION_REQUIRED: 'Required or previously selected work cannot be removed or reduced. Restore its scope or retain an eligible, previously committed cosmetic assessment with its acknowledgement. Local edits are retained.',
  LINE_RECONCILIATION_REQUIRED: 'Generated lines conflict with existing or manually edited estimate lines. Reconcile those lines before committing. Local edits are retained.',
  PRESET_INCOMPATIBLE: 'The selected preset does not match this panel. Check body style, panel, operation, severity, area and paint system.',
  PRESET_LOCKED: 'This preset locks its selling inputs. Apply a different available preset or use reviewed manual inputs.',
  PRESET_OVERRIDE_REQUIRED: 'An owner / admin must supply a customer-safe reason for changed preset selling inputs.',
  FORBIDDEN: 'Your role cannot perform this action. Local edits are retained.',
  INVALID_INPUT: 'Some inputs are invalid. Check package allocations, operation identities, quantities, tax choices and acknowledgements. Local edits are retained.',
  INVALID_PACKAGE: 'Review the package inclusions, tax treatment and explicit sell allocation. Local edits are retained.',
  REVIEW_REQUIRED: 'The server requires a complete reviewed scope before commit. Review the calculation flags.',
}

// App uses BrowserRouter (not a data router): useBlocker is unsupported there.
// Wrap its navigator, and guard native links/back separately, without adding history entries.
function useDirtyNavigation(dirty) {
  const navigation = useContext(UNSAFE_NavigationContext)
  const current = useRef(dirty); current.current = dirty
  useEffect(() => {
    const ask = () => !current.current || window.confirm('Leave the estimator and discard unsaved public, private cost or catalog edits?')
    const navigator = navigation?.navigator
    const originals = {}
    let index = window.history.state?.idx, restoring = false
    if (navigator) for (const method of ['push', 'replace']) originals[method] = navigator[method]
    const unload = event => { if (current.current) { event.preventDefault(); event.returnValue = '' } }
    const link = event => {
      const anchor = event.target.closest?.('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const url = new URL(anchor.href, window.location.href)
      if ((!navigator || url.origin !== window.location.origin || anchor.hasAttribute('reloadDocument')) && !ask()) { event.preventDefault(); event.stopPropagation() }
    }
    const pop = event => {
      const next = event.state?.idx
      if (restoring) { restoring = false; index = next; return }
      if (current.current && index != null && next != null && next !== index && !ask()) {
        event.stopImmediatePropagation(); restoring = true; window.history.go(index - next)
      } else index = next
    }
    // BrowserRouter go() also emits popstate; guarding it here would prompt twice.
    // push/replace update the index used when a native Back/Forward event fires.
    if (navigator) for (const method of ['push', 'replace']) {
      navigator[method] = (...args) => { if (ask()) { const result = originals[method].apply(navigator, args); index = window.history.state?.idx; return result } }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', link, true)
    window.addEventListener('popstate', pop, true)
    return () => {
      if (navigator) for (const method of Object.keys(originals)) navigator[method] = originals[method]
      window.removeEventListener('beforeunload', unload); document.removeEventListener('click', link, true); window.removeEventListener('popstate', pop, true)
    }
  }, [navigation?.navigator])
}

export default function PanelEstimator(props) { return <EstimatorSession key={`${props.roId}:${getRole()}`} {...props} /> }
function EstimatorSession({ roId, vehicle, photos = [] }) {
  const base = `/estimate-items/${encodeURIComponent(roId)}/panel-estimator`
  const owner = ['owner', 'admin'].includes(getRole()), readOnly = !['owner', 'admin', 'assistant'].includes(getRole())
  const [availablePhotos, setAvailablePhotos] = useState(photos)
  const [state, setState] = useState(null), [panels, setPanels] = useState([]), [catalog, setCatalog] = useState([])
  const [scenario, setScenario] = useState(defaultScenario), [adjustments, setAdjustments] = useState({})
  const [active, setActive] = useState(null), [busy, setBusy] = useState('Loading estimator'), [error, setError] = useState(null), [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false), [preview, setPreview] = useState(null), [targets, setTargets] = useState(null), [reviewed, setReviewed] = useState(false)
  const [quote, setQuote] = useState(null), [revision, setRevision] = useState(null), [warning, setWarning] = useState(null)
  const [costs, setCosts] = useState(null), [costHash, setCostHash] = useState(null), [costOpen, setCostOpen] = useState(false), [costDraft, setCostDraft] = useState(null), [costDirty, setCostDirty] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false), [catalogDirty, setCatalogDirty] = useState(false), [catalogBusy, setCatalogBusy] = useState(false)
  const lock = useRef(false), alive = useRef(true), identity = useRef(null), retry = useRef(null), editor = useRef(null), returnFocus = useRef(null), warningFocus = useRef(null), warningButton = useRef(null)
  const panel = panels.find(item => item.panel_id === active)
  const allDirty = dirty || costDirty || catalogDirty
  useDirtyNavigation(allDirty || !!busy || catalogBusy)
  const draft = { expected_version: state?.version, assessments: panels, scenario, adjustments }
  function invalidate() { setError(null); retry.current = null; setPreview(null); setReviewed(false); setQuote(null); identity.current = null; setNotice('') }
  function edit(next) { invalidate(); setPanels(next); setDirty(true) }
  function patchPanel(patch, preserveReview = false) { edit(panels.map(item => item.panel_id === active ? { ...item, ...patch, reviewed: preserveReview ? item.reviewed : patch.reviewed ?? false } : item)) }
  function selectPanel(id, trigger = document.activeElement) { returnFocus.current = trigger; setActive(id); requestAnimationFrame(() => editor.current?.focus()) }
  function closeEditor() { setActive(null); returnFocus.current?.focus?.() }
  function askWarning(value) { warningFocus.current = document.activeElement; setWarning(value) }
  function cancelWarning() { setWarning(null); warningFocus.current?.focus?.() }
  useEffect(() => { if (warning) warningButton.current?.focus() }, [warning])
  function accept(data) {
    if (data.version == null || !Array.isArray(data.assessments)) throw new Error('Invalid estimator response')
    setState(data); setPanels(data.assessments); setScenario(data.scenario || defaultScenario); setAdjustments(data.adjustments || {}); setRevision(data.active_revision_id || null); setDirty(false)
    if (Array.isArray(data.presets)) setCatalog(data.presets)
    setActive(previous => data.assessments.some(item => item.panel_id === previous) ? previous : data.assessments[0]?.panel_id || null)
  }
  async function run(name, task) {
    if (lock.current) return
    lock.current = true; setBusy(name); setError(null); retry.current = () => run(name, task)
    try { await task() } catch (err) {
      if (alive.current) setError(messages[err.response?.data?.error] || (err.response?.status === 409 ? messages.VERSION_CONFLICT : `${name} failed. The estimator service may be unavailable. Your local edits are preserved.`))
    } finally { if (alive.current) { lock.current = false; setBusy('') } }
  }
  const load = () => run('Load estimator', async () => {
    const { data } = await api.get(base)
    if (alive.current) { accept(data); invalidate(); setTargets(null); setCosts(null); setCostDraft(null); setCostDirty(false); setCostOpen(false); setWarning(null) }
  })
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false } }, [])
  const save = () => run('Save draft', async () => {
    const { data } = await api.put(`${base}/draft`, draft)
    if (alive.current) { accept(data); invalidate(); setNotice('Draft saved. Calculate a fresh preview before committing. Private cost edits are retained.') }
  })
  const calculate = () => run('Preview calculation', async () => {
    const { data } = await api.post(`${base}/preview`, draft)
    if (alive.current) {
      if (!data.input_hash || data.version !== state.version || !data.quote) throw new Error('Invalid preview')
      setPreview(data); setTargets(data.quote); setReviewed(false); setNotice('Preview calculated. Review the server totals, scope and flags.')
    }
  })
  const commit = () => run('Commit reviewed draft', async () => {
    const signature = JSON.stringify({ ...draft, input_hash: preview.input_hash })
    if (identity.current?.signature !== signature) identity.current = { signature, key: crypto.randomUUID() }
    const { data } = await api.post(`${base}/commit`, { ...draft, input_hash: preview.input_hash, idempotency_key: identity.current.key, reviewed: true })
    if (alive.current) { setRevision(data.revision_id); setState(previous => ({ ...previous, version: data.version })); setPreview(null); setReviewed(false); setDirty(false); setNotice('Reviewed revision saved. Customer response is separate from carrier authorization, billing status and payment.') }
  })
  const loadPhotos = () => run('Load repair-order photos', async () => { const { data } = await api.get(`/photos/${encodeURIComponent(roId)}`); if (alive.current) setAvailablePhotos(data.photos || []) })
  const getQuote = () => run('Load customer quote', async () => { const { data } = await api.get(`${base}/quote?revision_id=${encodeURIComponent(revision)}`); if (!data.quote) throw new Error('Invalid quote envelope'); if (alive.current) setQuote(data.quote) })
  const getCosts = () => {
    if (!owner) return
    run('Load private costs', async () => {
      const { data } = await api.get(`${base}/cost-summary`)
      if (!data.costs?.settings || data.version !== state.version) throw Object.assign(new Error('Version conflict'), { response: { data: { error: 'VERSION_CONFLICT' } } })
      if (alive.current) {
        const saved = data.costs.settings
        setCosts(data.costs); setCostHash(data.input_hash); setCostOpen(true); setCostDirty(false)
        const lines = clone(saved.lines || [])
        for (const item of panels) if (!lines.some(line => line.panel_id === item.panel_id)) lines.push({ panel_id: item.panel_id, ...blankCosts() })
        setCostDraft({ lines, target_margin_bps: saved.target_margin_bps ?? null, overhead_cents: saved.overhead_cents ?? null, include_overhead_in_target: saved.include_overhead_in_target ?? false, private_notes: saved.private_notes ?? '', reason: '' })
      }
    })
  }
  useEffect(() => {
    if (!costDraft) return
    const missing = panels.filter(item => !costDraft.lines.some(line => line.panel_id === item.panel_id))
    if (missing.length) setCostDraft(previous => ({ ...previous, lines: [...previous.lines, ...missing.map(item => ({ panel_id: item.panel_id, ...blankCosts() }))] }))
  }, [panels, costDraft])
  function changeCosts(patch) { invalidate(); setCostDraft(previous => ({ ...previous, ...patch })); setCostDirty(true) }
  const saveCosts = () => {
    if (!owner) return
    run('Save private costs', async () => {
      const { data } = await api.put(`${base}/cost-settings`, { expected_version: state.version, ...costDraft })
      if (alive.current) { invalidate(); setState(previous => ({ ...previous, version: data.version })); setCostDirty(false); setCosts(null); setCostHash(null); setNotice('Cost settings saved. Public unsaved edits are retained. Reload private costs and calculate a fresh preview.') }
    })
  }
  function selection(ids) {
    const removed = panels.find(item => !ids.includes(item.panel_id))
    if (removed) { askWarning({ type: 'remove', id: removed.panel_id }); return }
    const added = ids.find(id => !panels.some(item => item.panel_id === id))
    if (added) { edit([...panels, blankPanel(added)]); selectPanel(added) }
  }
  const preset = panel?.preset_version_id && panel?.application_snapshot?.id === panel.preset_version_id ? panel.application_snapshot : catalog.find(item => item.id === panel?.preset_version_id)
  const controlledDisabled = !!preset && (preset.sell_settings.override_policy === 'locked' || !owner || !panel.preset_override?.reason?.trim())
  function applyPreset(id) {
    if (!id) { patchPanel({ preset_version_id: null, preset_override: null, application_snapshot: null }); return }
    const selected = catalog.find(item => item.id === id && !item.archived)
    if (!selected) return
    if (selected.match.panel_id !== panel.panel_id) { setError(messages.PRESET_INCOMPATIBLE); return }
    patchPanel({ ...Object.fromEntries(Object.entries(selected.match).filter(([key, value]) => key !== 'panel_id' && value != null)), ...safeSell(selected.sell_settings), preset_version_id: selected.id, preset_override: null, application_snapshot: clone(Object.fromEntries(['id', 'family_id', 'version', 'contract_version', 'name', 'match', 'sell_settings'].map(key => [key, selected[key]]))) })
    setNotice('Preset selling inputs explicitly applied for review. Existing repair-order costs are retained; review them separately. Catalog private costs were not loaded or applied.')
  }
  const flags = preview?.quote?.review_flags || []
  const blocked = !preview || preview.quote.complete !== true || preview.quote.inspection_required || flags.some(flag => !warnings.has(flag.code)) || costDirty
  const eligible = panel && ['paint-only', 'blend'].includes(panel.operation) && (panel.body_hours == null || panel.body_hours === 0) && panel.parts_sell_cents === 0 && panel.sublet_sell_cents === 0 && !panel.extras?.length
  const changeAdjustment = patch => { invalidate(); setDirty(true); setAdjustments(previous => ({ ...previous, ...patch })) }
  const availablePresets = catalog.filter(item => !item.archived && item.match.panel_id === panel?.panel_id)
  const historicalPreset = preset && !availablePresets.some(item => item.id === preset.id)
  return <section className="min-w-0 space-y-5 break-words text-ink" aria-label="Visual panel estimator">
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-instrument bg-panel p-5"><div><p className="text-xs font-semibold uppercase tracking-widest text-brand">Visual panels</p><h2 className="mt-1 text-2xl font-semibold">Build a clear repair scope</h2><p className="mt-2 text-sm text-muted">{vehicle || 'Confirm vehicle on the repair order'} · Generic selection diagram, not VIN-exact. Confirm panel applicability.</p></div><span className="break-all rounded-full bg-raised px-3 py-2 text-sm text-gold">{allDirty ? 'Unsaved changes' : revision ? `Revision ${revision}` : 'Draft estimate'}</span></header>
    {busy && <p role="status" className="text-brand">{busy}…</p>}
    {error && <div role="alert" className="space-y-2 rounded-instrument border border-gold/40 bg-panel p-4"><p className="text-gold">{error}</p><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!!busy || !retry.current} onClick={() => retry.current?.()}>Retry</button><button type="button" className={buttonClass} disabled={!!busy} onClick={() => allDirty ? askWarning({ type: 'reload' }) : load()}>Reload saved draft</button></div></div>}
    {notice && <p role="status" className="text-brand">{notice}</p>}
    {warning && <div role="alertdialog" aria-label="Preserve unsaved edits" className="space-y-3 rounded-instrument border border-gold/40 bg-raised p-4"><p>{warning.type === 'remove' ? `Remove ${vehiclePanelLabel(warning.id)} from this draft? Previously selected required work cannot be dropped. The server requires reconciliation; eligible cosmetic work must remain as a deferred assessment.` : 'Discard unsaved public and private cost changes and reload the saved draft? Catalog edits remain in the catalog.'}</p><div className="flex flex-wrap gap-2"><button type="button" ref={warningButton} className={buttonClass} onClick={cancelWarning}>Keep editing</button><button type="button" className={buttonClass} onClick={() => { if (warning.type === 'remove') { edit(panels.filter(item => item.panel_id !== warning.id)); if (active === warning.id) closeEditor(); setWarning(null) } else load() }}>{warning.type === 'remove' ? 'Remove from draft' : 'Discard and reload'}</button></div></div>}
    {state && <>
      <fieldset disabled={!!busy || readOnly} className="min-w-0 space-y-5">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(220px,0.7fr)_minmax(300px,1.4fr)_minmax(240px,0.9fr)]">
          <div className="min-w-0 space-y-4 rounded-instrument border border-line-2 bg-panel p-4"><h3 className="font-semibold">1. Select damaged panels</h3><VehicleDiagram compact value={panels.map(item => item.panel_id)} onChange={selection} onPanelSelect={selectPanel} readOnly={readOnly || !!busy} /><div className="space-y-2">{panels.map(item => <button key={item.panel_id} className={`${buttonClass} w-full justify-between ${active === item.panel_id ? 'border-brand text-brand' : ''}`} onClick={event => selectPanel(item.panel_id, event.currentTarget)}><span>{item.label || vehiclePanelLabel(item.panel_id)}</span><span className="text-xs">{status(item)}</span></button>)}</div></div>
          <div className="min-w-0 space-y-4 rounded-instrument border border-line-2 bg-panel p-5"><h3 ref={editor} tabIndex={-1} className="font-semibold outline-none">2. Configure panel work{panel ? ` — ${panel.label || vehiclePanelLabel(panel.panel_id)}` : ''}</h3>{!panel ? <p className="py-8 text-muted">Select a panel to specify its scope, hours, and selling amounts.</p> : <>
            <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={closeEditor}>Close panel editor</button><button type="button" className={buttonClass} onClick={() => askWarning({ type: 'remove', id: panel.panel_id })}>Remove selected panel</button></div>
            <fieldset disabled={!!panel.deferral} className="min-w-0 space-y-4">
              <MatchFields value={panel} onChange={patchPanel} /><TextField name="Damage type" value={panel.damage_type} onChange={damage_type => patchPanel({ damage_type })} />
              {panel.operation === 'inspection-required' && <p className="text-gold">Inspection required — this scope cannot be committed.</p>}
              <Choice name="Shop preset" value={panel.preset_version_id} empty="Manual reviewed inputs" options={[...availablePresets.map(item => [item.id, `${item.name} · Version ${item.version}`]), ...(historicalPreset ? [[preset.id, `${preset.name} · Version ${preset.version} · Retained historical application`]] : [])]} onChange={applyPreset} />
              {preset && <div className="space-y-2 rounded-lg bg-raised p-3 text-sm"><p>{preset.name} · Version {preset.version}</p><p className="break-all">Source version ID: {preset.id} · Family: {preset.family_id}</p><p>Includes: {preset.sell_settings.package?.included_operations.map(human).join(', ') || 'Itemized category charges'}{preset.sell_settings.extras.length ? `; extras: ${preset.sell_settings.extras.map(item => item.description || item.key).join(', ')}` : ''}</p><p>Panel minimum: {quoteMoney(preset.sell_settings.minimum_cents)} · Policy: {preset.sell_settings.override_policy === 'locked' ? 'Locked' : 'Owner / admin override with reason'}</p><p>No automatic reprice. Archived versions remain historical references.</p>{owner && preset.sell_settings.override_policy !== 'locked' && <TextField name="Customer-safe preset override reason" maxLength={4000} value={panel.preset_override?.reason} onChange={reason => patchPanel({ preset_override: reason ? { reason } : null })} />}</div>}
              <PanelWorkFields value={panel} onChange={patchPanel} disabled={controlledDisabled} />
              <TextField name="Customer-visible notes" multiline maxLength={4000} value={panel.customer_notes} onChange={customer_notes => patchPanel({ customer_notes })} />
              <div className="space-y-2 text-sm"><p className="break-words text-muted">Linked photo IDs: {(panel.photo_ids || []).join(', ') || 'None selected'}</p><button type="button" className={buttonClass} onClick={loadPhotos}>Load repair-order photos</button>{availablePhotos.map(photo => <label key={photo.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={panel.photo_ids?.includes(photo.id) || false} onChange={event => patchPanel({ photo_ids: event.target.checked ? [...(panel.photo_ids || []), photo.id] : panel.photo_ids.filter(id => id !== photo.id) })} />{photo.label || photo.caption || photo.filename || `Photo ${photo.id}`}</label>)}</div>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={!!panel.reviewed} disabled={!configured(panel) || panel.operation === 'inspection-required'} onChange={event => patchPanel({ reviewed: event.target.checked })} />I reviewed this panel’s inputs and applicability</label>
            </fieldset>
            {owner && <section aria-label="Optional cosmetic work" className="space-y-3 border-t border-line-2 pt-3"><p className="text-sm text-muted">Only paint-only or blend work with no body repair, parts, sublet or extras is eligible. Required work cannot be dropped. Deferral requires the unchanged assessment to have been committed as optional first.</p><label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={!!panel.deferral || (!eligible && !panel.optional_cosmetic)} checked={!!panel.optional_cosmetic} onChange={e => patchPanel({ optional_cosmetic: e.target.checked }, true)} />Classify as optional cosmetic work</label><label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={!panel.optional_cosmetic || !eligible} checked={!!panel.deferral} onChange={e => patchPanel({ deferral: e.target.checked ? { reason: '', estimator_acknowledged: false, customer_acknowledged: false, customer_acknowledgement_reference: '' } : null }, true)} />Defer and retain this cosmetic assessment</label>{panel.deferral && <div className="space-y-3"><p className="text-gold">Retained deferred work — estimator-recorded acknowledgement, not digital approval, signature or carrier authorization.</p><TextField name="Deferral reason" maxLength={4000} value={panel.deferral.reason} onChange={reason => patchPanel({ deferral: { ...panel.deferral, reason } }, true)} /><TextField name="Customer acknowledgement reference" maxLength={1000} value={panel.deferral.customer_acknowledgement_reference} onChange={customer_acknowledgement_reference => patchPanel({ deferral: { ...panel.deferral, customer_acknowledgement_reference } }, true)} />{[['estimator_acknowledged', 'I acknowledge this retained deferral as estimator'], ['customer_acknowledged', 'I recorded the customer acknowledgement at the reference above']].map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={panel.deferral[key]} onChange={e => patchPanel({ deferral: { ...panel.deferral, [key]: e.target.checked } }, true)} />{label}</label>)}</div>}</section>}
            {!owner && panel.deferral && <p className="text-gold">Deferred cosmetic assessment retained. Estimator-recorded acknowledgement: {panel.deferral.customer_acknowledgement_reference}. Reason: {panel.deferral.reason}. Not digital approval.</p>}
          </>}</div>
          <aside className="min-w-0 space-y-4 rounded-instrument border border-line-2 bg-panel p-5"><h3 className="font-semibold">3. Review estimate</h3>
            <Choice name="Payer" value={scenario.payer} empty={false} options={[[ 'cash', 'Customer Pay' ], [ 'insurance', 'Insurance' ]]} onChange={payer => { invalidate(); setDirty(true); setScenario({ ...scenario, payer }) }} />
            <Choice name="Estimate provenance" value={scenario.provenance} options={[[ 'shop_prepared', 'Shop-prepared — not insurer-approved' ], [ 'imported_carrier', 'Imported carrier estimate — approval not implied' ]]} onChange={provenance => { invalidate(); setDirty(true); setScenario({ ...scenario, provenance }) }} /><p className="text-sm text-muted">Payer changes preserve scope, rates and entered allocation. Carrier approval cannot be entered here.</p>
            {scenario.payer === 'insurance' && <div className="space-y-3"><p className="text-sm text-muted">Enter explicit allocation, including zero adjustments when known. Blank stays unknown.</p>{[['covered_cents', 'Covered amount before deductible'], ['deductible_cents', 'Applicable deductible'], ['uncovered_cents', 'Uncovered charges'], ['adjustment_cents', 'Coverage reduction / adjustment']].map(([key, name]) => <NumericField key={key} name={name} value={scenario.allocation?.[key]} onChange={value => { invalidate(); setDirty(true); setScenario({ ...scenario, allocation: { covered_cents: null, deductible_cents: null, uncovered_cents: null, adjustment_cents: null, ...scenario.allocation, [key]: value } }) }} />)}</div>}
            <p>Customer responsibility: {quoteMoney(preview?.quote.allocation?.customer_cents)}</p>
            <NumericField name="Global discount" value={adjustments.discount_cents} onChange={discount_cents => changeAdjustment({ discount_cents })} /><NumericField name="Estimate minimum" value={adjustments.minimum_cents} onChange={minimum_cents => changeAdjustment({ minimum_cents })} /><p className="text-sm text-muted">Discounts apply before minimums. The server adds a visible minimum adjustment and uses the billable work’s tax treatment. Mixed-tax minimum increases are rejected as ambiguous; no tax rate is entered here.</p>
            <div className="space-y-3"><h4 className="font-semibold">Scoped discounts</h4><p className="text-sm text-muted">Calculate a preview to load exact server line/package targets. Included lines must be discounted through their package.</p>{(adjustments.discounts || []).map((discount, index) => <fieldset key={index} className="space-y-2 rounded-lg border border-line-2 p-3"><legend>Scoped discount {index + 1}</legend><TextField name="Discount ID" value={discount.id} onChange={id => changeAdjustment({ discounts: adjustments.discounts.map((item, i) => i === index ? { ...item, id } : item) })} /><NumericField name="Scoped discount amount" value={discount.amount_cents} onChange={amount_cents => changeAdjustment({ discounts: adjustments.discounts.map((item, i) => i === index ? { ...item, amount_cents } : item) })} />{[['line_ids', targets?.lines?.filter(line => !line.included && !line.inspection_required) || []], ['package_ids', targets?.packages || []]].map(([key, options]) => <div key={key}><p className="text-sm">{key === 'line_ids' ? 'Line targets' : 'Package targets'}</p>{options.map(item => <label key={item.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={discount[key].includes(item.id)} onChange={e => changeAdjustment({ discounts: adjustments.discounts.map((entry, i) => i === index ? { ...entry, line_ids: [], package_ids: [], [key]: e.target.checked ? [...discount[key], item.id] : discount[key].filter(id => id !== item.id) } : entry) })} />{item.name || `${vehiclePanelLabel(item.panel_id)} · ${human(item.category)} · ${item.description}`}</label>)}{discount[key].filter(id => !options.some(item => item.id === id)).map(id => <p key={id} className="break-all text-sm text-gold">Retained target {id}; calculate a fresh preview to verify.</p>)}</div>)}<button type="button" className={buttonClass} onClick={() => changeAdjustment({ discounts: adjustments.discounts.filter((_, i) => i !== index) })}>Remove scoped discount {index + 1}</button></fieldset>)}<button type="button" className={buttonClass} disabled={!targets || (adjustments.discounts || []).length >= 100} onClick={() => changeAdjustment({ discounts: [...(adjustments.discounts || []), { id: '', amount_cents: null, line_ids: [], package_ids: [] }] })}>Add scoped discount</button></div>
            {preview ? <div className="space-y-2 border-y border-line-2 py-4"><p className="text-sm text-muted">Calculated sell preview</p>{[['Net', 'net_cents'], ['Tax', 'tax_cents'], ['Repair total', 'total_cents']].map(([name, key]) => <p key={key} className="flex justify-between gap-2"><span>{name}</span><strong className="font-mono">{quoteMoney(preview.quote.totals?.[key])}</strong></p>)}<div className="space-y-3 text-sm" aria-label="Calculated packages">{(preview.quote.packages || []).map(pkg => <div key={pkg.id} className="rounded-lg border border-line-2 p-3"><p className="font-semibold">{pkg.name}</p><p>One package price before discounts: {quoteMoney(pkg.price_cents)}</p><p>Includes: {pkg.included_operations.map(item => `${vehiclePanelLabel(item.panel_id)} · ${human(item.operation_id)}`).join(', ')}</p>{pkg.sell_allocation_cents && <p>Tax allocation within this price: {Object.entries(pkg.sell_allocation_cents).map(([key, amount]) => `${human(key)} ${quoteMoney(amount)}`).join('; ')}</p>}</div>)}</div><div className="space-y-2 text-sm" aria-label="Calculated adjustments">{(preview.quote.discount_lines || []).map((discount, index) => <p key={discount.id || index}>{discount.id ? `Scoped discount ${discount.id}` : 'Global discount'}: {quoteMoney(discount.amount_cents)} · Already allocated in totals</p>)}{(preview.quote.buckets || []).filter(bucket => ['minimum', 'panel_minimum'].includes(bucket.kind)).map(bucket => <p key={bucket.id}>{bucket.panel_id ? `${vehiclePanelLabel(bucket.panel_id)} minimum adjustment` : 'Estimate minimum adjustment'}: {quoteMoney(bucket.net_cents)} · Tax {quoteMoney(bucket.tax_cents)} · Already included in totals</p>)}</div><div className="space-y-2 text-sm" aria-label="Calculated sell lines">{(preview.quote.lines || []).map(line => <div key={line.id} className="border-t border-line-2 pt-2"><p>{line.description || human(line.operation_id)}</p><p className="text-muted">{vehiclePanelLabel(line.panel_id)} · {human(line.category)}{preview.quote.scope?.assessments?.find(item => item.panel_id === line.panel_id)?.application_snapshot ? ` · Preset version ${preview.quote.scope.assessments.find(item => item.panel_id === line.panel_id).application_snapshot.version}` : ' · Manual inputs'}{line.shared_key ? ' · Shared operation' : ''}</p><p>{line.included ? 'Included in package' : `${line.quantity ?? 'Unknown'} × ${quoteMoney(line.unit_price_cents)}`} · Net {quoteMoney(line.net_cents)}</p></div>)}</div><ul className="text-sm text-gold">{flags.map((flag, i) => <li key={i}>{flag.panel_id ? `${vehiclePanelLabel(flag.panel_id)}: ` : ''}{human(flag.code)}{warnings.has(flag.code) ? ' — warning; does not block a complete quote' : ' — review required'}</li>)}</ul></div> : <p className="rounded-lg bg-raised p-4 text-sm text-muted">Calculate a preview to see current selling totals. Edits invalidate earlier calculations.</p>}
            <div className="flex flex-col gap-2"><button type="button" className={buttonClass} onClick={save}>Save draft</button><button type="button" className={buttonClass} disabled={!panels.length || costDirty} onClick={calculate}>Preview calculation</button>{costDirty && <p className="text-sm text-gold">Save or explicitly discard private cost edits before calculation or commit.</p>}<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={blocked} onChange={event => setReviewed(event.target.checked)} />I reviewed this calculated draft</label><button type="button" className={`${buttonClass} text-brand`} disabled={!reviewed || blocked} onClick={commit}>Commit reviewed draft</button><button type="button" className={buttonClass} disabled={!dirty && !costDirty} onClick={() => askWarning({ type: 'cancel' })}>Cancel unsaved changes</button><button type="button" className={buttonClass} onClick={() => dirty || costDirty ? askWarning({ type: 'reload' }) : load()}>Reload saved inputs</button></div>
          </aside>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={!!busy || !revision || dirty || costDirty} onClick={getQuote}>Preview customer quote</button>{owner && <><button type="button" className={buttonClass} disabled={!!busy} onClick={() => costDraft ? setCostOpen(true) : getCosts()}>Owner cost drawer</button><button type="button" className={buttonClass} disabled={!!busy} onClick={() => setCatalogOpen(true)}>Manage owner presets</button></>}</div>
      {owner && catalogOpen && <><button type="button" className={buttonClass} disabled={catalogBusy} onClick={() => { if (!catalogDirty || window.confirm('Discard unsaved catalog inputs and close?')) { setCatalogOpen(false); setCatalogDirty(false) } }}>Close preset catalog</button><PanelPresetManager panel={panel} onCatalogChange={setCatalog} onDirtyChange={setCatalogDirty} onBusyChange={setCatalogBusy} /></>}
      {owner && costOpen && costDraft && <section aria-label="Private owner costs" className="min-w-0 space-y-4 rounded-instrument border border-line-2 bg-panel p-5"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Private owner / admin cost settings</h3><button type="button" className={buttonClass} disabled={!!busy} onClick={() => { setCostOpen(false); setNotice(costDirty ? 'Private cost edits remain unsaved and retained in the closed drawer.' : '') }}>Close cost drawer</button></div><p className="text-sm text-muted">Costs apply to the saved repair-order draft. Catalog private costs never automatically replace these settings.</p>{costDirty && <p className="text-gold">Unsaved private cost changes</p>}
        {costs ? <div className="space-y-2"><p className="text-muted">Saved server calculation{dirty || costDirty ? ' — local edits are not included' : ''}</p><p className="text-sm text-muted">Last saved cost audit reason: {costs.settings?.reason || 'Not supplied'}</p><p>Estimated direct cost: {quoteMoney(costs.direct_cost_cents)} · Known subtotal: {quoteMoney(costs.known_subtotal_cents)}</p><p className="text-gold">{costs.complete === true ? 'Cost inputs complete' : 'Cost inputs incomplete — no complete estimate claimed'}</p><ul>{(costs.missing || []).map((item, index) => <li key={index}>{item.id ? item.id.split(':').map(human).join(' · ') : 'Estimate'}: {human(item.reason)}</li>)}</ul><p>Gross contribution: {quoteMoney(costs.contribution_cents)} · Gross margin: {costs.margin_bps == null ? 'Unknown' : `${(costs.margin_bps / 100).toFixed(2)}%`}</p><p>Allocated overhead: {quoteMoney(costs.overhead_cents)} · After allocated overhead: {quoteMoney(costs.after_overhead_cents)}</p><p>Target price / floor: {quoteMoney(costs.target_revenue_cents)} · {costs.include_overhead_in_target ? 'Includes overhead' : 'Excludes overhead'}</p>{preview?.input_hash === costHash && preview.quote.totals?.net_cents != null && costs.target_revenue_cents != null ? <p className="text-gold">{preview.quote.totals.net_cents < costs.target_revenue_cents ? 'Selling price is below the target floor.' : 'Selling price meets the target floor.'}</p> : <p className="text-sm text-muted">Calculate a matching current preview to compare selling price with the floor.</p>}</div> : <p>Reload the saved server cost result after saving.</p>}
        <fieldset disabled={!!busy} className="min-w-0 space-y-4">{costDraft.lines.map((line, index) => <fieldset key={line.panel_id} className="min-w-0 space-y-3 rounded-lg border border-line-2 p-3"><legend>{vehiclePanelLabel(line.panel_id)}</legend><PrivateCostFields value={line} extras={panels.find(item => item.panel_id === line.panel_id)?.extras || []} onChange={patch => changeCosts({ lines: costDraft.lines.map((item, i) => i === index ? { ...item, ...patch } : item) })} /></fieldset>)}<CostPolicyFields value={costDraft} onChange={changeCosts} /><TextField name="Private estimate notes" multiline maxLength={4000} value={costDraft.private_notes} onChange={private_notes => changeCosts({ private_notes })} /><TextField name="Private cost audit reason" multiline maxLength={4000} value={costDraft.reason} onChange={reason => changeCosts({ reason })} /><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!costDraft.reason.trim()} onClick={saveCosts}>Save private cost settings</button><button type="button" className={buttonClass} onClick={() => { if (!costDirty || window.confirm('Discard unsaved private cost edits and reload saved costs? Public edits are retained.')) getCosts() }}>Reload private costs</button></div></fieldset>
      </section>}
      {quote && <CustomerPanelQuote quote={quote} />}
    </>}
  </section>
}
