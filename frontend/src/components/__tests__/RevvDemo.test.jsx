import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Buffer } from 'node:buffer'
import { readFileSync, statSync } from 'node:fs'
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

  it('mounts an unobstructed media row above the five-beat readout and controls', () => {
    setReducedMotion(false)
    const { container } = render(<RevvDemo />)

    expect(screen.getByText('This RO is $1,450 short.')).toBeInTheDocument()
    expect(screen.getByText('-$1,450')).toHaveClass('is-critical')
    expect(screen.getByRole('button', { name: 'Turn product tour sound on' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay product tour' })).toBeInTheDocument()

    const video = container.querySelector('video.revv-demo-video')
    const media = video.closest('.revv-demo-media')
    expect(video).toBeInTheDocument()
    expect(media.nextElementSibling).toHaveClass('revv-demo-readout')
    expect(media.nextElementSibling.nextElementSibling).toHaveClass('revv-demo-controls')
    expect(video).toHaveAttribute('poster', '/demo/revv-product-tour-poster.png')
    expect(video).toHaveAttribute('playsinline')
    expect(video.querySelectorAll('source')).toHaveLength(2)
    expect(container.querySelector('.revv-demo-grid')).not.toBeInTheDocument()
    expect(container.querySelector('.revv-demo-sweep')).not.toBeInTheDocument()

    const sources = [...container.querySelectorAll('video source')]
      .map((node) => node.getAttribute('src'))
      .filter(Boolean)
    expect(sources).toEqual([
      '/demo/revv-product-tour-mobile.mp4',
      '/demo/revv-product-tour-desktop.mp4',
    ])
    expect(sources.every((source) => source.startsWith('/demo/'))).toBe(true)
    expect(container.querySelector('audio')).not.toBeInTheDocument()

    for (const source of sources) {
      const file = resolve(process.cwd(), 'public', source.slice(1))
      expect(statSync(file).size, source).toBeGreaterThan(50_000)
      expect(readFileSync(file).includes(Buffer.from('soun')), `${source} has an embedded audio track`).toBe(true)
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
