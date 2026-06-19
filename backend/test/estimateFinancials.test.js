const assert = require('node:assert/strict');
const test = require('node:test');

const { buildFinancialsFromAdjusterTotals } = require('../src/routes/estimateLineItems');

test('buildFinancialsFromAdjusterTotals preserves Mitchell gross, net, deductible, and labor buckets', () => {
  const financials = buildFinancialsFromAdjusterTotals(
    { tax_amount: 0 },
    {
      parts: 5038.72,
      body_labor_cost: 1476,
      paint_labor_cost: 1074,
      glass_labor_cost: 30,
      frame_labor_cost: 120,
      mechanical_labor_cost: 90,
      paint_supplies_cost: 1322.88,
      other_charges: 5,
      total_cost_of_repairs: 9969.25,
      deductible: -1000,
      net_cost_of_repairs: 8969.25,
    }
  );

  assert.deepEqual(financials, {
    parts_cost: 5038.72,
    labor_cost: 2790,
    sublet_cost: 1327.88,
    tax: 812.65,
    total: 9969.25,
    deductible: 1000,
    net_estimate_total: 8969.25,
  });
});
