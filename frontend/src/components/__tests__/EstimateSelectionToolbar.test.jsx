import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EstimateSelectionToolbar from '../EstimateSelectionToolbar'

const items = [
  { type: 'parts', description: 'Bumper cover' },
  { type: 'labor', description: 'Body labor' },
  { type: 'other', description: 'Paint materials' },
]

function Harness() {
  const [selected, setSelected] = useState({ 0: true, 1: true, 2: true })
  return (
    <>
      <EstimateSelectionToolbar items={items} selected={selected} onChange={setSelected} />
      <output data-testid="selection">{JSON.stringify(selected)}</output>
    </>
  )
}

describe('EstimateSelectionToolbar', () => {
  it('switches between parts-only, all, and clear without losing the item index mapping', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('selection')).toHaveTextContent('{"0":false,"1":false,"2":false}')

    await user.click(screen.getByRole('button', { name: 'Select Parts Only' }))
    expect(screen.getByTestId('selection')).toHaveTextContent('{"0":true,"1":false,"2":false}')

    await user.click(screen.getByRole('button', { name: 'Select All' }))
    expect(screen.getByTestId('selection')).toHaveTextContent('{"0":true,"1":true,"2":true}')
    expect(screen.getByText('3 of 3 estimate lines selected')).toBeInTheDocument()
  })
})
