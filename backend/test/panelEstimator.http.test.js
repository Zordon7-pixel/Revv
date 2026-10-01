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
function noPrivate(value) {
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /cost|private|margin|target|reason|created_by/);
    noPrivate(child);
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
        for (const table of ['repair_orders', 'ro_panel_estimator_drafts', 'ro_panel_estimator_costs', 'ro_payments', 'panel_estimator_preset_versions']) {
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
        await pool.query('UPDATE shops SET tax_rate=0 WHERE id=$1', [shop]);
        for (const [status, amount] of [['paid', 20000], ['succeeded', 10000], ['pending', 99999], ['failed', 99999]]) {
          await pool.query('INSERT INTO ro_payments VALUES ($1,$2,$3,$4,$5)', [id(), shop, ro, amount, status]);
        }
        await pool.query('INSERT INTO ro_payments VALUES ($1,$2,$3,99999,$4)', [id(), foreignShop, foreignRO, 'paid']);
        const insurance = { expected_version: version, ...draft({ adjustments: {}, assessments: [panel({ body_hours: 1,
          body_rate_cents: 180000, refinish_hours: 0, refinish_rate_cents: 0, parts_sell_cents: 0, materials_sell_cents: 0 })],
        scenario: { payer: 'insurance', provenance: 'shop_prepared', allocation: { covered_cents: 160000, deductible_cents: 50000,
          uncovered_cents: 20000, adjustment_cents: 0, total_cents: 1, customer_cents: 1, paid_cents: 0 } } }) };
        const known = await request(`${base}/preview`, { method: 'POST', body: insurance });
        assert.equal(known.status, 200); assert.deepEqual(known.body.quote.allocation, {
          complete: true, carrier_cents: 110000, customer_cents: 70000, paid_cents: 30000, balance_cents: 150000 });
        insurance.scenario.allocation.covered_cents = null;
        const unknown = await request(`${base}/preview`, { method: 'POST', body: insurance });
        assert.equal(unknown.body.quote.allocation.customer_cents, null);
        await pool.query('UPDATE shops SET tax_rate=NULL WHERE id=$1', [shop]);
        const missingTax = await request(`${base}/preview`, { method: 'POST', body });
        assert.equal(missingTax.body.quote.totals.total_cents, null);
        assert.ok(missingTax.body.review_flags.some(f => f.code === 'missing_shop_tax_rate'));
        await pool.query('UPDATE shops SET tax_rate=0.1 WHERE id=$1', [shop]);
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
        const selected = draft({ assessments: [panel({ preset_version_id: presetRow.id, body_rate_cents: 9000 })] });
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
      await t.test('wrong/fake/incompatible preset and photo refs cannot save or preview; unsupported revisions', async () => {
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
        assert.equal((await request(`${base}/commit`, { method: 'POST', body: {} })).status, 404);
        assert.equal((await request(`${base}/quote`)).status, 404);
        assert.equal((await request(`${base}/cost-summary?revision_id=pretend`)).status, 404);
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
