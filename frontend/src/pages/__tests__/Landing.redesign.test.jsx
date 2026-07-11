import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

    expect(screen.getByRole('heading', { name: 'Collision shop operations, in one live system.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Watch REVV run/ })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Start free/i })[0]).toHaveAttribute('href', '/shop-register')
    expect(screen.getByText('One live repair order')).toBeInTheDocument()
    expect(screen.getByText('$199')).toBeInTheDocument()
    expect(screen.getByAltText('REVV wordmark')).toHaveAttribute('src', '/revv-wordmark-transparent.png')

    const externalMedia = [...document.querySelectorAll('img, audio')]
      .map((node) => node.getAttribute('src'))
      .filter((source) => /^https?:\/\//.test(source || ''))
    expect(externalMedia).toHaveLength(0)
  })

  it('preserves the mobile waitlist submission flow', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter><Landing /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'shop@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Notify me' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/waitlist', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'shop@example.com', source: 'landing-download' }),
    })))
    expect(await screen.findByText('You are on the list.')).toBeInTheDocument()
  })
})
