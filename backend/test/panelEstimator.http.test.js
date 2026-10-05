'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const n = require('../src/services/panelEstimatorStore');
const { assembleDraft, hashInputs, quoteDTO } = require('../src/services/panelEstimatorDraft');
const { normalizePreset, createPanelEstimatorPresets } = require('../src/services/panelEstimatorPresets');
const { ensurePanelEstimator } = require('../src/db/panelEstimator');

const taxable = () => ({ body: true, refinish: true, parts: true, materials: true, sublet: true });
const panel = (patch = {}) => ({ panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light',
  operation: 'repair', refinish: true, body_hours: 2, refinish_hours: 1, body_rate_cents: 10000,
  refinish_rate_cents: 10000, parts_sell_cents: 10000, materials_sell_cents: 5000, sublet_sell_cents: 0,
  taxable: taxable(), reviewed: true, ...patch });
const draft = (patch = {}) => ({ assessments: [panel()], scenario: { payer: 'cash', provenance: 'shop_prepared' },
  adjustments: { discount_cents: 5000, minimum_cents: 0 }, ...patch });
const privateSettings = () => ({ lines: [{ panel_id: 'hood', body_cost_rate_cents: 4000,
  refinish_cost_rate_cents: 4000, parts_cost_cents: 7000, materials_cost_cents: 3000, sublet_cost_cents: 0,
  private_notes: 'PRIVATE line note' }], overhead_cents: 0, target_margin_bps: 4000,
  private_notes: 'PRIVATE overall note', reason: 'PRIVATE reason' });
function preset() {
  const source = panel();
  return { contract_version: 1, name: 'Explicit hood repair',
    match: { panel_id: source.panel_id, body_style: source.body_style, operation: source.operation, severity: source.severity },
    sell_settings: Object.fromEntries(['body_hours', 'refinish_hours', 'refinish', ...n.SELL, 'taxable'].map(k => [k, source[k]])),
    private_cost_config: { body_cost_rate_cents: 4000, target_margin_bps: 4000, private_notes: 'PRIVATE preset note' }, reason: 'PRIVATE preset reason' };
}
function noPrivate(value, path = '') {
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    // Comparison arrays carry the exact same assessment DTO at before/after.
    const assessmentComparison = /^(?:quote\.)?comparisons\.\d+\.differences\.\d+$/.test(path) &&
      value.path === 'scope.assessments' && ['before', 'after'].includes(key);
    const nestedPath = path ? `${path}.${key}` : key;
    const childPath = assessmentComparison ? 'scope.assessments' :
      nestedPath.replace(/^(?:quote\.)?comparisons\.\d+\.scope\./, 'scope.');
    if (!/^(?:quote\.)?(?:scope\.)?assessments\.\d+\.(?:preset_override|deferral)\.reason$/.test(childPath))
      assert.doesNotMatch(key, /cost|private|margin|target|reason|created_by/);
    noPrivate(child, childPath);
  }
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
}
function calculate(input = draft(), cost = privateSettings(), taxRateBps = 1000, paidCents = 0) {
  return assembleDraft({ draft: n.publicSnapshot(input), costs: n.privateSnapshot(cost), taxRateBps, paidCents });
}

test('pure draft F1, unknowns, explicit zero, review flags and quote allowlist', () => {
  const result = calculate();
  assert.equal(result.sell.totals.total_cents, 44000);
  assert.equal(result.costs.direct_cost_cents, 22000);
  assert.equal(result.costs.contribution_cents, 18000);
  assert.equal(result.costs.target_revenue_cents, 36667);
  assert.equal(result.sell.allocation.customer_cents, 44000);
  assert.equal(result.sell.allocation.carrier_cents, 0);
  noPrivate(result.sell);
  for (const patch of [{ body_hours: null }, { body_rate_cents: null }, { materials_sell_cents: null },
    { operation: 'inspection-required' }, { body_style: null }, { severity: null }, { taxable: {} }]) {
    const incomplete = calculate(draft({ assessments: [panel(patch)] }));
    assert.equal(incomplete.sell.complete, false);
    assert.equal(incomplete.sell.totals.total_cents, null);
    assert.ok(incomplete.sell.review_flags.length);
    assert.equal(incomplete.costs.contribution_cents, null);
  }
  assert.equal(calculate(draft(), privateSettings(), null).sell.totals.total_cents, null);
  assert.equal(calculate(draft({ assessments: [panel({ reviewed: false })] })).sell.review_flags[0].code, 'unreviewed');
  const cost = privateSettings(); cost.lines[0].materials_cost_cents = null;
  assert.equal(calculate(draft(), cost).costs.direct_cost_cents, null);
  cost.lines[0].materials_cost_cents = 0;
  assert.equal(calculate(draft(), cost).costs.direct_cost_cents, 19000);
  assert.throws(() => n.publicSnapshot(draft({ assessments: [panel({ parts_sell_cents: 10000000000 })] })));
  assert.throws(() => n.publicSnapshot(draft({ assessments: [panel({ severity: 'fake' })] })));
});

test('pure draft F2 uses only allocation input fields and real paid context', () => {
  const input = draft({ assessments: [panel({ body_hours: 1, body_rate_cents: 180000, refinish_hours: 0,
    refinish_rate_cents: 0, parts_sell_cents: 0, materials_sell_cents: 0 })], adjustments: {},
  scenario: { payer: 'insurance', provenance: 'imported_carrier', allocation: {
    covered_cents: 160000, deductible_cents: 50000, uncovered_cents: 20000, adjustment_cents: 0,
    total_cents: 1, customer_cents: 1, carrier_cents: 1, paid_cents: 999999, balance_cents: 1 } } });
  assert.deepEqual(calculate(input, privateSettings(), 0, 30000).sell.allocation, {
    complete: true, carrier_cents: 110000, customer_cents: 70000, paid_cents: 30000, balance_cents: 150000 });
  input.scenario.allocation.covered_cents = null;
  assert.equal(calculate(input, privateSettings(), 0).sell.allocation.customer_cents, null);
  assert.deepEqual(Object.keys(n.publicSnapshot(input).scenario.allocation), ['covered_cents', 'deductible_cents', 'uncovered_cents', 'adjustment_cents']);
});

