import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('mounts the five-beat demo over real local desktop and mobile video', () => {
    setReducedMotion(false)
    const { container } = render(<RevvDemo />)

    expect(screen.getByText('This RO is $1,450 short.')).toBeInTheDocument()
    expect(screen.getByText('-$1,450')).toHaveClass('is-critical')
    expect(screen.getByRole('button', { name: 'Restart product tour with sound' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay product tour muted' })).toBeInTheDocument()

    const video = container.querySelector('video.revv-demo-video')
    expect(video).toBeInTheDocument()
    expect(video).toHaveAttribute('poster', '/demo/revv-product-tour-poster.png')
    expect(video).toHaveAttribute('playsinline')
    expect(video.querySelectorAll('source')).toHaveLength(2)
    expect(container.querySelector('.revv-demo-grid')).not.toBeInTheDocument()
    expect(container.querySelector('.revv-demo-sweep')).not.toBeInTheDocument()

    const sources = [...container.querySelectorAll('video source, audio')]
      .map((node) => node.getAttribute('src'))
      .filter(Boolean)
    expect(sources).toEqual([
      '/demo/revv-product-tour-mobile.mp4',
      '/demo/revv-product-tour-desktop.mp4',
      '/demo/revv-wow-tv-ad.mp3',
    ])
    expect(sources.every((source) => source.startsWith('/demo/'))).toBe(true)

    for (const source of sources) {
      expect(statSync(resolve(process.cwd(), 'public', source.slice(1))).size, source).toBeGreaterThan(50_000)
    }
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
