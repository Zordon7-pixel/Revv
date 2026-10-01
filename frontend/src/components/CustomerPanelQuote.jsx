import { FileCheck, Info } from 'lucide-react'

export const quoteMoney = value => value == null || !Number.isFinite(Number(value)) ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) / 100)
const label = value => typeof value === 'string' ? value : ''
const scopeText = scope => Array.isArray(scope) ? scope.map(item => typeof item === 'string' ? item : item.label || item.description).filter(Boolean).join(', ') : label(scope)
const provenance = value => value === 'imported_carrier' ? 'Imported carrier estimate — approval status not implied' : 'Shop-prepared estimate for insurance submission — not insurer-approved'

// Pure rendering of the GET /quote projection. Never accepts the owner cost model.
export default function CustomerPanelQuote({ quote }) {
  if (!quote) return null
  const totals = quote.totals || {}
  const allocation = quote.allocation || {}
  const vehicle = typeof quote.vehicle === 'string' ? quote.vehicle : [quote.vehicle?.year, quote.vehicle?.make, quote.vehicle?.model].filter(Boolean).join(' ')
  return <article className="min-w-0 space-y-5 rounded-instrument border border-line-2 bg-panel p-4 text-ink sm:p-6" aria-label="Customer quote">
    <header className="flex items-start gap-3"><FileCheck className="shrink-0 text-brand" /><div><h2 className="text-xl font-semibold">Your repair estimate</h2><p className="text-muted">{vehicle || 'Vehicle not supplied'} · Revision {quote.revision_id ?? 'not supplied'}</p></div></header>
    <p><span className="text-muted">Scope: </span>{scopeText(quote.scope) || 'Scope not supplied'}</p>
    {quote.customer_notes && <p className="whitespace-pre-wrap break-words">{quote.customer_notes}</p>}
    <div className="space-y-3" aria-label="Reviewed estimate lines">{(quote.lines || []).map((line, index) => <div key={line.id || index} className="grid grid-cols-1 gap-2 border-b border-line-2 pb-3 sm:grid-cols-[1fr_auto]">
      <div><p className="font-medium">{line.description || line.label || line.operation_id}</p><p className="text-sm text-muted">{line.panel_label || line.panel_id} · {line.included ? 'Included in package' : `${line.quantity ?? 'Unknown'} × ${quoteMoney(line.unit_price_cents)}`}</p>{line.customer_notes && <p className="whitespace-pre-wrap">{line.customer_notes}</p>}</div>
      <div className="text-sm sm:text-right"><p>Net {quoteMoney(line.net_cents)}</p><p className="text-muted">Tax {quoteMoney(line.tax_cents)}</p></div>
    </div>)}</div>
    <dl className="space-y-2">{[['Net repair amount', totals.net_cents], ['Tax', totals.tax_cents], ['Repair total', totals.total_cents]].map(([name, value]) => <div key={name} className="flex justify-between gap-4"><dt>{name}</dt><dd className="font-mono font-semibold">{quoteMoney(value)}</dd></div>)}</dl>
    <section className="space-y-2 rounded-instrument bg-raised p-4"><h3 className="font-semibold">Payer allocation</h3><p className="text-sm text-muted">{quote.payer === 'cash' ? 'Customer Pay' : provenance(quote.provenance)}</p><p>Estimated carrier contribution: {quoteMoney(allocation.carrier_cents)}</p><p>Estimated customer responsibility: {quoteMoney(allocation.customer_cents)}</p><p>Posted payments: {quoteMoney(allocation.paid_cents)}</p><p>Remaining balance: {quoteMoney(allocation.balance_cents)}</p>{allocation.complete !== true && <p className="flex items-start gap-2 text-gold"><Info size={18} className="shrink-0" />Allocation is incomplete. Unknown responsibility is not zero.</p>}</section>
    {(quote.scenarios || []).length > 0 && <section className="space-y-3"><h3 className="font-semibold">Scenario comparison</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{quote.scenarios.map((scenario, index) => <div key={scenario.id || index} className="min-w-0 rounded-instrument bg-raised p-4"><h4>{scenario.payer === 'cash' ? 'Customer Pay' : 'Insurance'} · Revision {scenario.revision_id ?? 'unknown'}</h4><p className="text-sm text-muted">{scenario.payer === 'cash' ? 'Customer Pay estimate' : provenance(scenario.provenance)}</p><p>Scope: {scopeText(scenario.scope) || 'Unknown'}</p><p>Repair total: {quoteMoney(scenario.totals?.total_cents)}</p><p>Customer responsibility: {quoteMoney(scenario.allocation?.customer_cents)}</p><ul className="mt-2 list-inside list-disc text-sm">{(scenario.differences || []).map((difference, i) => <li key={i}>{typeof difference === 'string' ? difference : `${difference.label || difference.field}: ${difference.before ?? 'Unknown'} → ${difference.after ?? 'Unknown'}`}</li>)}</ul>{!scenario.differences && <p className="text-gold">Scope/rate differences not supplied; equivalence is unverified.</p>}</div>)}</div></section>}
    <p className="text-sm text-muted">Estimator-reviewed scope is not customer authorization or carrier approval. Vehicle inspection may change the required work.</p>
  </article>
}