test('compact preset contract rejects deep injection, uses scoped extras and calculator packages', () => {
  assert.equal(normalizePreset(preset()).contract_version, 1);
  for (const mutate of [p => { p.total_cents = 1; }, p => { p.created_by = 'fake'; }, p => { p.effective_at = 'fake'; },
    p => { p.match.carrier_approved = true; }, p => { p.sell_settings.costs = {}; },
    p => { p.sell_settings.taxable.private_notes = 'PRIVATE'; }, p => { p.sell_settings.body_rate_cents = 10000000000; },
    p => { delete p.sell_settings.body_hours; }, p => { p.private_cost_config.customer_cents = 4; },
    p => { p.sell_settings.package = { name: 'Bad', price_cents: 5, taxable: true, included_operations: ['fake'] }; },
    p => { p.sell_settings.extras = [{ key: 'mask', scope: 'job', category: 'materials', quantity: 1, unit_price_cents: 10, taxable: true, private_notes: 'PRIVATE' }]; }]) {
    const data = preset(); mutate(data); assert.throws(() => normalizePreset(data));
  }
  const extra = { key: 'mask', scope: 'whole_job', category: 'materials', description: 'One setup', quantity: 1, unit_price_cents: 1000, taxable: true };
  const first = panel({ package: { name: 'Body and paint', price_cents: 15000, taxable: true, included_operations: ['body', 'refinish'] }, extras: [extra] });
  const input = draft({ assessments: [first, panel({ panel_id: 'roof', extras: [{ ...extra, description: 'Different description' }] })], adjustments: {} });
  const costs = privateSettings(); costs.lines[0].extras = [{ key: 'mask', scope: 'whole_job', cost_unit_cents: 100 }];
  costs.lines.push({ ...costs.lines[0], panel_id: 'roof' });
  const result = calculate(input, costs, 0);
  assert.equal(result.sell.totals.total_cents, 76000); // 30k package+parts/materials, 45k second panel, 1k shared.
  assert.equal(result.sell.lines.filter(line => line.shared_key).length, 1);
  assert.equal(result.sell.packages[0].name, 'Body and paint');
  assert.equal(result.costs.direct_cost_cents, 44100);
  assert.deepEqual(calculate({ ...input, assessments: [...input.assessments].reverse() }, costs, 0), result);
  noPrivate(result.sell);
  const pendingPackage = calculate(draft({ assessments: [{ ...first, body_hours: null }], adjustments: {} }), costs, 0);
  assert.equal(pendingPackage.sell.totals.total_cents, null);
  assert.equal(pendingPackage.sell.packages[0].name, 'Body and paint');
  assert.ok(pendingPackage.sell.review_flags.some(f => f.code === 'missing_body_inputs'));
  assert.equal(hashInputs({ a: 1, b: { d: 2, c: 3 } }), hashInputs({ b: { c: 3, d: 2 }, a: 1 }));
  assert.equal(typeof quoteDTO, 'function');
});

test('B1 material method exact extension, exclusivity, unknowns and private source normalization', () => {
  const material = { method: 'quantity_rate', quantity: 1.25, unit_rate_cents: 2 };
  const input = draft({ assessments: [panel({ materials_sell_cents: null, materials_pricing: material })], adjustments: {} });
  const privateCost = privateSettings();
  privateCost.lines[0].cost_sources = { body_cost_rate_cents: 'actual', materials_cost_cents: 'quoted' };
  const result = calculate(input, privateCost);
  assert.equal(result.sell.lines.find(l => l.category === 'materials').unit_price_cents, 3);
  assert.equal(result.costs.direct_cost_cents, 22000); // Material cost remains an explicit total.
  assert.equal(result.costs.lines.find(l => l.id === 'hood:body').cost_source, 'actual');
  assert.equal(result.costs.lines.find(l => l.id === 'hood:materials').cost_source, 'quoted');
  assert.equal(result.costs.lines.find(l => l.id === 'hood:parts').cost_source, null);
  noPrivate(result.sell);
  for (const missing of [{ quantity: null }, { unit_rate_cents: null }]) {
    const pending = calculate(draft({ assessments: [panel({ materials_sell_cents: null,
      materials_pricing: { ...material, ...missing } })] }), privateCost);
    assert.equal(pending.sell.complete, false); assert.equal(pending.sell.totals.total_cents, null);
    assert.equal(pending.costs.lines.find(l => l.id === 'hood:materials').cost_source, 'quoted');
  }
  for (const patch of [{ materials_sell_cents: 0 }, { materials_sell_cents: 12 }, { materials_sell_cents: undefined },
    { materials_pricing: { method: 'quantity_rate', quantity: 1.001, unit_rate_cents: 1 } },
    { materials_pricing: { method: 'quantity_rate', quantity: 1000001, unit_rate_cents: 1 } },
    { materials_pricing: { method: 'quantity_rate', quantity: 1, unit_rate_cents: 0.5 } },
    { materials_pricing: { method: 'explicit', quantity: 1 } }, { materials_pricing: { method: 'fake' } }]) {
    assert.throws(() => calculate(draft({ assessments: [panel({ materials_sell_cents: null, materials_pricing: material, ...patch })] })));
  }
  assert.throws(() => calculate(draft({ assessments: [panel({ materials_sell_cents: null,
    materials_pricing: { method: 'quantity_rate', quantity: 1000000, unit_rate_cents: 9999999999 } })] })));
  assert.equal(calculate(draft({ assessments: [panel({ materials_sell_cents: null,
    materials_pricing: { ...material, quantity: 0 } })], adjustments: {} })).sell.totals.subtotal_cents, 40000);
  assert.throws(() => n.extras([{ key: 'materials', scope: 'hood', category: 'materials', materials_pricing: material }]));
  for (const source of ['shop', '', false, 1, {}]) {
    assert.throws(() => n.privateSnapshot({ lines: [{ panel_id: 'hood', cost_sources: { parts_cost_cents: source } }] }));
    assert.throws(() => n.extras([{ key: 'mask', scope: 'job', cost_source: source }], true));
  }
  assert.throws(() => n.costSources({ arbitrary: 'actual' }));
  const config = preset(); config.sell_settings.materials_sell_cents = null;
  config.sell_settings.materials_pricing = material;
  config.private_cost_config.cost_sources = { body_cost_rate_cents: 'estimated' };
  assert.deepEqual(normalizePreset(config).sell_settings.materials_pricing, material);
  assert.equal(normalizePreset(config).private_cost_config.cost_sources.body_cost_rate_cents, 'estimated');
});

