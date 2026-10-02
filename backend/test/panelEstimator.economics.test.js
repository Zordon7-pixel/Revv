'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ensurePanelEstimator } = require('../src/db/panelEstimator');
const { createPanelEstimatorDraft } = require('../src/services/panelEstimatorDraft');
const { createPanelEstimatorStore } = require('../src/services/panelEstimatorStore');
const { createPanelEstimatorRevisions } = require('../src/services/panelEstimatorRevisions');
const economics = require('../src/services/panelEstimatorEconomics');

function localDatabase(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55459'); assert.equal(url.pathname, '/revv_panel_test');
  assert.equal(url.search, ''); assert.equal(url.hash, '');
  return { connectionString: value, connectionTimeoutMillis: 3000, statement_timeout: 10000 };
}
const draft = () => ({ assessments: [{ panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light',
  damage_type: 'dent', area: 'center', operation: 'repair', refinish: true, body_hours: 10,
  refinish_hours: 0, body_rate_cents: 10000, refinish_rate_cents: 10000, parts_sell_cents: 0,
  materials_sell_cents: 0, sublet_sell_cents: 0, reviewed: true,
  taxable: { body: false, refinish: false, parts: false, materials: false, sublet: false } }],
  scenario: { payer: 'cash', provenance: 'shop_prepared' }, adjustments: {} });
const costs = (rate = 4000) => ({ lines: [{ panel_id: 'hood', body_cost_rate_cents: rate,
  refinish_cost_rate_cents: 0, parts_cost_cents: 0, materials_cost_cents: 0, sublet_cost_cents: 0,
  private_notes: 'PRIVATE LINE SENTINEL' }], overhead_cents: 0, target_margin_bps: 4000,
  reason: 'PRIVATE REASON SENTINEL', private_notes: 'PRIVATE NOTES SENTINEL' });
const noPrivate = value => {
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|body_cost_rate_cents|known_subtotal_cents|private_notes|after_overhead_cents|target_margin_bps/);
};
const noEconomics = value => {
  noPrivate(value);
  assert.doesNotMatch(JSON.stringify(value), /contribution_cents|direct_cost_cents|panel_economics|known_profit_cents/);
};

test('economics guard rejects ambient, remote, wrong port/database and connection overrides', () => {
  for (const url of [undefined, 'postgresql://remote:55459/revv_panel_test',
    'postgresql://localhost:5432/revv_panel_test', 'postgresql://localhost:55459/revv',
    'postgresql://localhost:55459/revv_panel_test?host=remote']) assert.throws(() => localDatabase(url));
});

test('economics adapter is lazy and narrowly compatible, never masks real query failures', async () => {
  const path = require.resolve('../src/db'), original = require.cache[path];
  try {
    require.cache[path] = { id: path, filename: path, loaded: true, exports: {} };
    assert.equal((await economics.selectedEconomics('shop', ['ro'], 'owner')).size, 0);
    assert.equal(await economics.periodEconomics('shop', 'owner', ''), null);
    require.cache[path].exports.pool = { query: async () => ({ rows: [{ pointer: false, costs: null }] }) };
    assert.equal((await economics.selectedEconomics('shop', ['ro'], 'owner')).size, 0);
    for (const code of ['42P01', '42703', '08006', '42501']) {
      require.cache[path].exports.pool.query = async () => { throw Object.assign(new Error('failure'), { code }); };
      await assert.rejects(economics.selectedEconomics('shop', ['ro'], 'owner'), err => err.code === code);
    }
  } finally { if (original) require.cache[path] = original; else delete require.cache[path]; }
});

