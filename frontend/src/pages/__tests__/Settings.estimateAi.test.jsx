import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn(), patch: vi.fn(), post: vi.fn() } }))
vi.mock('../../components/AgreementArchive', () => ({ default: () => null }))
vi.mock('../../components/AgreementTemplates', () => ({ default: () => null }))
vi.mock('../../components/ThemeSettingsCard', () => ({ default: () => null }))
import api from '../../lib/api'
import Settings from '../Settings'

const shop = { id: 'synthetic-shop', name: 'Synthetic shop', labor_rate: 75, parts_markup: 0.3, tax_rate: 0.08875 }
let settings, readFailure
beforeEach(() => {
  vi.resetAllMocks()
  readFailure = false
  settings = { estimate_ai_enabled: false, sms_notifications_enabled: true, email_notifications_enabled: false,
    parts_margin_pct: 0.25, materials_margin_pct: 0.45, sublet_margin_pct: 0.05, blended_labor_cost_per_hr: 51 }
  api.get.mockImplementation(async url => {
    if (url === '/market/shop') return { data: shop }
    if (url === '/market/rates') return { data: { states: [] } }
    if (url === '/settings') {
      if (readFailure) throw Error('Unavailable')
      return { data: { ...settings } }
    }
    if (url === '/settings/public-intake') return { data: { public_intake_slug: 'abcdefghijklmnop' } }
    return { data: {} }
  })
  api.put.mockImplementation(async url => ({ data: url === '/market/shop' ? shop : {} }))
  api.patch.mockImplementation(async (url, body) => { settings = { ...settings, ...body }; return { data: { ...settings } } })
})
afterEach(() => { cleanup(); localStorage.clear() })

async function mount(role = 'owner') {
  // Real frontend role decoding, including exact spelling checks.
  localStorage.setItem('sc_token', `synthetic.${btoa(JSON.stringify({ role, shop_id: shop.id }))}.unsigned`)
  render(<MemoryRouter><Settings /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'AI estimate fallback' })
  return screen.getByRole('region', { name: 'AI estimate fallback' })
}
async function save() {
  fireEvent.submit(document.getElementById('shop-settings-form'))
  await waitFor(() => expect(api.patch).toHaveBeenCalled())
  await screen.findByRole('button', { name: /Saved!/ })
}

it.each(['owner', 'admin'])('%s sees default off and sends an explicit boolean only after editing', async role => {
  const card = await mount(role)
  expect(within(card).getByRole('status')).toHaveTextContent(/^Off$/)
  expect(within(card).getByRole('checkbox')).not.toBeChecked()
  await save()
  expect(api.patch.mock.calls.at(-1)).toEqual(['/settings', {
    sms_notifications_enabled: true, email_notifications_enabled: false,
    parts_margin_pct: 0.25, materials_margin_pct: 0.45, sublet_margin_pct: 0.05, blended_labor_cost_per_hr: 51,
  }])
  expect(api.put.mock.calls.find(([url]) => url === '/market/shop')[1]).toMatchObject({ tax_rate: 0.0888, parts_markup: 0.3, labor_rate: 75 })
  api.patch.mockClear()
  fireEvent.click(within(card).getByRole('checkbox', { name: 'Enable AI estimate fallback' }))
  expect(within(card).getByRole('status')).toHaveTextContent('On — unsaved change')
  expect(api.patch).not.toHaveBeenCalled()
  await save()
  expect(api.patch.mock.calls.at(-1)[1].estimate_ai_enabled).toBe(true)
  expect(within(card).getByRole('status')).toHaveTextContent(/^On$/)
  api.patch.mockClear()
  fireEvent.click(within(card).getByRole('checkbox'))
  await save()
  expect(api.patch.mock.calls.at(-1)[1].estimate_ai_enabled).toBe(false)
  expect(within(card).getByRole('status')).toHaveTextContent(/^Off$/)
})

it.each(['assistant', 'superadmin', 'technician', 'employee', 'staff', 'customer', 'unknown', 'OWNER', 'Admin', ' owner'])('%s can see off without an edit control or private cost display', async role => {
  // Staff DTO excludes costs. UI must not invent a visible private profile.
  settings = { estimate_ai_enabled: false }
  const card = await mount(role)
  expect(within(card).getByRole('status')).toHaveTextContent(/^Off$/)
  expect(within(card).queryByRole('checkbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Financial' }))
  expect(screen.queryByText('Shop Cost Profile')).toBeNull()
  expect(api.patch).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toMatch(/admission_count|window_started_at|api_key|secret/i)
})

it.each([undefined, null, 'true', 'false', 1])('missing/invalid persisted policy (%s) is unavailable and cannot enable', async value => {
  settings.estimate_ai_enabled = value
  const card = await mount()
  expect(within(card).getByRole('status')).toHaveTextContent('status unavailable')
  expect(within(card).getByRole('checkbox')).toBeDisabled()
  expect(within(card).getByRole('checkbox')).not.toBeChecked()
  await save()
  expect(api.patch.mock.calls.at(-1)[1]).not.toHaveProperty('estimate_ai_enabled')
})

it('read failure is honest, disables the toggle and prevents default-profile writes', async () => {
  readFailure = true
  const card = await mount()
  expect(within(card).getByRole('status')).toHaveTextContent('status unavailable')
  expect(within(card).getByRole('checkbox')).toBeDisabled()
  fireEvent.submit(document.getElementById('shop-settings-form'))
  expect(await screen.findByText(/Shop cost profile is still loading/)).toBeInTheDocument()
  expect(api.patch).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('failed save keeps the explicit choice unsaved and shows the error', async () => {
  const card = await mount()
  api.patch.mockRejectedValue({ response: { data: { error: 'Could not save settings' } } })
  fireEvent.click(within(card).getByRole('checkbox'))
  fireEvent.submit(document.getElementById('shop-settings-form'))
  expect(await screen.findByText('Could not save settings')).toBeInTheDocument()
  expect(within(card).getByRole('status')).toHaveTextContent('On — unsaved change')
  expect(api.patch.mock.calls.at(-1)[1].estimate_ai_enabled).toBe(true)
  expect(within(card).getByText(/estimate content may be sent to OpenAI/)).toBeInTheDocument()
  expect(within(card).getByText(/do not guarantee a dollar spending cap/)).toBeInTheDocument()
})

it('staff sees persisted on without a control; unrelated owner saves preserve on by omission', async () => {
  settings.estimate_ai_enabled = true
  const card = await mount('staff')
  expect(within(card).getByRole('status')).toHaveTextContent(/^On$/)
  expect(within(card).queryByRole('checkbox')).toBeNull()
  cleanup()
  await mount('owner'); await save()
  expect(api.patch.mock.calls.at(-1)[1]).not.toHaveProperty('estimate_ai_enabled')
})
