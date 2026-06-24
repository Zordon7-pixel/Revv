import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => ({
      'ro.addRO': 'Add Repair Order',
      'common.back': 'Back',
      'common.cancel': 'Cancel',
      'common.name': 'Name',
      'common.vehicle': 'Vehicle',
      'common.year': 'Year',
      'common.make': 'Make',
      'common.model': 'Model',
    }[key] || key),
  }),
}))

import api from '../../lib/api'
import AddROModal from '../AddROModal'

describe('AddROModal feedback handling', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.get.mockImplementation((url) => {
      if (url === '/customers') return Promise.resolve({ data: { customers: [] } })
      return Promise.reject(new Error(`Unhandled api.get call in test: ${url}`))
    })
    window.alert = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows customer-selection validation inline instead of using a browser alert', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <AddROModal onClose={vi.fn()} onSaved={vi.fn()} />
      </MemoryRouter>
    )

    await screen.findByRole('button', { name: /Next/i })
    await user.click(screen.getByRole('button', { name: /Next/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Please select a customer or choose New.')
    expect(window.alert).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })
})