test('B1 normalized mixed package and scoped discount DTOs preserve targets and block invalid scope', () => {
  const assessment = panel({ taxable: { ...taxable(), body: false }, package: { name: 'Mixed', price_cents: 15000,
    taxable: null, included_operations: ['body', 'refinish'], sell_allocation_cents: { body: 10000, refinish: 5000 } } });
  const input = draft({ assessments: [assessment], adjustments: { discount_cents: 0,
    discounts: [{ id: 'package', amount_cents: 3000, package_ids: ['hood:package'] },
      { id: 'materials', amount_cents: 1000, line_ids: ['hood:materials'] }] } });
  const quote = calculate(input).sell;
  assert.equal(quote.totals.discount_cents, 4000); assert.equal(quote.totals.net_cents, 26000);
  assert.equal(quote.totals.tax_cents, 1800);
  assert.equal(quote.discount_lines.length, 2); noPrivate(quote);
  assert.deepEqual(quote.discount_lines[1].package_ids, ['hood:package']);
  for (const targets of [{ line_ids: ['hood:body'] }, { package_ids: ['missing'] }, { line_ids: ['missing'] },
    { line_ids: ['hood:materials', 'hood:materials'] }, { line_ids: ['hood:materials'], package_ids: ['hood:package'] }]) {
    assert.throws(() => calculate({ ...input, adjustments: { discounts: [{ id: 'bad', amount_cents: 1, ...targets }] } }));
  }
  const incomplete = structuredClone(input); incomplete.assessments[0].parts_sell_cents = null;
  incomplete.adjustments.discounts[0].package_ids = ['missing'];
  assert.throws(() => calculate(incomplete));
  assert.throws(() => n.discounts(Array.from({ length: 101 }, (_, i) => ({ id: String(i), amount_cents: 0, line_ids: ['hood:parts'] }))));
  const p = preset(); Object.assign(p.sell_settings, { package: assessment.package, taxable: assessment.taxable });
  assert.deepEqual(normalizePreset(p).sell_settings.package.sell_allocation_cents, { body: 10000, refinish: 5000 });
});

