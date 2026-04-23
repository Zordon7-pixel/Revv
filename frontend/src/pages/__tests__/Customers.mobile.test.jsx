import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
})
