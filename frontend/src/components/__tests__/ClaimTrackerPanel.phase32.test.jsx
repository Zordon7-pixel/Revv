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

import api from '../../lib/api'
import ClaimTrackerPanel from '../ClaimTrackerPanel'

describe('ClaimTrackerPanel evidence media', () => {
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

  it('resolves relative evidence URLs and replaces broken evidence with fallback UI', async () => {
    api.get.mockResolvedValue({
      data: {
        evidence: [{
          id: 'evidence-1',
          media_url: '/uploads/claim-evidence/miles-evidence.jpg',
          media_type: 'photo',
          caption: 'Supplement photo',
          created_at: '2026-06-03T12:00:00.000Z',
          uploaded_by_name: 'Miles Tech',
        }],
        contacts: [],
        disputes: [],
      },
    })

    render(<ClaimTrackerPanel roId="ro-1" canEdit />)

    const image = await screen.findByAltText('Supplement photo')
    expect(image).toHaveAttribute('src', `${window.location.origin}/uploads/claim-evidence/miles-evidence.jpg`)

    fireEvent.error(image)

    expect(await screen.findByText('Evidence unavailable')).toBeInTheDocument()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('shows a safe load error without using browser alerts', async () => {
    api.get.mockRejectedValue({
      response: { data: { error: 'Could not load claim tracker data' } },
      message: 'request failed',
    })

    render(<ClaimTrackerPanel roId="ro-1" canEdit />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load claim tracker data')
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('renders appraisal PDFs as document links instead of broken images', async () => {
    api.get.mockResolvedValue({
      data: {
        evidence: [{
          id: 'document-1',
          media_url: '/uploads/claim-evidence/appraisal.pdf',
          media_type: 'document',
          mime_type: 'application/pdf',
          caption: 'Appraisal quick intake source',
          created_at: '2026-07-10T12:00:00.000Z',
          uploaded_by_name: 'Miles Owner',
        }],
        contacts: [],
        disputes: [],
      },
    })

    render(<ClaimTrackerPanel roId="ro-1" canEdit />)

    const link = await screen.findByRole('link', { name: 'Open appraisal document' })
    expect(link).toHaveAttribute('href', `${window.location.origin}/uploads/claim-evidence/appraisal.pdf`)
    expect(screen.getByText('Document')).toBeInTheDocument()
  })

  it('opens claim photos above the sidebar and can delete them from the viewer', async () => {
    const user = userEvent.setup()
    api.get.mockResolvedValue({
      data: {
        evidence: [{
          id: 'evidence-1',
          media_url: '/uploads/claim-evidence/supplement.jpg',
          media_type: 'photo',
          caption: 'Supplement damage',
          created_at: '2026-07-10T12:00:00.000Z',
          uploaded_by_name: 'Shop Tech',
        }],
        contacts: [],
        disputes: [],
      },
    })
    api.delete.mockResolvedValue({ data: { ok: true } })

    render(<ClaimTrackerPanel roId="ro-1" canEdit />)
    await user.click(await screen.findByRole('button', { name: 'View Supplement damage' }))

    const dialog = screen.getByRole('dialog', { name: 'Supplement damage' })
    const overlay = dialog.closest('[data-photo-lightbox="true"]')
    expect(overlay?.parentElement).toBe(document.body)
    expect(overlay).toHaveClass('z-[200]')
    expect(screen.getByTestId('photo-lightbox-image')).toHaveClass('max-h-[64dvh]', 'max-w-[min(76vw,60rem)]')

    await user.click(screen.getByRole('button', { name: 'Delete photo' }))
    expect(window.confirm).toHaveBeenCalledWith('Delete this evidence file?')
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/claim-tracker/evidence/evidence-1'))
  })
})