function localDatabase(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Refuse nonloopback test DB');
  assert.match(decodeURIComponent(url.pathname).slice(1), /(?:^|_)test(?:_|$)/);
  assert.equal(url.search, ''); assert.equal(url.hash, '');
  return value;
}
test('HTTP database guard refuses remote, production and connection overrides', () => {
  for (const url of ['postgresql://host/revv_test', 'postgresql://127.0.0.1/revv', 'postgresql://127.0.0.1/revv_test?host=remote']) {
    assert.throws(() => localDatabase(url));
  }
});
const database = process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL;
for (const type of ['TEXT', 'UUID']) {
  test(`mounted HTTP actual JWT and isolated PostgreSQL ${type}`, { skip: !database && 'PANEL_ESTIMATOR_TEST_DATABASE_URL missing; HTTP persistence NOT verified' }, async t => {
    const connectionString = localDatabase(database), schema = `panel_http_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(schema, /^panel_http_test_[a-f0-9]{32}$/);
    const admin = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
    let pool, server, owned = false;
    const dbPath = require.resolve('../src/db');
    const authPath = require.resolve('../src/middleware/auth');
    const routePath = require.resolve('../src/routes/estimateLineItems');
    const oldDB = require.cache[dbPath], oldAuth = require.cache[authPath], oldRoute = require.cache[routePath];
    const previousSecret = process.env.JWT_SECRET;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`); owned = true;
      pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8, connectionTimeoutMillis: 3000 });
      await pool.query(`CREATE TABLE shops(id ${type} PRIMARY KEY, tax_rate NUMERIC(8,4));
        CREATE TABLE users(id ${type} PRIMARY KEY, revoke_all_before TIMESTAMPTZ);
        CREATE TABLE revoked_tokens(id TEXT PRIMARY KEY, token_jti TEXT);
        CREATE TABLE repair_orders(id ${type} PRIMARY KEY, shop_id ${type} REFERENCES shops(id));
        CREATE TABLE ro_photos(id ${type} PRIMARY KEY, ro_id ${type} REFERENCES repair_orders(id));
        CREATE TABLE ro_payments(id ${type} PRIMARY KEY, shop_id ${type}, ro_id ${type}, amount_cents INTEGER, status TEXT)`);
      const id = () => type === 'TEXT' ? `text-${randomUUID()}` : randomUUID();
      const shop = id(), foreignShop = id(), ro = id(), foreignRO = id(), siblingRO = id(), user = id();
      await pool.query('INSERT INTO shops VALUES ($1,0.1),($2,0.1)', [shop, foreignShop]);
      await pool.query('INSERT INTO users(id) VALUES ($1)', [user]);
      await pool.query('INSERT INTO repair_orders VALUES ($1,$2),($3,$4),($5,$2)', [ro, shop, foreignRO, foreignShop, siblingRO]);
      await ensurePanelEstimator(pool);
      process.env.JWT_SECRET = 'isolated-panel-http-test-only';
      const db = { pool, dbGet: async (sql, params) => (await pool.query(sql, params)).rows[0],
        dbAll: async (sql, params) => (await pool.query(sql, params)).rows, dbRun: (sql, params) => pool.query(sql, params) };
      // Actual middleware, including revocation reads, gets the same isolated pool.
      require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
      delete require.cache[authPath]; delete require.cache[routePath];
      const app = express(); app.use(express.json());
      app.use('/api/estimate-items', require('../src/routes/estimateLineItems'));
      // Independently exercise explicit factory database injection with actual auth.
      app.use('/injected', require('../src/routes/panelEstimator').createPanelEstimatorRouter({ database: db }));
      server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
      const origin = `http://127.0.0.1:${server.address().port}`;
      const token = (role, tenant = shop) => jwt.sign({ id: user, shop_id: tenant, role, jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '1h' });
      async function request(path, { role = 'owner', method = 'GET', body, tenant = shop, rawToken } = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (role !== null) headers.Authorization = `Bearer ${rawToken ?? token(role, tenant)}`;
        const response = await fetch(`${origin}${path.startsWith('/injected') ? path : `/api/estimate-items${path}`}`, {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const result = await response.json().catch(() => null);
        return { status: response.status, body: result, cache: response.headers.get('cache-control') };
      }
      const base = `/${ro}/panel-estimator`;
      let version = 0, presetRow;
      await t.test('401, revoked token, strict roles, nested tenant 404 and static mount', async () => {
        assert.equal((await request(base, { role: null })).status, 401);
        const revoked = jwt.sign({ id: user, shop_id: shop, role: 'owner', jti: 'revoked' }, process.env.JWT_SECRET);
        await pool.query("INSERT INTO revoked_tokens VALUES ('revocation','revoked')");
        assert.equal((await request(base, { rawToken: revoked })).status, 401);
        for (const role of ['technician', 'customer', 'employee', 'staff']) {
          assert.equal((await request(base, { role })).status, 403);
          assert.equal((await request('/panel-presets', { role })).status, 403);
          assert.equal((await request(`${base}/preview`, { role, method: 'POST', body: { expected_version: 0, ...draft() } })).status, 403);
        }
        for (const suffix of ['', '/cost-summary']) assert.equal((await request(`/${foreignRO}/panel-estimator${suffix}`)).status, 404);
        assert.equal((await request(`${base}/draft`, { tenant: foreignShop, method: 'PUT', body: { expected_version: 0, ...draft() } })).status, 404);
        assert.equal((await request(`/injected/${ro}/panel-estimator`)).status, 200);
        const catalog = await request('/panel-presets', { role: 'assistant' });
        assert.equal(catalog.status, 200); assert.deepEqual(catalog.body.presets, []); assert.equal(catalog.cache, 'no-store');
        const preview = await request(`${base}/preview`, { method: 'POST', body: { expected_version: 0, ...draft() } });
        assert.equal(preview.status, 200); assert.equal(preview.body.version, 0);
        assert.equal((await pool.query('SELECT * FROM ro_panel_estimator_drafts')).rowCount, 0);
        assert.equal((await pool.query('SELECT * FROM ro_panel_estimator_costs')).rowCount, 0);
      });
      await t.test('assistant saves sell; owner costs independent; stale writes; safe GET and F1 preview', async () => {
        const saved = await request(`${base}/draft`, { role: 'assistant', method: 'PUT', body: {
          expected_version: version, ...draft(), shop_id: foreignShop, role: 'owner', total_cents: 1, costs: privateSettings() } });
        assert.equal(saved.status, 200); version = saved.body.version; noPrivate(saved.body);
        for (const [suffix, method] of [['/cost-summary', 'GET'], ['/cost-settings', 'PUT']]) {
          assert.equal((await request(`${base}${suffix}`, { role: 'assistant', method, ...(method === 'PUT' ? { body: privateSettings() } : {}) })).status, 403);
        }
        assert.equal((await request(`${base}/cost-settings`, { method: 'PUT', body: { expected_version: version, ...privateSettings(), reason: '' } })).status, 400);
        const savedCost = await request(`${base}/cost-settings`, { method: 'PUT', body: { expected_version: version, ...privateSettings() } });
        assert.equal(savedCost.status, 200); version = savedCost.body.version;
        assert.deepEqual(savedCost.body, { version });
        assert.equal((await request(`${base}/draft`, { method: 'PUT', body: { expected_version: version - 1, ...draft() } })).status, 409);
        assert.equal((await request(`${base}/preview`, { method: 'POST', body: { expected_version: version - 1, ...draft() } })).status, 409);
        const get = await request(base, { role: 'assistant' });
        assert.equal(get.body.assessments[0].body_rate_cents, 10000); noPrivate(get.body);
        const first = await request(`${base}/preview`, { role: 'assistant', method: 'POST', body: { expected_version: version, ...draft() } });
        assert.equal(first.status, 200); assert.equal(first.body.quote.totals.total_cents, 44000); noPrivate(first.body);
        const summary = await request(`${base}/cost-summary`);
        assert.equal(summary.status, 200); assert.equal(summary.body.costs.direct_cost_cents, 22000);
        assert.equal(summary.body.costs.contribution_cents, 18000); assert.equal(summary.body.costs.target_revenue_cents, 36667);
        assert.equal(summary.body.costs.settings.private_notes, 'PRIVATE overall note');
        assert.equal(summary.body.costs.settings.lines[0].private_notes, 'PRIVATE line note');
        assert.equal(summary.body.input_hash, first.body.input_hash);
      });
      async function state() {
        const result = {};
        for (const table of ['repair_orders', 'ro_panel_estimator_drafts', 'ro_panel_estimator_costs', 'ro_payments',
          'ro_panel_estimator_revisions', 'ro_panel_estimator_revision_costs', 'panel_estimator_preset_versions']) {
          result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows;
        }
        return result;
      }
      await t.test('preview is deterministic/no writes; server tax and payment authority; F2 and unknown', async () => {
        const before = await state(), body = { expected_version: version, ...draft() };
        const one = await request(`${base}/preview`, { method: 'POST', body });
        const two = await request(`${base}/preview`, { method: 'POST', body: { ...body, paid_cents: 7, private_costs: privateSettings(), total_cents: 5 } });
        assert.deepEqual(one.body, two.body); assert.deepEqual(await state(), before);
        assert.equal((await request(`${base}/preview`, { method: 'POST', body: { ...body, adjustments: { tax_rate_bps: 0 } } })).status, 400);
        assert.equal((await request(`${base}/draft`, { method: 'PUT', body: { ...body, scenario: { payer: 'insurance', provenance: 'carrier_approved' } } })).status, 400);
        await pool.query('UPDATE shops SET tax_rate=NULL WHERE id=$1', [shop]);
        try {
          const missingTax = await request(`${base}/preview`, { method: 'POST', body });
          assert.equal(missingTax.status, 200);
          assert.equal(missingTax.body.quote.totals.total_cents, null);
          assert.ok(missingTax.body.review_flags.some(f => f.code === 'missing_shop_tax_rate'));
        } finally { await pool.query('UPDATE shops SET tax_rate=0.1 WHERE id=$1', [shop]); }
        // Keep this payment-authority fixture isolated from the preview tax inputs.
        const paidShop = id(), paidRO = id(), paidBase = `/${paidRO}/panel-estimator`;
        await pool.query('INSERT INTO shops VALUES ($1,0)', [paidShop]);
        await pool.query('INSERT INTO repair_orders VALUES ($1,$2)', [paidRO, paidShop]);
        for (const [status, amount] of [['paid', 20000], ['succeeded', 10000], ['pending', 99999], ['failed', 99999]]) {
          await pool.query('INSERT INTO ro_payments VALUES ($1,$2,$3,$4,$5)', [id(), paidShop, paidRO, amount, status]);
        }
        await pool.query('INSERT INTO ro_payments VALUES ($1,$2,$3,99999,$4)', [id(), foreignShop, foreignRO, 'paid']);
        const insurance = { expected_version: 0, ...draft({ adjustments: {}, assessments: [panel({ body_hours: 1,
          body_rate_cents: 180000, refinish_hours: 0, refinish_rate_cents: 0, parts_sell_cents: 0, materials_sell_cents: 0 })],
        scenario: { payer: 'insurance', provenance: 'shop_prepared', allocation: { covered_cents: 160000, deductible_cents: 50000,
          uncovered_cents: 20000, adjustment_cents: 0, total_cents: 1, customer_cents: 1, paid_cents: 0 } } }) };
        const known = await request(`${paidBase}/preview`, { tenant: paidShop, method: 'POST', body: insurance });
        assert.equal(known.status, 200); assert.deepEqual(known.body.quote.allocation, {
          complete: true, carrier_cents: 110000, customer_cents: 70000, paid_cents: 30000, balance_cents: 150000 });
        insurance.scenario.allocation.covered_cents = null;
        const unknown = await request(`${paidBase}/preview`, { tenant: paidShop, method: 'POST', body: insurance });
        assert.equal(unknown.status, 200);
        assert.equal(unknown.body.quote.allocation.customer_cents, null);
        const held = await state();
        // Minimal schema with no lines still fails closed below the monetary floor.
        await assert.rejects(pool.query('UPDATE shops SET tax_rate=0.1 WHERE id=$1',[paidShop]),
          e=>e.code==='23514' && e.message==='RO_FINANCIAL_HOLD');
        assert.deepEqual(await state(),held);
        await pool.query(`CREATE TABLE estimate_line_items(id TEXT,shop_id TEXT,ro_id TEXT,type TEXT,total NUMERIC,taxable BOOLEAN)`);
        await ensurePanelEstimator(pool);
        await pool.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type,total,taxable) VALUES ($1,$2,$3,'labor',3000,TRUE)",[id(),paidShop,paidRO]);
        for(const tax of [0.1,0,null]) await pool.query('UPDATE shops SET tax_rate=$2 WHERE id=$1',[paidShop,tax]);
        assert.equal((await pool.query('SELECT tax_rate FROM shops WHERE id=$1',[paidShop])).rows[0].tax_rate,null);
        const repriced=await state();
        await assert.rejects(pool.query('UPDATE estimate_line_items SET total=1 WHERE ro_id=$1',[paidRO]),
          e=>e.code==='23514' && e.message==='RO_FINANCIAL_HOLD');
        assert.deepEqual(await state(),repriced);
        assert.equal(Number((await pool.query('SELECT total FROM estimate_line_items WHERE ro_id=$1',[paidRO])).rows[0].total),3000);

      });
      await t.test('presets strict writes, private authorization, immutable versions and explicit application snapshots', async () => {
        assert.equal((await request('/panel-presets', { role: 'assistant', method: 'POST', body: preset() })).status, 403);
        const create = await request('/panel-presets', { method: 'POST', body: preset() });
        assert.equal(create.status, 201); presetRow = create.body; noPrivate(presetRow);
        const privatePreset = await request(`/panel-presets/${presetRow.id}/cost-config`);
        assert.equal(privatePreset.status, 200); assert.equal(privatePreset.body.created_by, user);
        assert.ok(privatePreset.body.effective_at); assert.equal(privatePreset.body.private_cost_config.body_cost_rate_cents, 4000);
        assert.equal((await request(`/panel-presets/${presetRow.id}/cost-config`, { role: 'assistant' })).status, 403);
        assert.equal((await request(`/panel-presets/${presetRow.id}/cost-config`, { tenant: foreignShop })).status, 404);
        const selected = draft({ assessments: [panel({ preset_version_id: presetRow.id, body_rate_cents: 9000, preset_override: { reason: 'Reviewed customer rate' } })] });
        const apply = await request(`${base}/draft`, { method: 'PUT', body: { expected_version: version, ...selected } });
        assert.equal(apply.status, 200); version = apply.body.version;
        assert.equal(apply.body.assessments[0].body_rate_cents, 9000); // Explicit manual choice retained.
        assert.equal(apply.body.assessments[0].application_snapshot.sell_settings.body_rate_cents, 10000);
        const before = await request(`${base}/preview`, { method: 'POST', body: { expected_version: version, ...selected } });
        const nextPreset = preset(); nextPreset.sell_settings.body_rate_cents = 20000;
        const next = await request(`/panel-presets/${presetRow.family_id}/versions`, { method: 'POST', body: nextPreset });
        assert.equal(next.status, 201); assert.equal(next.body.version, 2); assert.notEqual(next.body.id, presetRow.id);
        const after = await request(`${base}/preview`, { method: 'POST', body: { expected_version: version, ...selected } });
        assert.deepEqual(after.body, before.body);
        await assert.rejects(pool.query('UPDATE panel_estimator_preset_versions SET sell_settings=$3 WHERE shop_id=$1 AND id=$2', [shop, presetRow.id, '{}']), e => e.code === '23514');
        await assert.rejects(pool.query('DELETE FROM panel_estimator_preset_versions WHERE shop_id=$1 AND id=$2', [shop, presetRow.id]), e => e.code === '23514');
        const archive = await request(`/panel-presets/${presetRow.family_id}/archive`, { method: 'POST', body: { archived: true } });
        assert.equal(archive.status, 200);
        assert.equal((await request(`/panel-presets/${presetRow.family_id}/versions`, { method: 'POST', body: preset() })).status, 409);
        assert.equal((await request(`${base}/preview`, { method: 'POST', body: { expected_version: version, ...selected } })).body.input_hash, before.body.input_hash);
        const listed = await request('/panel-presets', { role: 'assistant' });
        assert.equal(listed.body.presets.length, 2); assert.ok(listed.body.presets.every(p => p.archived)); noPrivate(listed.body);
        const service = createPanelEstimatorPresets(pool);
        await assert.rejects(service.create({ shopId: shop, actorId: user, role: 'assistant', body: preset() }), e => e.status === 403);
      });
      await t.test('invalid preset and photo refs rejected; malformed commit cannot mutate state; missing quotes/private revisions return 404', async () => {
        const foreign = await request('/panel-presets', { tenant: foreignShop, method: 'POST', body: preset() });
        const photo = id(), siblingPhoto = id(), foreignPhoto = id();
        await pool.query('INSERT INTO ro_photos VALUES ($1,$2),($3,$4),($5,$6)', [photo, ro, siblingPhoto, siblingRO, foreignPhoto, foreignRO]);
        for (const patch of [{ preset_version_id: foreign.body.id }, { preset_version_id: randomUUID() },
          { preset_version_id: presetRow.id, severity: 'heavy' }, { photo_ids: [siblingPhoto] },
          { photo_ids: [foreignPhoto] }, { photo_ids: [id()] }]) {
          for (const [suffix, method] of [['/draft', 'PUT'], ['/preview', 'POST']]) {
            const response = await request(`${base}${suffix}`, { method, body: { expected_version: version, ...draft({ assessments: [panel(patch)] }) } });
            assert.ok([400, 404].includes(response.status), JSON.stringify(response));
            assert.ok(!JSON.stringify(response.body).includes('SELECT'));
          }
        }
        const valid = await request(`${base}/draft`, { method: 'PUT', body: { expected_version: version, ...draft({ assessments: [panel({ photo_ids: [photo] })] }) } });
        assert.equal(valid.status, 200); version = valid.body.version;
        const beforeCommit = await state();
        const malformedCommit = await request(`${base}/commit`, { method: 'POST', body: {} });
        assert.equal(malformedCommit.status, 400);
        assert.deepEqual(malformedCommit.body, { error: 'INVALID_INPUT' });
        assert.deepEqual(await state(), beforeCommit);
        assert.equal((await request(`${base}/quote`)).status, 404);
        assert.equal((await request(`${base}/cost-summary?revision_id=pretend`)).status, 404);
      });
      await t.test('B1 JWT save/reload/version, preset method/allocation and private provenance', async () => {
        const target = `/${siblingRO}/panel-estimator`;
        const material = { method: 'quantity_rate', quantity: 1.25, unit_rate_cents: 2 };
        const assessment = panel({ materials_sell_cents: null, materials_pricing: material,
          taxable: { ...taxable(), body: false }, package: { name: 'B1 mixed', price_cents: 15000, taxable: null,
            included_operations: ['body', 'refinish'], sell_allocation_cents: { body: 10000, refinish: 5000 } },
          extras: [{ key: 'mask', scope: 'job', category: 'materials', quantity: 1, unit_price_cents: 100, taxable: true }] });
        const input = draft({ assessments: [assessment], adjustments: { discount_cents: 0,
          discounts: [{ id: 'package', amount_cents: 3000, package_ids: ['hood:package'] }] } });
        const saved = await request(`${target}/draft`, { role: 'assistant', method: 'PUT', body: { ...input, expected_version: 0 } });
        assert.equal(saved.status, 200); assert.equal(saved.body.version, 1);
        const reload = await request(target, { role: 'assistant' }); noPrivate(reload.body);
        assert.deepEqual(reload.body.assessments[0].materials_pricing, material);
        assert.deepEqual(reload.body.assessments[0].package.sell_allocation_cents, assessment.package.sell_allocation_cents);
        assert.deepEqual(reload.body.adjustments.discounts[0].package_ids, ['hood:package']);
        const privateCost = privateSettings();
        privateCost.lines[0].cost_sources = { body_cost_rate_cents: 'actual', parts_cost_cents: 'quoted', materials_cost_cents: 'estimated' };
        privateCost.lines[0].extras = [{ key: 'mask', scope: 'job', cost_unit_cents: 10, cost_source: 'quoted' }];
        assert.equal((await request(`${target}/cost-settings`, { method: 'PUT', body: { ...privateCost, expected_version: 1 } })).body.version, 2);
        assert.equal((await request(`${target}/draft`, { method: 'PUT', body: { ...input, expected_version: 1 } })).status, 409);
        const summary = await request(`${target}/cost-summary`); assert.equal(summary.status, 200);
        assert.equal(summary.body.costs.settings.lines[0].cost_sources.body_cost_rate_cents, 'actual');
        assert.equal(summary.body.costs.lines.find(l => l.id === 'hood:extra:job:mask').cost_source, 'quoted');
        assert.equal((await request(`${target}/cost-summary`, { role: 'assistant' })).status, 403);
        const preview = await request(`${target}/preview`, { method: 'POST', body: { ...input, expected_version: 2 } });
        assert.equal(preview.status, 200); noPrivate(preview.body);
        assert.equal(preview.body.quote.totals.total_cents, 23513);
        assert.equal(preview.body.quote.lines.find(l => l.category === 'materials' && !l.shared_key).unit_price_cents, 3);
        const p = preset();
        p.sell_settings = Object.fromEntries([...n.SELL, 'body_hours', 'refinish_hours', 'refinish', 'taxable', 'package', 'extras', 'materials_pricing'].map(k => [k, assessment[k]]));
        p.private_cost_config.cost_sources = { body_cost_rate_cents: 'estimated' };
        const created = await request('/panel-presets', { method: 'POST', body: p });
        assert.equal(created.status, 201); noPrivate(created.body);
        assert.deepEqual(created.body.sell_settings.materials_pricing, material);
        const catalog = await request('/panel-presets'); noPrivate(catalog.body);
        assert.deepEqual(catalog.body.presets.find(v => v.id === created.body.id).sell_settings.package, created.body.sell_settings.package);
        assert.equal((await request(`/panel-presets/${created.body.id}/cost-config`)).body.private_cost_config.cost_sources.body_cost_rate_cents, 'estimated');
        for (const patch of [{ materials_sell_cents: 0 }, { package: { ...assessment.package, sell_allocation_cents: { body: 15000 } } }]) {
          assert.equal((await request(`${target}/draft`, { method: 'PUT', body: { ...input,
            assessments: [{ ...assessment, ...patch }], expected_version: 2 } })).status, 400);
        }
        for (const discount of [{ id: 'bad', amount_cents: 1, line_ids: ['hood:body'] },
          { id: 'bad', amount_cents: 1, line_ids: ['missing'] },
          { id: 'bad', amount_cents: 1, package_ids: ['missing'] }]) {
          for (const [suffix, method] of [['draft', 'PUT'], ['preview', 'POST']]) {
            const invalid = await request(`${target}/${suffix}`, { method, body: { ...input,
              adjustments: { discounts: [discount] }, expected_version: 2 } });
            assert.equal(invalid.status, 400); assert.deepEqual(invalid.body, { error: 'INVALID_INPUT' });
          }
        }
        const excessive = await request(`${target}/preview`, { method: 'POST', body: { ...input,
          adjustments: { discounts: [{ id: 'excess', amount_cents: 15001, package_ids: ['hood:package'] }] }, expected_version: 2 } });
        assert.equal(excessive.status, 400);
        privateCost.lines[0].cost_sources.body_cost_rate_cents = 'shop';
        assert.equal((await request(`${target}/cost-settings`, { method: 'PUT', body: { ...privateCost, expected_version: 2 } })).status, 400);
        assert.equal((await request(target)).body.version, 2);
      });
    } finally {
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      for (const [path, previous] of [[dbPath, oldDB], [authPath, oldAuth], [routePath, oldRoute]]) {
        if (previous) require.cache[path] = previous; else delete require.cache[path];
      }
      if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
      try { if (pool) await pool.end(); if (owned) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { await admin.end(); }
    }
  });
}

