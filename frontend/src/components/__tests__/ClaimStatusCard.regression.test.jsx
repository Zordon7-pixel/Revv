import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../lib/api', () => ({
  default: {
    patch: vi.fn(),
  },
}))

import ClaimStatusCard from '../ClaimStatusCard'

describe('ClaimStatusCard defensive claim-status banners', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows total-loss handling when claim_status is total_loss even if workflow status is not', () => {
    render(
      <ClaimStatusCard
        ro={{ id: 'ro-1', status: 'in_progress', claim_status: 'total_loss' }}
        isAdmin={false}
        onUpdate={vi.fn()}
      />
    )

    expect(screen.getByText('Total Loss — Storage + Pickup / Release')).toBeInTheDocument()
    expect(screen.getByText(/No repair labor or deductible is collected/i)).toBeInTheDocument()
  })
})
