import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

import api from '../../lib/api'
import SupplementFinderPanel from '../SupplementFinderPanel'

describe('SupplementFinderPanel staged appraisal reuse', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('analyzes the estimate staged during RO creation without another upload', async () => {
    const user = userEvent.setup()
    const onFileSupplement = vi.fn()
    const lineItems = [
      { type: 'parts', description: 'Bumper cover', quantity: 1, unit_price: 500 },
      { type: 'labor', description: 'Body labor', quantity: 2, unit_price: 75 },
    ]
    api.get.mockResolvedValue({
      data: {
        metadata: {
          import_draft: {
            source: 'appraisal_quick_intake',
            line_items: lineItems,
            estimate_totals: { total_cost_of_repairs: 650 },
          },
        },
      },
    })
    api.post.mockResolvedValue({
      data: {
        flags: [],
        summary: {
          total_insurance_allowed: 650,
          total_shop_value: 650,
          total_supplement_opportunity: 50,
        },
      },
    })

    render(<SupplementFinderPanel roId="ro-1" variant="hero" onFileSupplement={onFileSupplement} />)

    expect(await screen.findByRole('status')).toHaveTextContent('ready with 2 estimate lines')
    expect(screen.getByRole('status')).toHaveTextContent('no upload is needed')
    const analyze = screen.getByRole('button', { name: 'Analyze RO' })
    expect(analyze).toBeEnabled()
    await user.click(analyze)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/insurance-ocr/analyze', {
      line_items: lineItems,
    }))
    expect(await screen.findAllByText('$650.00')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'File supplement' }))
    expect(onFileSupplement).toHaveBeenCalledOnce()
  })

  it('can parse and analyze appraisal pages already attached to an existing RO', async () => {
    const user = userEvent.setup()
    api.get.mockImplementation((url) => {
      if (url === '/estimate-metadata/metadata/ro-1') return Promise.resolve({ data: { metadata: null } })
      if (url === '/claim-tracker/ro/ro-1') return Promise.resolve({
        data: {
          evidence: [{
            media_url: '/uploads/claim-evidence/estimate.jpg',
            media_type: 'photo',
            mime_type: 'image/jpeg',
            caption: 'Appraisal quick intake source · estimate-page.jpg',
          }],
        },
      })
      return Promise.resolve({ data: {} })
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['image'], { type: 'image/jpeg' })),
    }))
    api.post.mockImplementation((url) => {
      if (url === '/insurance-ocr/parse') return Promise.resolve({
        data: {
          parsed: {
            insurance_company: 'GEICO',
            line_items: [{ type: 'labor', description: 'Repair door', quantity: 2, unit_price: 75 }],
          },
        },
      })
      if (url === '/insurance-ocr/analyze') return Promise.resolve({
        data: {
          flags: [],
          summary: { total_insurance_allowed: 150, total_shop_value: 150, total_supplement_opportunity: 0 },
        },
      })
      return Promise.resolve({ data: {} })
    })

    render(<SupplementFinderPanel roId="ro-1" />)

    await user.click(await screen.findByRole('button', { name: 'Use Attached Appraisal' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`${window.location.origin}/uploads/claim-evidence/estimate.jpg`))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/insurance-ocr/analyze', {
      line_items: [{ type: 'labor', description: 'Repair door', quantity: 2, unit_price: 75 }],
    }))
    expect(await screen.findByText(/Source: GEICO upload/)).toBeInTheDocument()
  })
})
