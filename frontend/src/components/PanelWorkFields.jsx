import { useId } from 'react'
import { vehiclePanelOptions } from './VehicleDiagram'

export const inputClass = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-2 bg-raised px-3 py-2 text-ink'
export const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-2 bg-raised px-4 py-2 text-sm font-medium text-ink disabled:opacity-40'
export const categories = ['body', 'refinish', 'parts', 'materials', 'sublet']
export const sellFields = ['body_hours', 'refinish_hours', 'body_rate_cents', 'refinish_rate_cents', 'parts_sell_cents', 'materials_sell_cents', 'sublet_sell_cents']
export const costFields = ['body_cost_rate_cents', 'refinish_cost_rate_cents', 'parts_cost_cents', 'materials_cost_cents', 'sublet_cost_cents']
export const labels = { body: 'Body labor', refinish: 'Refinish labor', parts: 'Parts', materials: 'Materials', sublet: 'Sublet', body_hours: 'Body hours', refinish_hours: 'Refinish hours', body_rate_cents: 'Body sell rate', refinish_rate_cents: 'Refinish sell rate', parts_sell_cents: 'Parts sell', materials_sell_cents: 'Materials sell', sublet_sell_cents: 'Sublet sell', body_cost_rate_cents: 'Body cost rate', refinish_cost_rate_cents: 'Refinish cost rate', parts_cost_cents: 'Parts cost', materials_cost_cents: 'Materials cost', sublet_cost_cents: 'Sublet cost' }
export const human = value => labels[value] || String(value || '').replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase())
export const clone = value => JSON.parse(JSON.stringify(value))
export const safeSell = panel => ({ ...Object.fromEntries(sellFields.map(key => [key, panel[key] ?? null])), refinish: panel.refinish ?? null, taxable: Object.fromEntries(categories.map(key => [key, panel.taxable?.[key] ?? null])), package: clone(panel.package ?? null), extras: clone(panel.extras || []), materials_pricing: clone(panel.materials_pricing || { method: 'explicit' }) })
export const blankCosts = () => ({ ...Object.fromEntries(costFields.map(key => [key, null])), cost_sources: Object.fromEntries(costFields.map(key => [key, null])), extras: [], private_notes: '' })

export function NumericField({ name, value, onChange, money = true, unit, max = money ? 99999999.99 : 1000000 }) {
  return <label className="block min-w-0 text-sm text-muted">{name}{unit ?? (money ? ' ($)' : '')}<input className={inputClass} type="number" min="0" max={max} step="0.01" placeholder="Not supplied" value={value == null ? '' : money ? value / 100 : value} onChange={event => {
    const raw = event.target.value
    if (raw === '') onChange(null)
    else if (/^\d+(\.\d{0,2})?$/.test(raw) && Number(raw) <= max) onChange(money ? Math.round(Number(raw) * 100) : Number(raw))
  }} /></label>
}
export function TextField({ name, value, onChange, maxLength = 200, multiline = false }) {
  const Tag = multiline ? 'textarea' : 'input'
  return <label className="block min-w-0 text-sm text-muted">{name}<Tag className={inputClass} maxLength={maxLength} value={value ?? ''} onChange={e => onChange(e.target.value)} /></label>
}
export function Choice({ name, value, onChange, options, empty = 'Not supplied' }) {
  return <label className="block min-w-0 text-sm text-muted">{name}<select className={inputClass} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>{empty !== false && <option value="">{empty}</option>}{options.map(option => { const [id, label] = Array.isArray(option) ? option : [option, human(option)]; return <option key={id} value={id}>{label}</option> })}</select></label>
}
export function TaxField({ name, value, onChange, mixed = false }) {
  return <Choice name={name} value={value == null ? '' : String(value)} onChange={value => onChange(value === null ? null : value === 'true')} empty={mixed ? 'Use explicit category allocation' : 'Required — choose tax treatment'} options={[[ 'true', 'Taxable' ], [ 'false', 'Not taxable' ]]} />
}
export function MatchFields({ value, onChange, panelId = false }) {
  return <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
    {panelId && <Choice name="Match panel" value={value.panel_id} options={vehiclePanelOptions} onChange={panel_id => onChange({ panel_id })} />}
    <Choice name="Body style" value={value.body_style} onChange={body_style => onChange({ body_style })} options={['sedan', 'coupe', 'hatchback', 'suv', 'truck', 'van', 'other']} />
    <Choice name="Severity" value={value.severity} onChange={severity => onChange({ severity })} options={['light', 'moderate', 'heavy']} />
    <Choice name="Operation" value={value.operation} onChange={operation => onChange({ operation })} options={['repair', 'replace', 'paint-only', 'blend', 'inspection-required']} />
    <TextField name="Damage area" value={value.area} onChange={area => onChange({ area: area || null })} />
    <TextField name="Paint system (optional match)" maxLength={80} value={value.paint_system} onChange={paint_system => onChange({ paint_system: paint_system || null })} />
  </div>
}