test('calculator snapshots project and aggregate without assumptions, private inputs, float addition or role inference', async () => {
  const { calculateEstimate } = require('../src/services/panelEstimator');
  const path = require.resolve('../src/db'), original = require.cache[path];
  const input = { lines: [{ id: 'body', panel_id: 'hood', operation_id: 'repair', category: 'body',
    quantity: 10, unit_price_cents: 10000, cost_unit_cents: 4000, cost_source: 'shop', taxable: false }],
    overhead_cents: 0, tax_rate_bps: 0, discount_cents: 0, minimum_cents: 0 };
  let snapshot = calculateEstimate(input).costs;
  const queries = [];
  try {
    require.cache[path] = { id: path, filename: path, loaded: true, exports: { pool: {
      query: async (sql, params) => {
        queries.push(sql);
        if (sql.includes('pg_attribute')) return { rows: [{ pointer: true, costs: 'revision_costs' }] };
        assert.deepEqual(params, ['shop', ['panel']]);
        return { rows: [{ id: 'panel', active_revision_id: 'revision', ...(sql.includes('c.snapshot') ? { snapshot } : {}) }] };
      },
    } } };
    let selected = await economics.selectedEconomics('shop', ['panel'], 'owner');
    const dto = selected.get('panel').panel_economics;
    assert.deepEqual(dto, { source: 'panel_estimator_revision', revision_id: 'revision',
      contribution_cents: 60000, direct_cost_cents: 40000, margin_bps: 6000, complete: true, missing_count: 0 });
    noPrivate(dto);
    const rows = [{ id: 'panel', true_profit: '920.00' }, { id: 'legacy', true_profit: '0.10' }, { id: 'legacy2', true_profit: '0.20' }];
    const aggregate = economics.summarizeEconomics(rows, selected, 'owner');
    assert.equal(aggregate.profit_cents, 60030); assert.equal(aggregate.known_profit_cents, 60030);
    assert.equal(aggregate.unknown_count, 0); assert.equal(aggregate.profit_complete, true);
    const redacted = economics.redactSelectedRO({ id: 'panel', true_profit: 920, profit: { trueProfit: 920 } }, selected);
    assert.equal(redacted.true_profit, null); assert.equal(redacted.profit, null); noEconomics(redacted);
    for (const role of ['assistant', 'technician', 'customer', 'superadmin', undefined]) {
      queries.length = 0;
      const unauthorized = await economics.selectedEconomics('shop', ['panel'], role);
      assert.ok(!queries.some(sql => sql.includes('c.snapshot'))); noEconomics([...unauthorized.values()]);
      // Aggregation also checks the role even if given an already-loaded privileged map.
      const result = economics.summarizeEconomics(rows, selected, role);
      assert.equal(result.profit_cents, null); assert.equal(result.cost_cents, null);
      assert.equal(result.unknown_count, 1); assert.equal(result.profit_complete, false); noEconomics(result);
    }
    snapshot = calculateEstimate({ ...input, lines: [{ ...input.lines[0], cost_unit_cents: null }] }).costs;
    selected = await economics.selectedEconomics('shop', ['panel'], 'admin');
    assert.equal(selected.get('panel').panel_economics.contribution_cents, null);
    assert.equal(selected.get('panel').panel_economics.direct_cost_cents, null);
    let result = economics.summarizeEconomics(rows, selected, 'owner');
    assert.equal(result.profit_cents, null); assert.equal(result.unknown_count, 1); assert.equal(result.known_profit_cents, 30);
    snapshot = calculateEstimate({ ...input, lines: [{ ...input.lines[0], cost_unit_cents: 10000 }] }).costs;
    selected = await economics.selectedEconomics('shop', ['panel'], 'owner');
    result = economics.summarizeEconomics(rows.slice(0, 1), selected, 'owner');
    assert.equal(result.profit_cents, 0); assert.equal(result.profit_complete, true);
    // Missing overhead stays explicitly incomplete even when direct contribution is known.
    snapshot = calculateEstimate({ ...input, overhead_cents: null }).costs;
    selected = await economics.selectedEconomics('shop', ['panel'], 'owner');
    result = economics.summarizeEconomics(rows, selected, 'owner');
    assert.equal(result.profit_cents, null); assert.equal(result.known_profit_cents, 60030); assert.equal(result.unknown_count, 1);
    snapshot = calculateEstimate({ ...input, lines: [{ ...input.lines[0], quantity: 0 }] }).costs;
    selected = await economics.selectedEconomics('shop', ['panel'], 'owner');
    assert.equal(selected.get('panel').panel_economics.margin_bps, null);
    assert.equal(economics.summarizeEconomics([{ id: 'legacy', true_profit: null }], new Map(), 'owner').profit_cents, null);
  } finally { if (original) require.cache[path] = original; else delete require.cache[path]; }
});

