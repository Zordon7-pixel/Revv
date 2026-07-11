import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api', () => ({
  default: { post: vi.fn() },
}))

import api from '../../lib/api'
import AppraisalQuickIntake from '../AppraisalQuickIntake'

describe('AppraisalQuickIntake', () => {
  beforeEach(() => {
    api.post.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('reads multiple pages once and carries editable intake fields plus the estimate draft', async () => {
    const onApply = vi.fn().mockResolvedValue()
    const user = userEvent.setup()
    api.post.mockResolvedValue({
      data: {
        parsed: {
          customer_name: 'Miles Customer',
          customer_phone: '718-555-0100',
          vehicle_year: '2024',
          vehicle_make: 'Toyota',
          vehicle_model: 'Camry',
          insurance_company: 'Progressive',
          claim_number: 'CLM-100',
          detected_format: 'ccc',
          line_items: [{ type: 'parts', description: 'Bumper cover', quantity: 1, unit_price: 500 }],
          estimate_totals: { total_cost_of_repairs: 550, deductible: 100, net_cost_of_repairs: 450 },
        },
      },
    })

    render(<AppraisalQuickIntake onApply={onApply} />)
    const files = [
      new File(['page 1'], 'appraisal-1.jpg', { type: 'image/jpeg' }),
      new File(['page 2'], 'appraisal-2.jpg', { type: 'image/jpeg' }),
    ]
    fireEvent.change(screen.getByLabelText('Appraisal files'), { target: { files } })
    await user.click(screen.getByRole('button', { name: 'Read Appraisal' }))

    await screen.findByDisplayValue('Miles Customer')
    expect(screen.getByText('2 of 12 pages selected')).toBeInTheDocument()
    const body = api.post.mock.calls[0][1]
    expect(body.get('mode')).toBeNull()
    expect(body.getAll('estimate_images')).toHaveLength(2)
    expect(screen.queryByRole('heading', { name: 'Line Items' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 estimate line')
    expect(screen.getByRole('status')).toHaveTextContent('You will not need to upload these pages again')

    fireEvent.change(screen.getByLabelText('Claim number'), { target: { value: 'CLM-101' } })
    await user.click(screen.getByRole('button', { name: 'Use Details in New RO' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(onApply.mock.calls[0][0].fields.claim_number).toBe('CLM-101')
    expect(onApply.mock.calls[0][0].files).toHaveLength(2)
    expect(onApply.mock.calls[0][0].estimateDraft).toEqual(expect.objectContaining({
      claim_number: 'CLM-101',
      line_items: [expect.objectContaining({ description: 'Bumper cover' })],
      estimate_totals: expect.objectContaining({ total_cost_of_repairs: 550 }),
    }))
  })
})
