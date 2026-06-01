import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}))

vi.mock('../RepairOrders', () => ({
  STATUS_LABELS: {
    intake: 'Intake',
  },
}))

import api from '../../lib/api'
import OwnerKpis from '../OwnerKpis'

function renderOwnerKpis() {
  return render(
    <MemoryRouter>
      <OwnerKpis />
    </MemoryRouter>
  )
}

describe('OwnerKpis', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockImplementation((url) => {
      if (url === '/dashboard/owner-kpis') {
        return Promise.resolve({
          data: {
            cycle_time_by_stage: [],
            supplement_capture: {
              requested_cents: 10000,
              captured_cents: 2500,
              capture_rate: 25.5,
            },
            tech_efficiency: [],
          },
        })
      }

      if (url === '/dashboard/supplements/monthly-opportunity') {
        return Promise.resolve({
          data: {
            total_supplement_opportunity: 900,
            ro_count: 3,
          },
        })
      }

      if (url === '/ros/job-cost/summary') {
        return Promise.resolve({
          data: {
            avgMargin: 0,
            grossProfit: 0,
            rows: [],
          },
        })
      }

      if (url === '/ros/carryover-pending') {
        return Promise.resolve({ data: { ros: [] } })
      }

      if (url === '/ros/turnaround-estimate') {
        return Promise.resolve({ data: null })
      }

      return Promise.reject(new Error(`Unhandled api.get call in test: ${url}`))
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the backend supplement capture rate instead of recomputing it', async () => {
    renderOwnerKpis()

    expect(await screen.findByTestId('supplement-capture-rate-value')).toHaveTextContent('25.5%')
  })
})
