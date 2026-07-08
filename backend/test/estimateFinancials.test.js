const assert = require('node:assert/strict');
const test = require('node:test');

const { buildFinancialsFromAdjusterTotals } = require('../src/routes/estimateLineItems');

test('buildFinancialsFromAdjusterTotals preserves Mitchell gross, net, deductible, labor buckets, and stated tax', () => {
  const financials = buildFinancialsFromAdjusterTotals(
    { tax_amount: 9999 },
    {
      parts: 5038.72,
      body_labor_cost: 1476,
      paint_labor_cost: 1074,
      glass_labor_cost: 30,
      frame_labor_cost: 120,
      mechanical_labor_cost: 90,
      paint_supplies_cost: 1322.88,
      other_charges: 5,
      sales_tax_cost: 812.65,
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
    needs_review: false,
    reconciliation: {
      status: 'accepted',
      tolerance_cents: 2,
      gross_total_cents: 996925,
      bucket_total_cents: 996925,
      delta_cents: 0,
    },
  });
});

test('buildFinancialsFromAdjusterTotals flags bucket gaps instead of plugging tax', () => {
  const financials = buildFinancialsFromAdjusterTotals(
    { tax_amount: 9999 },
    {
      parts: 5000,
      body_labor_cost: 2500,
      paint_supplies_cost: 1000,
      sales_tax_cost: 400,
      total_cost_of_repairs: 10000,
    }
  );

  assert.equal(financials.needs_review, true);
  assert.equal(financials.reason, 'adjuster_totals_do_not_reconcile');
  assert.equal(financials.reconciliation.status, 'needs_review');
  assert.equal(financials.reconciliation.gross_total_cents, 1000000);
  assert.equal(financials.reconciliation.bucket_total_cents, 890000);
  assert.equal(financials.reconciliation.delta_cents, 110000);
  assert.equal(financials.parts_cost, undefined);
  assert.equal(financials.tax, undefined);
});

test('buildFinancialsFromAdjusterTotals accepts totals inside two-cent tolerance', () => {
  const financials = buildFinancialsFromAdjusterTotals(
    { tax_amount: 0 },
    {
      parts: 10,
      body_labor_cost: 20,
      sales_tax_cost: 1.01,
      total_cost_of_repairs: 31,
    }
  );

  assert.equal(financials.needs_review, false);
  assert.equal(financials.tax, 1.01);
  assert.equal(financials.total, 31);
  assert.equal(financials.reconciliation.delta_cents, -1);
});

test('buildFinancialsFromAdjusterTotals flags totals outside two-cent tolerance', () => {
  const financials = buildFinancialsFromAdjusterTotals(
    { tax_amount: 0 },
    {
      parts: 10,
      body_labor_cost: 20,
      sales_tax_cost: 1.03,
      total_cost_of_repairs: 31,
    }
  );

  assert.equal(financials.needs_review, true);
  assert.equal(financials.reconciliation.delta_cents, -3);
});