export default function PanelWorkFields({ value, onChange, disabled = false }) {
  const updatePackage = patch => onChange({ package: { ...value.package, ...patch } })
  const updateExtra = (index, patch) => onChange({ extras: value.extras.map((extra, i) => i === index ? { ...extra, ...patch } : extra) })
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <legend className="font-semibold">Selling inputs</legend>
    <p className="text-sm text-muted">Blank means unknown. Enter explicit zero when appropriate. Every category needs a tax choice, including zero charges. The server calculates extensions and totals.</p>
    <Choice name="Include refinish work" value={value.refinish == null ? null : String(value.refinish)} onChange={refinish => onChange({ refinish: refinish == null ? null : refinish === 'true' })} options={[[ 'true', 'Yes' ], [ 'false', 'No' ]]} />
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{sellFields.filter(key => key !== 'materials_sell_cents').map(key => <NumericField key={key} name={labels[key]} value={value[key]} money={key.endsWith('_cents')} onChange={number => onChange({ [key]: number })} />)}</div>
    <Choice name="Materials pricing method" value={value.materials_pricing?.method || 'explicit'} empty={false} options={[[ 'explicit', 'Explicit amount' ], [ 'quantity_rate', 'Quantity × shop rate' ]]} onChange={method => onChange({ materials_sell_cents: null, materials_pricing: method === 'explicit' ? { method } : { method, quantity: null, unit_rate_cents: null } })} />
    {value.materials_pricing?.method === 'quantity_rate' ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><NumericField name="Materials quantity" money={false} value={value.materials_pricing.quantity} onChange={quantity => onChange({ materials_pricing: { ...value.materials_pricing, quantity } })} /><NumericField name="Materials unit rate" value={value.materials_pricing.unit_rate_cents} onChange={unit_rate_cents => onChange({ materials_pricing: { ...value.materials_pricing, unit_rate_cents } })} /></div> : <NumericField name="Materials sell" value={value.materials_sell_cents} onChange={materials_sell_cents => onChange({ materials_sell_cents })} />}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{categories.map(category => <TaxField key={category} name={`${labels[category]} tax treatment`} value={value.taxable?.[category]} onChange={taxable => onChange({ taxable: { ...value.taxable, [category]: taxable } })} />)}</div>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!value.package} onChange={e => onChange({ package: e.target.checked ? { name: '', price_cents: null, taxable: null, included_operations: [] } : null })} />Use one fixed package price</label>
    {value.package && <div className="space-y-3 rounded-lg border border-line-2 p-3"><TextField name="Package name" value={value.package.name} onChange={name => updatePackage({ name })} /><NumericField name="Package price" value={value.package.price_cents} onChange={price_cents => updatePackage({ price_cents })} /><TaxField name="Package tax treatment" mixed value={value.package.taxable} onChange={taxable => updatePackage({ taxable })} />
      <p className="text-sm text-muted">Included operations have one package selling price. Mixed tax requires an explicit sell allocation summing to that price; private costs never set this allocation.</p>
      {categories.map(category => <label key={category} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={value.package.included_operations.includes(category)} onChange={e => { const included_operations = e.target.checked ? [...value.package.included_operations, category] : value.package.included_operations.filter(key => key !== category); updatePackage({ included_operations, ...(value.package.sell_allocation_cents ? { sell_allocation_cents: Object.fromEntries(included_operations.map(key => [key, value.package.sell_allocation_cents[key] ?? null])) } : {}) }) }} />Include {labels[category]}</label>)}
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!value.package.sell_allocation_cents} onChange={e => { const { sell_allocation_cents, ...rest } = value.package; onChange({ package: e.target.checked ? { ...rest, sell_allocation_cents: Object.fromEntries(rest.included_operations.map(key => [key, null])) } : rest }) }} />Allocate package selling price by category</label>
      {value.package.sell_allocation_cents && value.package.included_operations.map(category => <NumericField key={category} name={`${labels[category]} package allocation`} value={value.package.sell_allocation_cents[category]} onChange={amount => updatePackage({ sell_allocation_cents: { ...value.package.sell_allocation_cents, [category]: amount } })} />)}
    </div>}
    <div className="space-y-3"><h5 className="font-semibold">Distinct and shared extra operations</h5><p className="text-sm text-muted">Use the same scope and operation key for genuinely shared work. Different operations need distinct identities, even with the same description. Keys use lowercase letters, digits and underscores, starting with a letter. Do not repeat base materials here.</p>
      {(value.extras || []).map((extra, index) => <fieldset key={index} className="space-y-3 rounded-lg border border-line-2 p-3"><legend>Extra operation {index + 1}</legend><TextField name="Operation key" maxLength={80} value={extra.key} onChange={key => updateExtra(index, { key })} /><TextField name="Operation scope" maxLength={80} value={extra.scope} onChange={scope => updateExtra(index, { scope })} /><Choice name="Extra category" value={extra.category} options={categories} onChange={category => updateExtra(index, { category })} /><TextField name="Extra description" value={extra.description} onChange={description => updateExtra(index, { description })} /><NumericField name="Extra quantity" money={false} value={extra.quantity} onChange={quantity => updateExtra(index, { quantity })} /><NumericField name="Extra unit price" value={extra.unit_price_cents} onChange={unit_price_cents => updateExtra(index, { unit_price_cents })} /><TaxField name="Extra tax treatment" value={extra.taxable} onChange={taxable => updateExtra(index, { taxable })} /><button type="button" className={buttonClass} onClick={() => onChange({ extras: value.extras.filter((_, i) => i !== index) })}>Remove extra operation {index + 1}</button></fieldset>)}
      <button type="button" className={buttonClass} disabled={(value.extras || []).length >= 30} onClick={() => onChange({ extras: [...(value.extras || []), { key: '', scope: '', category: null, description: '', quantity: null, unit_price_cents: null, taxable: null }] })}>Add extra operation</button>
    </div>
  </fieldset>
}

