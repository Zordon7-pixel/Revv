import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
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
    }[key] || key),
  }),
}))

import api from '../../lib/api'
import AddROModal from '../AddROModal'

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
    vi.useRealTimers()
    vi.restoreAllMocks()
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
})
