const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { normalizeImportDraft } = require('../routes/estimateLineItems');

test('estimate import drafts are bounded and normalized before persistence', () => {
  const draft = normalizeImportDraft({
    source: 'appraisal_quick_intake',
    source_files: ['page-1.jpg', 'page-2.pdf'],
    detected_format: 'ccc',
    needs_review: true,
    review_reasons: ['ccc_line_grid_missing'],
    insurance_company: 'GEICO',
    claim_number: 'CLM-100',
    estimate_totals: { parts: '500.25', total_cost_of_repairs: 740, ignored: 'not-money' },
    line_items: [
      { type: 'parts', description: ' Bumper cover ', quantity: '1', unit_price: '500.25' },
      { type: 'unsupported', description: 'Paint materials', quantity: 1, unit_price: 100 },
    ],
  });

  assert.equal(draft.source, 'appraisal_quick_intake');
  assert.deepEqual(draft.source_files, ['page-1.jpg', 'page-2.pdf']);
  assert.deepEqual(draft.line_items, [
    { type: 'parts', description: 'Bumper cover', quantity: 1, unit_price: 500.25 },
    { type: 'other', description: 'Paint materials', quantity: 1, unit_price: 100 },
  ]);
  assert.deepEqual(draft.estimate_totals, { parts: 500.25, total_cost_of_repairs: 740 });
  assert.equal(draft.insurance_company, 'GEICO');
  assert.equal(draft.claim_number, 'CLM-100');
});

test('estimate import draft can be explicitly cleared', () => {
  assert.equal(normalizeImportDraft(null), null);
});

test('migration creates and backfills the import_draft column idempotently', () => {
  const source = fs.readFileSync(path.join(__dirname, '../db/migrate.js'), 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS estimate_metadata[\s\S]*import_draft JSONB/);
  assert.match(source, /ALTER TABLE estimate_metadata ADD COLUMN IF NOT EXISTS import_draft JSONB/);
});
