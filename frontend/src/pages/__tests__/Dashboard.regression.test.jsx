import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
}))

vi.mock('../../lib/auth', () => ({
  getRole: vi.fn(() => 'owner'),
  getTokenPayload: vi.fn(() => ({ id: 'owner-1', role: 'owner' })),
  isAdmin: vi.fn(() => true),
}))

import api from '../../lib/api'
import CommandPalette from '../../components/CommandPalette'
import Dashboard from '../Dashboard'

function shiftMonthLabel(label, offset) {
  const parsed = new Date(`${label} 1`)
  const shifted = new Date(parsed.getFullYear(), parsed.getMonth() + offset, 1)
  return shifted.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function stubDashboardApi({ ros = [], summaryOverrides = {} } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/reports/summary?scope=all') {
      return Promise.resolve({
        data: {
          active: 999,
          completed: 999,
          byStatus: [
            { status: 'intake', count: 1 },
            { status: 'estimate', count: 1 },
          ],
          ...summaryOverrides,
        },
      })
    }

    if (url === '/reports/summary') {
      return Promise.resolve({
        data: {
          total: 0,
          revenue: 0,
          profit: 0,
        },
      })
    }

    if (url === '/ros/carryover-pending') {
      return Promise.resolve({ data: { ros: [] } })
    }

    if (url === '/appointments') {
      return Promise.resolve({ data: { requests: [] } })
    }

    if (url.startsWith('/goals/')) {
      return Promise.resolve({ data: { goal: null } })
    }

    if (url === '/adas/queue') {
      return Promise.resolve({ data: { queue: [] } })
    }

    if (url === '/dashboard/weekly') {
      return Promise.resolve({ data: null })
    }

    if (url === '/dashboard/instruments') {
      return Promise.resolve({
        data: {
          revenue_mtd_cents: 12345,
          revenue_goal_cents: 100000,
          true_profit_cents: 4567,
          profit_margin_percent: 37,
          supplement_opportunity_cents: 8888,
          supplement_ro_count: 1,
          ro_count: 4,
        },
      })
    }

    if (url === '/repair-orders') {
      return Promise.resolve({ data: { ros } })
    }

    return Promise.reject(new Error(`Unhandled api.get call in test: ${url}`))
  })
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location-probe">{location.pathname}{location.search}</output>
}

describe('Dashboard regression coverage', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.patch.mockReset()
    api.put.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('updates RO calendar month label when navigating months', async () => {
    stubDashboardApi({
      ros: [
        {
          id: 'ro-1',
          ro_number: 'RO-1',
          status: 'intake',
          estimated_delivery: '2026-04-05',
        },
      ],
    })

    const user = userEvent.setup()
    renderDashboard()

    const monthLabel = await screen.findByTestId('ro-calendar-month-label')
    const initial = monthLabel.textContent
    const next = shiftMonthLabel(initial, 1)

    await user.click(screen.getByTestId('ro-calendar-next-month'))
    await waitFor(() => {
      expect(screen.getByTestId('ro-calendar-month-label')).toHaveTextContent(next)
    })

    await user.click(screen.getByTestId('ro-calendar-prev-month'))
    await waitFor(() => {
      expect(screen.getByTestId('ro-calendar-month-label')).toHaveTextContent(initial)
    })
  })

  it('derives Active/Completed from repair-orders list when present', async () => {
    stubDashboardApi({
      ros: [
        { id: 'ro-1', ro_number: 'RO-1', status: 'intake' },
        { id: 'ro-2', ro_number: 'RO-2', status: 'repair' },
        { id: 'ro-3', ro_number: 'RO-3', status: 'completed' },
        { id: 'ro-4', ro_number: 'RO-4', status: 'closed' },
      ],
      summaryOverrides: {
        active: 100,
        completed: 200,
      },
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByTestId('stat-value-active-jobs')).toHaveTextContent('2')
      expect(screen.getByTestId('stat-value-completed')).toHaveTextContent('2')
      expect(screen.getByTestId('stat-value-total-revenue')).toHaveTextContent('$123.45')
      expect(screen.getByTestId('stat-value-true-profit')).toHaveTextContent('$45.67')
      expect(screen.getByTestId('stat-value-supplement-opportunity')).toHaveTextContent('$88.88')
      expect(screen.getByTestId('production-line')).toBeInTheDocument()
    }, { timeout: 2500 })
  })

  it('opens an own-shop command result and jumps to its repair order', async () => {
    api.get.mockImplementation((url, config) => {
      if (url === '/search' && config?.params?.q === 'RO-9001') {
        return Promise.resolve({
          data: {
            results: [{
              id: 'ro-search-1',
              ro_number: 'RO-9001',
              status: 'repair',
              customer_name: 'Miles Customer',
              year: 2024,
              make: 'Honda',
              model: 'Accord',
              plate: 'MILES1',
            }],
          },
        })
      }
      return Promise.reject(new Error(`Unhandled api.get call in command test: ${url}`))
    })

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <CommandPalette open onOpenChange={vi.fn()} />
        <LocationProbe />
      </MemoryRouter>
    )

    await user.type(screen.getByRole('textbox', { name: 'Search repair orders' }), 'RO-9001')
    await user.click(await screen.findByRole('option', { name: /RO-9001/i }))

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/ros/ro-search-1')
    expect(api.get).toHaveBeenCalledWith('/search', { params: { q: 'RO-9001' } })
  })
})
