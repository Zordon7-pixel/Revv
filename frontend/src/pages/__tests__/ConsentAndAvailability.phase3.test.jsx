import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../../lib/auth', () => ({ isAdmin: () => true, isAssistant: () => false }))
vi.mock('../../components/PanelEstimator', () => ({ default: () => <div data-testid="panel-editor">Editor mounted</div> }))
import api from '../../lib/api'
import Customers from '../Customers'
import EstimateBuilder from '../EstimateBuilder'
const confirmed = { sms_consent: true, sms_consent_method: 'verbal', sms_consent_at: '2026-10-01T12:00:00Z', sms_consent_by: 'staff-1' }
let customers
beforeEach(() => {
  customers = []
  Object.values(api).forEach(mock => mock.mockReset())
  api.get.mockImplementation(async url => {
    if (url === '/customers') return { data: { customers } }
    if (url === '/ros/ro-1') return { data: { id: 'ro-1', ro_number: 'RO-1' } }
    if (url === '/estimate-items/ro-1') return { data: { items: [], summary: {} } }
    return { data: {} }
  })
  api.post.mockResolvedValue({ data: {} }); api.put.mockResolvedValue({ data: {} })
})
afterEach(cleanup)
const checkbox = () => screen.getByRole('checkbox', { name: 'Customer agreed to texts' })
const ordinary = { name: 'Customer', phone: '', email: '', address: '', insurance_company: '', policy_number: '' }

