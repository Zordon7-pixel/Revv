import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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

  it('opens a bounded body-level viewer above the sidebar with working zoom controls', async () => {
    const user = userEvent.setup()
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
    await user.click(await screen.findByRole('button', { name: 'View Bumper damage' }))

    const dialog = screen.getByRole('dialog', { name: 'Bumper damage' })
    const overlay = dialog.closest('[data-photo-lightbox="true"]')
    expect(overlay?.parentElement).toBe(document.body)
    expect(overlay).toHaveClass('z-[200]')
    expect(screen.getByTestId('photo-lightbox-image')).toHaveClass('max-h-[64dvh]', 'max-w-[min(76vw,60rem)]')
    expect(screen.getByText('100%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('125%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close photo preview' }))
    expect(screen.queryByRole('dialog', { name: 'Bumper damage' })).not.toBeInTheDocument()
  })

  it('keeps a touch-visible delete action and removes the uploaded photo', async () => {
    const user = userEvent.setup()
    api.get
      .mockResolvedValueOnce({
        data: {
          photos: [{
            id: 'photo-1',
            photo_url: '/uploads/photos/miles-damage.jpg',
            photo_type: 'damage',
            caption: 'Bumper damage',
          }],
        },
      })
      .mockResolvedValue({ data: { photos: [] } })
    api.delete.mockResolvedValue({ data: { ok: true } })

    render(<ROPhotos roId="ro-1" isAdmin />)
    await user.click(await screen.findByRole('button', { name: 'Delete Bumper damage' }))

    expect(window.confirm).toHaveBeenCalledWith('Delete this photo?')
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/photos/photo-1'))
    expect(await screen.findByText('No photos yet')).toBeInTheDocument()
  })
})
