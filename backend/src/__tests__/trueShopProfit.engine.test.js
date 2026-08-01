const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateProfit, calculateTrueProfit } = require('../services/profit');

const profile = {
  parts_margin_pct: 0.25,
  materials_margin_pct: 0.45,
  sublet_margin_pct: 0.05,
  blended_labor_cost_per_hr: 50,
};

test('no labor-cost profile returns the legacy calculation byte-for-byte', () => {
  const ro = {
    parts_cost: 800,
    labor_cost: 1200,
    sublet_cost: 200,
    deductible_waived: 75,
    referral_fee: 25,
    goodwill_repair_cost: 10,
  };
  const legacy = calculateProfit(ro);
  const result = calculateTrueProfit(ro, { ...profile, blended_labor_cost_per_hr: null });

  assert.deepEqual(result, legacy);
  assert.deepEqual(Object.keys(result), Object.keys(legacy));
  assert.equal(JSON.stringify(result), JSON.stringify(legacy));
  assert.equal(result.costProfileApplied, false);
});

test('parts and sublet use the configured margin percentages', () => {
  const result = calculateTrueProfit(
    { parts_cost: 1000, labor_cost: 0, sublet_cost: 200 },
    profile,
    { laborHours: 0, laborRate: 100 }
  );

  assert.equal(result.breakdown.parts_profit, 250);
  assert.equal(result.breakdown.sublet_profit, 10);
  assert.equal(result.trueProfit, 260);
  assert.equal(result.costProfileApplied, true);
});

test('explicit labor hours take priority when calculating labor profit', () => {
  const result = calculateTrueProfit(
    { parts_cost: 0, labor_cost: 1000, sublet_cost: 0 },
    profile,
    { laborHours: 8, laborRate: 100 }
  );

  assert.equal(result.breakdown.labor_hours, 8);
  assert.equal(result.breakdown.labor_cost_dollars, 400);
  assert.equal(result.breakdown.labor_profit, 600);
});

test('labor hours are implied from billed labor and labor rate when line-item hours are absent', () => {
  const result = calculateTrueProfit(
    { parts_cost: 0, labor_cost: 900, sublet_cost: 0 },
    profile,
    { laborRate: 90 }
  );

  assert.equal(result.breakdown.labor_hours, 10);
  assert.equal(result.breakdown.labor_cost_dollars, 500);
  assert.equal(result.breakdown.labor_profit, 400);
});

test('zero labor rate with no explicit hours leaves billed labor as labor profit', () => {
  const result = calculateTrueProfit(
    { parts_cost: 0, labor_cost: 900, sublet_cost: 0 },
    profile,
    { laborRate: 0 }
  );

  assert.equal(result.breakdown.labor_hours, null);
  assert.equal(result.breakdown.labor_cost_dollars, 0);
  assert.equal(result.breakdown.labor_profit, 900);
});

test('materials profit remains zero without a billed-materials source', () => {
  const result = calculateTrueProfit(
    { parts_cost: 100, labor_cost: 100, sublet_cost: 100 },
    { ...profile, materials_margin_pct: 1 },
    { laborHours: 0 }
  );

  assert.equal(result.breakdown.materials_profit, 0);
});

test('margin is rounded to a whole percent and guarded when gross is zero', () => {
  const rounded = calculateTrueProfit(
    { parts_cost: 100, labor_cost: 100, sublet_cost: 100 },
    profile,
    { laborHours: 1 }
  );
  const zeroGross = calculateTrueProfit(
    { parts_cost: 0, labor_cost: 0, sublet_cost: 0, referral_fee: 25 },
    profile,
    { laborHours: 0 }
  );

  assert.equal(rounded.trueProfit, 80);
  assert.equal(rounded.margin, 27);
  assert.equal(zeroGross.margin, 0);
});