export function PrivateCostFields({ value, onChange, extras = [] }) {
  const id = useId()
  const identities = [...(value.extras || [])]
  for (const extra of extras) if (!identities.some(item => item.key === extra.key && item.scope === extra.scope)) identities.push({ key: extra.key, scope: extra.scope, cost_unit_cents: null, cost_source: null })
  return <div className="space-y-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{costFields.map(key => <div key={key} className="space-y-2"><NumericField name={labels[key]} value={value[key]} onChange={amount => onChange({ [key]: amount })} /><Choice name={`${labels[key]} source`} value={value.cost_sources?.[key]} options={['estimated', 'quoted', 'actual']} empty="Unknown source" onChange={source => onChange({ cost_sources: { ...value.cost_sources, [key]: source } })} /></div>)}</div>
    {identities.map((extra, index) => <fieldset key={`${extra.scope}:${extra.key}`} className="space-y-2 border border-line-2 p-3"><legend>Extra cost: {extra.scope} / {extra.key}</legend><NumericField name="Extra unit cost" value={extra.cost_unit_cents} onChange={cost_unit_cents => onChange({ extras: identities.map((item, i) => i === index ? { ...item, cost_unit_cents } : item) })} /><Choice name="Extra cost source" value={extra.cost_source} options={['estimated', 'quoted', 'actual']} empty="Unknown source" onChange={cost_source => onChange({ extras: identities.map((item, i) => i === index ? { ...item, cost_source } : item) })} /><button type="button" className={buttonClass} onClick={() => onChange({ extras: identities.filter((_, i) => i !== index) })}>Clear saved extra cost {extra.scope} / {extra.key}</button></fieldset>)}
    <label htmlFor={id} className="block text-sm text-muted">Private panel notes</label><textarea id={id} className={inputClass} maxLength={4000} value={value.private_notes || ''} onChange={e => onChange({ private_notes: e.target.value })} />
  </div>
}
export function CostPolicyFields({ value, onChange }) {
  return <div className="space-y-3"><NumericField name="Target margin" unit=" (%)" max={99.99} value={value.target_margin_bps} onChange={target_margin_bps => onChange({ target_margin_bps })} /><NumericField name="Allocated overhead" value={value.overhead_cents} onChange={overhead_cents => onChange({ overhead_cents })} /><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={!!value.include_overhead_in_target} onChange={e => onChange({ include_overhead_in_target: e.target.checked })} />Include allocated overhead in target margin price</label></div>
}
