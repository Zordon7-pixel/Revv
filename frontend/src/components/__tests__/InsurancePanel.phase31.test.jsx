import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}))

import api from '../../lib/api'
import InsurancePanel from '../InsurancePanel'
import { AI_CONFIG_ERROR } from '../../lib/safeErrors'

describe('InsurancePanel OCR import', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.patch.mockReset()
    api.get.mockResolvedValue({ data: { metadata: null } })
    window.alert = vi.fn()
    window.confirm = vi.fn(() => false)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows a safe message for provider auth failures without leaking key text', async () => {
    const user = userEvent.setup()
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

    const { container } = render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'Sedgwick', insurance_claim_number: 'CLM-1' }}
        onUpdated={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /Upload estimate photo/i }))
    const fileInput = container.querySelector('input[type="file"]')
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['pdf'], '15 Benz CLS 400.pdf', { type: 'application/pdf' })],
      },
    })

    await user.click(screen.getByRole('button', { name: /Extract Line Items with AI/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(AI_CONFIG_ERROR)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/insurance-ocr/parse', expect.any(FormData), expect.any(Object)))
    expect(screen.queryByText(/sk-(?:proj-)?|platform\.[a-z]+\.com|api key/i)).not.toBeInTheDocument()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('keeps flagged CCC line items available for review and explicit import', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValueOnce({
      data: {
        success: true,
        needs_review: true,
        detected_format: 'ccc',
        parsed: {
          detected_format: 'ccc',
          needs_review: true,
          review_reasons: ['total_cost_does_not_reconcile'],
          line_items: [
            { type: 'labor', description: 'Repair quarter panel', quantity: 3, unit_price: 75 },
          ],
        },
      },
    })

    const { container } = render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'Progressive', insurance_claim_number: 'CLM-1' }}
        onUpdated={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /Upload estimate photo/i }))
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['pdf'], 'ccc-estimate.pdf', { type: 'application/pdf' })] },
    })
    await user.click(screen.getByRole('button', { name: /Extract Line Items with AI/i }))

    expect(await screen.findByText('Review this CCC estimate before import')).toBeInTheDocument()
    expect(screen.getByText('The extracted gross repair total does not reconcile with the subtotal and taxes.')).toBeInTheDocument()
    expect(screen.getByText('Repair quarter panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 item' })).toBeEnabled()
    expect(api.post.mock.calls.some(([url]) => String(url).startsWith('/estimate-items/'))).toBe(false)
  })

  it('loads the appraisal staged during RO creation without another upload', async () => {
    api.get.mockResolvedValue({
      data: {
        metadata: {
          import_draft: {
            source: 'appraisal_quick_intake',
            detected_format: 'ccc',
            needs_review: true,
            review_reasons: ['ccc_line_grid_missing'],
            insurance_company: 'GEICO',
            claim_number: 'CLM-100',
            estimate_totals: { parts: 500, total_cost_of_repairs: 550 },
            line_items: [
              { type: 'parts', description: 'Bumper cover', quantity: 1, unit_price: 500 },
              { type: 'labor', description: 'Refinish bumper', quantity: 1.5, unit_price: 75 },
            ],
          },
        },
      },
    })

    render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'GEICO', insurance_claim_number: 'CLM-100' }}
        onUpdated={vi.fn()}
      />
    )

    expect(await screen.findByText(/Appraisal from RO creation is ready: 2 lines staged/)).toBeInTheDocument()
    expect(screen.getByText('Bumper cover')).toBeInTheDocument()
    expect(screen.getByText('Refinish bumper')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 2 items' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Upload estimate photos/i })).not.toBeInTheDocument()
  })

  it('reuses appraisal evidence already attached to an existing RO', async () => {
    const user = userEvent.setup()
    api.get.mockImplementation((url) => {
      if (url === '/estimate-metadata/metadata/ro-1') return Promise.resolve({ data: { metadata: null } })
      if (url === '/claim-tracker/ro/ro-1') return Promise.resolve({
        data: {
          evidence: [{
            id: 'evidence-1',
            media_url: '/uploads/claim-evidence/page-1.pdf',
            media_type: 'document',
            mime_type: 'application/pdf',
            caption: 'Appraisal quick intake source · GEICO-estimate.pdf',
          }],
        },
      })
      return Promise.resolve({ data: {} })
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' })),
    }))
    api.post.mockImplementation((url) => {
      if (url === '/insurance-ocr/parse') return Promise.resolve({
        data: {
          success: true,
          parsed: {
            detected_format: 'ccc',
            line_items: [{ type: 'parts', description: 'Front bumper cover', quantity: 1, unit_price: 500 }],
            estimate_totals: { parts: 500, total_cost_of_repairs: 550 },
          },
        },
      })
      return Promise.resolve({ data: {} })
    })

    render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'GEICO', insurance_claim_number: 'CLM-100' }}
        onUpdated={vi.fn()}
      />
    )

    const useAttached = await screen.findByRole('button', { name: 'Use 1 Attached Appraisal Page' })
    await user.click(useAttached)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`${window.location.origin}/uploads/claim-evidence/page-1.pdf`))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/insurance-ocr/parse', expect.any(FormData), expect.any(Object)))
    const parseBody = api.post.mock.calls.find(([url]) => url === '/insurance-ocr/parse')[1]
    expect(parseBody.getAll('estimate_images').map((file) => file.name)).toEqual(['GEICO-estimate.pdf'])
    expect(await screen.findByText('Front bumper cover')).toBeInTheDocument()
  })

  it('saves deductible as dollars instead of cents', async () => {
    const user = userEvent.setup()
    api.patch.mockResolvedValue({ data: { deductible: 1000 } })

    render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'Progressive', insurance_claim_number: 'CLM-1', deductible: 500 }}
        onUpdated={vi.fn()}
      />
    )

    const deductible = screen.getByLabelText(/Deductible/i)
    await user.clear(deductible)
    await user.type(deductible, '1000')
    await user.click(screen.getByRole('button', { name: /Save Insurance/i }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/ros/ro-1/insurance', expect.objectContaining({
      deductible: 1000,
    })))
    expect(api.patch.mock.calls[0][1].deductible).not.toBe(100000)
  })

  it('selects estimate categories and syncs complete financials from the Insurance tab', async () => {
    const user = userEvent.setup()
    const onUpdated = vi.fn()
    api.post.mockImplementation((url) => {
      if (url === '/insurance-ocr/parse') return Promise.resolve({
        data: {
          success: true,
          parsed: {
            line_items: [
              { type: 'parts', description: 'Bumper cover', quantity: 1, unit_price: 500 },
              { type: 'labor', description: 'Body labor', quantity: 2, unit_price: 60 },
              { type: 'other', description: 'Paint materials', quantity: 1, unit_price: 100 },
            ],
            estimate_totals: {
              parts: 500,
              body_labor_cost: 120,
              paint_supplies_cost: 100,
              sales_tax_cost: 20,
              total_cost_of_repairs: 740,
              deductible: 100,
              net_cost_of_repairs: 640,
            },
          },
        },
      })
      if (url === '/estimate-metadata/metadata/ro-1') return Promise.resolve({ data: { success: true } })
      if (url === '/estimate-items/ro-1/import-financials') return Promise.resolve({ data: { success: true } })
      if (url === '/estimate-items/ro-1') return Promise.resolve({ data: { item: {} } })
      return Promise.resolve({ data: {} })
    })

    const { container } = render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'Progressive', insurance_claim_number: 'CLM-1' }}
        onUpdated={onUpdated}
      />
    )

    await user.click(screen.getByRole('button', { name: /Upload estimate photo/i }))
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['pdf'], 'estimate.pdf', { type: 'application/pdf' })] },
    })
    await user.click(screen.getByRole('button', { name: /Extract Line Items with AI/i }))

    expect(await screen.findByText('Gross estimate')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Import 0 items' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Select Parts Only' }))
    expect(screen.getByRole('button', { name: 'Import 1 item' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Select All' }))
    await user.click(screen.getByRole('button', { name: 'Import 3 items' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/estimate-metadata/metadata/ro-1', {
      adjuster_totals: expect.objectContaining({ total_cost_of_repairs: 740 }),
      import_draft: null,
    }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/estimate-items/ro-1/import-financials'))
    expect(onUpdated).toHaveBeenCalled()
    expect(await screen.findByText('Estimate lines and financials imported to this RO.')).toBeInTheDocument()
  })

  it('validates supplement amount before requesting a supplement', async () => {
    const user = userEvent.setup()

    render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'Progressive', insurance_claim_number: 'CLM-1', supplement_amount: 0 }}
        onUpdated={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /Request Supplement/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a supplement amount greater than $0.00.')
    expect(api.post).not.toHaveBeenCalled()
    expect(window.alert).not.toHaveBeenCalled()
  })
})
