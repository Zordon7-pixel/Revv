import { afterEach, describe, expect, it, vi } from 'vitest'
import { installKeyboardFocusGuard, scrollFocusedElementIntoView } from '../keyboardFocus'

function createFocusWindow({ viewportHeight = 320 } = {}) {
  const document = window.document.implementation.createHTMLDocument('keyboard-focus')
  const listeners = {}
  const visualListeners = {}
  return {
    innerHeight: 844,
    document,
    visualViewport: {
      height: viewportHeight,
      offsetTop: 0,
      addEventListener: vi.fn((type, fn) => { visualListeners[type] = fn }),
      removeEventListener: vi.fn(),
    },
    setTimeout: (fn) => {
      fn()
      return 1
    },
    clearTimeout: vi.fn(),
    addEventListener: vi.fn((type, fn) => { listeners[type] = fn }),
    removeEventListener: vi.fn(),
    listeners,
    visualListeners,
  }
}

describe('keyboard focus guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scrolls a focused text input into view when the keyboard reduces the visual viewport', () => {
    const mockWindow = createFocusWindow()
    const input = mockWindow.document.createElement('input')
    input.type = 'text'
    input.scrollIntoView = vi.fn()
    input.getBoundingClientRect = () => ({ top: 500, bottom: 540 })
    mockWindow.document.body.appendChild(input)
    input.focus()

    const scrolled = scrollFocusedElementIntoView(mockWindow)

    expect(scrolled).toBe(true)
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  })

  it('wires focus and visualViewport listeners and cleans them up', () => {
    const mockWindow = createFocusWindow()
    const input = mockWindow.document.createElement('input')
    input.type = 'text'
    input.scrollIntoView = vi.fn()
    input.getBoundingClientRect = () => ({ top: 500, bottom: 540 })
    mockWindow.document.body.appendChild(input)
    input.focus()

    const cleanup = installKeyboardFocusGuard(mockWindow)
    input.dispatchEvent(new Event('focusin', { bubbles: true }))

    expect(input.scrollIntoView).toHaveBeenCalled()

    cleanup()

    expect(mockWindow.visualViewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(mockWindow.visualViewport.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(mockWindow.removeEventListener).toHaveBeenCalledWith('orientationchange', expect.any(Function))
  })
})
