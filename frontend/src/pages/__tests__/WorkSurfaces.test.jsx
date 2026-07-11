import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../lib/auth', () => ({
  getRole: vi.fn(),
  getTokenPayload: vi.fn(),
  isAdmin: vi.fn(),
}))

import api from '../../lib/api'
import { getRole, getTokenPayload, isAdmin } from '../../lib/auth'
import Settings from '../Settings'
import TimeClock from '../TimeClock'
import TechView from '../TechView'
import NotificationBell from '../../components/NotificationBell'

function renderPage(component) {
  return render(<MemoryRouter>{component}</MemoryRouter>)
}

describe('Phase 6C authenticated work surfaces', () => {
  beforeEach(() => {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) api[method].mockReset()
    getRole.mockReturnValue('owner')
    getTokenPayload.mockReturnValue({ id: 'owner-1', role: 'owner', shop_id: 'shop-1' })
    isAdmin.mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads all settings dependencies and preserves the section tabs', async () => {
    const user = userEvent.setup()
    api.get.mockImplementation((url) => {
      if (url === '/market/shop') return Promise.resolve({ data: { id: 'shop-1', name: 'Miles Automotive', state: 'NY', labor_rate: 75, parts_markup: 0.3, tax_rate: 0.08875 } })
      if (url === '/market/rates') return Promise.resolve({ data: { states: [] } })
      if (url.startsWith('/market/rates?state=')) return Promise.resolve({ data: { stateName: 'New York', tier: 1, tierLabel: 'Major Metro', laborRate: 75, partsMarkup: 0.3, taxRate: 0.08875 } })
      if (url === '/sms/status') return Promise.resolve({ data: { configured: true, sms_phone: '+18668259523' } })
      if (url === '/settings') return Promise.resolve({ data: { sms_notifications_enabled: true, email_notifications_enabled: true } })
      if (url === '/owner-activity/preferences') return Promise.resolve({ data: {} })
      if (url === '/users/me') return Promise.resolve({ data: { name: 'Miles Owner', phone: '2125550100' } })
      if (url === '/subscriptions/status') return Promise.resolve({ data: { plan: 'pro' } })
      if (url === '/accounting/quickbooks/status') return Promise.resolve({ data: { configured: false, connected: false } })
      if (url.startsWith('/goals/')) return Promise.resolve({ data: { goal: { revenue_goal: 85000, ro_goal: 20 } } })
      return Promise.reject(new Error(`Unhandled api.get call: ${url}`))
    })

    renderPage(<Settings />)

    expect(await screen.findByRole('heading', { name: 'Shop settings' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Miles Automotive')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Messaging' }))
    expect(screen.getByText('SMS Status Notifications')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Financial' }))
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/market/shop')
    expect(api.get).toHaveBeenCalledWith('/owner-activity/preferences')
  })

  it('keeps the four timeclock startup endpoints and empty state', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/timeclock/status') return Promise.resolve({ data: { clocked_in: false, entry: null } })
      if (url === '/timeclock/entries') return Promise.resolve({ data: { entries: [] } })
      if (url === '/schedule/today') return Promise.resolve({ data: { shift: null } })
      if (url === '/timeclock/lunch/status') return Promise.resolve({ data: { on_lunch: false, lunch: null } })
      return Promise.reject(new Error(`Unhandled api.get call: ${url}`))
    })

    renderPage(<TimeClock />)

    expect(await screen.findByRole('heading', { name: 'Time clock' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clock In' })).toBeInTheDocument()
    expect(screen.getByText('No time entries')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/timeclock/status')
    expect(api.get).toHaveBeenCalledWith('/timeclock/entries')
    expect(api.get).toHaveBeenCalledWith('/schedule/today')
    expect(api.get).toHaveBeenCalledWith('/timeclock/lunch/status')
  })

  it('preserves technician note saves and status advancement', async () => {
    const user = userEvent.setup()
    getRole.mockReturnValue('technician')
    getTokenPayload.mockReturnValue({ id: 'tech-1', role: 'technician', shop_id: 'shop-1' })
    isAdmin.mockReturnValue(false)
    api.get.mockResolvedValue({ data: { ros: [{ id: 'ro-1', ro_number: 'RO-1', assigned_to: 'tech-1', status: 'repair', customer_name: 'Miles Customer', tech_notes: '' }] } })
    api.patch.mockResolvedValue({ data: { ok: true } })
    api.put.mockResolvedValue({ data: { ok: true } })

    renderPage(<TechView />)

    const notes = await screen.findByLabelText('Tech notes')
    await user.type(notes, 'Ready for paint')
    await user.click(screen.getByRole('button', { name: 'Save notes' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/ros/ro-1', { tech_notes: 'Ready for paint' }))

    await user.click(screen.getByRole('button', { name: /move to paint/i }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/ros/ro-1/status', { status: 'paint' }))
  })

  it('keeps notification loading, navigation action, and read mutation intact', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({ data: { notifications: [{ id: 'note-1', type: 'status_change', title: 'Status updated', ro_id: 'ro-9', ro_number: '900', created_at: new Date().toISOString() }] } })
    api.patch.mockResolvedValue({ data: { ok: true } })

    renderPage(<NotificationBell />)

    await user.click(screen.getByRole('button', { name: 'Open notifications' }))
    await user.click(await screen.findByText('Status updated'))
    expect(api.patch).toHaveBeenCalledWith('/notifications/note-1/read')
  })
})
