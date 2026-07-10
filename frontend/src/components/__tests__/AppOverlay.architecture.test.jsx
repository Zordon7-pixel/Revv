import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AppOverlay from '../AppOverlay'

const AUTHENTICATED_OVERLAY_FILES = [
  'src/pages/EstimateBuilder.jsx',
  'src/pages/StorageHold.jsx',
  'src/pages/Settings.jsx',
  'src/pages/Users.jsx',
  'src/pages/Schedule.jsx',
  'src/pages/TimeClock.jsx',
  'src/pages/Customers.jsx',
  'src/pages/VehicleDiagnostics.jsx',
  'src/components/PartsSearch.jsx',
  'src/components/PaymentModal.jsx',
  'src/components/EstimateImportWizard.jsx',
  'src/components/CarryoverModal.jsx',
  'src/components/FeedbackButton.jsx',
  'src/components/HelpDesk.jsx',
  'src/components/HelpPanel.jsx',
]

describe('AppOverlay architecture', () => {
  it('portals dialogs to document.body above the sidebar and handles Escape', () => {
    const onClose = vi.fn()
    render(<main data-testid="page"><AppOverlay label="Test dialog" onClose={onClose}><div>Dialog content</div></AppOverlay></main>)

    const overlay = screen.getByRole('dialog', { name: 'Test dialog' })
    expect(overlay).toHaveAttribute('data-app-overlay', 'true')
    expect(overlay.parentElement).toBe(document.body)
    expect(overlay.className).toContain('z-[150]')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps authenticated modal surfaces out of page-local fixed stacking contexts', () => {
    for (const relativePath of AUTHENTICATED_OVERLAY_FILES) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
      expect(source, relativePath).toContain('AppOverlay')
      expect(source, relativePath).not.toContain('className="fixed inset-0')
    }
  })
})
