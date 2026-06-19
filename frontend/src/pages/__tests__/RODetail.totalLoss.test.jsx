import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  normalizePaymentStatus: () => 'unpaid',
}))
vi.mock('../../components/PaymentPanel', () => ({ default: () => null }))
vi.mock('../../components/LibraryAutocomplete', () => ({ default: () => null }))
vi.mock('../../components/ROPhotos', () => ({ default: () => null }))
vi.mock('../../components/TurnaroundEstimator', () => ({ default: () => null }))
vi.mock('../../components/PartsSearch', () => ({ default: () => null }))
vi.mock('../../components/VehicleDiagram', () => ({ default: () => null }))
vi.mock('../../components/ClaimStatusCard', () => ({ default: () => null }))
vi.mock('../../components/InsurancePanel', () => ({ default: () => null }))
vi.mock('../../components/SupplementFinderPanel', () => ({ default: () => null }))
vi.mock('../../components/ROOperations', () => ({ default: () => null }))
vi.mock('../../components/ClaimTrackerPanel', () => ({ default: () => null }))

import api from '../../lib/api'
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

function stubApi(initialRo) {
  let currentRo = initialRo
  api.get.mockImplementation((url) => {
    if (url === '/ros/ro-1') return Promise.resolve({ data: currentRo })
    if (url === '/parts-requests/ro-1') return Promise.resolve({ data: { requests: [] } })
    if (url === '/comms/ro-1') return Promise.resolve({ data: { comms: [] } })
    if (url === '/ros/ro-1/notes') return Promise.resolve({ data: { notes: [] } })
    if (url === '/sms/thread/ro-1') return Promise.resolve({ data: { messages: [], customerPhone: '' } })
    if (url === '/photos/ro/ro-1/predropoff') return Promise.resolve({ data: { photos: [] } })
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

describe('RODetail total loss action', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.patch.mockReset()
    api.put.mockReset()
    api.delete.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('confirms total loss, sends the status note, and keeps profit fields editable', async () => {
    stubApi(makeRo())
    const user = userEvent.setup()
    renderRODetail()

    await screen.findByText('RO-1')
    await user.click(screen.getByRole('button', { name: /mark total loss/i }))

    await screen.findByRole('heading', { name: /mark total loss/i })
    await user.type(screen.getByLabelText(/internal note/i), 'Insurer declared total loss')
    await user.click(screen.getByRole('button', { name: /confirm total loss/i }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/ros/ro-1/status', {
        status: 'total_loss',
        note: 'Insurer declared total loss',
      })
    })
    expect(await screen.findByText(/total loss closed/i)).toBeInTheDocument()

    const setButtons = screen.getAllByRole('button', { name: /\+ set/i })
    await user.click(setButtons[0])
    expect(screen.getByDisplayValue('0')).toBeInTheDocument()
  })
})
