import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GaugeArc, Logo, Money, StatInstrument, StatusBadge, formatMoneyCents } from '../ui'

describe('REVV design-system primitives', () => {
  it('renders server-authoritative integer cents without float drift', () => {
    expect(formatMoneyCents(996925)).toBe('$9,969.25')
    expect(formatMoneyCents(-100000)).toBe('-$1,000.00')
    expect(formatMoneyCents('not-cents')).toBe('—')
    render(<Money cents={896925} />)
    expect(screen.getByText('$8,969.25')).toHaveAttribute('data-numeric', 'true')
  })

  it('uses the approved transparent logo assets', () => {
    render(<><Logo variant="mark" /><Logo variant="wordmark" alt="REVV wordmark" /></>)
    expect(screen.getByAltText('REVV')).toHaveAttribute('src', '/revv-mark-transparent.png')
    expect(screen.getByAltText('REVV wordmark')).toHaveAttribute('src', '/revv-wordmark-transparent.png')
  })

  it('keeps status semantics and accessible gauge values explicit', () => {
    render(
      <>
        <StatusBadge status="closed" claimStatus="total_loss" />
        <GaugeArc value={75} max={100} label="Monthly goal" />
        <StatInstrument label="Revenue MTD" value={<Money cents={125000} />} gauge={{ value: 50, max: 100 }} />
      </>
    )
    expect(screen.getByText('Total loss closed')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Monthly goal' })).toHaveAttribute('aria-valuenow', '75')
    expect(screen.getByRole('meter', { name: 'Revenue MTD progress' })).toBeInTheDocument()
  })
})
