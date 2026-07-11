import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const frontendRoot = process.cwd()
const files = {
  roDetail: 'src/pages/RODetail.jsx',
  addRo: 'src/components/AddROModal.jsx',
  appraisal: 'src/components/AppraisalQuickIntake.jsx',
  insurance: 'src/components/InsurancePanel.jsx',
  claimTracker: 'src/components/ClaimTrackerPanel.jsx',
  diagnostics: 'src/pages/VehicleDiagnostics.jsx',
  inspection: 'src/pages/InspectionEditor.jsx',
  adas: 'src/pages/ADASCalibration.jsx',
  onboarding: 'src/pages/Onboarding.jsx',
  superAdmin: 'src/pages/SuperAdminDashboard.jsx',
  superAdminLogin: 'src/pages/SuperAdminLogin.jsx',
  partsSearch: 'src/components/PartsSearch.jsx',
  estimateWizard: 'src/components/EstimateImportWizard.jsx',
  claimStatus: 'src/components/ClaimStatusCard.jsx',
  estimateSelection: 'src/components/EstimateSelectionToolbar.jsx',
}

function read(relativePath) {
  return readFileSync(resolve(frontendRoot, relativePath), 'utf8')
}

function buttonContext(source, label, { last = false } = {}) {
  const index = last ? source.lastIndexOf(label) : source.indexOf(label)
  expect(index, `missing action label: ${label}`).toBeGreaterThan(-1)
  const start = source.lastIndexOf('<button', index)
  const end = source.indexOf('</button>', index)
  expect(start, `missing opening button for: ${label}`).toBeGreaterThan(-1)
  expect(end, `missing closing button for: ${label}`).toBeGreaterThan(index)
  return source.slice(start, end + '</button>'.length)
}

const genericActions = {
  roDetail: ['Log Communication', 'Send Tracking Link', 'Save Communication', 'Search Catalog'],
  addRo: ['Manual Entry', 'Appraisal Quick Intake', 'Done', 'Retry Appraisal Setup', 'Next'],
  appraisal: ['Add appraisal PDF or photos', '>Clear<', 'Read Appraisal', 'Use Details in New RO'],
  insurance: ['Reading attached appraisal', 'Add another photo / PDF', 'Importing…', 'Save Insurance'],
  claimTracker: ['`Add ${selectedEvidenceFiles', 'Open appraisal document', 'Add Contact Entry', 'Add Dispute Note'],
  diagnostics: ['New Scan', 'Add DTC', 'Add ADAS', 'Save Scan'],
  inspection: ['Send to Customer'],
  adas: ["'Checking...' : 'Lookup'"],
  onboarding: ["'Saving...' : 'Continue'", 'Import your existing estimate', 'Go to Users', 'Enter REVV'],
  superAdmin: ['<LayoutDashboard size={14} />', '<Send size={12} /> Send', 'Copy prompt for issue'],
  superAdminLogin: ["'Signing in...' : 'Sign In'"],
  partsSearch: ["'Searching...' : 'Search'", 'Add to RO'],
  estimateWizard: ["'Parsing estimate...' : 'Parse Estimate'", 'Add item', 'Choose other files'],
  claimStatus: ['Open Storage Hold'],
  estimateSelection: ['Select Parts Only', 'Select All', 'Clear'],
}

describe('locked redesign color semantics', () => {
  it('keeps generic workflow actions on brand instead of money-only gold', () => {
    for (const [fileKey, labels] of Object.entries(genericActions)) {
      const source = read(files[fileKey])
      for (const label of labels) {
        const context = buttonContext(source, label)
        expect(context, `${files[fileKey]}: ${label}`).not.toMatch(/#EAB308|gold|yellow-|amber-/i)
      }
    }
  })

  it('retains gold for the explicitly approved supplement and New RO revenue actions', () => {
    const insurance = read(files.insurance)
    expect(buttonContext(insurance, 'Request Supplement')).toMatch(/bg-gold/)

    const addRo = read(files.addRo)
    const createLabel = "t('ro.addRO')"
    expect(buttonContext(addRo, createLabel, { last: true })).toMatch(/bg-\[#EAB308\]|bg-gold/)

    const onboarding = read(files.onboarding)
    expect(buttonContext(onboarding, 'Create First RO')).toMatch(/bg-gold/)

    const estimateWizard = read(files.estimateWizard)
    expect(buttonContext(estimateWizard, 'Create Repair Order', { last: true })).toMatch(/bg-gold/)
    expect(estimateWizard).toMatch(/text-gold[^>]*>\s*This job brings in/)
  })
})
