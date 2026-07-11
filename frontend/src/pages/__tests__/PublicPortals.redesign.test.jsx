import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LanguageProvider } from '../../contexts/LanguageContext'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../../lib/api'
import ClaimPortal from '../ClaimPortal'
import ApprovalPortal from '../ApprovalPortal'
import TrackPortal from '../TrackPortal'
import BookAppointment from '../BookAppointment'
import PublicEstimateRequest from '../PublicEstimateRequest'
import ReviewSubmit from '../ReviewSubmit'
import InspectionPublic from '../InspectionPublic'
import ShopProfile from '../ShopProfile'

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function renderRoute(element, path, entry) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

function restoreClipboard() {
  if (originalClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  else delete navigator.clipboard
}

describe('Phase 6D public portals', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    localStorage.setItem('revv_lang', 'en')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    restoreClipboard()
    localStorage.clear()
  })

  it('keeps claim assessment validation and multipart submission on the public claim endpoints', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({
      data: {
        link: {},
        shop: { name: 'Miles Automotive', phone: '212-555-0100' },
        ro: { ro_number: 'RO-31', parts_cost: 2100, labor_cost: 1700, total: 4200 },
        vehicle: { year: 2022, make: 'Honda', model: 'Accord', vin: 'VIN31' },
        customer: { name: 'Miles Customer' },
      },
    })
    api.post.mockResolvedValue({ data: { ok: true } })

    renderRoute(<ClaimPortal />, '/claim/:token', '/claim/claim-token')

    expect(await screen.findByText('RO-31')).toBeInTheDocument()
    fireEvent.submit(screen.getByRole('button', { name: 'Submit assessment' }).closest('form'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Adjustor name and company are required.')
    expect(api.post).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Adjustor name'), 'Alex Adjustor')
    await user.type(screen.getByLabelText('Adjustor company'), 'Carrier Co')
    fireEvent.submit(screen.getByRole('button', { name: 'Submit assessment' }).closest('form'))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(api.post.mock.calls[0][0]).toBe('/claim-link/claim-token/submit')
    expect(api.post.mock.calls[0][1]).toBeInstanceOf(FormData)
    expect(api.post.mock.calls[0][2]).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } })
  })

  it('keeps estimate approval response payloads and shared money rendering', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({
      data: {
        shop: { name: 'Miles Automotive' },
        customer: { name: 'Miles Customer' },
        vehicle: { year: 2021, make: 'Toyota', model: 'Camry' },
        ro: { ro_number: 'RO-32', status: 'approval', labor_cost: 1000, parts_cost: 2000, sublet_cost: 300, tax: 25, total: 3325 },
      },
    })
    api.post.mockResolvedValue({ data: { ok: true } })

    renderRoute(<ApprovalPortal />, '/approve/:token', '/approve/approval-token')

    expect(await screen.findByText('$3,325.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve Estimate' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/approval/approval-token/respond', { decision: 'approve', reason: undefined }))
    expect(await screen.findByRole('status')).toHaveTextContent('approval is recorded')
  })

  it('keeps tracking reads and customer message payloads while resolving relative photos', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({
      data: {
        shop: { name: 'Miles Automotive', phone: '212-555-0100', city: 'Queens', state: 'NY' },
        ro: { ro_number: 'RO-33', status: 'repair', estimated_delivery: '2026-07-20' },
        vehicle: { year: 2020, make: 'Ford', model: 'Explorer', color: 'Black' },
        parts: [{ id: 'part-1', part_name: 'Bumper', status: 'ordered' }],
        photos: [{ id: 'photo-1', photo_url: '/uploads/photo-1.jpg', caption: 'Repair progress' }],
        timeline: [{ to_status: 'repair', created_at: '2026-07-10T12:00:00Z' }],
        has_rated: false,
      },
    })
    api.post.mockResolvedValue({ data: { ok: true } })

    renderRoute(<TrackPortal />, '/track/:token', '/track/track-token')

    expect((await screen.findAllByText('In repair')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByAltText('Repair progress')).toHaveAttribute('src', `${window.location.origin}/uploads/photo-1.jpg`)
    await user.type(screen.getByLabelText('Message'), 'Please call me with an update.')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/portal/track/track-token/message', { notes: 'Please call me with an update.' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent')
  })

  it('keeps appointment request routing and JSON payloads', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute(<BookAppointment />, '/book', '/book?shop=shop-1&name=Miles%20Automotive')

    await user.type(screen.getByLabelText('Customer name'), 'Miles Customer')
    await user.type(screen.getByLabelText('Phone'), '2125550100')
    await user.click(screen.getByRole('button', { name: 'Submit Booking' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/appointments/request?shop=shop-1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ name: 'Miles Customer', phone: '2125550100', service: 'Oil Change' })
    expect(await screen.findByRole('status')).toHaveTextContent('Appointment Confirmed')
  })

  it('keeps public estimate request fields and photo-array payload', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    renderRoute(<PublicEstimateRequest />, '/estimate-request', '/estimate-request?shop=shop-2')

    const values = [
      ['Full name', 'Miles Customer'],
      ['Phone', '2125550101'],
      ['Email', 'customer@example.com'],
      ['Vehicle year', '2023'],
      ['Vehicle make', 'Honda'],
      ['Vehicle model', 'Pilot'],
      ['Damage description', 'Rear bumper impact'],
    ]
    for (const [label, value] of values) await user.type(screen.getByLabelText(label), value)
    await user.click(screen.getByRole('button', { name: 'Submit request' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/public/estimate-request?shop=shop-2')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ name: 'Miles Customer', make: 'Honda', photos: [] })
  })

  it('keeps review context and rating submission endpoints', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({ data: { shop_name: 'Miles Automotive' } })
    api.post.mockResolvedValue({ data: { ok: true } })

    renderRoute(<ReviewSubmit />, '/review/:token', '/review/review-token')

    expect(await screen.findByText('Rate your experience at Miles Automotive')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rate 5 out of 5' }))
    await user.type(screen.getByLabelText('Comment'), 'Excellent communication')
    await user.click(screen.getByRole('button', { name: 'Submit rating' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reviews/submit/review-token', { rating: 5, comment: 'Excellent communication' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Miles Automotive')
  })

  it('keeps public inspection grouping and uploaded-photo resolution', async () => {
    api.get.mockResolvedValue({
      data: {
        shop: { name: 'Miles Automotive' },
        vehicle: { year: 2024, make: 'Acura', model: 'MDX' },
        ro: { ro_number: 'RO-34' },
        inspection: { status: 'complete' },
        items: [{ id: 'item-1', category: 'Exterior', item_name: 'Front bumper', condition: 'needs_attention', note: 'Scratched', photo_url: '/uploads/inspection.jpg' }],
      },
    })

    renderRoute(<InspectionPublic />, '/inspection/:inspectionId', '/inspection/inspection-1')

    expect(await screen.findByText('Vehicle inspection report')).toBeInTheDocument()
    expect(screen.getByText('Front bumper')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View photo' })).toHaveAttribute('href', `${window.location.origin}/uploads/inspection.jpg`)
    expect(api.get).toHaveBeenCalledWith('/inspections/inspection-1/public')
  })

  it('keeps shop profile reads, shared money, booking navigation, and clipboard feedback', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    api.get.mockResolvedValue({
      data: {
        shop: { name: 'Miles Automotive', phone: '212-555-0100', city: 'Queens', state: 'NY', labor_rate: 75 },
        rating: { avg: 4.9, count: 12 },
        badges: [{ type: 'top_rated', label: 'Top rated' }],
        reviews: [],
      },
    })

    renderRoute(<ShopProfile />, '/shop/:shopId', '/shop/shop-1')

    expect(await screen.findByText('Miles Automotive')).toBeInTheDocument()
    expect(screen.getByText('$75.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/shop/shop-1`))
    expect(await screen.findByText('Shop profile link copied.')).toHaveAttribute('role', 'status')
    await user.click(screen.getAllByRole('button', { name: 'Book appointment' })[0])
    await waitFor(() => expect(screen.queryByText('Miles Automotive')).not.toBeInTheDocument())
  })
})
