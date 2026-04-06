import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

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
    }, { timeout: 2500 })
  })
})