test('B2 resolver enforces immutable sell fields, wildcard/exact area and trusted role', async () => {
  const { resolveApplications, safeSnapshot } = require('../src/services/panelEstimatorPresets');
  const data = preset(); data.match.area = 'center'; data.sell_settings.minimum_cents = 50000;
  const source = { ...normalizePreset(data), id: 'version', family_id: 'family', version: 1 };
  const before = structuredClone(source);
  const client = { query: async (sql, params) => {
    assert.match(sql, /v.shop_id = \$1 AND v.id = \$2/);
    return { rowCount: params[0] === 'tenant' && params[1] === 'version' ? 1 : 0, rows: [source] };
  } };
  const applied = patch => n.assessments([panel({ preset_version_id: 'version', area: 'center', ...patch })]);
  const exact = applied(); await resolveApplications(client, 'tenant', exact, { role: 'assistant' });
  assert.equal(exact[0].application_snapshot.sell_settings.minimum_cents, 50000);
  assert.equal(safeSnapshot(source).sell_settings.override_policy, 'owner_admin');
  const forged = applied({ minimum_cents: 0, application_snapshot: { ...safeSnapshot(source),
    sell_settings: { ...safeSnapshot(source).sell_settings, minimum_cents: 0 } } });
  await resolveApplications(client, 'tenant', forged, { role: 'assistant' });
  assert.equal(forged[0].application_snapshot.sell_settings.minimum_cents, 50000);
  assert.deepEqual(source, before);
  await assert.rejects(resolveApplications(client, 'foreign', applied(), { role: 'owner' }), e => e.code === 'INVALID_REFERENCE');
  await assert.rejects(resolveApplications(client, 'tenant', applied({ area: 'edge' }), { role: 'owner' }), e => e.code === 'PRESET_INCOMPATIBLE');
  for (const patch of [{ body_hours: 3 }, { refinish_hours: 2 }, { body_rate_cents: 1 }, { refinish: false },
    { taxable: { ...taxable(), parts: false } }, { package: { name: 'Package', price_cents: 100, taxable: true, included_operations: ['body'] } },
    { extras: [{ key: 'scan', scope: 'job', category: 'sublet', quantity: 1, unit_price_cents: 100, taxable: true }] },
    { materials_sell_cents: null, materials_pricing: { method: 'quantity_rate', quantity: 1, unit_rate_cents: 5000 } }]) {
    await assert.rejects(resolveApplications(client, 'tenant', applied(patch), { role: 'owner' }), e => e.code === 'PRESET_OVERRIDE_REQUIRED');
    for (const role of ['assistant', undefined]) {
      await assert.rejects(resolveApplications(client, 'tenant', applied({ ...patch,
        role: 'owner', preset_override: { reason: 'Reviewed scope and price' },
        application_snapshot: { ...safeSnapshot(source), sell_settings: { ...source.sell_settings, ...patch, minimum_cents: 0 } } }), { role }), e => e.code === 'FORBIDDEN');
    }
    const changed = applied({ ...patch, preset_override: { reason: 'Reviewed scope and price' } });
    await resolveApplications(client, 'tenant', changed, { role: 'admin' });
    assert.deepEqual(changed[0].application_snapshot, safeSnapshot(before));
    noPrivate({ assessments: changed });
  }
  source.sell_settings.override_policy = 'locked';
  await assert.rejects(resolveApplications(client, 'tenant', applied({ body_hours: 3,
    preset_override: { reason: 'Owner reviewed' } }), { role: 'owner' }), e => e.code === 'PRESET_LOCKED');
  const legacy = applied({ body_hours: 3 });
  await resolveApplications(client, 'tenant', legacy, { enforce: false }); // Safe stored read only.
  source.match.area = null;
  await resolveApplications(client, 'tenant', applied({ area: 'edge' }), { role: 'assistant' });
});

