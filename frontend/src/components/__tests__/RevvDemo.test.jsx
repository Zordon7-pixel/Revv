import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import RevvDemo from '../RevvDemo'

function setReducedMotion(matches) {
  const listeners = new Set()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_event, listener) => listeners.add(listener),
    removeEventListener: (_event, listener) => listeners.delete(listener),
  })))
}

describe('RevvDemo', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('mounts the five-beat demo using only local assets', () => {
    setReducedMotion(false)
    const { container } = render(<RevvDemo />)

    expect(screen.getByText('This RO is $1,450 short.')).toBeInTheDocument()
    expect(screen.getByText('-$1,450')).toHaveClass('is-critical')
    expect(screen.getByRole('button', { name: 'Play demo with sound' })).toBeInTheDocument()
    expect(container.querySelectorAll('.revv-demo-screen')).toHaveLength(5)

    const sources = [...container.querySelectorAll('img, audio')]
      .map((node) => node.getAttribute('src'))
      .filter(Boolean)
    expect(sources).not.toHaveLength(0)
    expect(sources.every((source) => source.startsWith('/demo/'))).toBe(true)
  })

  it('shows the final static frame when reduced motion is requested', () => {
    setReducedMotion(true)
    const { container } = render(<RevvDemo />)

    expect(container.firstChild).toHaveAttribute('data-reduced-motion', 'true')
    expect(container.firstChild).toHaveAttribute('data-beat', 'cta')
    expect(screen.getByText('Run every repair. Protect every dollar.')).toBeInTheDocument()
    expect(screen.getByText('IN SYNC')).toHaveClass('is-brand')
    expect(screen.getByText('0:30 / 0:30')).toBeInTheDocument()
  })
})
