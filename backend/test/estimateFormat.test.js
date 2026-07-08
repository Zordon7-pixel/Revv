const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { detectEstimateFormat } = require('../src/services/estimateFormat');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

test('detectEstimateFormat detects synthetic CCC estimate text', () => {
  const result = detectEstimateFormat(fixture('ccc-estimate-totals.txt'));

  assert.equal(result.format, 'ccc');
  assert.ok(result.confidence > 0);
  assert.ok(result.signals.includes('ccc-one-header'));
  assert.ok(result.signals.includes('ccc-estimate-totals-block'));
});

test('detectEstimateFormat detects synthetic Mitchell estimate text', () => {
  const result = detectEstimateFormat(fixture('mitchell-estimate-synthetic.txt'));

  assert.equal(result.format, 'mitchell');
  assert.ok(result.confidence > 0);
  assert.ok(result.signals.includes('mitchell-header'));
  assert.ok(result.signals.includes('mitchell-gross-net-totals'));
});

test('detectEstimateFormat returns unknown for unrecognized text', () => {
  const result = detectEstimateFormat(fixture('estimate-format-unknown.txt'));

  assert.deepEqual(result, {
    format: 'unknown',
    confidence: 0,
    signals: [],
  });
});