test('L3 job-cost handler projects only owner/admin rows from the already loaded map', async () => {
  const initialModules = new Set(Object.keys(require.cache));
  const cached = new Map();
  const stub = (path, exports) => {
    const resolved = require.resolve(path);
    cached.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  const dto = { source: 'panel_estimator_revision', revision_id: 'frozen-complete',
    contribution_cents: 60000, direct_cost_cents: 40000, margin_bps: 6000, complete: true, missing_count: 0 };
  const zero = { ...dto, revision_id: 'frozen-zero', contribution_cents: 0, direct_cost_cents: 100000, margin_bps: 0 };
  const unknown = { ...dto, revision_id: 'frozen-unknown', contribution_cents: null, direct_cost_cents: null,
    margin_bps: null, complete: false, missing_count: 2 };
  // Deliberately give even unauthorized roles a private map to pin the output boundary.
  const selected = new Map([['complete', { panel_economics: dto }], ['zero', { panel_economics: zero }],
    ['unknown', { panel_economics: unknown }]]);
  const rows = ['complete', 'zero', 'unknown', 'legacy'].map(id => ({ id, total: 1000,
    true_profit: 920, parts_cost: 0, labor_cost: 1000, sublet_cost: 0 }));
  let selectedReads = 0, rowReads = 0;
  try {
    stub('../src/db', { pool: { query: () => assert.fail('Unexpected extra database read') }, dbAll: async (sql, params) => {
      rowReads++;
      assert.match(sql, /WHERE ro.shop_id = \$1/); assert.deepEqual(params, ['synthetic-shop']);
      return rows;
    } });
    stub('../src/middleware/auth', (req, res, next) => next());
    stub('../src/services/panelEstimatorEconomics', { ...economics, selectedEconomics: async (shop, ids) => {
      selectedReads++; assert.equal(shop, 'synthetic-shop'); assert.deepEqual(ids, rows.map(row => row.id));
      return selected;
    } });
    const forbidden = () => assert.fail('Unexpected provider invocation');
    stub('../src/services/sms', { sendSMS: forbidden });
    stub('../src/services/mailer', { sendMail: forbidden });
    stub('../src/services/customerBilling', {});
    stub('../src/services/quickbooks', { syncInvoiceForRo: forbidden });
    stub('../src/services/customerOptInConfirmation', { sendCustomerOptInConfirmation: forbidden });
    stub('../src/routes/insuranceOcr', { insuranceOcrLimiter: (req, res, next) => next() });
    const routePath = require.resolve('../src/routes/ros');
    cached.set(routePath, require.cache[routePath]); delete require.cache[routePath];
    const route = require(routePath).stack.find(layer => layer.route?.path === '/job-cost/summary').route;
    assert.equal(route.stack.length, 3); // auth, requireAdmin, handler; real JWT/PG proof is below.
    assert.equal(route.stack[1].handle, require('../src/middleware/roles').requireAdmin);
    const handler = route.stack.at(-1).handle;
    for (const role of ['owner', 'admin', 'assistant', 'superadmin']) {
      let result;
      await handler({ user: { shop_id: 'synthetic-shop', role }, query: {} }, {
        json: body => { result = body; }, status: code => { assert.fail(`Unexpected status ${code}`); },
      });
      assert.equal(result.profit_complete, false); assert.equal(result.grossProfit, null);
      assert.equal(result.totalCost, null); assert.equal(result.profitableCount, null);
      assert.equal(result.rows[0].true_profit, null);
      assert.equal(result.rows[3].true_profit, 920);
      assert.equal(Object.hasOwn(result.rows[3], 'panel_economics'), false);
      if (['owner', 'admin'].includes(role)) {
        assert.deepEqual(result.rows.map(row => row.panel_economics), [dto, zero, unknown, undefined]);
        noPrivate(result);
      } else {
        noEconomics(result);
        for (const row of result.rows) assert.equal(Object.hasOwn(row, 'panel_economics'), false);
      }
    }
    assert.equal(selectedReads, 4); assert.equal(rowReads, 4);
  } finally {
    for (const path of Object.keys(require.cache)) if (!initialModules.has(path)) delete require.cache[path];
    for (const [path, value] of cached) { if (value) require.cache[path] = value; else delete require.cache[path]; }
  }
});

test('L2 real PostgreSQL frozen economics and mounted production RO/dashboard/report routes', { timeout: 60000 }, async t => {
  const config = localDatabase(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL);
  const schema = `panel_economics_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool(config), cached = new Map(), queries = [], providerCalls = [];
  let pool, server, owned = false;
  const previousSecret = process.env.JWT_SECRET;
  const stub = (path, exports) => {
    const resolved = require.resolve(path);
    if (!cached.has(resolved)) cached.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  const fresh = path => {
    const resolved = require.resolve(path);
    if (!cached.has(resolved)) cached.set(resolved, require.cache[resolved]);
    delete require.cache[resolved]; return require(path);
  };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); owned = true;
    pool = new Pool({ ...config, options: `-c search_path=${schema}`, max: 8 });
    await pool.query(`CREATE TABLE shops(id TEXT PRIMARY KEY, tax_rate NUMERIC DEFAULT 0,
        labor_rate NUMERIC DEFAULT 100, blended_labor_cost_per_hr NUMERIC DEFAULT 40,
        parts_margin_pct NUMERIC DEFAULT 40, materials_margin_pct NUMERIC DEFAULT 40, sublet_margin_pct NUMERIC DEFAULT 40);
      CREATE TABLE users(id TEXT PRIMARY KEY, shop_id TEXT, role TEXT, name TEXT, customer_id TEXT, revoke_all_before TIMESTAMPTZ);
      CREATE TABLE revoked_tokens(id TEXT PRIMARY KEY, token_jti TEXT);
      CREATE TABLE customers(id TEXT PRIMARY KEY, name TEXT, phone TEXT);
      CREATE TABLE vehicles(id TEXT PRIMARY KEY, year INTEGER, make TEXT, model TEXT, color TEXT);
      CREATE TABLE repair_orders(id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id),
        customer_id TEXT, vehicle_id TEXT, assigned_to TEXT, ro_number TEXT DEFAULT 'SYNTHETIC',
        parts_cost NUMERIC DEFAULT 0, labor_cost NUMERIC DEFAULT 0, sublet_cost NUMERIC DEFAULT 0,
        tax NUMERIC DEFAULT 0, total NUMERIC DEFAULT 0, estimate_amount NUMERIC DEFAULT 0,
        true_profit NUMERIC DEFAULT 987.65, amount_owed_cents INTEGER DEFAULT 0,
        deductible NUMERIC DEFAULT 0, deductible_waived NUMERIC DEFAULT 0, referral_fee NUMERIC DEFAULT 0,
        goodwill_repair_cost NUMERIC DEFAULT 0, status TEXT DEFAULT 'estimate', notes TEXT,
        estimate_status TEXT, estimate_approved_at TEXT, estimate_approved_by TEXT, estimate_token TEXT,
        insurance_company TEXT, insurance_claim_number TEXT, claim_number TEXT, insurance_approved_amount NUMERIC,
        supplement_status TEXT, supplement_amount NUMERIC, is_drp BOOLEAN DEFAULT FALSE, job_type TEXT,
        payment_status TEXT DEFAULT 'unpaid', payment_received INTEGER DEFAULT 0,
        billing_month TEXT DEFAULT TO_CHAR(NOW(),'YYYY-MM'), revenue_period TEXT DEFAULT 'current',
        carried_over BOOLEAN DEFAULT FALSE, actual_delivery TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE ro_payments(id TEXT PRIMARY KEY, shop_id TEXT, ro_id TEXT, amount_cents INTEGER, status TEXT);
      CREATE TABLE estimate_line_items(id TEXT PRIMARY KEY, ro_id TEXT NOT NULL, shop_id TEXT NOT NULL,
        type TEXT NOT NULL, description TEXT NOT NULL, quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
        unit_price NUMERIC(10,2) NOT NULL DEFAULT 0, total NUMERIC(10,2) GENERATED ALWAYS AS (quantity*unit_price) STORED,
        taxable BOOLEAN NOT NULL DEFAULT FALSE, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE job_status_log(id TEXT PRIMARY KEY, ro_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE parts_orders(id TEXT PRIMARY KEY, ro_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE monthly_goals(shop_id TEXT, year_month TEXT, revenue_goal NUMERIC);`);
    await ensurePanelEstimator(pool);
    const db = { pool: { query: (sql, params) => { queries.push(sql); return pool.query(sql, params); } },
      dbGet: async (sql, params) => (await pool.query(sql, params)).rows[0],
      dbAll: async (sql, params) => (await pool.query(sql, params)).rows,
      dbRun: (sql, params) => pool.query(sql, params) };
    stub('../src/db', db);
    const forbidden = async () => { providerCalls.push('unexpected'); assert.fail('Unexpected provider call'); };
    stub('../src/services/sms', { sendSMS: forbidden, isConfiguredForShop: async () => false });
    stub('../src/services/mailer', { sendMail: forbidden });
    stub('../src/services/email', { sendEmail: forbidden });
    stub('../src/services/stripe', { getStripeClient: forbidden });
    stub('../src/services/quickbooks', { syncInvoiceForRo: forbidden });
    stub('../src/services/customerOptInConfirmation', { sendCustomerOptInConfirmation: forbidden });
    stub('../src/routes/insuranceOcr', { insuranceOcrLimiter: (req, res, next) => next() });
    fresh('../src/services/customerBilling');
    process.env.JWT_SECRET = 'synthetic-panel-economics-only'; fresh('../src/middleware/auth');
    const app = express(); app.use(express.json());
    for (const route of ['ros', 'dashboard', 'reports']) app.use(`/api/${route}`, fresh(`../src/routes/${route}`));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const shopId = randomUUID(), otherShop = randomUUID(), actorId = randomUUID();
    await pool.query('INSERT INTO shops(id) VALUES ($1),($2)', [shopId, otherShop]);
    await pool.query("INSERT INTO users(id,shop_id,role) VALUES ($1,$2,'owner')", [actorId, shopId]);
    const request = async (path, role = 'owner', shop = shopId, method = 'GET', body) => {
      const token = jwt.sign({ id: actorId, shop_id: shop, role, jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '5m' });
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const result = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
      return { status: response.status, body: result };
    };
    const ok = async (...args) => { const result = await request(...args); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
    const newScope = async (shop = shopId) => {
      const roId = randomUUID(); await pool.query('INSERT INTO repair_orders(id,shop_id,assigned_to) VALUES ($1,$2,$3)', [roId, shop, actorId]);
      return { shopId: shop, roId, actorId, role: 'owner' };
    };
    const drafts = createPanelEstimatorDraft(pool), store = createPanelEstimatorStore(pool), revisions = createPanelEstimatorRevisions(pool);
    const commit = async (scope, cost) => {
      if (cost) await store.saveCosts({ ...scope, ...cost, expectedVersion: 0 });
      const body = draft(), preview = await drafts.preview({ ...scope, body });
      return revisions.commit({ ...scope, body: { ...body, expected_version: preview.version,
        input_hash: preview.input_hash, reviewed: true, idempotency_key: randomUUID() } });
    };
    const selected = await newScope(), knownZero = await newScope(), foreign = await newScope(otherShop);
    const revision = await commit(selected, costs()); const zeroRevision = await commit(knownZero, costs(10000)); await commit(foreign, costs(1));
    const dto = { source: 'panel_estimator_revision', revision_id: revision.revision_id,
      contribution_cents: 60000, direct_cost_cents: 40000, margin_bps: 6000, complete: true, missing_count: 0 };
    const legacy = await newScope();
    await pool.query('UPDATE repair_orders SET total=100,parts_cost=10,true_profit=12.34 WHERE shop_id=$1 AND id=$2', [shopId, legacy.roId]);
    await t.test('ten real hours freeze $600 contribution, never $920; commit clears stale profit and preserves payment facts', async () => {
      const ro = (await pool.query('SELECT * FROM repair_orders WHERE shop_id=$1 AND id=$2', [shopId, selected.roId])).rows[0];
      assert.equal(ro.true_profit, null); assert.equal(ro.payment_status, 'unpaid'); assert.equal(ro.payment_received, 0);
      assert.equal(Number(ro.total), 1000); assert.equal(ro.amount_owed_cents, 100000);
      const lines = (await pool.query("SELECT quantity FROM estimate_line_items WHERE shop_id=$1 AND ro_id=$2 AND type='labor'", [shopId, selected.roId])).rows;
      assert.equal(lines.length, 2); assert.equal(lines.reduce((s, row) => s + Number(row.quantity), 0), 2);
      for (const role of ['owner', 'admin']) {
        const detail = await ok(`/ros/${selected.roId}`, role);
        assert.deepEqual(detail.panel_economics, dto); assert.equal(detail.profit_breakdown, null); assert.equal(detail.profit, null);
        assert.equal(detail.true_profit, null); noPrivate(detail);
      }
      const saved = await store.getDraft(selected);
      await store.saveCosts({ ...selected, ...costs(9999), expectedVersion: saved.version });
      assert.deepEqual((await ok(`/ros/${selected.roId}`)).panel_economics, dto);
      assert.equal((await revisions.getCosts(selected)).costs.contribution_cents, 60000);
    });
    await t.test('stale selected legacy profit is redacted across detail/list/invoice/carryover/mutation outputs and roles', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('revv.panel_commit',jsonb_build_array($1::text,$2::text)::text,true)", [shopId, selected.roId]);
        await client.query('UPDATE repair_orders SET true_profit=777.77,carried_over=TRUE WHERE shop_id=$1 AND id=$2', [shopId, selected.roId]);
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
      for (const role of ['owner', 'admin', 'assistant', 'superadmin', 'technician', 'customer']) {
        queries.length = 0;
        const detail = await ok(`/ros/${selected.roId}`, role);
        assert.equal(detail.true_profit, null); assert.equal(detail.profit, null); noPrivate(detail);
        if (!['owner', 'admin'].includes(role)) {
          noEconomics(detail); assert.ok(!queries.some(sql => sql.includes('c.snapshot')));
        }
        const list = await ok('/ros', role);
        assert.equal(list.ros.find(row => row.id === selected.roId).true_profit, null); noEconomics(list);
        const invoice = await ok(`/ros/${selected.roId}/invoice`, role); noEconomics(invoice); assert.equal(invoice.true_profit, null);
      }
      noEconomics(await ok('/ros/carryover-pending', 'assistant'));
      const changed = await ok(`/ros/${selected.roId}/revenue-period`, 'assistant', shopId, 'PUT', { revenue_period: 'current' });
      assert.equal(changed.ro.true_profit, null); noEconomics(changed);
      const edited = await ok(`/ros/${selected.roId}`, 'owner', shopId, 'PUT', { notes: 'ordinary note', true_profit: 999 });
      assert.equal(edited.true_profit, null); assert.equal(edited.notes, 'ordinary note');
      assert.equal(Number((await pool.query('SELECT true_profit FROM repair_orders WHERE id=$1', [selected.roId])).rows[0].true_profit), 777.77);
      const manual = await ok(`/ros/${legacy.roId}`, 'owner', shopId, 'PUT', { true_profit: 12.34 });
      assert.equal(Number(manual.true_profit), 12.34);
    });
    await t.test('known zero and mixed legacy/panel aggregates keep scalar compatibility, cent precision and honest labels', async () => {
      assert.equal((await ok(`/ros/${knownZero.roId}`)).panel_economics.contribution_cents, 0);
      const dashboard = await ok('/dashboard/instruments');
      assert.equal(dashboard.true_profit_cents, 61234); assert.equal(dashboard.known_profit_cents, 61234);
      assert.equal(dashboard.profit_complete, true); assert.equal(dashboard.unknown_count, 0);
      assert.equal(dashboard.profit_source, 'panel_contribution_and_legacy_profit');
      assert.equal(dashboard.profit_margin_percent, 29.16);
      const report = await ok('/reports/summary'); assert.equal(report.profit, 612.34); noPrivate(report);
      assert.equal(report.recent.find(row => row.id === selected.roId).true_profit, null);
      const job = await ok('/ros/job-cost/summary');
      assert.equal(job.grossProfit, 612.34); assert.equal(job.profitableCount, 2); assert.equal(job.totalCost, 1410);
      assert.equal(job.rows.find(row => row.id === selected.roId).true_profit, null); noPrivate(job);
      for (const role of ['owner', 'admin']) {
        const report = await ok('/ros/job-cost/summary', role);
        assert.deepEqual(report.rows.find(row => row.id === selected.roId).panel_economics, dto);
        assert.deepEqual(report.rows.find(row => row.id === knownZero.roId).panel_economics, {
          ...dto, revision_id: zeroRevision.revision_id, contribution_cents: 0,
          direct_cost_cents: 100000, margin_bps: 0,
        });
        assert.equal(Object.hasOwn(report.rows.find(row => row.id === legacy.roId), 'panel_economics'), false);
        noPrivate(report);
      }
      for (const role of ['assistant', 'superadmin']) {
        for (const path of ['/reports/summary', '/ros/job-cost/summary', ...(role === 'superadmin' ? ['/dashboard/instruments'] : [])]) {
          queries.length = 0;
          const result = await ok(path, role); noEconomics(result);
          for (const row of result.rows || []) assert.equal(Object.hasOwn(row, 'panel_economics'), false);
          assert.equal(result.profit_complete, false); assert.equal(result.unknown_count, 2);
          for (const key of ['profit', 'grossProfit', 'true_profit_cents', 'profit_margin_percent', 'avgMargin', 'totalCost', 'profitableCount'])
            if (Object.hasOwn(result, key)) assert.equal(result[key], null);
          assert.ok(!queries.some(sql => sql.includes('c.snapshot')));
        }
      }
    });
    const missing = await newScope(); const missingRevision = await commit(missing);
    await t.test('missing direct costs remain null with known subtotal separate; no partial aggregate masquerades as zero', async () => {
      const detail = await ok(`/ros/${missing.roId}`);
      assert.equal(detail.panel_economics.contribution_cents, null); assert.equal(detail.panel_economics.direct_cost_cents, null);
      assert.equal(detail.panel_economics.margin_bps, null); assert.equal(detail.panel_economics.complete, false);
      assert.ok(detail.panel_economics.missing_count > 0);
      for (const role of ['owner', 'admin']) {
        const dashboard = await ok('/dashboard/instruments', role);
        assert.equal(dashboard.true_profit_cents, null); assert.equal(dashboard.profit_margin_percent, null);
        assert.equal(dashboard.profit_complete, false); assert.equal(dashboard.unknown_count, 1); assert.equal(dashboard.known_profit_cents, 61234);
        const job = await ok('/ros/job-cost/summary', role);
        const missingDto = (await ok(`/ros/${missing.roId}`, role)).panel_economics;
        assert.equal(missingDto.revision_id, missingRevision.revision_id);
        assert.equal(missingDto.complete, false);
        assert.equal(missingDto.contribution_cents, null);
        assert.equal(missingDto.direct_cost_cents, null);
        assert.equal(missingDto.margin_bps, null);
        assert.deepEqual(job.rows.find(row => row.id === missing.roId).panel_economics, missingDto);
        assert.deepEqual(job.rows.find(row => row.id === selected.roId).panel_economics, dto);
        assert.equal(job.rows.find(row => row.id === knownZero.roId).panel_economics.contribution_cents, 0);
        assert.equal(job.grossProfit, null); assert.equal(job.avgMargin, null); assert.equal(job.profitableCount, null); assert.equal(job.totalCost, null);
        const report = await ok('/reports/summary', role); assert.equal(report.profit, null); assert.equal(report.unknown_count, 1);
      }
    });
    await t.test('existing billing/creation period filters, cross-tenant scoping, role gates and exports', async () => {
      const month = (await pool.query("SELECT TO_CHAR(NOW(),'YYYY-MM') AS month")).rows[0].month;
      await pool.query("UPDATE repair_orders SET billing_month='2000-01', created_at='2000-01-01' WHERE shop_id=$1 AND id=$2", [shopId, missing.roId]);
      assert.equal((await ok('/dashboard/instruments')).true_profit_cents, 61234);
      assert.equal((await ok('/reports/summary')).profit, 612.34);
      assert.equal((await ok('/reports/summary?scope=all')).profit, null);
      assert.equal((await ok('/ros/job-cost/summary?from=2001-01-01')).grossProfit, 612.34);
      assert.equal((await ok('/ros/job-cost/summary?to=2000-12-31')).grossProfit, null);
      assert.equal((await request(`/ros/${selected.roId}`, 'owner', otherShop)).status, 404);
      assert.equal((await economics.selectedEconomics(otherShop, [selected.roId], 'owner')).size, 0);
      assert.equal((await ok('/dashboard/instruments', 'owner', otherShop)).true_profit_cents, 99990);
      for (const role of ['technician', 'customer']) for (const path of ['/reports/summary', '/ros/job-cost/summary', '/dashboard/instruments'])
        assert.equal((await request(path, role)).status, 403);
      assert.equal((await request('/dashboard/instruments', 'assistant')).status, 403);
      for (const role of ['owner', 'assistant', 'superadmin']) {
        noEconomics(await ok(`/reports/monthly/${month}`, role));
        const csv = await ok(`/reports/monthly/${month}/csv`, role); noEconomics(csv);
        assert.doesNotMatch(csv, /777\.77|987\.65|60000|40000/);
      }
    });
    await t.test('schema compatibility preserves selected redaction if private costs table is absent', async () => {
      // Rename only this disposable fixture table; selected pointer remains authoritative.
      await pool.query('ALTER TABLE ro_panel_estimator_revision_costs RENAME TO fixture_saved_costs');
      try {
        const map = await economics.selectedEconomics(shopId, [selected.roId], 'owner');
        assert.equal(map.get(selected.roId).panel_economics.contribution_cents, null);
        assert.equal(map.get(selected.roId).panel_economics.complete, false);
        const detail = await ok(`/ros/${selected.roId}`); assert.equal(detail.true_profit, null);
        assert.equal(detail.panel_economics.contribution_cents, null);
      } finally { await pool.query('ALTER TABLE fixture_saved_costs RENAME TO ro_panel_estimator_revision_costs'); }
    });
    assert.deepEqual(providerCalls, []);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    for (const [path, value] of cached) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    if (pool) await pool.end();
    if (owned) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
