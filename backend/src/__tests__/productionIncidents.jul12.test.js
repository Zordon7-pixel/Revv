const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function installMock(relativePath, exportsValue) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

function clearEstimateModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}routes${path.sep}estimateLineItems.js`) || key.includes(`${path.sep}db${path.sep}index.js`)) {
      delete require.cache[key];
    }
  }
}

test('shop schema creates and backfills the paint rate used by supplement analysis', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '../db/index.js'), 'utf8');
  const migrationSource = fs.readFileSync(path.join(__dirname, '../db/migrate.js'), 'utf8');
  const schemaSource = fs.readFileSync(path.join(__dirname, '../db/schema.pg.sql'), 'utf8');
  const marketSource = fs.readFileSync(path.join(__dirname, '../routes/market.js'), 'utf8');

  assert.match(indexSource, /CREATE TABLE IF NOT EXISTS shops[\s\S]*paint_rate REAL DEFAULT 62/);
  assert.match(indexSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS paint_rate REAL DEFAULT 62/);
  assert.match(migrationSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS paint_rate NUMERIC\(10,2\) DEFAULT 62/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS shops[\s\S]*paint_rate NUMERIC\(10,2\) DEFAULT 62/);
  assert.match(marketSource, /fields\.push\('paint_rate'\)/);
  assert.doesNotMatch(schemaSource, /ADD CONSTRAINT IF NOT EXISTS/);
  assert.match(schemaSource, /DO \$\$[\s\S]*ADD CONSTRAINT fk_users_customer_id[\s\S]*WHEN duplicate_object THEN NULL/);
});

test('customer list does not select a production column that is absent', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/customers.js'), 'utf8');
  const listRoute = source.slice(source.indexOf("router.get('/', auth"), source.indexOf("router.get('/:id/full'"));
  assert.doesNotMatch(listRoute, /c\.updated_at/);
  assert.match(listRoute, /WHERE c\.shop_id::text = \$1::text/);
});

test('insurer totals remain authoritative over inflated imported line sums', async () => {
  clearEstimateModules();
  installMock('../db', {
    async dbGet(sql) {
      const text = String(sql);
      if (text.includes('SUM(total)')) {
        return {
          subtotal: 24440.11,
          labor_total: 230,
          parts_total: 21655.11,
          sublet_total: 2540,
          other_total: 15,
          taxable_subtotal: 0,
          line_count: 58,
        };
      }
      if (text.includes('FROM estimate_metadata')) {
        return {
          adjuster_totals: {
            parts: 9135.11,
            subtotal: 12243.51,
            body_labor_cost: 1404,
            paint_labor_cost: 618,
            frame_labor_cost: 120,
            paint_supplies_cost: 391.4,
            miscellaneous: 570,
            other_charges: 5,
            sales_tax_cost: 489.74,
            county_tax_cost: 550.96,
            other_tax_1_cost: 45.91,
            total_cost_of_repairs: 13330.12,
            deductible: 1000,
            net_cost_of_repairs: 12330.12,
          },
        };
      }
      if (text.includes('FROM repair_orders ro')) return { id: 'ro-1', shop_id: 'shop-1', tax_rate: 0.0875 };
      throw new Error(`Unexpected query: ${text}`);
    },
    async dbAll() { return []; },
    async dbRun() { throw new Error('read-only test'); },
  });
  installMock('../middleware/auth', (_req, _res, next) => next());

  const route = require('../routes/estimateLineItems');
  const summary = await route.getSummary('ro-1', 'shop-1');

  assert.equal(summary.source, 'adjuster_totals');
  assert.equal(summary.line_subtotal, 24440.11);
  assert.equal(summary.subtotal, 12243.51);
  assert.equal(summary.parts_total, 9135.11);
  assert.equal(summary.labor_total, 2142);
  assert.equal(summary.tax_amount, 1086.61);
  assert.equal(summary.grand_total, 13330.12);
  assert.equal(summary.deductible, 1000);
  assert.equal(summary.net_estimate_total, 12330.12);
  assert.equal(summary.financial_review_required, false);
});
