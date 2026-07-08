const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

function installMock(relativePath, exportsValue) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue,
  };
}

function clearEstimateModules() {
  const segments = [
    `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}estimateLineItems.js`,
    `${path.sep}backend${path.sep}src${path.sep}db${path.sep}index.js`,
    `${path.sep}backend${path.sep}src${path.sep}services${path.sep}profit.js`,
  ];
  for (const key of Object.keys(require.cache)) {
    if (segments.some((segment) => key.includes(segment))) delete require.cache[key];
  }
}

function loadEstimateRoute({ adjusterTotals }) {
  clearEstimateModules();
  const calls = { dbRun: [] };
  installMock('../db', {
    async dbGet(sql, params = []) {
      const text = String(sql);
      if (text.includes('FROM repair_orders') && text.includes('deductible_waived')) {
        return { id: params[0], shop_id: params[1], deductible_waived: 0, referral_fee: 0, goodwill_repair_cost: 0 };
      }
      if (text.includes('FROM estimate_metadata')) {
        return { adjuster_totals: JSON.stringify(adjusterTotals) };
      }
      throw new Error(`Unexpected dbGet query: ${text}`);
    },
    async dbAll() { return []; },
    async dbRun(sql, params = []) {
      calls.dbRun.push({ sql: String(sql), params });
      return { rowCount: 1 };
    },
  });
  installMock('../services/profit', { calculateProfit: () => ({ trueProfit: 0 }) });
  installMock('../middleware/auth', (req, _res, next) => {
    req.user = { id: 'user-1', role: 'admin', shop_id: 'shop-1' };
    next();
  });
  return { calls, route: require('../routes/estimateLineItems') };
}

test('syncRepairOrderFinancials does not write scalar RO money when adjuster totals need review', async () => {
  const { calls, route } = loadEstimateRoute({
    adjusterTotals: {
      parts: 5000,
      body_labor_cost: 2500,
      paint_supplies_cost: 1000,
      sales_tax_cost: 400,
      total_cost_of_repairs: 10000,
    },
  });

  const result = await route.syncRepairOrderFinancials('ro-1', 'shop-1', {
    parts_total: 5000,
    labor_total: 2500,
    sublet_total: 1000,
    tax_amount: 400,
    grand_total: 8900,
  });

  assert.equal(result.needs_review, true);
  assert.equal(result.reconciliation.status, 'needs_review');
  assert.equal(calls.dbRun.length, 0);
});
