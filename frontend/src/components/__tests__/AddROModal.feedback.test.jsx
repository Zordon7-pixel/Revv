import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../AppraisalQuickIntake', () => ({ default: ({ onApply }) => <button onClick={() => onApply({
  fields: { customer_name: 'OCR Customer', customer_phone: '', customer_email: '', customer_address: '',
    year: '2024', make: 'Toyota', model: 'Camry', vin: '', color: '', plate: '', mileage: '', claim_number: '',
    policy_number: '', adjuster_name: '', adjuster_phone: '', adjuster_email: '', deductible: '',
    sms_consent: true, sms_consent_method: 'written', sms_consent_by: 'untrusted' }, files: []
})}>Apply OCR fixture</button> }))

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
    }[key] || key),
  }),
}))

import api from '../../lib/api'
import AddROModal, { shouldUseCompactKeyboardEditor } from '../AddROModal'

describe('AddROModal feedback handling', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.get.mockImplementation((url) => {
      if (url === '/customers') return Promise.resolve({ data: { customers: [] } })
      return Promise.reject(new Error(`Unhandled api.get call in test: ${url}`))
    })
    window.alert = vi.fn()
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.touch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses compact entry only for a touch landscape soft keyboard reduction', () => {
    const baseWindow = {
      innerWidth: 1024,
      innerHeight: 248,
      orientation: 90,
      navigator: { maxTouchPoints: 5 },
      document: { documentElement: { dataset: { touch: 'true' } } },
      screen: { width: 1024, height: 768 },
      visualViewport: { height: 248, offsetTop: 0 },
    }

    expect(shouldUseCompactKeyboardEditor(baseWindow)).toBe(true)
    expect(shouldUseCompactKeyboardEditor({
      ...baseWindow,
      innerHeight: 700,
      visualViewport: { height: 700, offsetTop: 0 },
    })).toBe(false)
    expect(shouldUseCompactKeyboardEditor({
      ...baseWindow,
      innerHeight: 700,
      screen: { width: 768, height: 1024 },
      visualViewport: { height: 700, offsetTop: 0 },
    })).toBe(false)
    expect(shouldUseCompactKeyboardEditor({
      ...baseWindow,
      orientation: 0,
      screen: { width: 768, height: 1024 },
    })).toBe(false)
    expect(shouldUseCompactKeyboardEditor({
      ...baseWindow,
      navigator: { maxTouchPoints: 0 },
      document: { documentElement: { dataset: { touch: 'false' } } },
    })).toBe(false)
  })

  it('shows customer-selection validation inline instead of using a browser alert', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <AddROModal onClose={vi.fn()} onSaved={vi.fn()} />
      </MemoryRouter>
    )

    await screen.findByRole('button', { name: /Next/i })
    await user.click(screen.getByRole('button', { name: /Next/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Please select a customer or choose New.')
    expect(window.alert).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('requires an email before enabling customer email status updates', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <AddROModal onClose={vi.fn()} onSaved={vi.fn()} />
      </MemoryRouter>
    )

    await user.click(await screen.findByRole('button', { name: /^New$/i }))
    await user.type(screen.getByPlaceholderText('John Smith'), 'Miles Customer')
    await user.click(screen.getByLabelText(/Customer consents to receive email status updates/i))
    await user.click(screen.getByRole('button', { name: /Next/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Customer email is required for email status updates.')
    expect(window.alert).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  const smsCheckbox = () => screen.getByLabelText(/Customer agreed to texts/i)

  async function saveManualRO(user) {
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await user.type(screen.getByPlaceholderText('2021'), '2024')
    await user.type(screen.getByPlaceholderText('Toyota'), 'Toyota')
    await user.type(screen.getByPlaceholderText('Camry'), 'Camry')
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await user.click(screen.getByRole('button', { name: 'Add Repair Order' }))
  }

  function mockSaves() {
    api.post.mockImplementation(async url => ({ data: { id: url === '/customers' ? 'new-customer' : url === '/vehicles' ? 'vehicle-1' : 'ro-1' } }))
  }

  it.each([false, true])('new customer requires an explicit SMS choice (%s)', async consent => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    mockSaves()
    render(<MemoryRouter><AddROModal onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)
    expect(smsCheckbox()).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: /^New$/i }))
    expect(smsCheckbox()).not.toBeChecked()
    await user.type(screen.getByPlaceholderText('John Smith'), 'Synthetic Customer')
    if (consent) {
      await user.click(smsCheckbox())
      await user.click(screen.getByRole('button', { name: /Next/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Choose verbal or written SMS consent.')
      expect(api.post).not.toHaveBeenCalled()
      await user.selectOptions(screen.getByLabelText('SMS consent method'), 'written')
    }
    await saveManualRO(user)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const payload = api.post.mock.calls.find(([url]) => url === '/customers')[1]
    expect(payload).toEqual({ name: 'Synthetic Customer', phone: '', email: '', address: '', insurance_company: 'Progressive', policy_number: null, email_consent: false, preferred_contact_method: consent ? 'sms' : 'none', ...(consent ? { sms_consent: true, sms_consent_method: 'written' } : {}) })
    const roPayload = api.post.mock.calls.find(([url]) => url === '/ros')[1]
    expect(Object.keys(roPayload).filter(key => key.startsWith('sms_'))).toEqual([])
  })

  it('clears prior consent on New, Existing selection reset, and repeated New clicks', async () => {
    const user = userEvent.setup()
    const customer = { id: 'existing', name: 'Synthetic Existing', sms_consent: true, sms_consent_method: 'verbal', sms_consent_at: '2026-10-01T12:00:00Z', sms_consent_by: 'staff-1' }
    api.get.mockImplementation(async url => ({ data: url === '/customers' ? { customers: [customer] } : { customer, vehicles: [] } }))
    render(<MemoryRouter><AddROModal onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter>)
    await screen.findByRole('option', { name: /Synthetic Existing/ })
    await user.selectOptions(screen.getByRole('combobox'), 'existing')
    await waitFor(() => expect(smsCheckbox()).toBeChecked())
    await user.selectOptions(screen.getByRole('option', { name: '— select —' }).parentElement, '')
    expect(smsCheckbox()).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: /^New$/i }))
    expect(smsCheckbox()).not.toBeChecked()
    await user.click(smsCheckbox())
    await user.click(screen.getByRole('button', { name: /^New$/i }))
    expect(smsCheckbox()).not.toBeChecked()
    await user.click(smsCheckbox())
    await user.click(screen.getByRole('button', { name: 'Existing' }))
    await user.click(screen.getByRole('button', { name: /^New$/i }))
    expect(smsCheckbox()).not.toBeChecked()
  })

  it.each([true, false, null, undefined, 'true'])('legacy consent stays unconfirmed and is omitted on unrelated intake (%s)', async stored => {
    const user = userEvent.setup()
    const customer = { id: 'existing', name: 'Synthetic Existing', sms_consent: stored }
    api.get.mockImplementation(async url => ({ data: url === '/customers' ? { customers: [customer] } : { customer, vehicles: [] } }))
    mockSaves()
    const onSaved = vi.fn()
    render(<MemoryRouter><AddROModal onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)
    await screen.findByRole('option', { name: /Synthetic Existing/ })
    await user.selectOptions(screen.getByRole('combobox'), 'existing')
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers/existing/autofill'))
    expect(smsCheckbox()).not.toBeChecked()
    await saveManualRO(user)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.post).not.toHaveBeenCalledWith('/customers', expect.anything())
    const payload = api.post.mock.calls.find(([url]) => url === '/ros')[1]
    expect(Object.keys(payload).filter(key => key.startsWith('sms_'))).toEqual([])
    expect(payload).not.toHaveProperty('email_consent')
    expect(payload).not.toHaveProperty('preferred_contact_method')
  })

  it.each(['unchanged', 'revoke', 'method'])('confirmed intake: %s sends only intentional evidence', async action => {
    const user = userEvent.setup()
    const customer = { id: 'existing', name: 'Confirmed', sms_consent: true, sms_consent_at: '2026-10-01T12:00:00Z', sms_consent_method: 'verbal', sms_consent_by: 'staff-1' }
    api.get.mockImplementation(async url => ({ data: url === '/customers' ? { customers: [customer] } : { customer, vehicles: [] } }))
    mockSaves()
    const onSaved = vi.fn()
    render(<MemoryRouter><AddROModal onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)
    await screen.findByRole('option', { name: /Confirmed/ })
    await user.selectOptions(screen.getByRole('combobox'), 'existing')
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers/existing/autofill'))
    expect(smsCheckbox()).toBeChecked()
    if (action === 'revoke') await user.click(smsCheckbox())
    if (action === 'method') await user.selectOptions(screen.getByLabelText('SMS consent method'), 'written')
    await saveManualRO(user)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const payload = api.post.mock.calls.find(([url]) => url === '/ros')[1]
    expect(Object.fromEntries(Object.entries(payload).filter(([key]) => key.startsWith('sms_')))).toEqual(
      action === 'unchanged' ? {} : action === 'revoke' ? { sms_consent: false } : { sms_consent: true, sms_consent_method: 'written' })
  })

  it('OCR resets prior attestation and ignores evidence in extracted fields', async () => {
    const user = userEvent.setup(); mockSaves()
    const onSaved = vi.fn()
    render(<MemoryRouter><AddROModal onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'New' }))
    await user.click(smsCheckbox())
    await user.selectOptions(screen.getByLabelText('SMS consent method'), 'verbal')
    await user.click(screen.getByRole('tab', { name: 'Appraisal Quick Intake' }))
    await user.click(screen.getByRole('button', { name: 'Apply OCR fixture' }))
    expect(await screen.findByDisplayValue('OCR Customer')).toBeInTheDocument()
    expect(smsCheckbox()).not.toBeChecked()
    expect(screen.queryByLabelText('SMS consent method')).not.toBeInTheDocument()
    await user.click(smsCheckbox())
    expect(screen.getByLabelText('SMS consent method')).toHaveValue('')
    await user.click(smsCheckbox())
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await user.click(screen.getByRole('button', { name: /Next/i }))
    await user.click(screen.getByRole('button', { name: 'Add Repair Order' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    for (const [url, payload] of api.post.mock.calls.filter(([url]) => ['/customers', '/ros'].includes(url))) {
      expect(Object.keys(payload).filter(key => key.startsWith('sms_')), url).toEqual([])
    }
  })

  it('switching customers drops the prior method and preserves email preferences on unrelated save', async () => {
    const user = userEvent.setup(); mockSaves()
    const rows = [{ id: 'one', name: 'One', sms_consent: false }, { id: 'two', name: 'Two', sms_consent: true, email_consent: true, email: 'two@example.com' }]
    api.get.mockImplementation(async url => ({ data: url === '/customers' ? { customers: rows } : { customer: url.includes('/two/') ? rows[1] : rows[0], vehicles: [] } }))
    const onSaved = vi.fn()
    render(<MemoryRouter><AddROModal onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>)
    await screen.findByRole('option', { name: /One/ })
    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'one')
    await user.click(smsCheckbox())
    await user.selectOptions(screen.getByLabelText('SMS consent method'), 'written')
    await user.selectOptions(select, 'two')
    await waitFor(() => expect(screen.getByLabelText(/Customer consents to receive email/)).toBeChecked())
    expect(smsCheckbox()).not.toBeChecked()
    await user.click(smsCheckbox())
    expect(screen.getByLabelText('SMS consent method')).toHaveValue('')
    await user.click(smsCheckbox())
    await saveManualRO(user)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const payload = api.post.mock.calls.find(([url]) => url === '/ros')[1]
    expect(payload.customer_id).toBe('two')
    expect(payload).not.toHaveProperty('sms_consent')
    expect(payload).not.toHaveProperty('email_consent')
    expect(payload).not.toHaveProperty('preferred_contact_method')
  })

  it('re-centers the focused field after the iPad landscape keyboard changes the visual viewport', () => {
    vi.useFakeTimers()
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const visualViewport = new EventTarget()
    Object.assign(visualViewport, {
      width: 1024,
      height: 248,
      offsetTop: 74,
      offsetLeft: 0,
    })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    })

    try {
      render(
        <MemoryRouter>
          <AddROModal presentation="page" onClose={vi.fn()} onSaved={vi.fn()} />
        </MemoryRouter>
      )

      fireEvent.click(screen.getByRole('button', { name: /^New$/i }))
      const nameInput = screen.getByPlaceholderText('John Smith')
      const scrollIntoView = vi.fn()
      nameInput.scrollIntoView = scrollIntoView
      nameInput.getBoundingClientRect = () => ({ top: 390, bottom: 434 })

      act(() => {
        nameInput.focus()
        fireEvent.focusIn(nameInput)
        visualViewport.dispatchEvent(new Event('resize'))
        vi.runAllTimers()
      })

      expect(document.activeElement).toBe(nameInput)
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'center',
        inline: 'nearest',
        behavior: 'auto',
      })
    } finally {
      if (originalVisualViewport) {
        Object.defineProperty(window, 'visualViewport', originalVisualViewport)
      } else {
        delete window.visualViewport
      }
    }
  })

  it('shows a focused one-field editor for the iPad landscape soft keyboard and syncs the value', () => {
    vi.useFakeTimers()
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    const originalOrientation = Object.getOwnPropertyDescriptor(window, 'orientation')
    const originalScreenWidth = Object.getOwnPropertyDescriptor(window.screen, 'width')
    const originalScreenHeight = Object.getOwnPropertyDescriptor(window.screen, 'height')
    const visualViewport = new EventTarget()
    Object.assign(visualViewport, { width: 1024, height: 248, offsetTop: 0, offsetLeft: 0 })

    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 248 })
    Object.defineProperty(window, 'orientation', { configurable: true, value: 90 })
    Object.defineProperty(window.screen, 'width', { configurable: true, value: 1024 })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 768 })
    document.documentElement.dataset.touch = 'true'

    try {
      render(
        <MemoryRouter>
          <AddROModal presentation="page" onClose={vi.fn()} onSaved={vi.fn()} />
        </MemoryRouter>
      )

      fireEvent.click(screen.getByRole('button', { name: /^New$/i }))
      const originalNameInput = screen.getByPlaceholderText('John Smith')

      act(() => {
        originalNameInput.focus()
        fireEvent.focusIn(originalNameInput)
        visualViewport.dispatchEvent(new Event('resize'))
        vi.runAllTimers()
      })

      const compactGroup = screen.getByRole('group', { name: /Editing Full Name/i })
      const compactInput = compactGroup.querySelector('[data-ro-compact-input="true"]')
      expect(compactInput).not.toBeNull()

      fireEvent.change(compactInput, { target: { value: 'Miles Customer' } })
      expect(originalNameInput).toHaveValue('Miles Customer')

      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      expect(screen.queryByRole('group', { name: /Editing Full Name/i })).not.toBeInTheDocument()
      expect(originalNameInput).toHaveValue('Miles Customer')
    } finally {
      const restore = (target, key, descriptor) => {
        if (descriptor) Object.defineProperty(target, key, descriptor)
        else delete target[key]
      }
      restore(window, 'visualViewport', originalVisualViewport)
      restore(window, 'innerWidth', originalInnerWidth)
      restore(window, 'innerHeight', originalInnerHeight)
      restore(window, 'orientation', originalOrientation)
      restore(window.screen, 'width', originalScreenWidth)
      restore(window.screen, 'height', originalScreenHeight)
    }
  })
})
