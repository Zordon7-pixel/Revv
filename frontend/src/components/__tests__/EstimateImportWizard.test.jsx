import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api', () => ({
  default: {
    post: vi.fn(),
  },
}))

import api from '../../lib/api'
import EstimateImportWizard from '../EstimateImportWizard'

describe('EstimateImportWizard', () => {
  beforeEach(() => {
    api.post.mockReset()
  })

  it('parses an uploaded estimate and creates a repair order from reviewed fields', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    api.post
      .mockResolvedValueOnce({
        data: {
          parsed: {
            customer_name: 'Avery Stone',
            customer_phone: '5551234567',
            vehicle_year: '2022',
            vehicle_make: 'Honda',
            vehicle_model: 'Accord',
            vin: '1HGCV1F34NA000001',
            insurance_company: 'Progressive',
            claim_number: 'CLM-22',
            estimate_totals: { deductible: 500 },
            line_items: [
              { type: 'labor', description: 'R&I bumper cover', quantity: 2, unit_price: 75 },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          ro: { id: 'ro-1', ro_number: 'RO-2026-0001' },
          imported_line_count: 1,
        },
      })

    const { container } = render(<EstimateImportWizard onClose={vi.fn()} onImported={onImported} />)

    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['pdf'], 'ccc-estimate.pdf', { type: 'application/pdf' })] },
    })
    await user.click(screen.getByRole('button', { name: /Parse Estimate/i }))

    expect(await screen.findByDisplayValue('Avery Stone')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1HGCV1F34NA000001')).toBeInTheDocument()
    expect(screen.getByDisplayValue('R&I bumper cover')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Create Repair Order/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect(api.post).toHaveBeenNthCalledWith(1, '/insurance-ocr/parse', expect.any(FormData), expect.any(Object))
    expect(api.post).toHaveBeenNthCalledWith(2, '/ros/import-estimate', expect.objectContaining({
      customer: expect.objectContaining({ name: 'Avery Stone' }),
      vehicle: expect.objectContaining({ make: 'Honda', model: 'Accord', vin: '1HGCV1F34NA000001' }),
      insurance: expect.objectContaining({ company: 'Progressive', claim_number: 'CLM-22' }),
      line_items: [expect.objectContaining({ description: 'R&I bumper cover', type: 'labor' })],
    }))
    expect(onImported).toHaveBeenCalledWith({ id: 'ro-1', ro_number: 'RO-2026-0001' })
  })
})
