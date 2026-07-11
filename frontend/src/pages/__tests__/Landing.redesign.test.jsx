import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../components/LeadCaptureForm', () => ({
  default: () => <form aria-label="Lead capture form" />,
}))

import Landing from '../Landing'

describe('Landing redesign', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps the real REVV brand, registration CTA, features, and local demo visible', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Run every repair. Protect every dollar.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Watch the product tour/ })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Start free/i })[0]).toHaveAttribute('href', '/shop-register')
    expect(screen.getByText('One live repair order')).toBeInTheDocument()
    expect(screen.getByText('$199')).toBeInTheDocument()
    expect(screen.getByAltText('REVV wordmark')).toHaveAttribute('src', '/revv-wordmark-transparent.png')
    const video = document.querySelector('video.revv-demo-video')
    const hero = document.querySelector('.landing-hero')
    const productTour = document.querySelector('#product-tour')
    expect(video).toBeInTheDocument()
    expect(hero).not.toContainElement(video)
    expect(productTour).toContainElement(video)
    expect(productTour).toHaveClass('landing-demo-stage')

    const externalMedia = [...document.querySelectorAll('img, video, video source, audio')]
      .map((node) => node.getAttribute('src'))
      .filter((source) => /^https?:\/\//.test(source || ''))
    expect(externalMedia).toHaveLength(0)
  })

  it('keeps only the advertising and conversion sections needed to sell REVV', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)

    expect(screen.getByText('Protect profit before delivery')).toBeInTheDocument()
    expect(screen.getByText('Proof ready when insurers ask')).toBeInTheDocument()
    expect(screen.getByText('Fourteen days free. No credit card or setup fee.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bring one real workflow. We will show you the difference.' })).toBeInTheDocument()
    expect(screen.queryByText('Get native app early access')).not.toBeInTheDocument()
    expect(screen.queryByText('One accountable workflow')).not.toBeInTheDocument()
  })
})
