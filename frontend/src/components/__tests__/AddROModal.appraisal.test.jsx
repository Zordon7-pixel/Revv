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
      if (url === '/customers') return Promise.resolve({ data: { customers: [{ id: 'customer-1', name: 'Miles Customer', phone: '7185550100', email: 'miles@example.com', sms_consent: true, sms_consent_at: '2026-10-01T12:00:00Z', sms_consent_method: 'written', sms_consent_by: 'staff-1', email_consent: false }] } })
      if (url === '/customers/customer-1/autofill') return Promise.resolve({ data: { customer: { id: 'customer-1', name: 'Miles Customer', phone: '7185550100', email: 'miles@example.com', sms_consent: true, sms_consent_at: '2026-10-01T12:00:00Z', sms_consent_method: 'written', sms_consent_by: 'staff-1', email_consent: false }, vehicles: [{ id: 'vehicle-1', year: 2024, make: 'Toyota', model: 'Camry', vin: '1HGBH41JXMN109186' }] } })
      if (url === '/ros') return Promise.resolve({ data: { ros: [] } })
      if (url === '/ros/turnaround-estimate') return Promise.resolve({ data: {} })
      return Promise.resolve({ data: {} })
    })
    api.post.mockImplementation((url) => {
      if (url === '/insurance-ocr/parse') return Promise.resolve({ data: { parsed: { sms_consent: true, sms_consent_method: 'verbal', sms_consent_at: '2000-01-01T00:00:00Z', sms_consent_by: 'ocr-spoof', customer_name: 'Miles Customer', customer_phone: '(718) 555-0100', customer_email: 'miles@example.com', vehicle_year: '2024', vehicle_make: 'Toyota', vehicle_model: 'Camry', vin: '1HGBH41JXMN109186', insurance_company: 'Progressive', claim_number: 'CLM-100', policy_number: 'POL-200', detected_format: 'ccc', needs_review: false, review_reasons: [], line_items: [{ type: 'parts', description: 'Bumper cover', quantity: 1, unit_price: 500 }], estimate_totals: { parts: 500, total_cost_of_repairs: 550, deductible: 100, net_cost_of_repairs: 450 } } } })
      if (url === '/ros') return Promise.resolve({ data: { id: 'ro-1', ro_number: 'RO-100' } })
      if (url === '/claim-tracker/ro/ro-1/evidence') return Promise.resolve({ data: { evidence: {} } })
      if (url === '/estimate-metadata/metadata/ro-1') return Promise.resolve({ data: { success: true } })
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
    await user.click(screen.getByRole('button', { name: 'Read Appraisal' }))
    await screen.findByDisplayValue('Miles Customer')
    await user.click(screen.getByRole('button', { name: 'Use Details in New RO' }))
    await screen.findByText(/Matched Miles Customer/)
    expect(screen.getByLabelText('Customer agreed to texts')).toBeChecked()
    expect(screen.getByLabelText('SMS consent method')).toHaveValue('written')

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
    const roPayload = api.post.mock.calls.find(([url]) => url === '/ros')[1]
    for (const key of ['sms_consent', 'sms_consent_method', 'sms_consent_at', 'sms_consent_by']) expect(roPayload).not.toHaveProperty(key)
    expect(api.post.mock.calls.filter(([url]) => url === '/claim-tracker/ro/ro-1/evidence')).toHaveLength(2)
    expect(api.post).toHaveBeenCalledWith('/estimate-metadata/metadata/ro-1', {
      adjuster_totals: expect.objectContaining({ total_cost_of_repairs: 550 }),
      import_draft: expect.objectContaining({
        source: 'appraisal_quick_intake',
        source_files: ['page-1.jpg', 'page-2.jpg'],
        line_items: [expect.objectContaining({ description: 'Bumper cover' })],
      }),
    })
  })

  it.each([
    ['new', undefined],
    ['existing', false],
    ['existing', null],
    ['existing', undefined],
    ['existing', true],
  ])('appraisal consent stays explicit for %s customers (%s)', async (kind, stored) => {
    const get = api.get.getMockImplementation()
    const post = api.post.getMockImplementation()
    api.get.mockImplementation(async url => {
      const result = await get(url)
      if (url === '/customers') {
        result.data.customers = kind === 'new' ? [] : result.data.customers.map(c => ({ ...c, sms_consent: stored, sms_consent_at: null, sms_consent_method: null, sms_consent_by: null }))
      }
      if (url === '/customers/customer-1/autofill') Object.assign(result.data.customer, { sms_consent: stored, sms_consent_at: null, sms_consent_method: null, sms_consent_by: null })
      return result
    })
    api.post.mockImplementation((url, body) => {
      if (url === '/customers') return Promise.resolve({ data: { id: 'customer-new' } })
      if (url === '/vehicles') return Promise.resolve({ data: { id: 'vehicle-new' } })
      return post(url, body)
    })
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<MemoryRouter><AddROModal onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)
    await user.click(screen.getByRole('tab', { name: 'Appraisal Quick Intake' }))
    fireEvent.change(screen.getByLabelText('Appraisal files'), { target: { files: [new File(['one'], 'page.jpg', { type: 'image/jpeg' })] } })
    await user.click(screen.getByRole('button', { name: 'Read Appraisal' }))
    await screen.findByDisplayValue('Miles Customer')
    await user.click(screen.getByRole('button', { name: 'Use Details in New RO' }))
    expect(screen.getByLabelText(/Customer agreed to texts/i)).not.toBeChecked()
    expect(screen.getByText(/SMS consent unconfirmed/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await user.click(screen.getByRole('button', { name: 'Add Repair Order' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const roPayload = api.post.mock.calls.find(([url]) => url === '/ros')[1]
    for (const key of ['sms_consent', 'sms_consent_method', 'sms_consent_at', 'sms_consent_by']) expect(roPayload).not.toHaveProperty(key)
    if (kind === 'new') {
      const customerPayload = api.post.mock.calls.find(([url]) => url === '/customers')[1]
      for (const key of ['sms_consent', 'sms_consent_method', 'sms_consent_at', 'sms_consent_by']) expect(customerPayload).not.toHaveProperty(key)
    }
    else expect(api.post).not.toHaveBeenCalledWith('/customers', expect.anything())
  })
  async function openAuthorizationFlow({ duplicate = false, failure = false } = {}) {
    const get = api.get.getMockImplementation()
    const post = api.post.getMockImplementation()
    api.get.mockImplementation((url) => url === '/agreements/templates' ? Promise.resolve({ data: { templates: [{ id: 'shop-agreement', title: 'This shop authorization' }] } }) : get(url))
    api.post.mockImplementation((url, body) => {
      if (url === '/ros' && duplicate) return Promise.resolve({ data: { id: 'ro-1', ro_number: 'RO-100', duplicate_warning: { count: 1 } } })
      if (url === '/agreements/ro/ro-1') return failure ? Promise.reject(new Error('Could not prepare agreement')) : Promise.resolve({ data: { signing_path: '/sign#qa-link' } })
      return post(url, body)
    })
    const user = userEvent.setup(), onSaved = vi.fn()
    render(<MemoryRouter><AddROModal presentation="page" onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)
    await user.click(await screen.findByRole('tab', { name: 'Appraisal Quick Intake' }))
    fireEvent.change(screen.getByLabelText('Appraisal files'), { target: { files: [new File(['one'], 'page.jpg', { type: 'image/jpeg' })] } })
    await user.click(screen.getByRole('button', { name: 'Read Appraisal' }))
    await screen.findByDisplayValue('Miles Customer')
    await user.click(screen.getByRole('button', { name: 'Use Details in New RO' }))
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await screen.findByRole('region', { name: 'New RO authorizations' })
    await user.selectOptions(screen.getByLabelText('Authorization for this RO'), 'shop-agreement')
    await user.click(screen.getByRole('button', { name: 'Add Repair Order' }))
    return { user, onSaved }
  }
  it('places shop authorizations at creation and hands the saved RO to signing without creating twice', async () => {
    const { user, onSaved } = await openAuthorizationFlow({ failure: true })
    expect(await screen.findByText('RO RO-100 created')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Repair Order' })).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Prepare signing link' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Prepare signing link' }))
    expect(api.post.mock.calls.filter(([url]) => url === '/ros')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Open repair order' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({id:'ro-1'}))
  })
  it('keeps the selected authorization after a duplicate warning without recreating the RO', async () => {
    const { user } = await openAuthorizationFlow({ duplicate: true })
    await user.click(await screen.findByRole('button', { name: 'Keep New RO' }))
    expect(await screen.findByText('RO RO-100 created')).toBeInTheDocument()
    expect(screen.getByLabelText('Shop agreement')).toHaveValue('shop-agreement')
    expect(api.post.mock.calls.filter(([url]) => url === '/ros')).toHaveLength(1)
  })

})
