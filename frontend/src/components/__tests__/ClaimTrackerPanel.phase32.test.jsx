import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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
})
