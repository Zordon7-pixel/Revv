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

function clearRoMoneyModules() {
  const segments = [
    `${path.sep}backend${path.sep}src${path.sep}services${path.sep}roMoney.js`,
    `${path.sep}backend${path.sep}src${path.sep}db${path.sep}index.js`,
  ];
  for (const key of Object.keys(require.cache)) {
    if (segments.some((segment) => key.includes(segment))) delete require.cache[key];
  }
}

function loadRoMoney({ summary, shop }) {
  clearRoMoneyModules();
  const calls = [];
  installMock('../db', {
    async dbGet(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('FROM estimate_line_items')) return summary;
      if (String(sql).includes('FROM shops')) return shop;
      throw new Error(`Unexpected dbGet query: ${sql}`);
    },
  });
  const roMoney = require('../services/roMoney');
  return { calls, roMoney };
}

test('getRoMoneySummary derives integer cents and applies tax once on taxable aggregate', async () => {
  const { calls, roMoney } = loadRoMoney({
    summary: {
      subtotal: '11.30',
      labor_total: '5.02',
      parts_total: '4.01',
      sublet_total: '1.00',
      other_total: '1.27',
      taxable_subtotal: '10.07',
      line_count: 4,
    },
    shop: { tax_rate: '0.0875' },
  });

  const result = await roMoney.getRoMoneySummary('ro-1', 'shop-1');

  assert.equal(result.lineCount, 4);
  assert.equal(result.taxRate, 0.0875);
  assert.equal(result.subtotalCents, 1130);
  assert.equal(result.laborCents, 502);
  assert.equal(result.partsCents, 401);
  assert.equal(result.subletCents, 100);
  assert.equal(result.otherCents, 127);
  assert.equal(result.taxableSubtotalCents, 1007);
  assert.equal(result.taxCents, 88);
  assert.equal(result.totalCents, 1218);
  assert.deepEqual(calls.map((call) => call.params), [['ro-1', 'shop-1'], ['shop-1']]);
});

test('reconcilePaymentStatus maps paid cents against owed cents', () => {
  const { roMoney } = loadRoMoney({ summary: {}, shop: {} });

  assert.equal(roMoney.reconcilePaymentStatus({ paidCents: 1000, owedCents: 1000 }), 'paid');
  assert.equal(roMoney.reconcilePaymentStatus({ paidCents: 1200, owedCents: 1000 }), 'paid');
  assert.equal(roMoney.reconcilePaymentStatus({ paidCents: 1, owedCents: 1000 }), 'partial');
  assert.equal(roMoney.reconcilePaymentStatus({ paidCents: 0, owedCents: 1000 }), 'unpaid');
  assert.equal(roMoney.reconcilePaymentStatus({ paidCents: 500, owedCents: 0 }), 'unpaid');
  assert.equal(roMoney.reconcilePaymentStatus({ paidCents: 0, owedCents: 0 }), 'unpaid');
});

test('isPaidStatus treats paid and legacy succeeded as paid only', () => {
  const { roMoney } = loadRoMoney({ summary: {}, shop: {} });

  assert.equal(roMoney.isPaidStatus('paid'), true);
  assert.equal(roMoney.isPaidStatus('succeeded'), true);
  assert.equal(roMoney.isPaidStatus(' PAID '), true);
  assert.equal(roMoney.isPaidStatus('partial'), false);
  assert.equal(roMoney.isPaidStatus('unpaid'), false);
  assert.equal(roMoney.isPaidStatus(''), false);
});
