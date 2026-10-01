const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateEstimate, allocateInsurance } = require('../services/panelEstimator');
const { calculateProfit, calculateTrueProfit, calculateEstimateProfit } = require('../services/profit');
const money = require('../services/roMoney');

function line(overrides = {}) {
  return { id: 'a', panel_id: 'hood', operation_id: 'repair', category: 'body',
    description: 'Panel work', quantity: 1, unit_price_cents: 10000, taxable: true,
    cost_unit_cents: 4000, cost_source: 'shop', ...overrides };
}
function fixture() {
  return { lines: [
    line({ id: 'body', quantity: 2 }),
    line({ id: 'refinish', operation_id: 'refinish', category: 'refinish' }),
    line({ id: 'parts', operation_id: 'part', category: 'parts', cost_unit_cents: 7000 }),
    line({ id: 'materials', operation_id: 'materials', category: 'materials', unit_price_cents: 5000, cost_unit_cents: 3000 }),
  ], packages: [], discount_cents: 5000, tax_rate_bps: 1000, minimum_cents: 0,
  target_margin_bps: 4000, overhead_cents: 0 };
}
const insurance = () => ({ total_cents: 180000, covered_cents: 160000, deductible_cents: 50000,
  uncovered_cents: 20000, adjustment_cents: 0, paid_cents: 0 });

test('F1 exact sell, tax, cost, contribution, margin and ceiling target', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const { sell, costs } = calculateEstimate(input);
  assert.equal(sell.subtotal_cents, 45000);
  assert.equal(sell.net_cents, 40000);
  assert.equal(sell.tax_cents, 4000);
  assert.equal(sell.total_cents, 44000);
  assert.equal(costs.known_subtotal_cents, 22000);
  assert.equal(costs.direct_cost_cents, 22000);
  assert.equal(costs.contribution_cents, 18000);
  assert.equal(costs.margin_bps, 4500);
  assert.equal(costs.target_revenue_cents, 36667);
  assert.equal(costs.complete, true);
  assert.deepEqual(costs.missing, []);
  assert.equal(JSON.stringify(input), before);
  assert.equal(calculateEstimateProfit, calculateEstimate);
});

test('F1 missing materials stays unknown; zero is explicit known cost', () => {
  const input = fixture();
  input.lines[3].cost_unit_cents = null;
  const { costs } = calculateEstimate(input);
  assert.equal(costs.known_subtotal_cents, 19000);
  assert.equal(costs.complete, false);
  for (const key of ['direct_cost_cents', 'total_cost_cents', 'contribution_cents', 'margin_bps', 'target_revenue_cents']) assert.equal(costs[key], null);
  assert.deepEqual(costs.missing, [{ id: 'materials', reason: 'missing_unit_cost' }]);
  input.lines[3].cost_unit_cents = 0;
  assert.equal(calculateEstimate(input).costs.complete, true);
  delete input.lines[3].cost_unit_cents;
  assert.equal(calculateEstimate(input).costs.complete, false);
});

test('F2 reconciliation and deposits stay separate from payer responsibility', () => {
  assert.deepEqual(allocateInsurance(insurance()), { complete: true, carrier_cents: 110000,
    customer_cents: 70000, paid_cents: 0, balance_cents: 180000 });
  const allocation = money.allocateInsurance({ ...insurance(), paid_cents: 30000, carrier_approved: true, status: 'approved' });
  assert.deepEqual(allocation, { complete: true, carrier_cents: 110000, customer_cents: 70000, paid_cents: 30000, balance_cents: 150000 });
  assert.deepEqual(allocateInsurance({ ...insurance(), total_cents: 181000, adjustment_cents: 1000 }),
    { complete: true, carrier_cents: 110000, customer_cents: 71000, paid_cents: 0, balance_cents: 181000 });
});

test('every missing/null insurance field gives unknown; invalid and mismatched allocations fail', () => {
  for (const key of Object.keys(insurance())) {
    for (const value of [null, undefined]) {
      const result = allocateInsurance({ ...insurance(), [key]: value });
      assert.equal(result.complete, false);
      assert.equal(result.carrier_cents, null);
      assert.equal(result.customer_cents, null);
      assert.equal(result.balance_cents, null);
    }
    for (const value of [true, false, NaN, Infinity, -1, 0.1, '', '1.0', Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => allocateInsurance({ ...insurance(), [key]: value }));
    }
  }
  for (const overrides of [{ total_cents: 1 }, { deductible_cents: 170000 }, { paid_cents: 180001 }]) {
    assert.throws(() => allocateInsurance({ ...insurance(), ...overrides }), /reconcile/);
  }
  assert.throws(() => allocateInsurance({ ...insurance(), covered_cents: null, paid_cents: true }));
});

