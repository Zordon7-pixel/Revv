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
}

function read(relativePath) {
  return readFileSync(resolve(frontendRoot, relativePath), 'utf8')
}

function actionContext(source, label) {
  const index = source.indexOf(label)
  expect(index, `missing action label: ${label}`).toBeGreaterThan(-1)
  return source.slice(Math.max(0, index - 280), index + label.length)
}

const genericActions = {
  roDetail: ['Log Communication', 'Send Tracking Link', 'Save Communication', 'Search Catalog'],
  addRo: ['Manual Entry', 'Appraisal Quick Intake', 'Done', 'Retry Appraisal Setup', 'Next'],
  appraisal: ['Add appraisal PDF or photos', '>Clear<', 'Read Appraisal', 'Use Details in New RO'],
  insurance: ['Reading attached appraisal', 'Add another photo / PDF', 'Importing…', 'Save Insurance'],
  claimTracker: ['`Add ${selectedEvidenceFiles', 'Open appraisal document', 'Add Contact Entry', 'Add Dispute Note'],
  diagnostics: ['New Scan', 'Add DTC', 'Add ADAS', 'Save Scan'],
  inspection: ['Send to Customer'],
}

describe('locked redesign color semantics', () => {
  it('keeps generic workflow actions on brand instead of money-only gold', () => {
    for (const [fileKey, labels] of Object.entries(genericActions)) {
      const source = read(files[fileKey])
      for (const label of labels) {
        const context = actionContext(source, label)
        expect(context, `${files[fileKey]}: ${label}`).not.toMatch(/#EAB308|bg-gold|text-gold|border-gold|yellow-/i)
      }
    }
  })

  it('retains gold for the explicitly approved supplement and New RO revenue actions', () => {
    const insurance = read(files.insurance)
    expect(actionContext(insurance, 'Request Supplement')).toMatch(/bg-gold/)

    const addRo = read(files.addRo)
    const createLabel = "t('ro.addRO')"
    const createIndex = addRo.lastIndexOf(createLabel)
    expect(addRo.slice(createIndex - 280, createIndex + createLabel.length)).toMatch(/bg-\[#EAB308\]|bg-gold/)
  })
})
