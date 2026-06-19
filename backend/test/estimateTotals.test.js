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
    frame_labor_hours: null,
    frame_labor_rate: null,
    frame_labor_cost: null,
    glass_labor_hours: null,
    glass_labor_rate: null,
    glass_labor_cost: null,
    paint_supplies_hours: 20.5,
    paint_supplies_rate: 30,
    paint_supplies_cost: 615,
    miscellaneous: null,
    other_charges: null,
    costs_total: null,
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

test('parseEstimateTotalsFromPdfText maps Mitchell gross, net, deductible, and all labor buckets', () => {
  const totals = parseEstimateTotalsFromPdfText(`
    Estimate Totals
    Body Labor        24.6   $60.00   $1,476.00
    Refinish Labor    17.9   $60.00   $1,074.00
    Glass Labor        0.5   $60.00      $30.00
    Frame Labor        2.0   $60.00     $120.00
    Mechanical Labor   1.5   $60.00      $90.00
    Total Labor       46.5             $2,790.00
    Taxable Parts                      $5,038.72
    Paint Materials                    $1,322.88
    Other Additional Costs                 $5.00
    Costs Total                        $1,445.73
    Gross Total                        $9,969.25
    Deductible                        -$1,000.00
    Net Estimate Total                 $8,969.25
    This is not an authorization to repair.
  `);

  assert.equal(totals.body_labor_cost, 1476);
  assert.equal(totals.paint_labor_cost, 1074);
  assert.equal(totals.glass_labor_cost, 30);
  assert.equal(totals.frame_labor_cost, 120);
  assert.equal(totals.mechanical_labor_cost, 90);
  assert.equal(totals.parts, 5038.72);
  assert.equal(totals.costs_total, 1445.73);
  assert.equal(totals.total_cost_of_repairs, 9969.25);
  assert.equal(totals.deductible, 1000);
  assert.equal(totals.net_cost_of_repairs, 8969.25);
});
