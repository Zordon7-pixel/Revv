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
