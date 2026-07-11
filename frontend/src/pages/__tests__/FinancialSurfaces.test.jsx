import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}))

vi.mock('../../lib/auth', () => ({
  getTokenPayload: vi.fn(() => ({ shop_id: 'shop-1' })),
}))

vi.mock('../RepairOrders', () => ({
  STATUS_LABELS: {
    intake: 'Intake',
    repair: 'Repair',
    closed: 'Closed',
  },
}))

import api from '../../lib/api'
import Payments from '../Payments'
import Reports from '../Reports'
import MonthlyReport from '../MonthlyReport'
import JobCosting from '../JobCosting'

function renderPage(component) {
  return render(<MemoryRouter>{component}</MemoryRouter>)
}

describe('Phase 6B financial surfaces', () => {
  beforeEach(() => {
    api.get.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows collected payment cents from paid transactions only', async () => {
    api.get.mockResolvedValue({
      data: {
        payments: [
          { id: 'pay-1', ro_number: 'RO-100', customer_name: 'Miles Customer', amount_cents: 125000, status: 'succeeded', payment_method: 'card', created_at: '2026-07-10T12:00:00Z' },
          { id: 'pay-2', ro_number: 'RO-101', customer_name: 'Pending Customer', amount_cents: 25000, status: 'pending', payment_method: 'card', created_at: '2026-07-10T13:00:00Z' },
        ],
      },
    })

    renderPage(<Payments />)

    expect((await screen.findAllByText('$1,250.00')).length).toBeGreaterThan(0)
    expect(screen.queryByText('$1,500.00')).not.toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/payments/history/shop-1')
  })

  it('preserves report endpoints and renders dollar APIs through Money', async () => {
    const user = userEvent.setup()
    api.get.mockImplementation((url) => {
      if (url === '/reports/summary') return Promise.resolve({ data: { total: 4, completed: 2, revenue: 1000, profit: 200, byType: [], byStatus: [], insuranceSummary: null } })
      if (url === '/market/shop') return Promise.resolve({ data: { monthly_revenue_target: 2000 } })
      if (url === '/reports/revenue') return Promise.resolve({ data: { total: 3000, avg: 1500, topMonths: [{ month: 'Jul 26', revenue: 3000 }], monthly: [] } })
      return Promise.reject(new Error(`Unhandled api.get call: ${url}`))
    })

    renderPage(<Reports />)

    expect((await screen.findAllByText('$1,000.00')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Target:/)).toHaveTextContent('$2,000.00')
    await user.click(screen.getByRole('tab', { name: 'Revenue' }))
    expect((await screen.findAllByText('$3,000.00')).length).toBeGreaterThan(0)
    expect(api.get).toHaveBeenCalledWith('/reports/revenue')
  })

  it('keeps monthly report loading, status, notes, and money rendering intact', async () => {
    api.get.mockResolvedValue({
      data: {
        summary: { total_revenue: 2500.5, total_ros: 1, completed_ros: 0, in_progress_ros: 1, avg_ro_value: 2500.5 },
        ros: [{ id: 'ro-1', ro_number: 'RO-200', customer_name: 'Miles Customer', vehicle: '2024 Honda Accord', status: 'repair', total_cost: 2500.5, technician: 'Tech One', created_at: '2026-07-10T12:00:00Z' }],
      },
    })

    renderPage(<MonthlyReport />)

    expect((await screen.findAllByText('$2,500.50')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('In repair').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Report month')).toBeInTheDocument()
    expect(screen.getByLabelText('Owner notes for tax purposes')).toBeInTheDocument()
    expect(api.get.mock.calls[0][0]).toMatch(/^\/reports\/monthly\/\d{4}-\d{2}$/)
  })

  it('preserves job-costing filters and repair-order navigation data', async () => {
    api.get.mockResolvedValue({
      data: {
        totalRevenue: 1000,
        totalCost: 700,
        grossProfit: 300,
        avgMargin: 30,
        profitableCount: 1,
        totalJobs: 1,
        rows: [{ id: 'ro-3', ro_number: 'RO-300', customer_name: 'Miles Customer', year: 2024, make: 'Honda', model: 'Accord', status: 'repair', total: 1000, parts_cost: 400, labor_cost: 200, sublet_cost: 100, true_profit: 300 }],
      },
    })

    renderPage(<JobCosting />)

    expect((await screen.findAllByText('$1,000.00')).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Job costing from date')).toBeInTheDocument()
    expect(screen.getByLabelText('Job costing to date')).toBeInTheDocument()
    await waitFor(() => expect(api.get.mock.calls[0][0]).toMatch(/^\/ros\/job-cost\/summary\?from=.*&to=.*$/))
  })
})
