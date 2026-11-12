import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../lib/auth', () => ({
  getTokenPayload: vi.fn(() => ({ id: 'owner-1', role: 'owner' })),
  isAdmin: vi.fn(() => true),
  isAssistant: vi.fn(() => false),
  isEmployee: vi.fn(() => false),
}))

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key }),
}))

vi.mock('../../lib/imageUpload', () => ({
  optimizeImageForUpload: vi.fn((file) => Promise.resolve(file)),
}))

vi.mock('../RepairOrders', () => ({
  STATUS_COLORS: {
    intake: '#64748b',
    estimate: '#3b82f6',
    approval: '#eab308',
    parts: '#8b5cf6',
    repair: '#f97316',
    paint: '#06b6d4',
    qc: '#10b981',
    delivery: '#22c55e',
    closed: '#374151',
    total_loss: '#dc2626',
  },
  STATUS_LABELS: {
    intake: 'Intake',
    estimate: 'Estimate',
    approval: 'Approval',
    parts: 'Parts',
    repair: 'Repair',
    paint: 'Paint',
    qc: 'QC Check',
    delivery: 'Delivery',
    closed: 'Closed',
    total_loss: 'Total Loss',
  },
}))

vi.mock('../../components/StatusBadge', () => ({
  default: ({ status }) => <span>{status}</span>,
}))
vi.mock('../../components/PaymentStatusBadge', () => ({
  default: () => <span>payment badge</span>,
  normalizePaymentStatus: (status) => status,
}))
vi.mock('../../components/PaymentPanel', () => ({ default: () => <div>Payment panel</div> }))
vi.mock('../../components/LibraryAutocomplete', () => ({ default: () => null }))
vi.mock('../../components/ROPhotos', () => ({ default: () => <div>Photo workspace</div> }))
vi.mock('../../components/TurnaroundEstimator', () => ({ default: () => null }))
vi.mock('../../components/PartsSearch', () => ({ default: () => null }))
vi.mock('../../components/VehicleDiagram', () => ({ default: () => null }))
vi.mock('../../components/ClaimStatusCard', () => ({ default: () => null }))
vi.mock('../../components/InsurancePanel', () => ({ default: () => <div>Insurance workspace</div> }))
vi.mock('../../components/SupplementFinderPanel', () => ({
  default: ({ variant }) => <div data-testid="supplement-finder" data-variant={variant}>Supplement Finder workspace</div>,
}))
vi.mock('../../components/ROOperations', () => ({ default: () => null }))
vi.mock('../../components/ClaimTrackerPanel', () => ({ default: () => null }))

import api from '../../lib/api'
import { isAdmin, isAssistant, getTokenPayload } from '../../lib/auth'
import RODetail from '../RODetail'


function makeRo(overrides = {}) {
  return {
    id: 'ro-1',
    ro_number: 'RO-1',
    status: 'repair',
    intake_date: '2026-06-01',
    payment_received: 0,
    payment_status: 'unpaid',
    parts_cost: 100,
    labor_cost: 200,
    sublet_cost: 0,
    tax: 0,
    total: 500,
    deductible: 100,
    deductible_waived: 0,
    referral_fee: 0,
    goodwill_repair_cost: 0,
    true_profit: 300,
    notes: '',
    damaged_panels: '[]',
    vehicle: { year: 2022, make: 'Honda', model: 'Civic' },
    customer: { id: 'cust-1', name: 'Jane Customer' },
    parts: [],
    log: [],
    ...overrides,
  }
}

function stubApi(initialRo, { preDropoffPhotos = [], messages = [] } = {}) {
  let currentRo = initialRo
  api.get.mockImplementation((url) => {
    if (url === '/ros/ro-1') return Promise.resolve({ data: currentRo })
    if (url === '/parts-requests/ro-1') return Promise.resolve({ data: { requests: [] } })
    if (url === '/comms/ro-1') return Promise.resolve({ data: { comms: [] } })
    if (url === '/ros/ro-1/notes') return Promise.resolve({ data: { notes: [] } })
    if (url === '/sms/thread/ro-1') return Promise.resolve({ data: { messages, customerPhone: '' } })
    if (url === '/photos/ro/ro-1/predropoff') return Promise.resolve({ data: { photos: preDropoffPhotos } })
    if (url === '/inspections/ro/ro-1') return Promise.resolve({ data: { inspections: [] } })
    if (url === '/ros/ro-1/supplements') return Promise.resolve({ data: { supplements: [], totalApproved: 0 } })
    if (url === '/storage/ro-1/charges') return Promise.resolve({ data: { charges: [] } })
    if (url === '/estimate-items/ro-1') return Promise.resolve({ data: { items: [], summary: null } })
    if (url === '/claim-links/ro/ro-1') return Promise.resolve({ data: null })
    if (url === '/users') return Promise.resolve({ data: { users: [] } })
    if (url === '/customers/cust-1/history') return Promise.resolve({ data: { visits: [] } })
    return Promise.resolve({ data: {} })
  })
  api.put.mockImplementation((url, body) => {
    if (url === '/ros/ro-1/status' && body.status === 'total_loss') {
      currentRo = {
        ...currentRo,
        status: 'total_loss',
        actual_delivery: '2026-06-18',
        log: [
          ...(currentRo.log || []),
          { to_status: 'total_loss', created_at: '2026-06-18T12:00:00.000Z', note: body.note },
        ],
      }
      return Promise.resolve({ data: currentRo })
    }
    return Promise.resolve({ data: currentRo })
  })
  api.patch.mockImplementation((url, body) => {
    if (url === '/ros/ro-1') {
      currentRo = { ...currentRo, ...body }
      return Promise.resolve({ data: currentRo })
    }
    return Promise.resolve({ data: {} })
  })
  api.post.mockResolvedValue({ data: {} })
  api.delete.mockResolvedValue({ data: {} })
}

