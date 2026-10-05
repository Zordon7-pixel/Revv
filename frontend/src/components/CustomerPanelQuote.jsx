import { FileCheck } from 'lucide-react'
import { vehiclePanelLabel } from './VehicleDiagram'

export const quoteMoney = value => typeof value !== 'number' || !Number.isSafeInteger(value) ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100)
const text = value => typeof value === 'string' ? value : ''
const list = value => Array.isArray(value) ? value : []
const labels = { cash: 'Customer Pay', insurance: 'Insurance', body: 'Body labor', refinish: 'Refinish labor', materials: 'Paint and materials', parts: 'Parts', sublet: 'Sublet work', repair: 'Repair', replace: 'Replacement', 'paint-only': 'Paint only', blend: 'Blend', 'inspection-required': 'Inspection required' }
const human = value => labels[value] || text(value).replace(/^extra:/, '').replace(/[_:.-]+/g, ' ').replace(/^./, c => c.toUpperCase()) || 'Unknown'
const panelName = (quote, id) => text(list(quote.scope?.assessments).find(panel => panel.panel_id === id)?.label) || vehiclePanelLabel(text(id)) || 'Panel'
const lineName = (quote, line) => {
  const parts = [panelName(quote, line.panel_id), text(line.description), human(line.category), human(line.operation_id)].map(value => value.trim()).filter(Boolean)
  return parts.filter((value, index) => parts.findIndex(part => part.toLowerCase() === value.toLowerCase()) === index).join(' · ')
}
// Presentation only: accept the calculator's decimal quantity contract without
// coercing absent values, arbitrary objects, exponents or unsafe numbers.
const quantityLabel = value => {
  if (!['string', 'number'].includes(typeof value) || Object.is(value, -0)) return 'Unknown'
  const decimal = String(value)
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(decimal) || decimal.length > 32 || Number(decimal) > 1000000) return 'Unknown'
  return decimal
}
export const reviewedRevisionLabel = (version, fallback = 'Reviewed revision') => Number.isSafeInteger(version) && version > 0 ? `Revision ${version}` : fallback
const provenance = value => value === 'imported_carrier' ? 'Imported carrier estimate — reviewed; approval status not implied' : value === 'shop_prepared' ? 'Shop-prepared estimate for insurance submission — not insurer-approved' : 'Estimate provenance unknown; carrier approval not established'

// Download only a completed response for the still-active session. No bearer URL
// is opened in the browser or included in a filename, log, or error message.
export function downloadQuotePdf(blob, revision) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = `panel-quote-${text(revision).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'revision'}.pdf`
    document.body.appendChild(link); link.click()
  } finally { link.remove(); URL.revokeObjectURL(url) }
}

