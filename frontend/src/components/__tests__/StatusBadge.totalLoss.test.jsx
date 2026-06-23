import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge, { displayStatusKey } from '../StatusBadge'

describe('StatusBadge total loss display', () => {
  it('keeps normal closed jobs separate from closed total losses', () => {
    expect(displayStatusKey('closed')).toBe('closed')
    expect(displayStatusKey('closed', 'total_loss')).toBe('closed_total_loss')

    const { rerender } = render(<StatusBadge status="closed" />)
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.queryByText('Total Loss Closed')).not.toBeInTheDocument()

    rerender(<StatusBadge status="closed" claimStatus="total_loss" />)
    expect(screen.getByText('Total Loss Closed')).toBeInTheDocument()
  })

  it('labels active total loss ROs clearly', () => {
    render(<StatusBadge status="total_loss" />)
    expect(screen.getByText('Total Loss')).toBeInTheDocument()
  })
})
