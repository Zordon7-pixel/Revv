const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildDeterministicParseResponse,
  buildDeterministicSummaryFallback,
  shouldReturnDeterministicParse,
} = require('../routes/insuranceOcr');
const { parseCccEstimate } = require('../services/cccExtractor');
const { parseMitchellEstimate } = require('../services/mitchellExtractor');

test('deterministic CCC and Mitchell review flags return a reviewable success payload', () => {
  for (const detectedFormat of ['ccc', 'mitchell']) {
    const parsed = {
      detected_format: detectedFormat,
      needs_review: true,
      review_reasons: ['subtotal_does_not_reconcile'],
      line_items: [{ type: 'parts', description: 'Bumper cover', quantity: 1, unit_price: 450 }],
    };

    const result = buildDeterministicParseResponse(parsed, detectedFormat);

    assert.equal(result.success, true);
    assert.equal(result.needs_review, true);
    assert.equal(result.detected_format, detectedFormat);
    assert.equal(result.parsed.needs_review, true);
    assert.deepEqual(result.parsed.review_reasons, ['subtotal_does_not_reconcile']);
    assert.equal(result.parsed.line_items.length, 1);
    assert.equal(Object.hasOwn(result, 'error'), false);
  }
});

test('deterministic fast path is used only when detailed line items exist', () => {
  assert.equal(shouldReturnDeterministicParse({ line_items: [{ description: 'Bumper' }] }), true);
  assert.equal(shouldReturnDeterministicParse({ line_items: [] }), false);
  assert.equal(shouldReturnDeterministicParse(null), false);
});

for (const [format, parse, filename] of [
  ['ccc', parseCccEstimate, 'ccc-estimate-totals.txt'],
  ['mitchell', parseMitchellEstimate, 'mitchell-estimate-synthetic.txt'],
]) {
  test(`${format} partially readable grids require recovery and preserve readable rows on failure`, () => {
    const text = fs.readFileSync(path.join(__dirname, '../../test/fixtures', filename), 'utf8');
    const partial = parse(text.replace(/^2\s+.+$/m, '2 unreadable estimate row'));
    assert.ok(partial.line_items.length > 0);
    assert.ok(partial.review_reasons.includes('low_confidence_line_2'));
    assert.equal(shouldReturnDeterministicParse(partial), false);
    const fallback = buildDeterministicSummaryFallback(partial, format);
    assert.deepEqual(fallback.line_items, partial.line_items);
    assert.ok(fallback.review_reasons.includes('low_confidence_line_2'));
    assert.equal(fallback.needs_review, true);
  });
}

test('totals-only reconciliation warnings do not unnecessarily trigger recovery', () => {
  assert.equal(shouldReturnDeterministicParse({
    line_items: [{ description: 'Bumper' }],
    review_reasons: ['subtotal_does_not_reconcile'],
  }), true);
});

test('zero-line CCC text produces reviewable category items instead of a dead-end empty result', () => {
  const fixturePath = path.join(__dirname, '../../test/fixtures/ccc-estimate-low-confidence.txt');
  const strict = parseCccEstimate(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(strict.line_items.length, 0);

  const fallback = buildDeterministicSummaryFallback(strict, 'ccc');
  assert.ok(fallback);
  assert.deepEqual(
    fallback.line_items.map((item) => item.description),
    ['Estimate totals - parts', 'Estimate totals - body labor']
  );
  assert.equal(fallback.needs_review, true);
  assert.ok(fallback.review_reasons.includes('ccc_summary_items_from_totals'));
  assert.equal(fallback.review_reasons.includes('ccc_line_items_missing'), false);
});
