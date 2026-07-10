const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildDeterministicParseResponse } = require('../routes/insuranceOcr');

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

test('deterministic estimate routes no longer convert review flags into HTTP 409 failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/insuranceOcr.js'), 'utf8');
  const responseCalls = source.match(/res\.json\(buildDeterministicParseResponse\(parsed, formatDetection\.format\)\)/g) || [];

  assert.equal(responseCalls.length, 2);
  assert.doesNotMatch(source, /CCC estimate needs review before import/);
  assert.doesNotMatch(source, /Mitchell estimate needs review before import/);
});
