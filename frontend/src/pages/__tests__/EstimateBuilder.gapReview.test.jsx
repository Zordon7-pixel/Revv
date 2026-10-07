import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}))

import api from '../../lib/api'
import EstimateBuilder from '../EstimateBuilder'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/estimate-builder/ro-1']}>
      <Routes>
        <Route path="/estimate-builder/:roId" element={<EstimateBuilder />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Estimate Builder gap review', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset())
    window.alert = vi.fn()
    api.get.mockImplementation((url) => {
      if (url === '/estimate-items/ro-1') return Promise.resolve({ data: { items: [{ id: 'line-1', description: 'Front bumper cover', type: 'parts', quantity: 1, unit_price: 500, sort_order: 0 }], summary: { grand_total: 500 } } })
      if (url === '/ros/ro-1') return Promise.resolve({ data: { id: 'ro-1', ro_number: 'RO-100', customer: { name: 'Miles Customer' } } })
      if (url === '/estimate-metadata/metadata/ro-1') return Promise.resolve({ data: { metadata: null } })
      if (url === '/estimate-items/ro-1/opportunities') return Promise.resolve({ data: { summary: null, flags: [] } })
      if (url === '/estimate-assistant/gap-review/ro-1') return Promise.resolve({
        data: {
          ready: true,
          reviewed_line_count: 1,
          evidence_sources: ['Damage diagram', 'RO photos'],
          gaps: [{
            code: 'LI-103',
            description: 'Radar sensor aiming/calibration',
            confidence: 'high',
            reason: 'Matches front bumper but no similar estimate line was found.',
            draft: { type: 'labor', description: 'Radar sensor aiming/calibration', quantity: 1.2, unit_price: 0, taxable: false },
          }],
        },
      })
      return Promise.resolve({ data: {} })
    })
    api.post.mockResolvedValue({
      data: {
        item: { id: 'line-2', type: 'labor', description: 'Radar sensor aiming/calibration', quantity: 1.2, unit_price: 0, taxable: false, sort_order: 1 },
        summary: { grand_total: 500 },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('adds a suggested gap as a zero-dollar draft', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Radar sensor aiming/calibration')).toBeInTheDocument()
    expect(screen.getByText(/Unit price remains \$0.00/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Add Draft/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/estimate-items/ro-1', expect.objectContaining({
      type: 'labor',
      description: 'Radar sensor aiming/calibration',
      quantity: 1.2,
      unit_price: 0,
      taxable: false,
    })))
    expect(window.alert).not.toHaveBeenCalled()
  })
})

describe('Estimate Builder AI fallback explanation', () => {
  afterEach(cleanup)

  it.each([
    ['ai_estimate_disabled', /AI estimate fallback is disabled for this shop/],
    ['ai_estimate_quota', /temporarily unavailable because the shop limit was reached/],
    ['ai_estimate_unavailable', /AI estimate fallback is temporarily unavailable/],
    ['ai_estimate_call_limit', /AI estimate fallback reached its attempt limit/],
    ['ai_estimate_input_limit', /The estimate exceeds the AI input limit/],
    ['estimate_pages_unreadable', /Some estimate pages could not be read/],
  ])('shows %s and keeps manual entry available', async (reason, message) => {
    Object.values(api).forEach(mock => mock.mockReset())
    api.get.mockImplementation(url => Promise.resolve({ data:
      url === '/ros/ro-1' ? { id: 'ro-1', ro_number: 'RO-SYNTHETIC' }
        : url === '/estimate-items/ro-1' ? { items: [], summary: {} }
          : {},
    }))
    api.post.mockImplementation(url => Promise.resolve({ data: url === '/insurance-ocr/parse'
      ? { success: true, needs_review: true, parsed: { line_items: [], estimate_totals: null,
        needs_review: true, review_reasons: [reason], ai_fallback_reason: reason } }
      : { success: true, flags: [], summary: {} },
    }))
    const user = userEvent.setup()
    const view = renderPage()
    const file = new File(['synthetic-original'], 'estimate.png', { type: 'image/png' })
    await waitFor(() => expect(view.container.querySelector('input[type="file"]')).not.toBeNull())
    await user.upload(view.container.querySelector('input[type="file"]'), file)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText(/No line items extracted. Review the original estimate and add lines manually/)).toBeInTheDocument()
    const form = api.post.mock.calls.find(([url]) => url === '/insurance-ocr/parse')[1]
    expect(form.getAll('estimate_images')).toEqual([file])
    expect(api.post.mock.calls.some(([url]) => url.includes('/import'))).toBe(false)
    expect(api.patch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close estimate import' }))
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })
})