function Scope({ quote }) {
  const panels = list(quote.scope?.assessments)
  return <section aria-label="Repair scope" className="space-y-2"><h3 className="font-semibold">Repair scope</h3>{panels.length ? panels.map((panel, index) => <div key={text(panel.panel_id) || index}>
    <p>{panelName(quote, panel.panel_id)} · {human(panel.operation)}{panel.refinish === true ? ' · Refinish included in scope' : ''}</p>
    {text(panel.customer_notes) && <p className="whitespace-pre-wrap">{text(panel.customer_notes)}</p>}
    {panel.deferral && <div className="rounded-lg bg-raised p-3 text-sm"><p>Deferred optional cosmetic work — retained in scope, excluded from this repair total.</p><p>Reason: {text(panel.deferral.reason) || 'Unknown'}</p><p>Estimator recorded acknowledgement: {panel.deferral.estimator_acknowledged === true ? 'Yes' : 'Unknown'} · Customer acknowledgement recorded: {panel.deferral.customer_acknowledged === true ? 'Yes' : 'Unknown'}</p><p>Reference: {text(panel.deferral.customer_acknowledgement_reference) || 'Unknown'}</p><p>This recorded acknowledgement is not digital approval or an agreement signature.</p></div>}
  </div>) : <p>{list(quote.scope?.panel_ids).map(id => panelName(quote, id)).join(', ') || 'Scope unknown'}</p>}</section>
}
function Allocation({ quote }) {
  const allocation = quote.allocation || {}, scenario = quote.scenario || {}
  return <div className="space-y-2 text-sm">
    <p>{scenario.payer === 'cash' ? 'Customer Pay estimate; payer is separate from payment method.' : provenance(scenario.provenance)}</p>
    {scenario.payer === 'insurance' && <div>{[['Covered amount before deductible', 'covered_cents'], ['Applicable deductible', 'deductible_cents'], ['Uncovered charges', 'uncovered_cents'], ['Coverage reduction / adjustment', 'adjustment_cents']].map(([name, key]) => <div key={key}>{name}: {quoteMoney(scenario.allocation?.[key])}</div>)}</div>}
    <p>Estimated carrier contribution: {quoteMoney(allocation.carrier_cents)}</p><p>Estimated customer responsibility: {quoteMoney(allocation.customer_cents)}</p><p>Posted payments: {quoteMoney(allocation.paid_cents)}</p><p>Remaining repair balance: {quoteMoney(allocation.balance_cents)}</p>
    {allocation.complete !== true && <p className="text-gold">Allocation is incomplete. Unknown responsibility is not zero.</p>}
    <p className="text-muted">Posted payments are frozen at review. Expected carrier contributions are not received payments.</p>
  </div>
}
// Accept only public comparison paths. Even malicious nested cost objects or old
// array-shaped comparisons must never be dumped into customer-facing markup.
const publicFields = new Set(('scope panel_ids assessments panel_id label body_style severity damage_type area operation refinish body_hours refinish_hours body_rate_cents refinish_rate_cents parts_sell_cents materials_sell_cents sublet_sell_cents customer_notes reviewed preset_version_id photo_ids paint_system taxable body parts materials sublet package name price_cents included_operations sell_allocation_cents extras key category description quantity unit_price_cents materials_pricing method unit_rate_cents application_snapshot id family_id version contract_version match sell_settings minimum_cents override_policy preset_override reason optional_cosmetic deferral estimator_acknowledged customer_acknowledged customer_acknowledgement_reference scenario payer provenance allocation covered_cents deductible_cents uncovered_cents adjustment_cents carrier_cents customer_cents paid_cents balance_cents complete adjustments discount_cents discounts amount_cents line_ids package_ids totals subtotal_cents minimum_adjustment_cents net_cents tax_rate_bps tax_cents total_cents').split(' '))
function safeDifference(change) {
  const path = text(change.path), fields = path.replace(/\[(?:"(?:[^"\\]|\\.)*"|\d+)\]/g, '').split('.')
  return ['scope', 'scenario', 'adjustments', 'totals', 'allocation'].includes(fields[0]) && fields.every(field => publicFields.has(field))
}
function differenceValue(value, path) {
  if (value == null) return 'Unknown'
  if (typeof value === 'object') return 'Historical detail unavailable'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return path.endsWith('_cents') ? quoteMoney(value) : path.endsWith('_bps') ? `${value / 100}%` : String(value)
  return labels[value] || (['operation', 'provenance', 'category', 'method', 'override_policy', 'body_style', 'severity'].some(field => path.endsWith(`.${field}`)) ? (value === 'shop_prepared' || value === 'imported_carrier' ? provenance(value) : human(value)) : text(value))
}
function Charges({ quote }) {
  const lines = list(quote.lines), buckets = list(quote.buckets), packages = list(quote.packages)
  const amounts = bucket => <p className="text-sm">Net {quoteMoney(bucket.net_cents)} · Tax {quoteMoney(bucket.tax_cents)}</p>
  const target = id => { const line = lines.find(item => item.id === id); return line ? lineName(quote, line) : 'Historical line target' }
  return <>
    <section aria-label="Reviewed estimate charges" className="space-y-3"><h3 className="font-semibold">Repair charges</h3><p className="text-sm text-muted">Net charges already include discounts. Package inclusions have no additional charge. Totals below come from the reviewed quote.</p>
      {packages.map((pkg, index) => <div key={text(pkg.id) || index} className="rounded-lg border border-line-2 p-3" aria-label={`Package ${text(pkg.name)}`}><h4 className="font-semibold">{text(pkg.name) || 'Package'}</h4><p>One package price before discounts: {quoteMoney(pkg.price_cents)}</p>
        {buckets.filter(bucket => (bucket.kind === 'package' && bucket.id === pkg.id) || (bucket.kind === 'package_allocation' && bucket.package_id === pkg.id)).map(bucket => <div key={bucket.id}>{bucket.kind === 'package_allocation' && <p>{human(bucket.category)} allocation within package</p>}{amounts(bucket)}</div>)}
        <ul>{list(pkg.included_operations).map((op, i) => <li key={i}>{panelName(quote, op.panel_id)} · {human(op.operation_id)} — Included in package</li>)}</ul>
      </div>)}
      {lines.filter(line => !line.included).map((line, i) => <div key={text(line.id) || i} className="border-b border-line-2 pb-3"><p>{lineName(quote, line)}</p><p className="text-sm text-muted">{quantityLabel(line.quantity)} × {quoteMoney(line.unit_price_cents)}{line.shared_key ? ' · Shared operation' : ''}</p>{amounts(line)}</div>)}
      {buckets.filter(bucket => ['minimum', 'panel_minimum'].includes(bucket.kind)).map(bucket => <div key={bucket.id}><p>{bucket.kind === 'panel_minimum' ? `${panelName(quote, bucket.panel_id)} minimum adjustment` : 'Estimate minimum adjustment'}</p>{amounts(bucket)}</div>)}
    </section>
    <section aria-label="Discounts and minimums" className="space-y-2"><h3 className="font-semibold">Discounts and minimums</h3><p>Global discount: {quoteMoney(quote.adjustments?.discount_cents)} — already allocated</p>
      {list(quote.adjustments?.discounts).map((discount, i) => <div key={text(discount.id) || i}><p>Scoped discount {i + 1}: {quoteMoney(discount.amount_cents)} — already allocated</p><ul>{list(discount.line_ids).map(id => <li key={id}>Applies to: {target(id)}</li>)}{list(discount.package_ids).map(id => <li key={id}>Applies to package: {text(packages.find(pkg => pkg.id === id)?.name) || 'Historical package'}</li>)}</ul></div>)}
      <p>Estimate minimum: {quoteMoney(quote.adjustments?.minimum_cents)} — any increase is shown in repair charges</p>
      {list(quote.scope?.assessments).filter(panel => panel.application_snapshot?.sell_settings?.minimum_cents != null).map(panel => <p key={panel.panel_id}>{panelName(quote, panel.panel_id)} preset minimum: {quoteMoney(panel.application_snapshot.sell_settings.minimum_cents)}{panel.deferral ? ' — deferred; not charged' : ' — any increase is shown in repair charges'}</p>)}
    </section>
  </>
}

// Explicit field access throughout; no spread/JSON rendering of owner inputs.
export default function CustomerPanelQuote({ quote, vehicle, version }) {
  if (!quote) return null
  const vehicleLabel = text(vehicle) || text(quote.vehicle) || [quote.vehicle?.year, quote.vehicle?.make, quote.vehicle?.model].filter(value => typeof value === 'string' || typeof value === 'number').join(' ')
  return <article className="min-w-0 space-y-5 break-words rounded-instrument border border-line-2 bg-panel p-4 text-ink sm:p-6" aria-label="Customer quote">
    <header className="flex items-start gap-3"><FileCheck className="shrink-0 text-brand" /><div className="min-w-0"><h2 className="text-xl font-semibold">Your repair estimate</h2><p className="text-muted">{vehicleLabel || 'Vehicle details not provided'} · {reviewedRevisionLabel(version)}</p>{vehicle && <p className="text-sm text-muted">Vehicle supplied by the repair-order screen; not a snapshot identity.</p>}</div></header>
    <Scope quote={quote} /><Charges quote={quote} />
    <dl className="space-y-2" aria-label="Quote totals">{[['Subtotal before discounts', 'subtotal_cents'], ['Total discounts (already allocated)', 'discount_cents'], ['Total minimum increases (already included)', 'minimum_adjustment_cents'], ['Net repair amount', 'net_cents'], ['Tax', 'tax_cents'], ['Repair total', 'total_cents']].map(([name, key]) => <div key={key} className="flex justify-between gap-4"><dt>{name}</dt><dd className="font-mono font-semibold">{quoteMoney(quote.totals?.[key])}</dd></div>)}</dl>
    <section aria-label="Payer scenarios" className="space-y-3"><h3 className="font-semibold">Customer Pay / Insurance comparison</h3><p className="text-sm text-muted">Only this selected revision drives billing. Historical alternatives are comparison only; do not add their totals. No equivalent scope, savings, automatic insurer uplift or carrier approval is implied.</p>
      <div className="rounded-lg bg-raised p-4"><h4 className="font-semibold">{human(quote.scenario?.payer)} · Current selected revision</h4><Allocation quote={quote} /></div>
      {list(quote.comparisons).map((old, index) => <section key={text(old.revision_id) || index} aria-label={`Historical ${reviewedRevisionLabel(old.version).toLowerCase()}`} className="space-y-3 rounded-lg border border-line-2 p-4"><h4 className="font-semibold">{human(old.scenario?.payer)} · Historical · {reviewedRevisionLabel(old.version)}</h4><Scope quote={old} /><p>Historical repair total: {quoteMoney(old.totals?.total_cents)}</p><Allocation quote={old} /><p>Differences: historical value → this selected revision</p><ul className="space-y-2 text-sm">{list(old.differences).filter(safeDifference).map((change, i) => <li key={i}>{text(change.label) || human(change.path)}: {differenceValue(change.before, text(change.path))} → {differenceValue(change.after, text(change.path))}</li>)}</ul>{!list(old.differences).length && <p>Recorded differences unavailable. Equivalence is unverified.</p>}{list(old.differences).some(change => typeof change.before === 'object' && change.before !== null || typeof change.after === 'object' && change.after !== null) && <p>Some historical details are unavailable in this older revision.</p>}</section>)}
    </section>
    <p className="text-sm text-muted">Estimator-reviewed scope is not customer authorization or carrier approval. Vehicle inspection may change the required work.</p>
  </article>
}