test('exact fractional quantity extension rounds half up for sell and cost', () => {
  const { sell, costs } = calculateEstimate({ lines: [line({ quantity: '0.15', unit_price_cents: 10, cost_unit_cents: 10 })] });
  assert.equal(sell.net_cents, 2);
  assert.equal(costs.direct_cost_cents, 2);
  assert.equal(sell.lines[0].quantity, '0.15');
  assert.equal(calculateEstimate({ lines: [line({ quantity: 0.29, unit_price_cents: 100 })] }).sell.net_cents, 29);
});

test('invalid numeric inputs and output overflow fail closed', () => {
  const invalid = [true, false, NaN, Infinity, -Infinity, -1, -0, '', ' ', '1e2', '01', {}, [], 1n, Number.MAX_SAFE_INTEGER + 1, '9'.repeat(100)];
  for (const value of invalid) {
    for (const key of ['quantity', 'unit_price_cents', 'cost_unit_cents']) {
      assert.throws(() => calculateEstimate({ lines: [line({ [key]: value })] }), `${key}: ${String(value)}`);
    }
    for (const key of ['discount_cents', 'tax_rate_bps', 'minimum_cents', 'target_margin_bps', 'overhead_cents']) {
      assert.throws(() => calculateEstimate({ lines: [line()], [key]: value }), `${key}: ${String(value)}`);
    }
  }
  for (const value of ['1.001', 0.001, '1.000', 1000001, null]) assert.throws(() => calculateEstimate({ lines: [line({ quantity: value })] }));
  for (const key of ['unit_price_cents', 'cost_unit_cents']) assert.throws(() => calculateEstimate({ lines: [line({ [key]: 1.1 })] }));
  for (const key of ['discount_cents', 'tax_rate_bps', 'minimum_cents']) assert.throws(() => calculateEstimate({ lines: [line()], [key]: null }));
  assert.throws(() => calculateEstimate({ lines: [line({ unit_price_cents: null })] }));
  assert.throws(() => calculateEstimate({ lines: [line()], target_margin_bps: 10000 }));
  assert.throws(() => calculateEstimate({ lines: [line()], tax_rate_bps: 10001 }));
  assert.throws(() => calculateEstimate({ lines: [line()], discount_cents: 10001 }));
  assert.throws(() => calculateEstimate({ lines: [line({ unit_price_cents: 9999999999, quantity: 2 })] }));
  assert.throws(() => calculateEstimate({ lines: [line({ unit_price_cents: 9999999999 })], tax_rate_bps: 1 }));
  assert.throws(() => calculateEstimate({ lines: [line({ cost_unit_cents: 9999999999 })], target_margin_bps: 9999 }));
});

function packageFixture() {
  return { lines: [line({ package_id: 'p', included: true }),
    line({ id: 'b', operation_id: 'refinish', category: 'refinish', unit_price_cents: 10000, cost_unit_cents: 2000, package_id: 'p', included: true })],
  packages: [{ id: 'p', price_cents: 15000, included_operations: ['repair', 'refinish'], taxable: true }], tax_rate_bps: 1000 };
}

test('fixed packages charge once, retain underlying costs, and charge explicit extras', () => {
  const input = packageFixture();
  input.lines.push(line({ id: 'c', operation_id: 'materials', category: 'materials', unit_price_cents: 1000, cost_unit_cents: 100, package_id: 'p', included: false }));
  const { sell, costs } = calculateEstimate(input);
  assert.equal(sell.net_cents, 16000);
  assert.equal(sell.tax_cents, 1600);
  assert.equal(costs.direct_cost_cents, 6100);
  assert.equal(sell.lines[0].net_cents, 0);
  assert.equal(sell.buckets.length, 2);
  input.lines[0].cost_unit_cents = null;
  assert.equal(calculateEstimate(input).costs.complete, false);
});