test('B2 scope acknowledgements, eligibility and disclosure privacy are conservative', async () => {
  const cosmetic = panel({ operation: 'paint-only', body_hours: 0, parts_sell_cents: 0, sublet_sell_cents: 0, optional_cosmetic: true });
  const acknowledgement = { reason: 'Cosmetic paint postponed', estimator_acknowledged: true, customer_acknowledged: true,
    customer_acknowledgement_reference: 'Customer discussion recorded on work order' };
  const saved = n.assessments([cosmetic]);
  const client = { query: async () => ({ rows: [{ public_snapshot: { scope: { assessments: saved } } }] }) };
  const deferred = n.assessments([{ ...cosmetic, deferral: acknowledgement }]);
  await assert.rejects(n.validateScopePolicy(client, { role: 'owner' }, [], saved), e => e.code === 'SCOPE_RECONCILIATION_REQUIRED');
  for (const role of ['assistant', undefined]) {
    await assert.rejects(n.validateScopePolicy(client, { role }, saved, []), e => e.code === 'FORBIDDEN');
    await assert.rejects(n.validateScopePolicy(client, { role }, n.assessments([{ ...cosmetic, optional_cosmetic: false }]), saved), e => e.code === 'FORBIDDEN');
  }
  await n.validateScopePolicy(client, { shopId: 'shop', roId: 'ro', role: 'owner' }, deferred, saved);
  const input = n.publicSnapshot({ ...draft(), assessments: deferred, adjustments: {} });
  const result = assembleDraft({ draft: input, costs: n.privateSnapshot(privateSettings()), taxRateBps: 1000, paidCents: 0 });
  assert.deepEqual(result.sell.scope.panel_ids, ['hood']); assert.equal(result.sell.scope.assessments.length, 1);
  assert.equal(result.sell.totals.total_cents, 0); assert.deepEqual(result.sell.lines, []);
  assert.deepEqual(result.costs.lines, []); assert.equal(result.costs.direct_cost_cents, 0);
  noPrivate(result.sell);
  for (const role of ['assistant', undefined]) await assert.rejects(n.validateScopePolicy(client,
    { shopId: 'shop', roId: 'ro', role }, deferred, deferred), e => e.code === 'FORBIDDEN');
  for (const patch of [{ reason: '' }, { estimator_acknowledged: false }, { customer_acknowledged: false },
    { customer_acknowledgement_reference: '  ' }]) assert.throws(() => n.assessments([{ ...cosmetic, deferral: { ...acknowledgement, ...patch } }]));
  for (const patch of [{ operation: 'repair' }, { operation: 'replace' }, { operation: 'inspection-required' },
    { body_hours: 1 }, { parts_sell_cents: 1 }, { sublet_sell_cents: 1 },
    { extras: [{ key: 'scan', scope: 'job', category: 'sublet', quantity: 1, unit_price_cents: 0, taxable: true }] }]) {
    await assert.rejects(n.validateScopePolicy(client, { role: 'owner' }, n.assessments([{ ...cosmetic, ...patch, deferral: acknowledgement }]), saved), e => e.code === 'INVALID_INPUT');
  }
  for (const previous of [[], n.assessments([{ ...cosmetic, optional_cosmetic: false }])]) {
    await assert.rejects(n.validateScopePolicy({ query: async () => ({ rows: [{ public_snapshot: { scope: { assessments: previous } } }] }) },
      { role: 'owner' }, deferred, saved), e => e.code === 'SCOPE_RECONCILIATION_REQUIRED');
  }
  await assert.rejects(n.validateScopePolicy(client, { role: 'owner' }, n.assessments([{ ...cosmetic,
    refinish_hours: 0, deferral: acknowledgement }]), saved), e => e.code === 'SCOPE_RECONCILIATION_REQUIRED');
  for (const path of ['private_notes', 'costs', 'reason', 'target_margin_bps']) {
    assert.throws(() => noPrivate({ scope: { assessments: [{ [path]: 'sensitive' }] } }));
    assert.throws(() => noPrivate({ scope: { assessments: [{ deferral: { [path]: 'PRIVATE sentinel' } }] } }));
  }
  assert.throws(() => noPrivate({ application_snapshot: { reason: 'Private catalog reason' } }));
});

