import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../lib/auth', () => ({
  isAdmin: vi.fn(() => true),
  isAssistant: vi.fn(() => false),
  isOwner: vi.fn(() => true),
}))

vi.mock('../../components/AddROModal', () => ({ default: () => null }))

import api from '../../lib/api'
import RepairOrders from '../RepairOrders'

const ROS = [
  {
    id: 'ro-overdue',
    ro_number: 'RO-9001',
    customer_name: 'Miles Customer',
    year: 2024,
    make: 'Honda',
    model: 'Accord',
    status: 'repair',
    estimated_delivery: '2020-01-02',
    amount_owed_cents: 996925,
    payment_status: 'unpaid',
  },
  {
    id: 'ro-paid',
    ro_number: 'RO-9002',
    customer_name: 'Second Customer',
    year: 2025,
    make: 'Toyota',
    model: 'Camry',
    status: 'closed',
    estimated_delivery: '2099-01-02',
    amount_owed_cents: 125050,
    payment_status: 'paid',
    payment_received: 1,
  },
]

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

describe('Repair Orders redesign', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.delete.mockReset()
    api.get.mockImplementation((url) => {
      if (url === '/users') return Promise.resolve({ data: { users: [] } })
      if (url === '/repair-orders') return Promise.resolve({ data: { ros: ROS } })
      return Promise.reject(new Error(`Unhandled GET ${url}`))
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows promise, server-cents total, payment state, and filter chips', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/ros']}>
        <RepairOrders />
        <LocationProbe />
      </MemoryRouter>
    )

    expect((await screen.findAllByText('RO-9001')).length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: 'Promise' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument()
    expect(screen.getAllByText('$9,969.25').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Jan 2 overdue/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/repair-orders', { params: { status: 'open' } }))

    await user.click(screen.getAllByRole('button', { name: /View/i })[0])
    expect(screen.getByTestId('location')).toHaveTextContent('/ros/ro-overdue')
  })
})