test('packages reject implicit membership, unallocated mixed tax, unknown refs and repeated membership', () => {
  for (const mutate of [
    input => { delete input.packages[0].included_operations; },
    input => { input.packages[0].included_operations = []; },
    input => { input.packages[0].included_operations = ['repair']; },
    input => { input.packages[0].included_operations.push('repair'); },
    input => { input.packages[0].included_operations.push('missing'); },
    input => { input.lines[0].taxable = false; },
    input => { input.packages[0].taxable = false; },
    input => { input.lines[0].package_id = 'unknown'; },
    input => { input.lines[0].included = false; },
    input => { input.lines[0].quantity = 0; },
    input => { input.packages.push(input.packages[0]); },
  ]) {
    const input = packageFixture(); mutate(input);
    assert.throws(() => calculateEstimate(input));
  }
  assert.throws(() => calculateEstimate({ lines: [line({ included: true })] }));
});

test('B1 mixed-tax package allocations charge once and reject incomplete or conflicting allocations', () => {
  const input = packageFixture();
  input.lines[0].taxable = false;
  Object.assign(input.packages[0], { taxable: null, sell_allocation_cents: { body: 10001, refinish: 4999 } });
  const result = calculateEstimate(input);
  assert.equal(result.sell.subtotal_cents, 15000);
  assert.equal(result.sell.tax_cents, 500);
  assert.equal(result.sell.total_cents, 15500);
  assert.equal(result.costs.direct_cost_cents, 6000);
  assert.deepEqual(result.sell.packages[0].sell_allocation_cents, { body: 10001, refinish: 4999 });
  assert.deepEqual(result.sell.buckets.map(b => [b.category, b.gross_cents, b.taxable]), [['body', 10001, false], ['refinish', 4999, true]]);
  assert.ok(result.sell.lines.every(l => l.net_cents === 0));
  assert.deepEqual(calculateEstimate({ ...input, lines: [...input.lines].reverse() }), result);
  const changedCosts = structuredClone(input); changedCosts.lines[0].cost_unit_cents = null;
  assert.deepEqual(calculateEstimate(changedCosts).sell, result.sell);
  for (const allocation of [{ body: 15000 }, { body: 10000, refinish: 4999 },
    { body: 10001, refinish: 4999, parts: 0 }, { body: -1, refinish: 15001 },
    { body: 10000.5, refinish: 4999.5 }, { body: null, refinish: 15000 }]) {
    assert.throws(() => calculateEstimate({ ...input, packages: [{ ...input.packages[0], sell_allocation_cents: allocation }] }));
  }
  assert.throws(() => calculateEstimate({ ...input, packages: [{ ...input.packages[0], taxable: true }] }));
  const homogeneous = packageFixture();
  homogeneous.packages[0].sell_allocation_cents = { body: 0, refinish: 15000 };
  assert.equal(calculateEstimate(homogeneous).sell.total_cents, 16500);
});

