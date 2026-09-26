import { PART_DELIVERY_LABELS } from '../lib/partDelivery'
const sourceLabel={supplier:'Supplier estimate',carrier:'Carrier estimate',shop:'Shop estimate',unknown:'Estimate source not confirmed'}
export default function CustomerPartsStatus({parts=[],summary}) {
  return <div className="space-y-3 p-4 sm:p-5">
    {summary&&<div className="rounded-instrument border border-brand/30 bg-brand/10 p-3"><p className="font-semibold text-ink">{summary.message}</p>{summary.latest_expected_date&&<p className="mt-1 text-sm text-muted">Latest expected parts arrival: {summary.latest_expected_date}</p>}<p className="mt-1 text-xs text-muted">{summary.disclaimer}</p></div>}
    <ul className="divide-y divide-line">{parts.map((p,i)=><li key={`${p.part_name}-${i}`} className="space-y-2 py-3 text-sm">
      <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words font-medium text-ink">{p.part_name}</span><span className="shrink-0 rounded-full border border-line px-2 py-1 text-xs text-muted">{PART_DELIVERY_LABELS[p.status]||p.status}</span></div>
      {p.status!=='cancelled'&&p.status!=='received'&&<p className="text-muted">Expected arrival: {p.expected_date||'Awaiting confirmation'}{p.expected_date&&` · ${sourceLabel[p.eta_source]||sourceLabel.unknown}`}</p>}
      {Number.isFinite(p.quantity)&&<p className="text-muted">{p.received_quantity||0} of {p.quantity} received by the shop</p>}
      {p.carrier_delivered&&p.status!=='received'&&p.status!=='cancelled'&&<p className="text-muted">Carrier reports delivery; awaiting the shop’s receipt check.</p>}
      {p.customer_note&&<p className="whitespace-pre-wrap break-words text-ink">{p.customer_note}</p>}
    </li>)}</ul>
  </div>
}