test('A2 customer comparison privacy accepts only public reasons in historical scope and scalar changes', () => {
  const { historicalQuote } = require('../src/services/panelEstimatorQuotePdf');
  const { differences } = require('../src/services/panelEstimatorRevisions');
  const input = draft({ assessments: [panel({ preset_override: { reason: 'Customer rate reviewed' } })] });
  const quote = calculate(input).sell;
  const historical = historicalQuote({ id: 'historical', version: 1, quote_hash: 'a'.repeat(64), public_snapshot: quote });
  historical.differences = differences({ scope: historical.scope }, { scope: calculate(draft()).sell.scope });
  noPrivate({ quote: { comparisons: [historical] } });
  // Preserve the old array-comparison privacy guard for legacy stored snapshots.
  noPrivate({ quote: { comparisons: [{ differences: [{ path: 'scope.assessments',
    before: quote.scope.assessments, after: [] }] }] } });
  for (const injected of [
    { ...historical, private_notes: 'PRIVATE comparison' },
    { ...historical, scope: { ...historical.scope, assessments: [{ ...historical.scope.assessments[0], reason: 'Private reason' }] } },
    { ...historical, differences: [{ label: 'Any', before: { costs: 4 }, after: null }] },
  ]) assert.throws(() => noPrivate({ quote: { comparisons: [injected] } }));
});