test('B1 scoped discounts use residual largest remainders, stable IDs, and package targets', () => {
  const input = { lines: [line({ id: 'a', unit_price_cents: 5 }),
    line({ id: 'b', panel_id: 'roof', unit_price_cents: 5, taxable: false })],
  discounts: [{ id: 'b', amount_cents: 1, line_ids: ['b', 'a'] },
    { id: 'a', amount_cents: 1, line_ids: ['b', 'a'] }], discount_cents: 1, tax_rate_bps: 1000 };
  const result = calculateEstimate(input);
  assert.equal(result.sell.discount_cents, 3);
  assert.deepEqual(result.sell.buckets.map(b => [b.discount_cents, b.net_cents]), [[2, 3], [1, 4]]);
  assert.deepEqual(calculateEstimate({ ...input, lines: [...input.lines].reverse(), discounts: [...input.discounts].reverse() }), result);
  const overlapping = { ...input, discount_cents: 0, discounts: [
    { id: 'a', amount_cents: 3, line_ids: ['a'] }, { id: 'b', amount_cents: 3, line_ids: ['a', 'b'] }] };
  const overlapResult = calculateEstimate(overlapping);
  assert.deepEqual(overlapResult.sell.buckets.map(b => b.net_cents), [1, 3]);
  assert.deepEqual(calculateEstimate({ ...overlapping, discounts: [...overlapping.discounts].reverse() }), overlapResult);
  for (const discounts of [[{ id: 'x', amount_cents: 1, line_ids: ['missing'] }],
    [{ id: 'x', amount_cents: 1, line_ids: ['a', 'a'] }], [{ id: 'x', amount_cents: 1 }],
    [{ id: 'x', amount_cents: 6, line_ids: ['a'] }],
    [{ id: 'x', amount_cents: 1, line_ids: ['a'], package_ids: ['p'] }],
    [{ id: 'x', amount_cents: 1, package_ids: ['missing'] }],
    [input.discounts[0], input.discounts[0]],
    [{ id: 'a', amount_cents: 5, line_ids: ['a'] }, { id: 'b', amount_cents: 1, line_ids: ['a'] }]]) {
    assert.throws(() => calculateEstimate({ ...input, discounts }));
  }
  assert.throws(() => calculateEstimate({ ...input, discount_cents: 9 }));
  const pkg = packageFixture(); pkg.lines[0].taxable = false;
  Object.assign(pkg.packages[0], { taxable: null, sell_allocation_cents: { body: 10000, refinish: 5000 } });
  pkg.discounts = [{ id: 'p-discount', amount_cents: 3000, package_ids: ['p'] }]; pkg.discount_cents = 1;
  const sale = calculateEstimate(pkg).sell;
  assert.deepEqual(sale.buckets.map(b => b.net_cents), [7999, 4000]);
  assert.equal(sale.tax_cents, 400); assert.equal(sale.total_cents, 12399);
  assert.throws(() => calculateEstimate({ ...pkg, discounts: [{ id: 'x', amount_cents: 1, line_ids: ['a'] }] }));
  assert.throws(() => calculateEstimate({ ...pkg, discounts: [{ id: 'x', amount_cents: 1, package_ids: ['p', 'p'] }] }));
  const minimum = calculateEstimate({ lines: [line({ unit_price_cents: 10 })],
    discounts: [{ id: 'x', amount_cents: 3, line_ids: ['a'] }], discount_cents: 2, minimum_cents: 8 });
  assert.equal(minimum.sell.minimum_adjustment_cents, 3); assert.equal(minimum.sell.net_cents, 8);
});

test('B1 private provenance does not change amount completeness or public sell', () => {
  const base = calculateEstimate({ lines: [line({ cost_source: null })] });
  for (const source of ['estimated', 'quoted', 'actual', 'legacy arbitrary source']) {
    const result = calculateEstimate({ lines: [line({ cost_source: source })] });
    assert.equal(result.costs.lines[0].cost_source, source);
    assert.equal(result.costs.direct_cost_cents, base.costs.direct_cost_cents);
    assert.deepEqual(result.sell, base.sell);
    const missing = calculateEstimate({ lines: [line({ cost_source: source, cost_unit_cents: null })] });
    assert.equal(missing.costs.complete, false); assert.equal(missing.costs.lines[0].cost_source, source);
  }
});

test('package repeated operations require scoped references', () => {
  const input = packageFixture();
  input.lines[1].operation_id = 'repair';
  input.lines[1].panel_id = 'door';
  input.packages[0].included_operations = ['repair'];
  assert.throws(() => calculateEstimate(input), /Ambiguous/);
  input.packages[0].included_operations = [{ panel_id: 'hood', operation_id: 'repair' }, { panel_id: 'door', operation_id: 'repair' }];
  assert.equal(calculateEstimate(input).sell.net_cents, 15000);
});

test('shared scope and operation identity deduplicate both sale and cost', () => {
  const input = { lines: [line({ id: 'z', shared_key: 'setup', description: 'One' }),
    line({ id: 'a', shared_key: 'setup', panel_id: 'door', description: 'Two' })] };
  const result = calculateEstimate(input);
  assert.equal(result.sell.net_cents, 10000);
  assert.equal(result.costs.direct_cost_cents, 4000);
  assert.equal(result.sell.lines.length, 1);
  assert.equal(result.sell.lines[0].id, 'a');
  assert.deepEqual(calculateEstimate({ lines: [...input.lines].reverse() }), result);
  for (const overrides of [{ unit_price_cents: 999 }, { quantity: 2 }, { taxable: false }, { cost_unit_cents: null }, { cost_source: 'other' }]) {
    assert.throws(() => calculateEstimate({ lines: [input.lines[0], { ...input.lines[1], ...overrides }] }), /duplicate/);
  }
});

