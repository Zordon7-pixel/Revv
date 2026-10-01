import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import CustomerPanelQuote from '../CustomerPanelQuote'
afterEach(cleanup)
it('renders a read-only allowlisted quote, unknown allocations and distinct payments', () => {
  const { container } = render(<CustomerPanelQuote quote={{ vehicle: '2020 Test Sedan', revision_id: 'r1', scope: ['Hood repair'], customer_notes: 'Keep original finish', payer: 'insurance', provenance: 'imported_carrier', totals: { net_cents: 40000, tax_cents: 4000, total_cents: 44000 }, lines: [{ id: 'a', description: 'Reviewed repair', quantity: 2, unit_price_cents: 20000, net_cents: 40000, tax_cents: 4000 }], allocation: { customer_cents: null, carrier_cents: null, paid_cents: 3000 }, private_notes: 'SECRET', costs: { margin_bps: 4500 }, scenarios: [{ payer: 'cash', revision_id: 'r2', scope: 'Hood blend', totals: { total_cents: 30000 }, differences: ['Operation: repair → blend', 'Body rate: $100 → $90'] }] }} />)
  expect(screen.getByText('Keep original finish')).toBeInTheDocument()
  expect(screen.getByText('Estimated customer responsibility: Unknown')).toBeInTheDocument()
  expect(screen.getByText('Posted payments: $30.00')).toBeInTheDocument()
  expect(screen.getByText(/Imported carrier estimate — approval status not implied/)).toBeInTheDocument()
  expect(screen.getByText('Body rate: $100 → $90')).toBeInTheDocument()
  expect(container).not.toHaveTextContent('SECRET')
  expect(container).not.toHaveTextContent('4500')
  expect(container.querySelector('input,button,textarea')).toBeNull()
  expect(container.querySelector('.sm\\:grid-cols-2')).toBeTruthy()
})
it('never substitutes zero for missing money or claims scenario equivalence', () => {
  render(<CustomerPanelQuote quote={{ lines: [], totals: {}, scenarios: [{ payer: 'insurance' }] }} />)
  expect(screen.getByText(/Scope\/rate differences not supplied/)).toBeInTheDocument()
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
})
