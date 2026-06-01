import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../../lib/auth', () => ({
  getRole: vi.fn(() => 'technician'),
  getTokenPayload: vi.fn(() => ({ id: 'tech-1', role: 'technician' })),
  isAdmin: vi.fn(() => false),
}))

vi.mock('../../components/ROPhotos', () => ({
  default: ({ roId }) => <div>Photos for {roId}</div>,
}))

import api from '../../lib/api'
import FloorMode from '../FloorMode'

function renderFloorMode() {
  return render(
    <MemoryRouter>
      <FloorMode />
    </MemoryRouter>
  )
}

describe('FloorMode', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.post.mockReset()
    api.get.mockImplementation((url) => {
      if (url === '/ros') {
        return Promise.resolve({
          data: {
            ros: [
              { id: 'ro-1', ro_number: 'RO-1', status: 'repair', customer_name: 'Miles Davis', year: 2022, make: 'Honda', model: 'Civic' },
              { id: 'ro-2', ro_number: 'RO-2', status: 'delivery', customer_name: 'Ready Customer' },
            ],
          },
        })
      }
      if (url === '/timeclock/status') {
        return Promise.resolve({ data: { clocked_in: false, entry: null } })
      }
      return Promise.reject(new Error(`Unhandled api.get call in test: ${url}`))
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads assigned active floor ROs and filters non-floor statuses', async () => {
    renderFloorMode()

    expect(await screen.findByText('RO-1')).toBeInTheDocument()
    expect(screen.getByText('Miles Davis')).toBeInTheDocument()
    expect(screen.queryByText('RO-2')).not.toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/ros', {
      params: { assigned_to: 'tech-1', status: 'open' },
    })
  })

  it('rolls back optimistic status advance when the status API fails', async () => {
    const user = userEvent.setup()
    api.put.mockRejectedValueOnce({ response: { data: { error: 'Nope' } } })
    renderFloorMode()

    await screen.findByText('RO-1')
    await user.click(screen.getByRole('button', { name: /move to paint/i }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/ros/ro-1/status', { status: 'paint' })
    })
    expect(await screen.findByText('Nope')).toBeInTheDocument()
    expect(screen.getByText('RO-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /move to paint/i })).toBeInTheDocument()
  })
})
