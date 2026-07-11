import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

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
  getRole: vi.fn(() => 'owner'),
  getTokenPayload: vi.fn(() => ({ id: 'owner-1', role: 'owner', shop_id: 'shop-1' })),
  isAdmin: vi.fn(() => true),
  isAssistant: vi.fn(() => false),
  isEmployee: vi.fn(() => false),
}))

vi.mock('../../lib/imageUpload', () => ({
  optimizeImageForUpload: vi.fn((file) => Promise.resolve(file)),
}))

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key }),
}))

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}))

vi.mock('../../components/FeedbackButton', () => ({ default: () => null }))
vi.mock('../../components/HelpPanel', () => ({ default: () => null }))
vi.mock('../../components/NotificationBell', () => ({ default: () => null }))
vi.mock('../../components/LanguageToggle', () => ({ default: () => null }))
vi.mock('../../components/AppOverlay', () => ({ default: () => null }))
vi.mock('../../components/CommandPalette', () => ({ default: () => null }))

import api from '../../lib/api'
import Layout from '../../components/Layout'
import Settings from '../Settings'

const shop = {
  id: 'shop-1',
  name: 'Miles Automotive',
  phone: '555-0100',
  logo_url: '',
  address: '100 Main St',
  city: 'Queens',
  state: 'NY',
  zip: '10001',
  labor_rate: 75,
  parts_markup: 0.3,
  tax_rate: 0.08875,
  monthly_revenue_target: 85000,
}

function stubSettingsApi() {
  api.get.mockImplementation((url) => {
    if (url === '/market/shop') return Promise.resolve({ data: shop })
    if (url === '/market/rates') return Promise.resolve({ data: { states: [] } })
    if (url === '/settings') return Promise.resolve({ data: {} })
    if (url === '/owner-activity/preferences') return Promise.resolve({ data: {} })
    if (url === '/users/me') return Promise.resolve({ data: { name: 'Miles Owner', phone: '' } })
    if (url === '/subscriptions/status') return Promise.resolve({ data: null })
    if (url === '/sms/status') return Promise.resolve({ data: { configured: false } })
    if (url === '/accounting/quickbooks/status') return Promise.resolve({ data: {} })
    if (url.startsWith('/goals/')) return Promise.resolve({ data: {} })
    if (url.startsWith('/market/rates?')) return Promise.resolve({ data: {} })
    return Promise.resolve({ data: {} })
  })
  api.post.mockImplementation((url) => {
    if (url === '/market/shop/logo') {
      return Promise.resolve({ data: { logo_url: '/uploads/shop-logos/miles.jpg' } })
    }
    return Promise.resolve({ data: {} })
  })
  api.delete.mockResolvedValue({ data: { logo_url: null } })
  api.put.mockResolvedValue({ data: shop })
  api.patch.mockResolvedValue({ data: {} })
}

describe('Phase 4 shop branding', () => {
  beforeEach(() => {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) api[method].mockReset()
    stubSettingsApi()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('uploads and removes the shop logo through the scoped media endpoints', async () => {
    const { container } = render(<Settings />)
    await screen.findByDisplayValue('Miles Automotive')

    const fileInput = container.querySelector('input[type="file"][accept="image/png,image/jpeg"]')
    const logo = new File(['logo'], 'miles.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [logo] } })

    expect(await screen.findByText('Shop logo updated.')).toBeInTheDocument()
    const uploadCall = api.post.mock.calls.find(([url]) => url === '/market/shop/logo')
    expect(uploadCall).toBeTruthy()
    expect(uploadCall[1]).toBeInstanceOf(FormData)
    expect(uploadCall[1].get('logo')).toBe(logo)
    expect(screen.getByAltText('Shop logo preview')).toHaveAttribute('src', expect.stringContaining('/uploads/shop-logos/miles.jpg'))

    await userEvent.click(screen.getByRole('button', { name: 'Remove Logo' }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/shop/logo'))
    expect(screen.getByText('Shop logo removed.')).toBeInTheDocument()
  })

  it('shows the authenticated shop logo beside the shop name in the app shell', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/users/me') return Promise.resolve({ data: { name: 'Miles Owner', email: 'owner@example.com' } })
      if (url === '/market/shop') return Promise.resolve({ data: { ...shop, logo_url: '/uploads/shop-logos/miles.jpg' } })
      return Promise.resolve({ data: {} })
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<div>Dashboard content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findAllByAltText('Miles Automotive logo')).not.toHaveLength(0)
    expect(screen.getAllByText('Miles Automotive').length).toBeGreaterThan(0)
  })
})
