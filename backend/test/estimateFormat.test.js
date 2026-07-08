import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectEstimateFormat } = require('../src/services/estimateFormat');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

describe('detectEstimateFormat', () => {
  it('detects synthetic CCC estimate text', () => {
    const result = detectEstimateFormat(fixture('ccc-estimate-totals.txt'));

    expect(result.format).toBe('ccc');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.signals).toContain('ccc-one-header');
    expect(result.signals).toContain('ccc-estimate-totals-block');
  });

  it('detects synthetic Mitchell estimate text', () => {
    const result = detectEstimateFormat(fixture('mitchell-estimate-synthetic.txt'));

    expect(result.format).toBe('mitchell');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.signals).toContain('mitchell-header');
    expect(result.signals).toContain('mitchell-gross-net-totals');
  });

  it('returns unknown for unrecognized text', () => {
    const result = detectEstimateFormat(fixture('estimate-format-unknown.txt'));

    expect(result).toEqual({
      format: 'unknown',
      confidence: 0,
      signals: [],
    });
  });
});
