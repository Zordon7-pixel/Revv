import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api', () => ({
  default: {
    patch: vi.fn(),
  },
}))

import api from '../../lib/api'
import ClaimStatusCard from '../ClaimStatusCard'

describe('ClaimStatusCard total-loss flow', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('points total-loss ROs to storage and pickup/release', async () => {
    const user = userEvent.setup()
    const onOpenStorage = vi.fn()

    render(
      <ClaimStatusCard
        ro={{ id: 'ro-1', status: 'total_loss', claim_status: 'total_loss' }}
        isAdmin
        onUpdate={vi.fn()}
        onOpenStorage={onOpenStorage}
      />
    )

    expect(screen.getByText('Total Loss — Storage + Pickup / Release')).toBeInTheDocument()
    expect(screen.getByText(/No repair labor or deductible is collected/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open Storage Hold' }))

    expect(onOpenStorage).toHaveBeenCalled()
  })

  it('preserves the claim-status update payload when selecting total loss', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    api.patch.mockResolvedValue({
      data: {
        id: 'ro-1',
        status: 'total_loss',
        claim_status: 'total_loss',
        storage_hold: true,
      },
    })

    render(
      <ClaimStatusCard
        ro={{ id: 'ro-1', status: 'estimate', claim_status: 'approved' }}
        isAdmin
        onUpdate={onUpdate}
      />
    )

    await user.click(screen.getByRole('button', { name: /Total Loss/i }))

    expect(api.patch).toHaveBeenCalledWith('/ros/ro-1', { claim_status: 'total_loss' })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'total_loss',
      storage_hold: true,
    }))
  })
})