test('same description keeps distinct scopes/operations; duplicate nonshared charges fail', () => {
  for (const overrides of [{ panel_id: 'door' }, { operation_id: 'refinish' }, { category: 'materials' }, { shared_key: 'other' }]) {
    assert.equal(calculateEstimate({ lines: [line(), line({ id: 'b', ...overrides })] }).sell.net_cents, 20000);
  }
  assert.equal(calculateEstimate({ lines: [line({ shared_key: 'one' }), line({ id: 'b', shared_key: 'two' })] }).sell.net_cents, 20000);
  assert.throws(() => calculateEstimate({ lines: [line(), line({ id: 'b' })] }), /duplicate/);
  assert.throws(() => calculateEstimate({ lines: [line(), line({ operation_id: 'refinish' })] }), /Duplicate line id/);
  assert.throws(() => calculateEstimate({ lines: [line(), line({ id: 'b', operation_id: 'replace' })] }), /Repair and replace/);
});

test('inspection-required is pending, not a zero-priced authorized operation', () => {
  for (const overrides of [{ category: 'inspection-required' }, { operation_id: 'inspection_required' }]) {
    const { sell, costs } = calculateEstimate({ lines: [line({ ...overrides, unit_price_cents: null })], target_margin_bps: 4000 });
    assert.equal(sell.inspection_required, true);
    assert.equal(sell.lines[0].unit_price_cents, null);
    assert.equal(sell.lines[0].net_cents, null);
    assert.deepEqual(sell.buckets, []);
    assert.equal(costs.complete, false);
    assert.equal(costs.target_revenue_cents, null);
  }
  const input = packageFixture(); input.lines[0].category = 'inspection_required';
  assert.throws(() => calculateEstimate(input));
});

test('zero revenue margin is null; no inferred target; overhead explicit or unknown', () => {
  const result = calculateEstimate({ lines: [line({ unit_price_cents: 0, cost_unit_cents: 0 })] });
  assert.equal(result.sell.net_cents, 0);
  assert.equal(result.costs.margin_bps, null);
  assert.equal(result.costs.target_margin_bps, null);
  assert.equal(result.costs.target_revenue_cents, null);
  assert.equal(result.costs.complete, true);
  assert.equal(calculateEstimate({ lines: [] }).costs.margin_bps, null);
  assert.equal(calculateEstimate({ lines: [line({ quantity: 0, cost_unit_cents: null })] }).costs.complete, false);
  const costs = calculateEstimate({ lines: [line()], overhead_cents: 1000, target_margin_bps: 0 }).costs;
  assert.equal(costs.total_cost_cents, 5000);
  assert.equal(costs.contribution_cents, 6000);
  assert.equal(costs.after_overhead_cents, 5000);
  assert.equal(costs.target_revenue_cents, 4000);
  const unknown = calculateEstimate({ lines: [line()], overhead_cents: null, target_margin_bps: 4000 }).costs;
  assert.equal(unknown.direct_cost_cents, 4000);
  assert.equal(unknown.complete, false);
  assert.equal(unknown.margin_bps, 6000);
  assert.equal(unknown.target_revenue_cents, 6667);
  assert.equal(calculateEstimate({ lines: [line()], overhead_cents: null, target_margin_bps: 4000, include_overhead_in_target: true }).costs.target_revenue_cents, null);
  assert.equal(calculateEstimate({ lines: [line({ unit_price_cents: 1000 })] }).costs.contribution_cents, -3000);
});

test('minimum adjustment is visible after discount and taxed explicitly', () => {
  const { sell } = calculateEstimate({ lines: [line()], discount_cents: 1000, minimum_cents: 15000, tax_rate_bps: 1000 });
  assert.equal(sell.minimum_adjustment_cents, 6000);
  assert.equal(sell.net_cents, 15000);
  assert.equal(sell.tax_cents, 1500);
  assert.deepEqual(sell.buckets.find(bucket => bucket.kind === 'minimum'), { id: 'minimum_adjustment', kind: 'minimum', taxable: true,
    gross_cents: 6000, discount_cents: 0, net_cents: 6000, tax_cents: 600, total_cents: 6600 });
  assert.throws(() => calculateEstimate({ lines: [], minimum_cents: 100 }));
  assert.throws(() => calculateEstimate({ lines: [line({ operation_id: 'inspection_required' })], minimum_cents: 100 }));
  assert.throws(() => calculateEstimate({ lines: [line({ quantity: 0 })], minimum_cents: 100 }));
  assert.throws(() => calculateEstimate({ lines: [line(), line({ id: 'b', panel_id: 'door', taxable: false })], minimum_cents: 30000 }));
});

