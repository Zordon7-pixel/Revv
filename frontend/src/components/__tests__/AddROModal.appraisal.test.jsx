import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => ({
      'ro.addRO': 'Add Repair Order',
      'common.back': 'Back',
      'common.cancel': 'Cancel',
      'common.name': 'Name',
      'common.vehicle': 'Vehicle',
      'common.year': 'Year',
      'common.make': 'Make',
      'common.model': 'Model',
      'common.vin': 'VIN',
    }[key] || key),
  }),
}))

import api from '../../lib/api'
import AddROModal from '../AddROModal'

describe('AddROModal appraisal quick intake', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.get.mockImplementation((url) => {
      if (url === '/customers') return Promise.resolve({ data: { customers: [{ id: 'customer-1', name: 'Miles Customer', phone: '7185550100', email: 'miles@example.com', sms_consent: true, email_consent: false }] } })
      if (url === '/customers/customer-1/autofill') return Promise.resolve({ data: { customer: { id: 'customer-1', name: 'Miles Customer', phone: '7185550100', email: 'miles@example.com', sms_consent: true, email_consent: false }, vehicles: [{ id: 'vehicle-1', year: 2024, make: 'Toyota', model: 'Camry', vin: '1HGBH41JXMN109186' }] } })
      if (url === '/ros') return Promise.resolve({ data: { ros: [] } })
      if (url === '/ros/turnaround-estimate') return Promise.resolve({ data: {} })
      return Promise.resolve({ data: {} })
    })
    api.post.mockImplementation((url) => {
      if (url === '/insurance-ocr/parse') return Promise.resolve({ data: { parsed: { customer_name: 'Miles Customer', customer_phone: '(718) 555-0100', customer_email: 'miles@example.com', vehicle_year: '2024', vehicle_make: 'Toyota', vehicle_model: 'Camry', vin: '1HGBH41JXMN109186', insurance_company: 'Progressive', claim_number: 'CLM-100', policy_number: 'POL-200' } } })
      if (url === '/ros') return Promise.resolve({ data: { id: 'ro-1', ro_number: 'RO-100' } })
      if (url === '/claim-tracker/ro/ro-1/evidence') return Promise.resolve({ data: { evidence: {} } })
      return Promise.reject(new Error(`Unexpected POST ${url}`))
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('reuses matched records, creates one RO, and attaches every appraisal page', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<MemoryRouter><AddROModal presentation="page" onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)

    await user.click(await screen.findByRole('tab', { name: 'Appraisal Quick Intake' }))
    const files = [
      new File(['one'], 'page-1.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'page-2.jpg', { type: 'image/jpeg' }),
    ]
    fireEvent.change(screen.getByLabelText('Appraisal files'), { target: { files } })
    await user.click(screen.getByRole('button', { name: 'Read Intake Details' }))
    await screen.findByDisplayValue('Miles Customer')
    await user.click(screen.getByRole('button', { name: 'Use Details in New RO' }))
    await screen.findByText(/Matched Miles Customer/)

    await user.click(screen.getByRole('button', { name: /Next/ }))
    await screen.findByText(/Step 2/)
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await screen.findByText(/Step 3/)
    expect(screen.queryByText('AI Estimate Suggestions')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add Repair Order' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'ro-1' })))
    expect(api.post).not.toHaveBeenCalledWith('/customers', expect.anything())
    expect(api.post).not.toHaveBeenCalledWith('/vehicles', expect.anything())
    expect(api.post).toHaveBeenCalledWith('/ros', expect.objectContaining({
      customer_id: 'customer-1',
      vehicle_id: 'vehicle-1',
      claim_number: 'CLM-100',
      policy_number: 'POL-200',
    }))
    expect(api.post.mock.calls.filter(([url]) => url === '/claim-tracker/ro/ro-1/evidence')).toHaveLength(2)
  })
})
