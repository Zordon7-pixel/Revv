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
  normalizePaymentStatus: () => 'unpaid',
}))
vi.mock('../../components/PaymentPanel', () => ({ default: () => null }))
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
import RODetail from '../RODetail'

const originalCreateObjectURLDescriptor = Object.getOwnPropertyDescriptor(window.URL, 'createObjectURL')
const originalRevokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(window.URL, 'revokeObjectURL')

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

function stubApi(initialRo, { preDropoffPhotos = [] } = {}) {
  let currentRo = initialRo
  api.get.mockImplementation((url) => {
    if (url === '/ros/ro-1') return Promise.resolve({ data: currentRo })
    if (url === '/parts-requests/ro-1') return Promise.resolve({ data: { requests: [] } })
    if (url === '/comms/ro-1') return Promise.resolve({ data: { comms: [] } })
    if (url === '/ros/ro-1/notes') return Promise.resolve({ data: { notes: [] } })
    if (url === '/sms/thread/ro-1') return Promise.resolve({ data: { messages: [], customerPhone: '' } })
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

describe('RODetail total loss action', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.patch.mockReset()
    api.put.mockReset()
    api.delete.mockReset()
    window.confirm = vi.fn(() => true)
    window.alert = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    if (originalCreateObjectURLDescriptor) {
      Object.defineProperty(window.URL, 'createObjectURL', originalCreateObjectURLDescriptor)
    } else {
      delete window.URL.createObjectURL
    }
    if (originalRevokeObjectURLDescriptor) {
      Object.defineProperty(window.URL, 'revokeObjectURL', originalRevokeObjectURLDescriptor)
    } else {
      delete window.URL.revokeObjectURL
    }
  })

  it('confirms total loss, sends the status note, and keeps profit fields editable', async () => {
    stubApi(makeRo())
    const user = userEvent.setup()
    renderRODetail()

    await screen.findByText('RO-1')
    await user.click(screen.getByRole('button', { name: /more repair order actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /mark total loss/i }))

    const modal = await screen.findByRole('dialog', { name: /mark total loss/i })
    expect(modal.parentElement).toBe(document.body)
    expect(modal).toHaveClass('z-[150]')
    await screen.findByRole('heading', { name: /mark total loss/i })
    await user.type(screen.getByLabelText(/internal note/i), 'Insurer declared total loss')
    await user.click(screen.getByRole('button', { name: /confirm total loss/i }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/ros/ro-1/status', {
        status: 'total_loss',
        note: 'Insurer declared total loss',
      })
    })
    expect((await screen.findAllByText(/^total loss$/i)).length).toBeGreaterThan(0)

    const setButtons = screen.getAllByRole('button', { name: /\+ set/i })
    await user.click(setButtons[0])
    expect(screen.getByDisplayValue('0')).toBeInTheDocument()
  })

  it('keeps modal failures visible above the app without using a browser alert', async () => {
    stubApi(makeRo())
    api.put.mockRejectedValueOnce({ response: { data: { error: 'Total loss update was rejected.' } } })
    const user = userEvent.setup()
    renderRODetail()

    await screen.findByText('RO-1')
    await user.click(screen.getByRole('button', { name: /more repair order actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /mark total loss/i }))
    await user.click(await screen.findByRole('button', { name: /confirm total loss/i }))

    const feedback = await screen.findByRole('alert')
    expect(feedback).toHaveTextContent('Total loss update was rejected.')
    expect(feedback.parentElement).toHaveClass('z-[220]')
    expect(feedback.parentElement?.parentElement).toBe(document.body)
    expect(window.alert).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /mark total loss/i })).toBeInTheDocument()
  })

  it('keeps pre-dropoff previews above the sidebar and allows the photo to be deleted', async () => {
    stubApi(makeRo(), {
      preDropoffPhotos: [{
        id: 'predropoff-1',
        photo_url: '/uploads/photos/predropoff.jpg',
        photo_type: 'predropoff',
        caption: 'Driver side before work',
      }],
    })
    const user = userEvent.setup()
    renderRODetail()

    await screen.findByText('RO-1')
    await user.click(await screen.findByRole('button', { name: 'View pre-dropoff photo: Driver side before work' }))

    const dialog = screen.getByRole('dialog', { name: 'Driver side before work' })
    const overlay = dialog.closest('[data-photo-lightbox="true"]')
    expect(overlay?.parentElement).toBe(document.body)
    expect(overlay).toHaveClass('z-[200]')
    expect(screen.getByTestId('photo-lightbox-image')).toHaveClass('max-h-[64dvh]', 'max-w-[min(76vw,60rem)]')

    await user.click(screen.getByRole('button', { name: 'Close photo preview' }))
    await user.click(screen.getByRole('button', { name: 'Delete pre-dropoff photo' }))

    expect(window.confirm).toHaveBeenCalledWith('Delete this pre-dropoff photo?')
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/photos/predropoff-1'))
    expect(screen.queryByRole('button', { name: 'View pre-dropoff photo: Driver side before work' })).not.toBeInTheDocument()
  })

  it('uploads multiple pre-dropoff photos and refreshes the gallery once after the batch', async () => {
    stubApi(makeRo())
    renderRODetail()

    await screen.findByText('RO-1')
    const input = screen.getByLabelText('Pre-dropoff photos')
    const first = new File(['first'], 'driver-side.jpg', { type: 'image/jpeg' })
    const second = new File(['second'], 'passenger-side.jpg', { type: 'image/jpeg' })
    expect(input).toHaveAttribute('multiple')

    fireEvent.change(input, { target: { files: [first, second] } })

    await waitFor(() => {
      const uploads = api.post.mock.calls.filter(([url]) => url === '/photos/ro/ro-1/predropoff')
      expect(uploads).toHaveLength(2)
      expect(uploads.map(([, form]) => form.get('photo').name)).toEqual(['driver-side.jpg', 'passenger-side.jpg'])
    })
    await waitFor(() => {
      const galleryLoads = api.get.mock.calls.filter(([url]) => url === '/photos/ro/ro-1/predropoff')
      expect(galleryLoads).toHaveLength(2)
    })
  })

  it('renders one action cluster and exposes every primary RO workspace from one tab row', async () => {
    stubApi(makeRo({
      payment_type: 'insurance',
      claim_number: 'CLM-9001',
      amount_owed_cents: 125050,
      amount_paid_cents: 25000,
      estimated_delivery: '2026-07-20',
    }))
    const user = userEvent.setup()
    renderRODetail()

    expect(await screen.findByRole('button', { name: /advance.*paint/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^supplement$/i })).toBeInTheDocument()
    expect(screen.getByText('$1,250.50')).toBeInTheDocument()
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.getByTestId('supplement-finder')).toHaveAttribute('data-variant', 'hero')

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Insurance', 'Parts', 'Customer', 'Comms', 'Photos'])

    await user.click(screen.getByRole('tab', { name: 'Insurance' }))
    expect(await screen.findByText('Insurance workspace')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Parts' }))
    expect(await screen.findByRole('heading', { name: 'ro.parts' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Customer' }))
    expect(await screen.findByRole('heading', { name: 'Customer' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Comms' }))
    expect(await screen.findByRole('heading', { name: 'Customer Text Messages' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Photos' }))
    expect(await screen.findByText('Photo workspace')).toBeInTheDocument()
  })

  it('downloads the branded repair-order PDF through the authenticated API client', async () => {
    stubApi(makeRo())
    const defaultGet = api.get.getMockImplementation()
    api.get.mockImplementation((url, options) => {
      if (url === '/invoice/ro-1/repair-order') {
        expect(options).toEqual({ responseType: 'blob' })
        return Promise.resolve({ data: new Blob(['repair-order'], { type: 'application/pdf' }) })
      }
      return defaultGet(url, options)
    })
    const createObjectURL = vi.fn(() => 'blob:repair-order')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const user = userEvent.setup()
    renderRODetail()
    await screen.findByText('RO-1')
    await user.click(screen.getByRole('button', { name: /more repair order actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /print repair order/i }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/invoice/ro-1/repair-order', { responseType: 'blob' })
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:repair-order')
    })
    expect(window.alert).not.toHaveBeenCalled()
  })
})