test('mixed tax discount uses stable largest remainders before subtotal tax allocation', () => {
  const lines = [line({ id: 'a', unit_price_cents: 5 }), line({ id: 'b', panel_id: 'door', unit_price_cents: 5, taxable: false })];
  const input = { lines, discount_cents: 1, tax_rate_bps: 1000 };
  const result = calculateEstimate(input);
  assert.deepEqual(result.sell.buckets.map(bucket => [bucket.discount_cents, bucket.net_cents, bucket.tax_cents]), [[1, 4, 0], [0, 5, 0]]);
  assert.equal(result.sell.total_cents, 9);
  assert.deepEqual(calculateEstimate({ ...input, lines: [...lines].reverse() }), result);
  assert.equal(calculateEstimate({ lines: [lines[0], { ...lines[1], taxable: true }], tax_rate_bps: 1000 }).sell.tax_cents, 1);
  assert.equal(calculateEstimate({ lines: [lines[0]], discount_cents: 5, tax_rate_bps: 1000 }).sell.total_cents, 0);
});

test('public sell uses a deep allowlist excluding private inputs and target settings', () => {
  const input = packageFixture();
  input.private_notes = 'secret'; input.target_margin_bps = 4000;
  for (const entry of [...input.lines, ...input.packages]) {
    entry.private_notes = 'secret'; entry.margin = 99; entry.cost_detail = { confidential: true };
    entry.nested = { cost_cents: 777 }; entry.target_margin_bps = 9900;
  }
  input.packages[0].included_operations = [
    { panel_id: 'hood', operation_id: 'repair', cost_cents: 123, private_notes: 'secret' },
    { panel_id: 'hood', operation_id: 'refinish', cost_cents: 123, private_notes: 'secret' },
  ];
  const { sell } = calculateEstimate(input);
  function inspect(value) {
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, /cost|margin|private|target|nested|source/);
      inspect(child);
    }
  }
  inspect(sell);
  assert.doesNotMatch(JSON.stringify(sell), /secret|confidential/);
});

test('legacy profit serialized bytes and money helper behavior remain unchanged', () => {
  const ro = { parts_cost: 100, labor_cost: 200, sublet_cost: 50, deductible_waived: 5, referral_fee: 10, goodwill_repair_cost: 15 };
  const legacy = '{"gross":350,"cogs":150,"naiveProfit":200,"nyAdjustments":30,"trueProfit":170,"margin":49}';
  assert.equal(JSON.stringify(calculateProfit(ro)), legacy);
  assert.equal(JSON.stringify(calculateTrueProfit(ro, null)), legacy);
  assert.equal(JSON.stringify(calculateTrueProfit(ro, {})), legacy);
  assert.equal(calculateTrueProfit(ro, null).costProfileApplied, false);
  assert.equal(JSON.stringify(calculateTrueProfit(ro, { blended_labor_cost_per_hr: 20, parts_margin_pct: 0.3, sublet_margin_pct: 0.2 }, { laborHours: 3 })),
    '{"gross":350,"cogs":150,"naiveProfit":200,"nyAdjustments":30,"trueProfit":150,"margin":43,"breakdown":{"labor_profit":140,"parts_profit":30,"materials_profit":0,"sublet_profit":10,"labor_cost_dollars":60,"labor_hours":3,"nyAdjustments":30},"costProfileApplied":true}');
  assert.equal(JSON.stringify(calculateTrueProfit({}, null)), '{"gross":0,"cogs":0,"naiveProfit":0,"nyAdjustments":0,"trueProfit":0,"margin":0}');
  assert.equal(money.dollarsToCents('$1,234.56'), 123456);
  assert.equal(money.roundToIntCents(null), null);
  assert.equal(money.reconcilePaymentStatus({ paidCents: 10, owedCents: 20 }), 'partial');
});

 test('F1 overhead is separate from gross contribution and target basis is explicit', () => {
  for (const included of [false, true]) {
    const { costs } = calculateEstimate({ ...fixture(), overhead_cents: 2000, include_overhead_in_target: included });
    assert.equal(costs.contribution_cents, 18000);
    assert.equal(costs.margin_bps, 4500);
    assert.equal(costs.after_overhead_cents, 16000);
    assert.equal(costs.target_revenue_cents, included ? 40000 : 36667);
    assert.equal(costs.include_overhead_in_target, included);
  }
  assert.throws(() => calculateEstimate({ ...fixture(), include_overhead_in_target: 'true' }));
});

