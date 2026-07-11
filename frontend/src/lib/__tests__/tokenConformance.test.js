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
  'src/pages/Goals.jsx',
  'src/pages/Performance.jsx',
  'src/pages/LeadsDashboard.jsx',
  'src/pages/Reviews.jsx',
  'src/pages/EstimateRequests.jsx',
  'src/pages/TechWorkload.jsx',
  'src/pages/Schedule.jsx',
  'src/pages/Settings.jsx',
  'src/pages/StorageHold.jsx',
  'src/pages/VehicleDiagnostics.jsx',
  'src/pages/Invoice.jsx',
  'src/pages/Users.jsx',
  'src/pages/RepairOrders.jsx',
  'src/pages/InspectionEditor.jsx',
  'src/components/AddROModal.jsx',
  'src/pages/Dashboard.jsx',
  'src/pages/EstimateBuilder.jsx',
  'src/pages/RODetail.jsx',
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

const phase6KFiles = [
  'src/pages/Goals.jsx',
  'src/pages/Performance.jsx',
  'src/pages/LeadsDashboard.jsx',
  'src/pages/Reviews.jsx',
  'src/pages/EstimateRequests.jsx',
  'src/pages/TechWorkload.jsx',
  'src/pages/Schedule.jsx',
  'src/pages/Settings.jsx',
]

const phase6LFiles = [
  'src/pages/StorageHold.jsx',
  'src/pages/VehicleDiagnostics.jsx',
  'src/pages/Invoice.jsx',
  'src/pages/Users.jsx',
  'src/pages/RepairOrders.jsx',
  'src/pages/InspectionEditor.jsx',
  'src/components/AddROModal.jsx',
]

const phase6MFiles = [
  'src/pages/Dashboard.jsx',
  'src/pages/EstimateBuilder.jsx',
  'src/pages/Customers.jsx',
]

