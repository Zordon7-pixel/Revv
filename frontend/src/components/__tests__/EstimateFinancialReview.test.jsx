import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import EstimateFinancialReview from '../EstimateFinancialReview'

describe('EstimateFinancialReview', () => {
  it('shows all collision-estimate revenue buckets and gross/net totals', () => {
    render(<EstimateFinancialReview totals={{
      parts: 5038.72,
      body_labor_hours: 24.6,
      body_labor_rate: 60,
      body_labor_cost: 1476,
      paint_labor_hours: 17.9,
      paint_labor_rate: 60,
      paint_labor_cost: 1074,
      mechanical_labor_cost: 90,
      frame_labor_cost: 120,
      glass_labor_cost: 30,
      paint_supplies_cost: 1322.88,
      other_charges: 5,
      sales_tax_cost: 812.65,
      total_cost_of_repairs: 9969.25,
      deductible: 1000,
      net_cost_of_repairs: 8969.25,
    }} />)

    for (const label of [
      'Parts', 'Body labor', 'Paint / refinish labor', 'Mechanical labor', 'Frame labor',
      'Glass labor', 'Paint materials / supplies', 'Sublet', 'Miscellaneous / other charges', 'Pre-tax subtotal', 'Tax',
      'Gross estimate', 'Deductible', 'Net estimate',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText('$9,969.25').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$8,969.25').length).toBeGreaterThan(0)
    expect(screen.getByText(/financial snapshot stays intact.*calculates profit after the shop's actual costs/i)).toBeInTheDocument()
  })
})