test('two five-cent taxable lines allocate one tax cent, independent of order', () => {
  const lines = [line({ id: 'a', unit_price_cents: 5 }), line({ id: 'b', panel_id: 'door', unit_price_cents: 5 })];
  const first = calculateEstimate({ lines, tax_rate_bps: 1000 });
  assert.equal(first.sell.tax_cents, 1);
  assert.deepEqual(first.sell.buckets.map(b => b.tax_cents), [1, 0]);
  assert.equal(first.sell.buckets.reduce((sum, b) => sum + b.tax_cents, 0), first.sell.tax_cents);
  assert.deepEqual(first, calculateEstimate({ lines: lines.reverse(), tax_rate_bps: 1000 }));
});

test('B2 panel minima follow scoped/global discounts and cannot be absorbed by another panel', () => {
  const input = { lines: [line({ id: 'hood', unit_price_cents: 1000 }),
    line({ id: 'roof', panel_id: 'roof', unit_price_cents: 9000, taxable: false })],
  discounts: [{ id: 'hood-off', amount_cents: 200, line_ids: ['hood'] }], discount_cents: 980,
  panel_minima: [{ panel_id: 'hood', minimum_cents: 2000 }], tax_rate_bps: 1000 };
  const result = calculateEstimate(input);
  assert.equal(result.sell.discount_cents, 1180);
  assert.equal(result.sell.minimum_adjustment_cents, 1280);
  assert.equal(result.sell.net_cents, 10100);
  assert.equal(result.sell.tax_cents, 200);
  assert.equal(result.sell.total_cents, 10300);
  assert.deepEqual(result.sell.buckets.find(b => b.kind === 'panel_minimum'), {
    id: 'hood:minimum_adjustment', panel_id: 'hood', kind: 'panel_minimum', taxable: true,
    gross_cents: 1280, discount_cents: 0, net_cents: 1280, tax_cents: 128, total_cents: 1408 });
  assert.deepEqual(calculateEstimate({ ...input, lines: [...input.lines].reverse() }), result);
  const homogeneous = { ...input, lines: input.lines.map(l => ({ ...l, taxable: true })), minimum_cents: 10500 };
  assert.equal(calculateEstimate(homogeneous).sell.minimum_adjustment_cents, 1680);
  assert.equal(calculateEstimate(homogeneous).sell.net_cents, 10500);
  for (const panel_minima of [[{ panel_id: 'missing', minimum_cents: 1 }],
    [input.panel_minima[0], input.panel_minima[0]], [{ panel_id: 'hood', minimum_cents: -1 }]]) {
    assert.throws(() => calculateEstimate({ ...input, panel_minima }));
  }
  assert.throws(() => calculateEstimate({ ...input, lines: [...input.lines,
    line({ id: 'hood-part', category: 'parts', operation_id: 'parts', taxable: false, unit_price_cents: 1 })] }), /homogeneous/);
});

test('B2 package minimum counts package once and rejects ambiguous mixed-tax top-ups', () => {
  const lines = [line({ id: 'body', package_id: 'pkg', included: true }),
    line({ id: 'paint', operation_id: 'refinish', category: 'refinish', package_id: 'pkg', included: true })];
  const input = { lines, packages: [{ id: 'pkg', price_cents: 1000, taxable: true,
    included_operations: ['repair', 'refinish'] }], panel_minima: [{ panel_id: 'hood', minimum_cents: 2000 }],
  discounts: [{ id: 'off', amount_cents: 100, package_ids: ['pkg'] }], tax_rate_bps: 1000 };
  const result = calculateEstimate(input);
  assert.equal(result.sell.net_cents, 2000); assert.equal(result.sell.tax_cents, 200);
  assert.equal(result.sell.buckets.length, 2); assert.equal(result.costs.direct_cost_cents, 8000);
  input.lines[0].taxable = false;
  input.packages[0].taxable = null;
  input.packages[0].sell_allocation_cents = { body: 500, refinish: 500 };
  assert.throws(() => calculateEstimate(input), /homogeneous/);
});