const phase6NFiles = [
  'src/pages/RODetail.jsx',
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

  it('keeps secondary operations and insights tokenized without changing workflow contracts', () => {
    for (const relativePath of phase6KFiles) {
      const source = read(relativePath)
      expect(source, relativePath).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(source, relativePath).not.toMatch(/(?:bg|text|border|ring|from|to|via)-(?:indigo|blue|slate|yellow|red|green|emerald|amber|violet|purple|cyan|teal|orange|lime|pink|rose)-/)
      expect(source, relativePath).not.toMatch(/(?:bg-gradient-|<linearGradient|\balert\s*\()/)
    }

    const goals = read('src/pages/Goals.jsx')
    const workload = read('src/pages/TechWorkload.jsx')
    const schedule = read('src/pages/Schedule.jsx')
    const settings = read('src/pages/Settings.jsx')
    expect(goals).toMatch(/api\.put\(`\/goals\/\$\{months\.current\}`/)
    expect(workload).toMatch(/api\.patch\(`\/ros\/\$\{dragging\.ro\.id\}\/assign`/)
    expect(schedule).toMatch(/api\.post\(`\/ros\/from-schedule\/\$\{shiftId\}`/)
    expect(schedule).toMatch(/confirm\('Remove this shift\?'\)/)
    expect(settings).toMatch(/window\.confirm/)
    expect(settings).toMatch(/api\.delete\('\/market\/demo-data'\)/)
    expect(settings).toMatch(/api\.post\('\/subscriptions\/checkout'/)
  })

  it('keeps RO intake, storage, diagnostics, invoice, team, and inspection surfaces tokenized', () => {
    for (const relativePath of phase6LFiles) {
      const source = read(relativePath)
      expect(source, relativePath).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(source, relativePath).not.toMatch(/(?:bg|text|border|ring|from|to|via|placeholder|accent)-(?:indigo|blue|slate|yellow|red|green|emerald|amber|violet|purple|cyan|teal|orange|lime|pink|rose)-/)
      expect(source, relativePath).not.toMatch(/(?:bg-gradient-|<linearGradient|\balert\s*\()/)
    }

    const storage = read('src/pages/StorageHold.jsx')
    const diagnostics = read('src/pages/VehicleDiagnostics.jsx')
    const invoice = read('src/pages/Invoice.jsx')
    const users = read('src/pages/Users.jsx')
    const repairOrders = read('src/pages/RepairOrders.jsx')
    const inspection = read('src/pages/InspectionEditor.jsx')
    const addRo = read('src/components/AddROModal.jsx')

    expect(storage).toMatch(/api\.post\(`\/storage\/\$\{billing\.roId\}\/charges`/)
    expect(storage).toMatch(/api\.patch\(`\/storage\/\$\{editingHold\.roId\}`/)
    expect(storage.match(/<AppOverlay/g)?.length).toBe(2)
    expect(diagnostics).toMatch(/api\.post\('\/vehicle-diagnostics'/)
    expect(diagnostics).toMatch(/window\.confirm\('Delete this diagnostic scan\? This cannot be undone\.'/)
    expect(invoice).toMatch(/api\.get\(`\/invoice\/\$\{id\}`/)
    expect(invoice).toMatch(/api\.post\(`\/ros\/\$\{id\}\/email-invoice`/)
    expect(invoice).toMatch(/window\.print\(\)/)
    expect(invoice).toMatch(/print:bg-white/)
    expect(users).toMatch(/api\.post\('\/users\/assistant'/)
    expect(users).toMatch(/confirm\(`Remove \$\{name\}\? This cannot be undone\.`\)/)
    expect(repairOrders).toMatch(/api\.post\('\/repair-orders\/bulk-status'/)
    expect(repairOrders).toMatch(/navigate\('\/ros\/new'\)/)
    expect(inspection).toMatch(/api\.patch\(`\/inspections\/\$\{inspectionId\}\/items\/\$\{itemId\}`/)
    expect(inspection).toMatch(/api\.post\(`\/inspections\/\$\{inspectionId\}\/send`/)
    expect(addRo).toMatch(/api\.post\('\/ros'/)
    expect(addRo).toMatch(/presentation === 'page'/)
    expect(addRo).toMatch(/shouldUseCompactKeyboardEditor/)
    const globalStyles = read('src/index.css')
    expect(globalStyles).toMatch(/\.sheet-modal-card input:focus[\s\S]*border-color: var\(--brand\)/)
    expect(globalStyles).not.toMatch(/\.sheet-modal-card input:focus[\s\S]{0,900}border-color: var\(--gold\)/)
  })

  it('keeps dashboard, estimate, and customer work surfaces on semantic roles without changing contracts', () => {
    for (const relativePath of phase6MFiles) {
      const source = read(relativePath)
      expect(source, relativePath).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(source, relativePath).not.toMatch(/(?:bg|text|border|ring|from|to|via|placeholder|accent)-(?:indigo|blue|slate|yellow|red|green|emerald|amber|violet|purple|cyan|teal|orange|lime|pink|rose)-/)
      expect(source, relativePath).not.toMatch(/(?:bg-gradient-|<linearGradient|\balert\s*\()/)
    }

    const dashboard = read('src/pages/Dashboard.jsx')
    const builder = read('src/pages/EstimateBuilder.jsx')
    expect(dashboard).toMatch(/api\.patch\(`\/ros\/\$\{roId\}`/)
    expect(dashboard).toMatch(/api\.put\(`\/ros\/\$\{roId\}\/status`/)
    expect(dashboard).toMatch(/getComputedStyle\(document\.documentElement\)/)
    expect(dashboard).toMatch(/getPropertyValue\('--brand'\)/)
    expect(builder).toMatch(/api\.post\('\/insurance-ocr\/parse'/)
    expect(builder).toMatch(/api\.post\(`\/estimate-items\/\$\{roId\}\/import-financials`/)
    expect(builder).toMatch(/api\.post\(`\/estimate-metadata\/metadata\/\$\{roId\}`/)
    expect(builder).toMatch(/<AppOverlay/)
    expect(builder).toMatch(/<EstimateSelectionToolbar/)
    expect(builder).toMatch(/role=\{actionFeedback\.type === 'error' \? 'alert' : 'status'\}/)
  })

  it('keeps the complete RO workspace tokenized while preserving every consequential workflow', () => {
    for (const relativePath of phase6NFiles) {
      const source = read(relativePath)
      expect(source, relativePath).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(source, relativePath).not.toMatch(/(?:bg|text|border|ring|from|to|via|placeholder|accent)-(?:indigo|blue|slate|yellow|red|green|emerald|amber|violet|purple|cyan|teal|orange|lime|pink|rose)-/)
      expect(source, relativePath).not.toMatch(/(?:bg-gradient-|<linearGradient|\balert\s*\()/)
    }

    const detail = read('src/pages/RODetail.jsx')
    expect(detail).toMatch(/createPortal\(/)
    expect(detail).toMatch(/z-\[220\]/)
    expect(detail).toMatch(/role=\{isError \? 'alert' : 'status'\}/)
    expect(detail).toMatch(/api\.put\(`\/ros\/\$\{id\}\/status`/)
    expect(detail).toMatch(/window\.confirm\(`Move back to/)
    expect(detail).toMatch(/window\.confirm\(\s*`This RO is assigned to/)
    expect(detail).toMatch(/api\.post\(`\/ros\/\$\{id\}\/supplements`/)
    expect(detail).toMatch(/api\.post\(`\/ros\/\$\{id\}\/mark-paid`/)
    expect(detail).toMatch(/api\.post\('\/sms\/send'/)
    expect(detail).toMatch(/api\.post\(`\/photos\/ro\/\$\{id\}\/predropoff`/)
    expect(detail.match(/<AppOverlay/g)?.length).toBe(4)
    expect(detail).toMatch(/<SupplementFinderPanel[\s\S]*variant="hero"/)
    expect(detail).toMatch(/<Money cents=\{ro\.amount_owed_cents/)
  })
})
