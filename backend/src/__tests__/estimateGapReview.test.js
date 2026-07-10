const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEstimateGapReview, suggestionAlreadyPresent } = require('../routes/estimateAssistant');

const ro = {
  year: 2024,
  make: 'Toyota',
  model: 'Camry',
  damaged_panels: JSON.stringify(['front_bumper', 'hood']),
};

test('estimate gap review stays gated until estimate lines exist', () => {
  const review = buildEstimateGapReview({
    ro,
    items: [],
    evidence: { photo_count: 2, inspection_count: 0, document_count: 1 },
  });

  assert.equal(review.ready, false);
  assert.match(review.reason, /estimate lines/i);
  assert.deepEqual(review.gaps, []);
});

test('estimate gap review filters represented work and emits zero-dollar drafts only', () => {
  const review = buildEstimateGapReview({
    ro,
    items: [{ description: 'R&R front bumper cover', type: 'labor' }],
    evidence: { photo_count: 2, inspection_count: 1, document_count: 1 },
  });

  assert.equal(review.ready, true);
  assert.equal(review.evidence_sources.includes('RO photos'), true);
  assert.equal(review.gaps.some((gap) => /bumper cover/i.test(gap.description)), false);
  assert.equal(review.gaps.length > 0, true);
  review.gaps.forEach((gap) => {
    assert.equal(gap.draft.unit_price, 0);
    assert.equal(gap.draft.taxable, false);
    assert.ok(['high', 'medium'].includes(gap.confidence));
  });
});

test('gap comparison recognizes equivalent operation wording', () => {
  assert.equal(
    suggestionAlreadyPresent('Front bumper cover remove/replace', [{ description: 'R&R front bumper cover' }]),
    true
  );
});