function renderRODetail() {
  return render(
    <MemoryRouter initialEntries={['/ros/ro-1']}>
      <Routes>
        <Route path="/ros/:id" element={<RODetail />} />
      </Routes>
    </MemoryRouter>
  )
}


const prompt = 'This ticket shows a $0 balance. Was it paid in full or settled (e.g. by insurance)?'
async function openClose(overrides = {}, admin = false) {
  isAdmin.mockReturnValue(admin)
  getTokenPayload.mockReturnValue({ id: 'tech-1', role: admin ? 'admin' : 'technician' })
  stubApi(makeRo({ status: 'delivery', total: 0, amount_owed_cents: 0, amount_paid_cents: 0, ...overrides }))
  renderRODetail()
  await screen.findByText('RO-1')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Close ticket' }))
}

describe('RODetail explicit close and status errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAssistant.mockReturnValue(false)
    window.confirm = vi.fn(() => true)
    window.alert = vi.fn()
  })
  afterEach(cleanup)

  it('nonadmin sees exact zero confirmation; No leaves all mutations untouched', async () => {
    await openClose()
    expect(screen.getByText(prompt)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes, paid - close ticket' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'No, keep open' }))
    expect(screen.queryByText(prompt)).not.toBeInTheDocument()
    expect(api.put).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
    expect(api.patch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Close ticket' })).toBeInTheDocument()
  })

  it('assistant authorized by the status gate can explicitly confirm zero close', async () => {
    isAdmin.mockReturnValue(false)
    isAssistant.mockReturnValue(true)
    getTokenPayload.mockReturnValue({ id: 'assistant-1', role: 'assistant' })
    stubApi(makeRo({ status: 'delivery', total: 0, amount_owed_cents: 0, amount_paid_cents: 0 }))
    renderRODetail()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Close ticket' }))
    expect(screen.getByText(prompt)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yes, paid - close ticket' }))
    expect(api.put).toHaveBeenCalledWith('/ros/ro-1/status', { status: 'closed', confirm_zero_settlement: true })
  })

  it('Yes sends explicit settlement once despite double click and closes the prompt on success', async () => {
    await openClose()
    let resolve
    api.put.mockImplementation(() => new Promise(done => { resolve = done }))
    const yes = screen.getByRole('button', { name: 'Yes, paid - close ticket' })
    fireEvent.click(yes)
    fireEvent.click(yes)
    expect(api.put).toHaveBeenCalledTimes(1)
    expect(api.put).toHaveBeenCalledWith('/ros/ro-1/status', { status: 'closed', confirm_zero_settlement: true })
    expect(yes).toBeDisabled()
    resolve({ data: {} })
    await waitFor(() => expect(screen.queryByText(prompt)).not.toBeInTheDocument())
    expect(api.post).not.toHaveBeenCalled()
  })

  it.each(['Only a zero remaining balance can be settled and closed', 'This RO is under SIU investigation. Clear the SIU hold before changing status.'])('shows stale/server refusal: %s', async reason => {
    await openClose()
    api.put.mockRejectedValueOnce({ response: { data: { error: reason } } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yes, paid - close ticket' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(screen.getByText(prompt)).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it.each([false, true])('positive unpaid close surfaces exact server reason and role guidance (admin=%s)', async admin => {
    isAdmin.mockReturnValue(admin)
    getTokenPayload.mockReturnValue({ id: 'user-1', role: admin ? 'admin' : 'technician' })
    stubApi(makeRo({ status: 'delivery', amount_owed_cents: 50000, amount_paid_cents: 0 }))
    api.put.mockRejectedValueOnce({ response: { data: { error: 'Payment must be received before closing this RO' } } })
    renderRODetail()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Close ticket' }))
    expect(screen.queryByText(prompt)).not.toBeInTheDocument()
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Payment must be received before closing this RO')
    expect(error).toHaveTextContent(admin ? 'Use the Payment panel or Mark Paid' : 'ask an admin to Mark Paid')
    expect(api.put).toHaveBeenCalledWith('/ros/ro-1/status', { status: 'closed' })
    expect(api.post).not.toHaveBeenCalled()
  })

  it.each(['paid', 'succeeded'])('paid close (%s) uses normal status operation without settlement', async payment_status => {
    await openClose({ payment_status, payment_received: 1 })
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/ros/ro-1/status', { status: 'closed' }))
    expect(screen.queryByText(prompt)).not.toBeInTheDocument()
  })

  it('stage click failures surface and a subsequent close still requires confirmation', async () => {
    await openClose()
    await userEvent.setup().click(screen.getByRole('button', { name: 'No, keep open' }))
    api.put.mockRejectedValueOnce({ response: { data: { error: 'Stage transition refused' } } })
    await userEvent.setup().click(screen.getByRole('button', { name: /^.*Paint.*$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Stage transition refused')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close ticket' }))
    expect(screen.getByText(prompt)).toBeInTheDocument()
    expect(api.put).toHaveBeenCalledTimes(1)
  })

  it('manual Mark Paid copy does not promise automatic closing and preserves its positive payment call', async () => {
    await openClose({ amount_owed_cents: 50000 }, true)
    await userEvent.setup().click(screen.getByRole('button', { name: 'More repair order actions' }))
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Mark payment received' }))
    expect(screen.getByText('Select payment method and confirm. This marks the RO as paid. It does not close the ticket; use Close ticket when ready.')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: /^Mark Paid$/ })
    await userEvent.setup().click(buttons.at(-1))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/ros/ro-1/mark-paid', { payment_method: 'cash' }))
  })
})
