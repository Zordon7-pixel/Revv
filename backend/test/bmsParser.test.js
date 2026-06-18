const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseBms } = require('../src/lib/bmsParser');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name));
}

test('parseBms maps CIECA BMS headers to the parsed contract', () => {
  const parsed = parseBms(fixture('cieca-sample.xml'));

  assert.deepEqual(Object.keys(parsed), [
    'insurance_company',
    'claim_number',
    'adjuster_name',
    'adjuster_phone',
    'adjuster_email',
    'customer_name',
    'customer_phone',
    'vehicle',
    'vin',
    'vehicle_year',
    'vehicle_make',
    'vehicle_model',
    'total_allowed',
    'estimate_totals',
    'line_items',
  ]);
  assert.equal(parsed.insurance_company, 'Acme Mutual Insurance');
  assert.equal(parsed.claim_number, 'CLM-2026-00042');
  assert.equal(parsed.adjuster_name, 'Jordan Lee');
  assert.equal(parsed.adjuster_phone, '555-0101');
  assert.equal(parsed.adjuster_email, 'jordan.lee@example.test');
  assert.equal(parsed.customer_name, 'Casey Rivera');
  assert.equal(parsed.customer_phone, '555-0199');
  assert.equal(parsed.vehicle, '2024 Toyota Camry XSE');
  assert.equal(parsed.vin, '4T1K61AK0RU123456');
  assert.equal(parsed.vehicle_year, '2024');
  assert.equal(parsed.vehicle_make, 'Toyota');
  assert.equal(parsed.vehicle_model, 'Camry XSE');
  assert.equal(parsed.total_allowed, 923.99);
  assert.equal(parsed.estimate_totals.parts, 435.25);
  assert.equal(parsed.estimate_totals.body_labor_hours, 2.5);
  assert.equal(parsed.estimate_totals.net_cost_of_repairs, 423.99);
});

test('parseBms maps labor, parts, sublet, and refinish line items with enrichment fields', () => {
  const parsed = parseBms(fixture('cieca-sample.xml'));

  assert.equal(parsed.line_items.length, 5);
  assert.deepEqual(parsed.line_items[0], {
    description: 'RPR left quarter panel',
    type: 'labor',
    quantity: 2.5,
    unit_price: 65,
    operation_code: 'RPR',
    labor_units: 2.5,
    part_type: null,
    part_number: null,
  });
  assert.deepEqual(parsed.line_items[1], {
    description: 'REPL rear bumper cover',
    type: 'parts',
    quantity: 1,
    unit_price: 435.25,
    operation_code: 'REPL',
    labor_units: null,
    part_type: 'OEM',
    part_number: '52159-06999',
  });
  assert.deepEqual(parsed.line_items[2], {
    description: 'Sublet wheel alignment',
    type: 'sublet',
    quantity: 1,
    unit_price: 200,
    operation_code: 'SUBL',
    labor_units: null,
    part_type: null,
    part_number: null,
  });
  assert.deepEqual(parsed.line_items[3], {
    description: 'REFN rear bumper cover',
    type: 'labor',
    quantity: 1.4,
    unit_price: 68,
    operation_code: 'REFN',
    labor_units: 1.4,
    part_type: null,
    part_number: null,
  });
});

test('parseBms reuses OCR operation-code classification semantics for RNI and RPR', () => {
  const parsed = parseBms(fixture('cieca-sample.xml'));
  const rni = parsed.line_items.find((item) => item.operation_code === 'RNI');
  const rpr = parsed.line_items.find((item) => item.operation_code === 'RPR');
  const repl = parsed.line_items.find((item) => item.operation_code === 'REPL');

  assert.equal(rni.type, 'labor');
  assert.equal(rpr.type, 'labor');
  assert.equal(repl.type, 'parts');
});

test('parseBms parses XXE and billion-laughs payloads inertly', () => {
  const parsed = parseBms(fixture('cieca-xxe-attack.xml'));
  const serialized = JSON.stringify(parsed);

  assert.equal(parsed.insurance_company, '&xxe;');
  assert.equal(parsed.customer_name, '&lol3;');
  assert.equal(parsed.line_items[0].description, 'RPR inert entity &xxe;');
  assert.doesNotMatch(serialized, /root:|daemon:|bin:|nobody:/);
  assert.doesNotMatch(serialized, /lollollollollollollollollollol/);
  assert.ok(serialized.length < 2000);
});
