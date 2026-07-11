import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const frontendRoot = process.cwd()
const tokenizedFiles = [
  'src/pages/Login.jsx',
  'src/pages/Register.jsx',
  'src/pages/ResetPassword.jsx',
  'src/pages/Terms.jsx',
  'src/pages/Privacy.jsx',
  'src/pages/SmsTerms.jsx',
  'src/components/ErrorBoundary.jsx',
  'src/components/CarryoverModal.jsx',
  'src/components/FeedbackButton.jsx',
  'src/components/HelpDesk.jsx',
  'src/components/HelpPanel.jsx',
  'src/components/LeadCaptureForm.jsx',
  'src/components/LibraryAutocomplete.jsx',
  'src/components/PhotoLightbox.jsx',
  'src/components/ROPhotos.jsx',
]

function read(relativePath) {
  return readFileSync(resolve(frontendRoot, relativePath), 'utf8')
}

describe('redesign token conformance', () => {
  it('keeps migrated auth, legal, and fallback surfaces off raw and legacy palettes', () => {
    for (const relativePath of tokenizedFiles) {
      const source = read(relativePath)
      expect(source, relativePath).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(source, relativePath).not.toMatch(/(?:bg|text|border|ring|from|to|via)-(?:indigo|blue|slate|yellow)-/)
      expect(source, relativePath).not.toMatch(/bg-gradient-/)
    }
  })

  it('uses the shared REVV mark on authentication surfaces', () => {
    for (const relativePath of ['src/pages/Login.jsx', 'src/pages/Register.jsx', 'src/pages/ResetPassword.jsx']) {
      const source = read(relativePath)
      expect(source, relativePath).toMatch(/import \{ Logo \} from '\.\.\/components\/ui'/)
      expect(source, relativePath).toMatch(/<Logo variant="mark"/)
    }
  })

  it('keeps the unmounted legacy customer portal removed', () => {
    expect(existsSync(resolve(frontendRoot, 'src/pages/Portal.jsx'))).toBe(false)
    expect(read('src/App.jsx')).not.toMatch(/\.\/pages\/Portal/)
  })

  it('keeps shared overlays above page-local stacking contexts without browser alerts', () => {
    for (const relativePath of [
      'src/components/CarryoverModal.jsx',
      'src/components/FeedbackButton.jsx',
      'src/components/HelpDesk.jsx',
      'src/components/HelpPanel.jsx',
      'src/components/PhotoLightbox.jsx',
    ]) {
      expect(read(relativePath), relativePath).toMatch(/AppOverlay/)
    }

    for (const relativePath of [
      'src/components/CarryoverModal.jsx',
      'src/components/FeedbackButton.jsx',
      'src/components/ROPhotos.jsx',
    ]) {
      expect(read(relativePath), relativePath).not.toMatch(/\balert\s*\(/)
    }
  })
})
