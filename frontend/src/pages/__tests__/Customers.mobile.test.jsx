import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../lib/auth', () => ({
  isAdmin: vi.fn(() => true),
  isAssistant: vi.fn(() => false),
}))

import api from '../../lib/api'
import Customers from '../Customers'
import { formatTurnaroundRange } from '../../components/TurnaroundEstimator'

describe('Customers mobile form flow', () => {
  let customers

  beforeEach(() => {
    customers = []
    api.get.mockReset()
    api.post.mockReset()
    api.put.mockReset()
    api.delete.mockReset()

    api.get.mockImplementation((url) => {
      if (url === '/customers') {
        return Promise.resolve({ data: { customers } })
      }
      return Promise.reject(new Error(`Unhandled api.get call in test: ${url}`))
    })

    api.post.mockImplementation(async (url, payload) => {
      expect(url).toBe('/customers')
      const created = { id: `cust-${customers.length + 1}`, ...payload }
      customers = [created, ...customers]
      return { data: created }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('submits the new customer form and refreshes the list', async () => {
    const user = userEvent.setup()
    render(<Customers />)

    await screen.findByText('Your customer book is waiting.')

    await user.click(screen.getByRole('button', { name: /\+ add customer/i }))
    await user.type(screen.getByPlaceholderText('John Doe'), ' Jane Doe ')
    await user.type(screen.getByPlaceholderText('(212) 555-0100'), '2125550100')
    await user.click(screen.getByRole('button', { name: /save customer/i }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/customers', expect.objectContaining({
        name: 'Jane Doe',
        phone: '2125550100',
      }))
    })

    await waitFor(() => {
      expect(screen.queryByText('New Customer')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  })

  it('shows inline validation when the customer name is empty', async () => {
    const user = userEvent.setup()
    render(<Customers />)

    await screen.findByText('Your customer book is waiting.')

    await user.click(screen.getByRole('button', { name: /\+ add customer/i }))
    await user.click(screen.getByRole('button', { name: /save customer/i }))

    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('shows failed deletes inline instead of using a browser alert', async () => {
    const user = userEvent.setup()
    customers = [{ id: 'cust-1', name: 'Miles Automotive', phone: '2125550100' }]
    api.delete.mockRejectedValue({ response: { data: { error: 'Failed to delete customer. Please try again.' } } })
    window.confirm = vi.fn(() => true)
    window.alert = vi.fn()

    render(<Customers />)

    expect(await screen.findByText('Miles Automotive')).toBeInTheDocument()
    await user.click(screen.getByTitle('Delete customer'))

    expect(window.confirm).toHaveBeenCalledWith('Delete customer "Miles Automotive"? This action cannot be undone.')
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete customer. Please try again.')
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('shows shop-scoped vehicle and repair-order counts on each customer card', async () => {
    customers = [{
      id: 'cust-1',
      name: 'Miles Automotive',
      vehicle_count: 2,
      ro_count: 5,
      active_ro_count: 1,
    }]

    render(<Customers />)

    const card = await screen.findByRole('button', { name: 'Open Miles Automotive' })
    expect(within(card).getByText('2')).toBeInTheDocument()
    expect(within(card).getByText('5')).toBeInTheDocument()
    expect(within(card).getByText('1')).toBeInTheDocument()
    expect(within(card).getByText('Vehicles')).toBeInTheDocument()
    expect(within(card).getByText('ROs')).toBeInTheDocument()
    expect(within(card).getByText('Active')).toBeInTheDocument()
  })

  it('shows a load failure instead of pretending the customer book is empty', async () => {
    api.get.mockRejectedValueOnce({ response: { data: { error: 'column c.updated_at does not exist' } } })

    render(<Customers />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Customers could not be loaded. Refresh and try again.')
    expect(screen.queryByText('Your customer book is waiting.')).not.toBeInTheDocument()
    expect(screen.queryByText(/column c\.updated_at/i)).not.toBeInTheDocument()
  })
})

describe('Phase 6 turnaround guard', () => {
  it('never renders undefined day ranges from incomplete estimates', () => {
    expect(formatTurnaroundRange({})).toBe('Timing range unavailable')
    expect(formatTurnaroundRange({ minDays: 4 })).toBe('~4 business days')
    expect(formatTurnaroundRange({ minDays: 3, maxDays: 5 })).toBe('3–5 business days')
  })
})
