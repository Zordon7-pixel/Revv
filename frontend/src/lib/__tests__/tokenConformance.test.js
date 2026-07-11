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
  'src/components/InsurancePanel.jsx',
  'src/components/ROOperations.jsx',
  'src/components/ClaimTrackerPanel.jsx',
  'src/components/VehicleDiagram.jsx',
  'src/components/SupplementFinderPanel.jsx',
  'src/components/AppraisalQuickIntake.jsx',
  'src/components/EstimateFinancialReview.jsx',
  'src/components/PaymentModal.jsx',
  'src/components/PaymentPanel.jsx',
  'src/components/StatusBadge.jsx',
  'src/components/EstimateReviewWarning.jsx',
  'src/components/ClaimStatusCard.jsx',
  'src/components/EstimateImportWizard.jsx',
  'src/components/PartsSearch.jsx',
  'src/pages/ADASCalibration.jsx',
  'src/pages/Customers.jsx',
]

const phase6JFiles = [
  'src/components/PaymentPanel.jsx',
  'src/components/StatusBadge.jsx',
  'src/components/EstimateReviewWarning.jsx',
  'src/components/ClaimStatusCard.jsx',
  'src/components/EstimateImportWizard.jsx',
  'src/components/PartsSearch.jsx',
  'src/pages/ADASCalibration.jsx',
  'src/pages/Customers.jsx',
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

  it('keeps RO money and evidence workflows tokenized without weakening consequential gates', () => {
    const insurance = read('src/components/InsurancePanel.jsx')
    const operations = read('src/components/ROOperations.jsx')
    const tracker = read('src/components/ClaimTrackerPanel.jsx')
    const diagram = read('src/components/VehicleDiagram.jsx')

    expect(insurance).not.toMatch(/\balert\s*\(/)
    expect(operations).not.toMatch(/\balert\s*\(/)
    expect(insurance).toMatch(/window\.confirm/)
    expect(operations).toMatch(/window\.confirm/)
    expect(tracker).toMatch(/window\.confirm/)
    expect(existsSync(resolve(frontendRoot, 'src/components/PaymentModal.jsx'))).toBe(true)
    expect(read('src/components/PaymentModal.jsx')).toMatch(/AppOverlay/)
    expect(read('src/App.jsx')).not.toMatch(/PaymentModal/)
    expect(diagram).not.toMatch(/<linearGradient/)
  })

  it('keeps shared payment, status, estimate, parts, ADAS, and customer surfaces on semantic roles', () => {
    for (const relativePath of phase6JFiles) {
      const source = read(relativePath)
      expect(source, relativePath).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(source, relativePath).not.toMatch(/(?:bg|text|border|ring|from|to|via)-(?:indigo|blue|slate|yellow|red|green|emerald|amber|violet|purple|cyan|teal|orange|lime|pink|rose)-/)
      expect(source, relativePath).not.toMatch(/(?:bg-gradient-|<linearGradient|\balert\s*\()/)
    }

    const payment = read('src/components/PaymentPanel.jsx')
    const parts = read('src/components/PartsSearch.jsx')
    expect(payment).toMatch(/api\.post\('\/payments\/intent'/)
    expect(payment).toMatch(/amount: amountCents/)
    expect(payment).toMatch(/stripe\.confirmPayment/)
    expect(payment).toMatch(/onMarkManual/)
    expect(parts).toMatch(/AppOverlay/)
    expect(parts).toMatch(/api\.post\(`\/parts\/ro\/\$\{roId\}`/)
  })
})
