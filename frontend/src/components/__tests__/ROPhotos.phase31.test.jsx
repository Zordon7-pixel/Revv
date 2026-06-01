import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../lib/imageUpload', () => ({
  optimizeImageForUpload: vi.fn((file) => Promise.resolve(file)),
}))

import api from '../../lib/api'
import ROPhotos from '../ROPhotos'

describe('ROPhotos uploaded media URLs', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.delete.mockReset()
    window.alert = vi.fn()
    window.confirm = vi.fn(() => true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('resolves relative upload URLs and replaces broken photos with fallback UI', async () => {
    api.get.mockResolvedValue({
      data: {
        photos: [{
          id: 'photo-1',
          photo_url: '/uploads/photos/miles-damage.jpg',
          photo_type: 'damage',
          caption: 'Bumper damage',
        }],
      },
    })

    render(<ROPhotos roId="ro-1" isAdmin />)

    const img = await screen.findByAltText('Bumper damage')
    expect(img).toHaveAttribute('src', `${window.location.origin}/uploads/photos/miles-damage.jpg`)

    fireEvent.error(img)

    expect(await screen.findByText('Photo unavailable')).toBeInTheDocument()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('renders a load error when the photo API fails', async () => {
    api.get.mockRejectedValue({
      response: { data: { error: 'Failed to load photos' } },
      message: 'request failed',
    })

    render(<ROPhotos roId="ro-1" isAdmin />)

    expect(await screen.findByText('Failed to load photos')).toBeInTheDocument()
    expect(screen.getByText('No photos yet')).toBeInTheDocument()
  })
})
