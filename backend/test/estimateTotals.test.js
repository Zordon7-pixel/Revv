const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseEstimateTotalsFromPdfText } = require('../src/routes/insuranceOcr');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

test('parseEstimateTotalsFromPdfText parses CCC totals with labels glued to values', () => {
  const totals = parseEstimateTotalsFromPdfText(fixture('ccc-estimate-totals.txt'));

  assert.deepEqual(totals, {
    parts: 2976.73,
    body_labor_hours: 48.2,
    body_labor_rate: 50,
    body_labor_cost: 2410,
    paint_labor_hours: 20.5,
    paint_labor_rate: 50,
    paint_labor_cost: 1025,
    mechanical_labor_hours: 2.2,
    mechanical_labor_rate: 50,
    mechanical_labor_cost: 110,
    paint_supplies_hours: 20.5,
    paint_supplies_rate: 30,
    paint_supplies_cost: 615,
    miscellaneous: null,
    other_charges: null,
    subtotal: 7136.73,
    sales_tax_basis: 7136.73,
    sales_tax_rate: 8.875,
    sales_tax_cost: 633.38,
    county_tax_basis: null,
    county_tax_rate: null,
    county_tax_cost: null,
    other_tax_1_basis: null,
    other_tax_1_rate: null,
    other_tax_1_cost: null,
    total_cost_of_repairs: 7770.11,
    deductible: null,
    total_adjustments: 0,
    net_cost_of_repairs: 7770.11,
    revenue: 7770.11,
  });

  for (const key of [
    'parts',
    'body_labor_hours',
    'body_labor_rate',
    'body_labor_cost',
    'paint_labor_hours',
    'paint_labor_rate',
    'paint_labor_cost',
    'mechanical_labor_hours',
    'mechanical_labor_rate',
    'mechanical_labor_cost',
    'paint_supplies_hours',
    'paint_supplies_rate',
    'paint_supplies_cost',
    'subtotal',
    'sales_tax_basis',
    'sales_tax_rate',
    'sales_tax_cost',
    'total_cost_of_repairs',
    'total_adjustments',
    'net_cost_of_repairs',
    'revenue',
  ]) {
    assert.notEqual(totals[key], null, `${key} should not be null`);
  }
});