it.each(['verbal', 'written'])('customer create validates and sends exact %s attestation', async method => {
  const user = userEvent.setup()
  render(<Customers />)
  await user.click(await screen.findByRole('button', { name: /\+ add customer/i }))
  expect(checkbox()).not.toBeChecked()
  await user.type(screen.getByPlaceholderText('John Doe'), 'Customer')
  await user.click(checkbox())
  // Exercise the submit handler too, independent of browser required validation.
  fireEvent.submit(screen.getByRole('button', { name: /save customer/i }).closest('form'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose verbal or written SMS consent.')
  expect(api.post).not.toHaveBeenCalled()
  await user.selectOptions(screen.getByLabelText('SMS consent method'), method)
  await user.click(screen.getByRole('button', { name: /save customer/i }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customers', { ...ordinary, sms_consent: true, sms_consent_method: method }))
})

it.each([true, null, undefined, false])('legacy customer %s is unconfirmed; unrelated edit omits evidence', async sms => {
  customers = [{ id: 'c1', ...ordinary, sms_consent: sms, email_consent: true, preferred_contact_method: 'email' }]
  const user = userEvent.setup(); render(<Customers />)
  await user.click(await screen.findByTitle('Edit customer'))
  expect(checkbox()).not.toBeChecked()
  expect(screen.queryByLabelText('SMS consent method')).not.toBeInTheDocument()
  await user.type(screen.getByPlaceholderText('123 Main St'), 'New address')
  await user.click(screen.getByRole('button', { name: /save customer/i }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/customers/c1', { ...ordinary, address: 'New address' }))
})

it.each([
  { sms_consent_at: null }, { sms_consent_at: '2026-02-30T12:00:00Z' },
  { sms_consent_method: null }, { sms_consent_method: 'imported' }, { sms_consent_by: ' ' },
])('incomplete or invalid provenance stays unchecked: %j', async patch => {
  customers = [{ id: 'c1', ...ordinary, ...confirmed, ...patch }]
  const user = userEvent.setup(); render(<Customers />)
  await user.click(await screen.findByTitle('Edit customer'))
  expect(checkbox()).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: /save customer/i }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/customers/c1', ordinary))
})

it.each(['unchanged', 'revoke', 'method', 'undo'])('confirmed customer edit %s preserves or intentionally changes evidence', async action => {
  customers = [{ id: 'c1', ...ordinary, ...confirmed }]
  const user = userEvent.setup(); render(<Customers />)
  await user.click(await screen.findByTitle('Edit customer'))
  expect(checkbox()).toBeChecked()
  expect(screen.getByLabelText('SMS consent method')).toHaveValue('verbal')
  if (action === 'revoke' || action === 'undo') await user.click(checkbox())
  if (action === 'undo') await user.click(checkbox())
  if (action === 'method') await user.selectOptions(screen.getByLabelText('SMS consent method'), 'written')
  await user.click(screen.getByRole('button', { name: /save customer/i }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/customers/c1', { ...ordinary,
    ...(action === 'revoke' ? { sms_consent: false } : action === 'method' ? { sms_consent: true, sms_consent_method: 'written' } : {}) }))
})
it('reconfirms a legacy customer with an explicit method', async () => {
  customers = [{ id: 'c1', ...ordinary, sms_consent: true }]
  const user = userEvent.setup(); render(<Customers />)
  await user.click(await screen.findByTitle('Edit customer'))
  await user.click(checkbox())
  await user.selectOptions(screen.getByLabelText('SMS consent method'), 'verbal')
  await user.click(screen.getByRole('button', { name: /save customer/i }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/customers/c1', { ...ordinary, sms_consent: true, sms_consent_method: 'verbal' }))
})
function builder() {
  render(<MemoryRouter initialEntries={['/estimate-builder/ro-1']}><Routes><Route path="/estimate-builder/:roId" element={<EstimateBuilder />} /></Routes></MemoryRouter>)
}
it.each([false, undefined, 'true', 'error'])('availability %s hides visual entry and never mounts editor', async enabled => {
  const original = api.get.getMockImplementation()
  api.get.mockImplementation(url => url === '/estimate-items/panel-estimator/availability'
    ? enabled === 'error' ? Promise.reject(new Error('Unavailable')) : Promise.resolve({ data: { enabled } }) : original(url))
  builder()
  expect(await screen.findByRole('button', { name: 'Manual / insurance import' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Visual panels' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('panel-editor')).not.toBeInTheDocument()
})
it('unknown availability hides editor; explicit enabled permits mounting only on demand', async () => {
  let resolve
  const pending = new Promise(r => { resolve = r })
  const original = api.get.getMockImplementation()
  api.get.mockImplementation(url => url === '/estimate-items/panel-estimator/availability' ? pending : original(url))
  builder()
  await screen.findByRole('button', { name: 'Manual / insurance import' })
  expect(screen.queryByRole('button', { name: 'Visual panels' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('panel-editor')).not.toBeInTheDocument()
  await act(async () => resolve({ data: { enabled: true } }))
  expect(screen.queryByTestId('panel-editor')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Visual panels' }))
  expect(screen.getByTestId('panel-editor')).toBeVisible()
})


it('phone edit hides old consent, saves without attestation, and requires explicit confirmation after reopening', async () => {
  customers = [{ id: 'c1', ...ordinary, phone: '+15551234567', ...confirmed }]
  api.put.mockImplementation(async (_url, payload) => {
    const changed = payload.phone === '+15557654321' && customers[0].phone !== payload.phone
    customers = [{ ...customers[0], ...payload, ...(changed ? {
      sms_consent: false, sms_consent_at: null, sms_consent_method: null, sms_consent_by: null,
    } : {}) }]
    return { data: customers[0] }
  })
  const user = userEvent.setup(); render(<Customers />)
  await user.click(await screen.findByTitle('Edit customer'))
  expect(checkbox()).toBeChecked()
  fireEvent.change(screen.getByPlaceholderText('(212) 555-0100'), { target: { value: '+15557654321' } })
  expect(screen.queryByRole('checkbox', { name: 'Customer agreed to texts' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Save this number, then reopen Edit Customer')
  await user.click(screen.getByRole('button', { name: /save customer/i }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/customers/c1', { ...ordinary, phone: '+15557654321' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /save customer/i })).not.toBeInTheDocument())
  await user.click(await screen.findByTitle('Edit customer'))
  expect(checkbox()).not.toBeChecked()
  await user.click(checkbox())
  await user.selectOptions(screen.getByLabelText('SMS consent method'), 'written')
  await user.click(screen.getByRole('button', { name: /save customer/i }))
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/customers/c1', {
    ...ordinary, phone: '+15557654321', sms_consent: true, sms_consent_method: 'written',
  }))
})

it.each(['(555) 123-4567', '+1 (555) 123-4567'])('phone formatting %s preserves the checked consent and omits evidence', async phone => {
  customers = [{ id: 'c1', ...ordinary, phone: '+15551234567', ...confirmed }]
  const user = userEvent.setup(); render(<Customers />)
  await user.click(await screen.findByTitle('Edit customer'))
  fireEvent.change(screen.getByPlaceholderText('(212) 555-0100'), { target: { value: phone } })
  expect(checkbox()).toBeChecked()
  await user.click(screen.getByRole('button', { name: /save customer/i }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/customers/c1', { ...ordinary, phone }))
})
