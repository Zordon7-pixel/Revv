function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(number(value))
}

function laborValue(totals, prefix) {
  const hours = number(totals?.[`${prefix}_labor_hours`])
  const rate = number(totals?.[`${prefix}_labor_rate`])
  const cost = number(totals?.[`${prefix}_labor_cost`])
  return hours > 0 || rate > 0
    ? `${hours.toFixed(1)}h x ${money(rate)} = ${money(cost)}`
    : money(cost)
}

function totalTax(totals) {
  const canonical = ['sales_tax_cost', 'county_tax_cost', 'other_tax_1_cost']
    .reduce((sum, key) => sum + number(totals?.[key]), 0)
  if (canonical) return canonical
  return number(totals?.tax_total ?? totals?.tax_amount ?? totals?.tax)
}

export default function EstimateFinancialReview({ totals, title = 'Extracted Estimate Financials' }) {
  if (!totals || typeof totals !== 'object') return null

  const otherCosts = number(totals.miscellaneous) + number(totals.other_charges)
  const gross = number(totals.total_cost_of_repairs ?? totals.gross_total ?? totals.estimate_gross_total)
  const deductible = Math.abs(number(totals.deductible))
  const net = number(totals.net_cost_of_repairs ?? totals.net_estimate_total ?? totals.revenue)
  const rows = [
    ['Parts', money(totals.parts ?? totals.parts_total)],
    ['Body labor', laborValue(totals, 'body')],
    ['Paint / refinish labor', laborValue(totals, 'paint')],
    ['Mechanical labor', laborValue(totals, 'mechanical')],
    ['Frame labor', laborValue(totals, 'frame')],
    ['Glass labor', laborValue(totals, 'glass')],
    ['Paint materials / supplies', money(totals.paint_supplies_cost)],
    ['Sublet', money(totals.sublet ?? totals.sublet_cost)],
    ['Miscellaneous / other charges', money(otherCosts)],
    ['Pre-tax subtotal', money(totals.subtotal)],
    ['Tax', money(totalTax(totals))],
    ['Gross estimate', money(gross)],
    ['Deductible', money(deductible)],
    ['Net estimate', money(net || Math.max(0, gross - deductible))],
  ]

  return (
    <section className="rounded-xl border border-[#2a2d3e] bg-[#111423] p-4" aria-label={title}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 text-xs text-slate-400">
            Line selection controls detailed estimate rows; this complete insurer financial snapshot stays intact. REVV calculates profit after the shop's actual costs are recorded.
          </p>
        </div>
        <span className="mt-2 shrink-0 rounded-lg border border-[#EAB308]/40 bg-[#EAB308]/10 px-3 py-2 text-sm font-semibold text-[#EAB308] sm:mt-0">
          Net {money(net || Math.max(0, gross - deductible))}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 border-b border-[#2a2d3e]/70 py-1.5 text-xs">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-right font-medium text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
