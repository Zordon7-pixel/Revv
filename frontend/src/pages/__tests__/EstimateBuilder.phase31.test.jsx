import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { AI_CONFIG_ERROR } from '../../lib/safeErrors'

function renderEstimateBuilder() {
  return render(
    <MemoryRouter initialEntries={['/estimate-builder/ro-1']}>
      <Routes>
        <Route path="/estimate-builder/:roId" element={<EstimateBuilder />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('EstimateBuilder OCR import', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.put.mockReset()
    api.delete.mockReset()
    api.patch.mockReset()
    window.alert = vi.fn()

    api.get.mockImplementation((url) => {
      if (url === '/estimate-items/ro-1') return Promise.resolve({ data: { items: [], summary: null } })
      if (url === '/ros/ro-1') return Promise.resolve({ data: { id: 'ro-1', ro_number: 'RO-3101', customer: { name: 'Miles Automotive' } } })
      if (url === '/estimate-metadata/metadata/ro-1') return Promise.resolve({ data: { metadata: null } })
      if (url === '/estimate-items/ro-1/opportunities') return Promise.resolve({ data: { summary: null, flags: [] } })
      return Promise.resolve({ data: {} })
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders a safe inline OCR error instead of alerting provider key text', async () => {
    const key = ['sk', 'proj-secret'].join('-')
    const docsUrl = ['https://platform', 'openai', 'com/account/api-keys'].join('.')
    const keyError = ['Incorrect', 'API key provided'].join(' ')
    api.post.mockRejectedValue({
      response: {
        data: {
          error: `401 ${keyError}: ${key}. You can find your API key at ${docsUrl}.`,
        },
      },
    })

    const { container } = renderEstimateBuilder()

    await screen.findByRole('heading', { name: 'Estimate Builder' })
    const fileInput = container.querySelector('input[type="file"]')
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['pdf'], '15 Benz CLS 400.pdf', { type: 'application/pdf' })],
      },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(AI_CONFIG_ERROR)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/insurance-ocr/parse', expect.any(FormData), expect.any(Object)))
    expect(screen.queryByText(/sk-(?:proj-)?|platform\.[a-z]+\.com|api key/i)).not.toBeInTheDocument()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('opens flagged CCC results for review instead of treating them as a failed upload', async () => {
    api.post
      .mockResolvedValueOnce({
        data: {
          success: true,
          needs_review: true,
          detected_format: 'ccc',
          parsed: {
            detected_format: 'ccc',
            needs_review: true,
            review_reasons: ['subtotal_does_not_reconcile'],
            line_items: [
              { type: 'parts', description: 'Front bumper cover', quantity: 1, unit_price: 450 },
            ],
          },
        },
      })
      .mockResolvedValueOnce({ data: { success: true, flags: [], summary: {} } })

    const { container } = renderEstimateBuilder()
    await screen.findByRole('heading', { name: 'Estimate Builder' })

    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: {
        files: [new File(['pdf'], 'ccc-estimate.pdf', { type: 'application/pdf' })],
      },
    })

    expect(await screen.findByText('Review this CCC estimate before import')).toBeInTheDocument()
    expect(screen.getByText('The extracted subtotal does not match the sum of its estimate buckets.')).toBeInTheDocument()
    expect(screen.getByText('Front bumper cover')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 item' })).toBeEnabled()
    expect(api.post.mock.calls.some(([url]) => String(url).startsWith('/estimate-items/'))).toBe(false)
    expect(screen.queryByText('CCC estimate needs review before import.')).not.toBeInTheDocument()
  })

  it('keeps the landscape import dialog above the app shell and makes every selection shortcut work', async () => {
    api.post.mockImplementation((url) => {
      if (url === '/insurance-ocr/parse') return Promise.resolve({
        data: {
          success: true,
          parsed: {
            line_items: [
              { type: 'parts', description: 'Front bumper cover', quantity: 1, unit_price: 5038.72 },
              { type: 'labor', description: 'Body and refinish labor', quantity: 42.5, unit_price: 60 },
              { type: 'other', description: 'Paint materials', quantity: 1, unit_price: 1322.88 },
            ],
            estimate_totals: {
              parts: 5038.72,
              body_labor_cost: 1476,
              paint_labor_cost: 1074,
              mechanical_labor_cost: 90,
              frame_labor_cost: 120,
              glass_labor_cost: 30,
              paint_supplies_cost: 1322.88,
              other_charges: 5,
              sales_tax_cost: 812.65,
              total_cost_of_repairs: 9969.25,
              deductible: 1000,
              net_cost_of_repairs: 8969.25,
            },
          },
        },
      })
      if (url === '/insurance-ocr/analyze') return Promise.resolve({ data: { success: true, flags: [], summary: {} } })
      return Promise.resolve({ data: {} })
    })

    const { container } = renderEstimateBuilder()
    await screen.findByRole('heading', { name: 'Estimate Builder' })
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['pdf'], 'estimate.pdf', { type: 'application/pdf' })] },
    })

    const dialog = await screen.findByRole('dialog', { name: 'Insurance estimate import' })
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.className).toContain('z-[150]')
    expect(screen.getByRole('button', { name: 'Import 3 items' })).toBeEnabled()
    expect(within(dialog).getByText('Gross estimate')).toBeInTheDocument()
    expect(screen.getAllByText('$9,969.25').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Import 0 items' })).toBeDisabled()
    expect(screen.getAllByRole('checkbox').every((checkbox) => !checkbox.checked)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Select Parts Only' }))
    expect(screen.getByRole('button', { name: 'Import 1 item' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Select Front bumper cover' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Body and refinish labor' })).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }))
    expect(screen.getByRole('button', { name: 'Import 3 items' })).toBeEnabled()
    expect(screen.getAllByRole('checkbox').every((checkbox) => checkbox.checked)).toBe(true)
  })

  it('syncs extracted estimate totals and profit inputs to the RO after line import', async () => {
    api.post.mockImplementation((url, payload) => {
      if (url === '/insurance-ocr/parse') return Promise.resolve({
        data: {
          success: true,
          parsed: {
            line_items: [
              { type: 'labor', description: 'Body labor', quantity: 2, unit_price: 60 },
            ],
            estimate_totals: {
              body_labor_cost: 120,
              total_cost_of_repairs: 120,
              net_cost_of_repairs: 120,
            },
          },
        },
      })
      if (url === '/insurance-ocr/analyze') return Promise.resolve({ data: { success: true, flags: [], summary: {} } })
      if (url === '/estimate-items/ro-1') return Promise.resolve({
        data: { item: { id: 'line-1', ...payload }, summary: { grand_total: 120 } },
      })
      if (url === '/estimate-metadata/metadata/ro-1') return Promise.resolve({ data: { success: true } })
      if (url === '/estimate-items/ro-1/import-financials') return Promise.resolve({
        data: {
          summary: { total: 120, grand_total: 120 },
          financials: { labor_cost: 120, total: 120, estimate_amount: 120, true_profit: 0 },
        },
      })
      return Promise.resolve({ data: {} })
    })

    const { container } = renderEstimateBuilder()
    await screen.findByRole('heading', { name: 'Estimate Builder' })
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['pdf'], 'estimate.pdf', { type: 'application/pdf' })] },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 item' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/estimate-metadata/metadata/ro-1', {
      adjuster_totals: expect.objectContaining({ total_cost_of_repairs: 120 }),
    }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/estimate-items/ro-1/import-financials'))
    expect(await screen.findByText(/Estimate revenue and profit inputs synced to this RO/i)).toBeInTheDocument()
  })
})
