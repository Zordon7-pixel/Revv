import { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { getRole } from '../lib/auth'
import PanelWorkFields, { blankCosts, buttonClass, Choice, clone, CostPolicyFields, MatchFields, NumericField, PrivateCostFields, safeSell, TextField } from './PanelWorkFields'

const base = '/estimate-items/panel-presets'
const matchKeys = ['panel_id', 'body_style', 'operation', 'severity', 'paint_system', 'area']
export default function PanelPresetManager(props) {
  return ['owner', 'admin'].includes(getRole()) ? <Catalog {...props} /> : null
}
function Catalog({ panel, onCatalogChange, onDirtyChange, onBusyChange }) {
  const [presets, setPresets] = useState([])
  const [form, setForm] = useState(null)
  const [selected, setSelected] = useState(null)
  const [privateReady, setPrivateReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const alive = useRef(true), lock = useRef(false), retry = useRef(null)
  const mark = value => { setDirty(value); onDirtyChange?.(value) }
  const patch = change => { setForm(previous => ({ ...previous, ...change })); mark(true); setResult(null) }
  const discard = () => !dirty || window.confirm('Discard unsaved catalog inputs?')
  async function run(name, task, retryTask = task) {
    if (lock.current || !['owner', 'admin'].includes(getRole())) return
    lock.current = true; setBusy(name); onBusyChange?.(true); setError(''); retry.current = () => run(name, retryTask)
    try { await task() } catch (err) { if (alive.current) setError(err.catalogRefresh ? 'The immutable version was created, but the catalog refresh failed. Its result is retained below. Retry the catalog read.' : err.response?.data?.error === 'PRESET_ARCHIVED' ? 'This family is archived. Unarchive it before creating a version. Your inputs are retained.' : `${name} failed. Inputs are retained. After an uncertain write, refresh the list and inspect versions before submitting again.`) }
    finally { if (alive.current) { lock.current = false; setBusy(''); onBusyChange?.(false) } }
  }
  async function refresh() {
    const { data } = await api.get(base)
    if (!Array.isArray(data.presets)) throw new Error('Invalid catalog response')
    if (alive.current) { setPresets(data.presets); onCatalogChange?.(data.presets) }
  }
  useEffect(() => { alive.current = true; run('Load catalog', refresh); return () => { alive.current = false } }, [])
  function startCurrent() {
    if (!panel || !discard()) return
    setSelected(null); setPrivateReady(false); setResult(null)
    setForm({ contract_version: 1, name: '', match: Object.fromEntries(matchKeys.map(key => [key, panel[key] ?? null])), sell_settings: { ...safeSell(panel), minimum_cents: null, override_policy: 'owner_admin' }, private_cost_config: { ...blankCosts(), target_margin_bps: null, overhead_cents: null, include_overhead_in_target: false }, reason: '' }); mark(true)
  }
  function selectVersion(id) {
    if (!discard()) return
    const preset = presets.find(item => item.id === id)
    setSelected(preset || null); setPrivateReady(false); setResult(null)
    setForm(preset ? { contract_version: 1, name: preset.name, match: clone(preset.match), sell_settings: clone(preset.sell_settings), private_cost_config: null, reason: '' } : null); mark(false)
  }
  function loadPrivate() {
    const versionId = selected.id
    run('Load version private configuration', async () => {
      const { data } = await api.get(`${base}/${encodeURIComponent(versionId)}/cost-config`)
      if (!data.private_cost_config) throw new Error('Invalid private configuration')
      if (alive.current) { setForm(previous => ({ ...previous, private_cost_config: clone(data.private_cost_config) })); setPrivateReady(false) }
    })
  }
  function save() {
    if (!form || !privateReady || !form.private_cost_config || !form.name.trim() || !form.reason.trim()) return
    const url = selected ? `${base}/${encodeURIComponent(selected.family_id)}/versions` : base
    const body = clone(form)
    run('Create immutable preset version', async () => {
      const { data } = await api.post(url, body)
      if (!data.id || !data.family_id || !data.version) throw new Error('Invalid version result')
      if (alive.current) { setResult(data); mark(false); setForm(null); setSelected(null); setPrivateReady(false); try { await refresh() } catch { throw Object.assign(new Error('Catalog refresh failed'), { catalogRefresh: true }) } }
    }, refresh)
  }
  function archive(preset) {
    run(preset.archived ? 'Unarchive preset family' : 'Archive preset family', async () => {
      await api.post(`${base}/${encodeURIComponent(preset.family_id)}/archive`, { archived: !preset.archived })
      await refresh()
    }, refresh)
  }
  const archived = selected && presets.find(item => item.id === selected.id)?.archived
  return <section aria-label="Owner preset catalog" className="min-w-0 space-y-4 rounded-instrument border border-line-2 bg-panel p-5">
    <h3 className="font-semibold">Owner / admin preset catalog</h3><p className="text-sm text-muted">Versions are immutable. New versions never reprice existing assessments. Private costs require separate review and do not automatically apply to the repair order.</p>
    {busy && <p role="status">{busy}…</p>}{error && <div role="alert"><p>{error}</p><button type="button" className={buttonClass} disabled={!!busy} onClick={() => retry.current?.()}>Retry catalog read</button></div>}
    {result && <p role="status" className="break-words text-brand">Created {result.name}, immutable version {result.version}. Version ID: {result.id}. Family ID: {result.family_id}.</p>}
    <fieldset disabled={!!busy} className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => run('Refresh catalog', refresh)}>Refresh catalog</button><button type="button" className={buttonClass} disabled={!panel} onClick={startCurrent}>Create preset from current panel settings</button></div>
      <Choice name="Catalog version" value={selected?.id} empty="Choose an immutable version" options={presets.map(item => [item.id, `${item.name} · Version ${item.version}${item.archived ? ' · Archived' : ''}`])} onChange={selectVersion} />
      <ul className="space-y-2">{presets.filter((item, index) => presets.findIndex(other => other.family_id === item.family_id) === index).map(item => <li key={item.family_id} className="flex flex-wrap items-center justify-between gap-2"><span>{item.name} · {item.archived ? 'Archived — historical use retained' : 'Available'}</span><button type="button" className={buttonClass} onClick={() => archive(item)}>{item.archived ? 'Unarchive' : 'Archive'} {item.name}</button></li>)}</ul>
      {form && <div className="min-w-0 space-y-4"><p className="text-sm text-muted">{selected ? `New version in family ${selected.family_id}; starting from version ${selected.version}.` : 'New family from explicitly copied current panel inputs.'} {dirty && 'Unsaved catalog inputs.'}</p>
        <TextField name="Preset name" value={form.name} onChange={name => patch({ name })} /><MatchFields panelId value={form.match} onChange={change => patch({ match: { ...form.match, ...change } })} />
        <PanelWorkFields value={form.sell_settings} onChange={change => patch({ sell_settings: { ...form.sell_settings, ...change } })} />
        <NumericField name="Preset panel minimum" value={form.sell_settings.minimum_cents} onChange={minimum_cents => patch({ sell_settings: { ...form.sell_settings, minimum_cents } })} /><p className="text-sm text-muted">Minimum is applied by the server after discounts. Ambiguous mixed-tax minimum adjustments are rejected.</p>
        <Choice name="Override policy" empty={false} value={form.sell_settings.override_policy} options={[[ 'owner_admin', 'Owner / admin with customer-safe reason' ], [ 'locked', 'Locked — no controlled changes' ]]} onChange={override_policy => patch({ sell_settings: { ...form.sell_settings, override_policy } })} />
        {selected && !form.private_cost_config && <button type="button" className={buttonClass} onClick={loadPrivate}>Load selected version private configuration</button>}
        {form.private_cost_config && <fieldset className="min-w-0 space-y-4 rounded-lg border border-line-2 p-4"><legend>Separate authorized catalog cost inputs</legend><PrivateCostFields value={form.private_cost_config} extras={form.sell_settings.extras} onChange={change => { setPrivateReady(false); patch({ private_cost_config: { ...form.private_cost_config, ...change } }) }} /><CostPolicyFields value={form.private_cost_config} onChange={change => { setPrivateReady(false); patch({ private_cost_config: { ...form.private_cost_config, ...change } }) }} /><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={privateReady} onChange={e => { setPrivateReady(e.target.checked); mark(true) }} />I reviewed these private costs; blanks remain unknown, not free</label></fieldset>}
        <TextField name="Catalog audit reason" multiline maxLength={4000} value={form.reason} onChange={reason => patch({ reason })} />
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!!archived || !privateReady || !form.name.trim() || !form.reason.trim()} onClick={save}>{selected ? 'Create immutable version' : 'Create preset family'}</button><button type="button" className={buttonClass} onClick={() => { if (discard()) { setForm(null); setSelected(null); setPrivateReady(false); mark(false) } }}>Cancel catalog edits</button></div>
      </div>}
    </fieldset>
  </section>
}
