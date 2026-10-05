import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import CustomerPanelQuote from '../CustomerPanelQuote'
const require = createRequire(import.meta.url)
const n = require('../../../../backend/src/services/panelEstimatorStore.js')
const { assembleDraft, hashInputs } = require('../../../../backend/src/services/panelEstimatorDraft.js')
const { differences } = require('../../../../backend/src/services/panelEstimatorRevisions.js')
const { historicalQuote } = require('../../../../backend/src/services/panelEstimatorQuotePdf.js')
afterEach(cleanup)
const panel = { panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light', operation: 'repair', refinish: true, body_hours: 2, refinish_hours: 1, body_rate_cents: 10000, refinish_rate_cents: 10000, parts_sell_cents: 10000, materials_sell_cents: 5000, sublet_sell_cents: 0, taxable: { body: true, refinish: true, parts: true, materials: true, sublet: true }, reviewed: true }
function quote(overrides = {}, options = {}) {
  const draft = n.publicSnapshot({ assessments: [{ ...panel, ...overrides }], scenario: options.scenario, adjustments: options.adjustments })
  const value = { ...assembleDraft({ draft, costs: n.privateSnapshot({}), taxRateBps: 1000, paidCents: options.paidCents ?? 0 }).sell, revision_id: options.revision || 'r1', reviewed: true, reviewed_at: '2026-10-01T12:00:00Z', comparisons: [] }
  return { ...value, quote_hash: hashInputs(value) }
}
it('renders the real projection scope, separate expected allocations/payments, and no fabricated vehicle identity', () => {
  const value = quote({}, { scenario: { payer: 'insurance', provenance: 'imported_carrier', allocation: { covered_cents: null, deductible_cents: null, uncovered_cents: null, adjustment_cents: null } }, paidCents: 2500 })
  render(<CustomerPanelQuote quote={value} vehicle="2020 Synthetic Sedan" />)
  expect(screen.getByLabelText('Repair scope')).toHaveTextContent('Hood · Repair · Refinish included in scope')
  expect(screen.getByText(/Imported carrier estimate/)).toHaveTextContent('approval status not implied')
  expect(screen.getByText('Estimated customer responsibility: Unknown')).toBeInTheDocument()
  expect(screen.getByText('Posted payments: $25.00')).toBeInTheDocument()
  expect(screen.getByText('Remaining repair balance: $470.00')).toBeInTheDocument()
  expect(screen.getByText(/Vehicle supplied by the repair-order screen/)).toBeInTheDocument()
  expect(screen.getByText(/Only this selected revision drives billing/)).toBeInTheDocument()
})
it('renders actual historical projections and per-field panel, operation, rate and discount differences', () => {
  const old = quote({}, { revision: 'r0', adjustments: { discount_cents: 5000 } })
  const current = quote({ operation: 'replace', body_rate_cents: 12000 }, { scenario: { payer: 'insurance', provenance: 'shop_prepared' }, adjustments: { discount_cents: 1000 } })
  const fields = q => ({ scope: q.scope, scenario: q.scenario, adjustments: q.adjustments, totals: q.totals, allocation: q.allocation })
  current.comparisons = [{ ...historicalQuote({ id: 'r0', version: 1, quote_hash: old.quote_hash, public_snapshot: old }), differences: differences(fields(old), fields(current)) }]
  render(<CustomerPanelQuote quote={current} />)
  const history = within(screen.getByRole('region', { name: 'Historical revision 1' }))
  expect(history.getByText('Customer Pay · Historical · Revision 1')).toBeInTheDocument()
  expect(history.getByText(/Body labor rate: \$100.00 → \$120.00/)).toBeInTheDocument()
  expect(history.getByText(/Operation: Repair → Replacement/)).toBeInTheDocument()
  expect(history.getByText('Price adjustments / Discount: $50.00 → $10.00')).toBeInTheDocument()
  expect(screen.getByText('Insurance · Current selected revision')).toBeInTheDocument()
  expect(screen.getByText(/not insurer-approved/)).toBeInTheDocument()
})
it('shows one package price, included operations once, scoped/global discounts and minimum adjustment without duplicate charges', () => {
  const value = quote({ package: { name: 'Hood finish package', price_cents: 40000, included_operations: ['body', 'refinish', 'materials'], taxable: true } }, { adjustments: { discount_cents: 1234, discounts: [{ id: 'pkg-sale', amount_cents: 2345, package_ids: ['hood:package'], line_ids: [] }], minimum_cents: 60000 } })
  render(<CustomerPanelQuote quote={value} />)
  expect(screen.getByText('One package price before discounts: $400.00')).toBeInTheDocument()
  expect(screen.getAllByText(/Included in package/)).toHaveLength(3)
  expect(screen.getByText('Global discount: $12.34 — already allocated')).toBeInTheDocument()
  expect(screen.getByText('Scoped discount 1: $23.45 — already allocated')).toBeInTheDocument()
  expect(screen.getByText('Estimate minimum adjustment')).toBeInTheDocument()
  expect(screen.getByLabelText('Quote totals')).toHaveTextContent('$600.00')
  expect(screen.getByLabelText('Quote totals')).toHaveTextContent('$660.00')
})
it('preserves mixed-tax package allocation labels within the single package price', () => {
  render(<CustomerPanelQuote quote={quote({ taxable: { ...panel.taxable, materials: false }, package: { name: 'Mixed package', price_cents: 40000, included_operations: ['body', 'materials'], taxable: null, sell_allocation_cents: { body: 30000, materials: 10000 } } })} />)
  expect(screen.getAllByText('One package price before discounts: $400.00')).toHaveLength(1)
  expect(screen.getByText('Body labor allocation within package')).toBeInTheDocument()
  expect(screen.getByText('Paint and materials allocation within package')).toBeInTheDocument()
})
it('renders retained cosmetic acknowledgement as a reference, not digital approval', () => {
  render(<CustomerPanelQuote quote={quote({ operation: 'paint-only', body_hours: 0, parts_sell_cents: 0, sublet_sell_cents: 0, optional_cosmetic: true, deferral: { reason: 'Finish later', estimator_acknowledged: true, customer_acknowledged: true, customer_acknowledgement_reference: 'RO discussion October 1' } })} />)
  expect(screen.getByText('Reference: RO discussion October 1')).toBeInTheDocument()
  expect(screen.getByText(/not digital approval or an agreement signature/)).toBeInTheDocument()
  expect(screen.getByText(/excluded from this repair total/)).toBeInTheDocument()
})
it('allowlists malicious cost props and never renders old comparison objects or raw private paths', () => {
  const sentinel = 'PRIVATE_COST_SENTINEL', value = quote()
  value.costs = { private_notes: sentinel }; value.private_notes = sentinel; value.lines[0].cost_unit_cents = sentinel
  value.scope.assessments[0].private_notes = sentinel
  value.comparisons = [{ revision_id: 'old', scenario: { payer: 'cash' }, costs: sentinel, scope: value.scope, differences: [
    { path: 'scope.assessments', before: [{ costs: sentinel }], after: { private_notes: sentinel } },
    { path: 'scope.assessments["hood"].private_notes', label: sentinel, before: sentinel, after: sentinel },
    { path: 'costs', label: sentinel, before: sentinel, after: sentinel },
  ] }]
  const { container } = render(<CustomerPanelQuote quote={value} costs={{ secret: sentinel }} />)
  expect(container.textContent).not.toContain(sentinel); expect(container.textContent).not.toContain('[object Object]')
  expect(container.querySelectorAll('input,button,textarea,select')).toHaveLength(0)
  expect(screen.getByText(/Some historical details are unavailable/)).toBeInTheDocument()
})

it('shows known posted payments independently of complete insurance contribution and liability', () => {
  render(<CustomerPanelQuote quote={quote({}, { scenario: { payer: 'insurance', provenance: 'shop_prepared', allocation: { covered_cents: 49500, deductible_cents: 10000, uncovered_cents: 0, adjustment_cents: 0 } }, paidCents: 2500 })} />)
  expect(screen.getByText('Estimated carrier contribution: $395.00')).toBeInTheDocument()
  expect(screen.getByText('Estimated customer responsibility: $100.00')).toBeInTheDocument()
  expect(screen.getByText('Posted payments: $25.00')).toBeInTheDocument()
  expect(screen.getByText('Remaining repair balance: $470.00')).toBeInTheDocument()
})

it('renders real decimal-string quantities and unique panel/category/operation labels', () => {
  const value = quote()
  expect(value.lines.find(line => line.category === 'body').quantity).toBe('2.00')
  expect(value.lines.find(line => line.category === 'refinish').quantity).toBe('1.00')
  render(<CustomerPanelQuote quote={value} />)
  const charges = within(screen.getByLabelText('Reviewed estimate charges'))
  expect(charges.getByText('2.00 × $100.00')).toBeInTheDocument()
  expect(charges.getAllByText('1.00 × $100.00')).toHaveLength(2)
  expect(charges.getByText('Hood · Body labor · Repair')).toBeInTheDocument()
  expect(charges.getByText('Hood · Refinish labor')).toBeInTheDocument()
  expect(charges.getByText('Hood · Parts')).toBeInTheDocument()
})
it.each([2, 1.25, 0, '0.00', '1000000.00'])('displays valid quantity %s without changing totals', quantity => {
  const value = quote(); value.lines = [{ ...value.lines[0], quantity }]
  render(<CustomerPanelQuote quote={value} />)
  expect(screen.getByText(`${quantity} × $100.00`)).toBeInTheDocument()
  expect(screen.getByLabelText('Quote totals')).toHaveTextContent('$495.00')
})
it.each([null, undefined, '', ' ', ' 2.00 ', '1e2', '0x10', '02', '1.001', '-1', 'Infinity', '<script>alert(1)</script>', true, {}, [], NaN, Infinity, -1, -0, 1000001, '9007199254740993'])('keeps malformed or missing quantity %s unknown', quantity => {
  const value = quote(); value.lines = [{ ...value.lines[0], quantity }]
  const { container } = render(<CustomerPanelQuote quote={value} />)
  expect(screen.getByText('Unknown × $100.00')).toBeInTheDocument()
  expect(container.querySelector('script')).toBeNull()
})
it('retains distinct descriptions and explicit shared operation indication', () => {
  const value = quote(); value.lines = [{ ...value.lines[0], description: 'Frame measurement', shared_key: 'whole-car', operation_id: 'extra:measure' }]
  render(<CustomerPanelQuote quote={value} />)
  expect(screen.getByText('Hood · Frame measurement · Body labor · Measure')).toBeInTheDocument()
  expect(screen.getByText('2.00 × $100.00 · Shared operation')).toBeInTheDocument()
})
it('uses immutable versions for current and historical labels with honest missing-identity wording', () => {
  const value = quote({}, { revision: '3f1b86db-c1bb-4346-af86-213584792157' })
  value.comparisons = [{ revision_id: 'c4d9c306-f362-458b-a5cb-6a5167d59171', version: 3 }]
  const { container, rerender } = render(<CustomerPanelQuote quote={value} version={7} />)
  expect(screen.getByText('Vehicle details not provided · Revision 7')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Historical revision 3' })).toBeInTheDocument()
  expect(container.textContent).not.toContain(value.revision_id)
  expect(container.innerHTML).not.toContain(value.comparisons[0].revision_id)
  for (const version of [undefined, null, 0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1]) {
    rerender(<CustomerPanelQuote quote={value} version={version} />)
    expect(screen.getByText('Vehicle details not provided · Reviewed revision')).toBeInTheDocument()
  }
})
