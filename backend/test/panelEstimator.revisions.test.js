'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ensurePanelEstimator } = require('../src/db/panelEstimator');
const { createPanelEstimatorDraft, hashInputs } = require('../src/services/panelEstimatorDraft');
const { createPanelEstimatorStore } = require('../src/services/panelEstimatorStore');
const { createPanelEstimatorPresets } = require('../src/services/panelEstimatorPresets');
const { createPanelEstimatorRevisions, differences } = require('../src/services/panelEstimatorRevisions');

const panel = patch => ({ panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light',
  damage_type: 'dent', area: 'center', operation: 'repair', refinish: true, body_hours: 2,
  refinish_hours: 1, body_rate_cents: 10000, refinish_rate_cents: 10000, parts_sell_cents: 10000,
  materials_sell_cents: 5000, sublet_sell_cents: 0, reviewed: true, customer_notes: 'Repair the hood',
  taxable: { body: true, refinish: true, parts: true, materials: true, sublet: true }, ...patch });
const draft = patch => ({ assessments: [panel()], scenario: { payer: 'cash', provenance: 'shop_prepared' },
  adjustments: { discount_cents: 5000, minimum_cents: 0 }, ...patch });
const costs = () => ({ lines: [{ panel_id: 'hood', body_cost_rate_cents: 4000, refinish_cost_rate_cents: 4000,
  parts_cost_cents: 7000, materials_cost_cents: 3000, sublet_cost_cents: 0, private_notes: 'PRIVATE LINE' }],
  target_margin_bps: 4000, overhead_cents: 0, reason: 'PRIVATE REASON', private_notes: 'PRIVATE NOTE' });
const errorCode = code => err => err.code === code;
function noPrivate(value) {
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /cost|private|margin|target|reason|reviewed_by/);
    noPrivate(child);
  }
}
function localDatabase(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55459'); assert.equal(url.pathname, '/revv_panel_test');
  assert.equal(url.search, ''); assert.equal(url.hash, '');
  return value;
}
test('revision comparisons enumerate all changed safe inputs without equivalence claims', () => {
  const before = { scope: { assessments: [panel()] }, scenario: draft().scenario, adjustments: draft().adjustments };
  const after = { scope: { assessments: [panel({ body_rate_cents: 9000, operation: 'replace' }), panel({ panel_id: 'roof' })] },
    scenario: { payer: 'insurance', provenance: 'imported_carrier' }, adjustments: { discount_cents: 1, minimum_cents: 5 } };
  assert.deepEqual(differences(before, after).map(d => d.path),
    ['adjustments.discount_cents', 'adjustments.minimum_cents', 'scenario.payer', 'scenario.provenance', 'scope.assessments']);
  assert.deepEqual(differences(before, before), []);
});
test('revision test guard refuses any other database', () => {
  for (const url of ['postgresql://remote:55459/revv_panel_test', 'postgresql://localhost:5432/revv_panel_test',
    'postgresql://localhost:55459/revv', 'postgresql://localhost:55459/revv_panel_test?host=remote']) assert.throws(() => localDatabase(url));
});
test('selected money compatibility is narrow and unexpected database failures propagate', async () => {
  const path = require.resolve('../src/db'), original = require.cache[path];
  const { getSelectedPanelMoney } = require('../src/services/roMoney');
  try {
    require.cache[path] = { id: path, filename: path, loaded: true, exports: {
      pool: { query: async () => ({ rows: [{ revisions: null, pointer: false }] }) },
    } };
    assert.equal(await getSelectedPanelMoney('ro','shop'), null);
    require.cache[path].exports.pool.query = async () => { throw Object.assign(new Error('Unexpected failure'), { code: '42P01' }); };
    await assert.rejects(getSelectedPanelMoney('ro','shop'), errorCode('42P01'));
  } finally { if (original) require.cache[path] = original; else delete require.cache[path]; }
});

const database = process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL;
for (const type of ['TEXT', 'UUID']) test(`real PostgreSQL revisions ${type}: services and mounted production routes`, {
  skip: !database && 'PANEL_ESTIMATOR_TEST_DATABASE_URL missing; revision persistence NOT verified',
}, async t => {
  const connectionString = localDatabase(database), schema = `panel_revision_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  let pool, server, owned = false;
  const paths = ['../src/db', '../src/middleware/auth', '../src/routes/estimateLineItems'].map(require.resolve);
  const cached = paths.map(p => require.cache[p]), previousSecret = process.env.JWT_SECRET;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); owned = true;
    pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 10, connectionTimeoutMillis: 3000 });
    await pool.query(`CREATE TABLE shops(id ${type} PRIMARY KEY, tax_rate NUMERIC(8,4));
      CREATE TABLE users(id ${type} PRIMARY KEY, revoke_all_before TIMESTAMPTZ);
      CREATE TABLE revoked_tokens(id TEXT PRIMARY KEY, token_jti TEXT);
      CREATE TABLE repair_orders(id ${type} PRIMARY KEY, shop_id ${type} NOT NULL REFERENCES shops(id),
        parts_cost NUMERIC DEFAULT 0, labor_cost NUMERIC DEFAULT 0, sublet_cost NUMERIC DEFAULT 0,
        tax NUMERIC DEFAULT 0, total NUMERIC DEFAULT 123.45, estimate_amount NUMERIC DEFAULT 123.45,
        true_profit NUMERIC DEFAULT 987.65, deductible NUMERIC DEFAULT 0, deductible_waived NUMERIC DEFAULT 0,
        referral_fee NUMERIC DEFAULT 0, goodwill_repair_cost NUMERIC DEFAULT 0, status TEXT DEFAULT 'estimate',
        estimate_status TEXT, estimate_approved_at TEXT, estimate_approved_by TEXT, estimate_token TEXT,
        insurance_company TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE ro_payments(id TEXT PRIMARY KEY, shop_id ${type}, ro_id ${type}, amount_cents INTEGER, status TEXT)`);
    // Prove late/repeated ensure installs child guards after minimal storage setup.
    await ensurePanelEstimator(pool);
    await pool.query(`CREATE TABLE estimate_line_items(id TEXT PRIMARY KEY, ro_id TEXT NOT NULL, shop_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other', description TEXT NOT NULL DEFAULT '', quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit_price NUMERIC(10,2) NOT NULL DEFAULT 0, total NUMERIC(10,2) GENERATED ALWAYS AS (quantity*unit_price) STORED,
      taxable BOOLEAN NOT NULL DEFAULT FALSE, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE estimate_metadata(id TEXT PRIMARY KEY, ro_id TEXT, shop_id TEXT, adjuster_totals JSONB,
        adjuster_raw_text TEXT, import_draft JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE estimate_approval_links(id TEXT PRIMARY KEY, ro_id TEXT, shop_id TEXT, token TEXT, responded_at TEXT)`);
    await ensurePanelEstimator(pool); await ensurePanelEstimator(pool);
    const id = () => type === 'TEXT' ? `text-${randomUUID()}` : randomUUID();
    const shopId = id(), foreignShop = id(), actorId = id();
    await pool.query('INSERT INTO shops VALUES ($1,0.1),($2,0.1)', [shopId, foreignShop]);
    await pool.query('INSERT INTO users(id) VALUES ($1)', [actorId]);
    const newScope = async (shop = shopId) => {
      const roId = id();
      await pool.query('INSERT INTO repair_orders(id,shop_id) VALUES ($1,$2)', [roId, shop]);
      return { shopId: shop, roId, actorId, role: 'owner' };
    };
    const revisions = createPanelEstimatorRevisions(pool), drafts = createPanelEstimatorDraft(pool), store = createPanelEstimatorStore(pool);
    const prepare = async (scope, body = draft(), key = randomUUID()) => {
      const preview = await drafts.preview({ ...scope, body });
      return { ...body, expected_version: preview.version, input_hash: preview.input_hash, reviewed: true, idempotency_key: key };
    };
    const commit = async (scope, body = draft()) => revisions.commit({ ...scope, body: await prepare(scope, body) });
    const snapshot = async scope => {
      const result = {};
      for (const table of ['ro_panel_estimator_drafts', 'ro_panel_estimator_revisions', 'ro_panel_estimator_revision_costs', 'estimate_line_items', 'estimate_metadata']) {
        result[table] = (await pool.query(`SELECT * FROM ${table} WHERE shop_id=$1 AND ro_id=$2 ORDER BY to_jsonb(${table})::text`, [scope.shopId, scope.roId])).rows;
      }
      result.ro = (await pool.query('SELECT * FROM repair_orders WHERE shop_id=$1 AND id=$2', [scope.shopId, scope.roId])).rows;
      return result;
    };
    // Test-only fixture damage; no request or production API can set this flag.
    const internalWrite = async (scope, sql, params) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('revv.panel_commit',jsonb_build_array($1::text,$2::text)::text,true)", [scope.shopId, scope.roId]);
        await client.query(sql, params); await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
    };

    const main = await newScope(); let first, firstRequest;
    await t.test('direct service: F1 immutable quote/private snapshot, exact net materialization and idempotent concurrency', async () => {
      await store.saveCosts({ ...main, ...costs(), expectedVersion: 0 });
      await pool.query('INSERT INTO estimate_metadata(id,ro_id,shop_id,adjuster_totals) VALUES ($1,$2,$3,$4)',
        [randomUUID(), main.roId, shopId, { grand_total: 9999, insurer: 'Original reference' }]);
      firstRequest = await prepare(main);
      const results = await Promise.all([revisions.commit({ ...main, body: firstRequest }), revisions.commit({ ...main, body: firstRequest })]);
      assert.deepEqual(results[0], results[1]); first = results[0];
      assert.equal(first.version, 2); assert.equal(first.quote.totals.total_cents, 44000);
      assert.equal(first.quote.scope.assessments[0].customer_notes, 'Repair the hood');
      assert.equal(first.quote.reviewed, true); assert.ok(Date.parse(first.quote.reviewed_at));
      const { quote_hash, ...hashable } = first.quote; assert.equal(hashInputs(hashable), quote_hash);
      noPrivate(first);
      const privateResult = await revisions.getCosts({ ...main, revisionId: first.revision_id });
      assert.equal(privateResult.costs.direct_cost_cents, 22000); assert.equal(privateResult.costs.contribution_cents, 18000);
      const state = await snapshot(main);
      assert.equal(state.ro_panel_estimator_revisions.length, 1);
      assert.equal(state.ro_panel_estimator_revision_costs.length, 1);
      assert.equal(state.ro_panel_estimator_drafts[0].active_revision_id, first.revision_id);
      assert.equal(Number(state.ro[0].total), 440); assert.equal(Number(state.ro[0].true_profit), 987.65);
      assert.equal(state.estimate_metadata[0].adjuster_totals.insurer, 'Original reference');
      assert.equal(state.estimate_line_items.reduce((s, l) => s + Math.round(Number(l.total) * 100), 0), 40000);
      for (const line of state.estimate_line_items) { assert.equal(line.quantity, '1.00'); assert.match(line.panel_fingerprint, /^[a-f0-9]{64}$/); }
      for (const table of ['ro_panel_estimator_revisions', 'ro_panel_estimator_revision_costs']) {
        await assert.rejects(pool.query(`UPDATE ${table} SET shop_id=shop_id WHERE shop_id=$1 AND ro_id=$2`, [shopId,main.roId]), errorCode('23514'));
        await assert.rejects(pool.query(`DELETE FROM ${table} WHERE shop_id=$1 AND ro_id=$2`, [shopId,main.roId]), errorCode('23514'));
      }
      assert.deepEqual(await revisions.commit({ ...main, body: firstRequest }), first);
    });

    await t.test('direct service: wrong tenant/role and mismatched key, hash, stale version fail closed', async () => {
      await assert.rejects(revisions.commit({ ...main, shopId: foreignShop, body: firstRequest }), errorCode('NOT_FOUND'));
      await assert.rejects(revisions.getQuote({ ...main, shopId: foreignShop, revisionId: first.revision_id }), errorCode('NOT_FOUND'));
      await assert.rejects(revisions.getCosts({ ...main, role: 'assistant', revisionId: first.revision_id }), errorCode('FORBIDDEN'));
      await assert.rejects(revisions.commit({ ...main, role: 'technician', body: firstRequest }), errorCode('FORBIDDEN'));
      await assert.rejects(revisions.commit({ ...main, body: { ...firstRequest, adjustments: {} } }), errorCode('IDEMPOTENCY_CONFLICT'));
      await assert.rejects(revisions.commit({ ...main, body: { ...firstRequest, idempotency_key: randomUUID() } }), errorCode('VERSION_CONFLICT'));
      const current = await prepare(main);
      for (const input_hash of ['bad', null, 7]) await assert.rejects(revisions.commit({ ...main, body: { ...current, input_hash } }), errorCode('INVALID_INPUT'));
      await assert.rejects(revisions.commit({ ...main, body: { ...current, input_hash: '0'.repeat(64) } }), errorCode('PREVIEW_CONFLICT'));
      await assert.rejects(revisions.commit({ ...main, body: { ...current, reviewed: false } }), errorCode('INVALID_INPUT'));
      const before = await snapshot(main);
      for (const patch of [{ reviewed: false }, { body_hours: null }, { operation: 'inspection-required' }, { taxable: {} }]) {
        await assert.rejects(commit(main, draft({ assessments: [panel(patch)] })), errorCode('REVIEW_REQUIRED'));
      }
      assert.deepEqual(await snapshot(main), before);
    });

    await t.test('direct service: different keys racing same preview have one winner', async () => {
      const scope = await newScope(), body = await prepare(scope);
      const outcomes = await Promise.allSettled([revisions.commit({ ...scope, body }),
        revisions.commit({ ...scope, body: { ...body, idempotency_key: randomUUID() } })]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(outcomes.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
      assert.equal((await snapshot(scope)).ro_panel_estimator_revisions.length, 1);
    });
    await t.test('direct service: changed posted payments invalidate preview, changed private settings invalidate version', async () => {
      const scope = await newScope(), request = await prepare(scope);
      await pool.query('INSERT INTO ro_payments VALUES ($1,$2,$3,1000,\'paid\')', [randomUUID(),shopId,scope.roId]);
      await assert.rejects(revisions.commit({ ...scope, body: request }), errorCode('PREVIEW_CONFLICT'));
      const fresh = await prepare(scope);
      await store.saveCosts({ ...scope, ...costs(), expectedVersion: 0 });
      await assert.rejects(revisions.commit({ ...scope, body: fresh }), errorCode('VERSION_CONFLICT'));
      assert.equal((await snapshot(scope)).ro_panel_estimator_revisions.length, 0);
    });

    await t.test('direct service: forced late rollback restores draft, pointer, history, private snapshots, lines and RO', async () => {
      const before = await snapshot(main);
      await pool.query(`CREATE FUNCTION fail_panel_total() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'TEST_FORCED_ROLLBACK'; END $$;
        CREATE TRIGGER fail_panel_total BEFORE UPDATE OF total ON repair_orders FOR EACH ROW EXECUTE FUNCTION fail_panel_total()`);
      try { await assert.rejects(commit(main, draft({ adjustments: { discount_cents: 1000 } })), /TEST_FORCED_ROLLBACK/); }
      finally { await pool.query('DROP TRIGGER fail_panel_total ON repair_orders'); }
      assert.deepEqual(await snapshot(main), before);
    });

    await t.test('direct service: manual, modified and missing rows are preserved with explicit conflicts', async () => {
      const manual = await newScope();
      await pool.query(`INSERT INTO estimate_line_items(id,shop_id,ro_id,description,unit_price) VALUES ($1,$2,$3,'Manual',5)`, [randomUUID(),shopId,manual.roId]);
      const before = await snapshot(manual);
      await assert.rejects(commit(manual), errorCode('LINE_RECONCILIATION_REQUIRED'));
      assert.deepEqual(await snapshot(manual), before);
      for (const mutation of ['edit', 'missing', 'manual']) {
        const scope = await newScope(); await commit(scope);
        if (mutation === 'edit') await internalWrite(scope, `UPDATE estimate_line_items SET description='Edited' WHERE shop_id=$1 AND ro_id=$2`, [shopId,scope.roId]);
        if (mutation === 'missing') await internalWrite(scope, `DELETE FROM estimate_line_items WHERE shop_id=$1 AND ro_id=$2`, [shopId,scope.roId]);
        if (mutation === 'manual') await internalWrite(scope, `INSERT INTO estimate_line_items(id,shop_id,ro_id) VALUES ($1,$2,$3)`, [randomUUID(),shopId,scope.roId]);
        const damaged = await snapshot(scope);
        await assert.rejects(commit(scope), errorCode('LINE_RECONCILIATION_REQUIRED'));
        assert.deepEqual(await snapshot(scope), damaged);
      }
    });

    await t.test('direct service: required scope decrease conflicts; same payer revision captures all differences', async () => {
      const before = await snapshot(main);
      for (const patch of [{ body_hours: 1 }, { refinish: false }, { operation: 'paint-only' }]) {
        await assert.rejects(commit(main, draft({ assessments: [panel(patch)] })), errorCode('SCOPE_RECONCILIATION_REQUIRED'));
      }
      assert.deepEqual(await snapshot(main), before);
      const next = await commit(main, draft({ assessments: [panel({ body_rate_cents: 12000 }), panel({ panel_id: 'roof' })],
        adjustments: { discount_cents: 4000, minimum_cents: 0 } }));
      assert.notEqual(next.revision_id, first.revision_id); assert.equal(next.quote.scenario.payer, 'cash');
      assert.ok(next.quote.comparisons[0].differences.some(d => d.path === 'scope.assessments'));
      assert.ok(next.quote.comparisons[0].differences.some(d => d.path === 'adjustments.discount_cents'));
      assert.deepEqual(await revisions.getQuote({ ...main, revisionId: first.revision_id }), first);
      assert.deepEqual(await revisions.commit({ ...main, body: firstRequest }), first);
      noPrivate(next);
    });

    await t.test('direct service: unknown allocation issues honest quote; package charges exactly once', async () => {
      const scope = await newScope();
      const result = await commit(scope, draft({ assessments: [panel({ package: {
        name: 'Body and paint', price_cents: 15000, taxable: true, included_operations: ['body','refinish'] } })],
      adjustments: {}, scenario: { payer: 'insurance', provenance: 'shop_prepared' } }));
      assert.equal(result.quote.totals.total_cents, 33000);
      assert.equal(result.quote.allocation.complete, false); assert.equal(result.quote.allocation.customer_cents, null);
      assert.ok(result.quote.review_flags.some(f => f.code === 'incomplete_insurance_allocation'));
      const rows = (await snapshot(scope)).estimate_line_items;
      assert.equal(rows.filter(l => l.panel_source_key.startsWith('package:')).length, 1);
      assert.equal(rows.filter(l => ['line:hood:body','line:hood:refinish'].includes(l.panel_source_key)).length, 0);
      assert.equal(rows.reduce((s, l) => s + Math.round(Number(l.total) * 100), 0), 30000);
    });

    await t.test('direct service: immutable preset applications survive newer catalog versions', async () => {
      const presets = createPanelEstimatorPresets(pool), scope = await newScope(), source = panel();
      const body = { contract_version: 1, name: 'Reviewed hood',
        match: { panel_id: 'hood', body_style: 'sedan', severity: 'light', operation: 'repair' },
        sell_settings: Object.fromEntries(['body_hours','refinish_hours','refinish','body_rate_cents','refinish_rate_cents',
          'parts_sell_cents','materials_sell_cents','sublet_sell_cents','taxable'].map(k => [k,source[k]])),
        private_cost_config: { body_cost_rate_cents: 1234, private_notes: 'PRIVATE PRESET' }, reason: 'PRIVATE PRESET REASON' };
      const preset = await presets.create({ ...scope, body });
      const quote = await commit(scope, draft({ assessments: [panel({ preset_version_id: preset.id })] }));
      assert.equal(quote.quote.scope.assessments[0].application_snapshot.id, preset.id);
      await presets.version({ ...scope, familyId: preset.family_id, body: { ...body, name: 'New catalog name' } });
      assert.deepEqual(await revisions.getQuote({ ...scope, revisionId: quote.revision_id }), quote);
      noPrivate(quote);
    });

    await t.test('database guards: legacy financial/approval/metadata/line writes blocked, normal RO works', async () => {
      const before = await snapshot(main);
      const queries = [
        [`UPDATE repair_orders SET total=1 WHERE id=$1 AND shop_id=$2`, [main.roId, shopId]],
        [`UPDATE repair_orders SET status='approval',estimate_approved_at='now' WHERE id=$1`, [main.roId]],
        [`UPDATE repair_orders SET insurance_company='Replaced' WHERE id=$1 AND shop_id=$2`, [main.roId,shopId]],
        [`UPDATE estimate_metadata SET adjuster_totals='{}' WHERE ro_id=$1 AND shop_id=$2`, [main.roId,shopId]],
        [`DELETE FROM estimate_metadata WHERE ro_id=$1 AND shop_id=$2`, [main.roId,shopId]],
        [`UPDATE estimate_line_items SET unit_price=1 WHERE ro_id=$1 AND shop_id=$2`, [main.roId,shopId]],
        [`DELETE FROM estimate_line_items WHERE ro_id=$1 AND shop_id=$2`, [main.roId,shopId]],
        [`INSERT INTO estimate_line_items(id,ro_id,shop_id) VALUES ($1,$2,$3)`, [randomUUID(),main.roId,shopId]],
        [`INSERT INTO estimate_line_items(id,ro_id,shop_id) VALUES ($1,$2,$3)`, [randomUUID(),main.roId,foreignShop]],
        [`INSERT INTO estimate_approval_links(id,ro_id,shop_id,token) VALUES ($1,$2,$3,'old')`, [randomUUID(),main.roId,shopId]],
        [`UPDATE ro_panel_estimator_drafts SET active_revision_id=NULL WHERE ro_id=$1 AND shop_id=$2`, [main.roId,shopId]],
      ];
      for (const [sql, params] of queries) await assert.rejects(pool.query(sql, params), errorCode('P0001'));
      // A capability for another tenant must never bypass the selected owner.
      await assert.rejects(internalWrite({ ...main, shopId: foreignShop }, queries[0][0], queries[0][1]), errorCode('P0001'));
      assert.deepEqual(await snapshot(main), before);
      const legacy = await newScope();
      await pool.query(`UPDATE repair_orders SET total=7 WHERE id=$1 AND shop_id=$2`, [legacy.roId,shopId]);
      await pool.query('INSERT INTO estimate_line_items(id,ro_id,shop_id) VALUES ($1,$2,$3)', [randomUUID(),legacy.roId,shopId]);
      await pool.query(`UPDATE estimate_line_items SET unit_price=8 WHERE ro_id=$1 AND shop_id=$2`, [legacy.roId,shopId]);
      await pool.query('DELETE FROM estimate_line_items WHERE ro_id=$1 AND shop_id=$2', [legacy.roId,shopId]);
    });

    await t.test('database guard race: waiting legacy insertion observes committed selection', async () => {
      const scope = await newScope(), request = await prepare(scope);
      const reached = {}, resume = {};
      reached.promise = new Promise(resolve => { reached.resolve = resolve; });
      resume.promise = new Promise(resolve => { resume.resolve = resolve; });
      const pausedPool = { connect: async () => {
        const client = await pool.connect();
        return { release: () => client.release(), query: async (sql, args) => {
          const value = await client.query(sql,args);
          if (sql.startsWith('UPDATE ro_panel_estimator_drafts SET active_revision_id')) { reached.resolve(); await resume.promise; }
          return value;
        } };
      } };
      const committing = createPanelEstimatorRevisions(pausedPool).commit({ ...scope, body: request });
      await Promise.race([reached.promise, committing.then(() => { throw new Error('Commit failed to pause'); })]);
      const writer = await pool.connect();
      let write;
      try {
        const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        write = writer.query(`INSERT INTO estimate_line_items(id,ro_id,shop_id) VALUES ($1,$2,$3)`, [randomUUID(),scope.roId,shopId]);
        const rejected = assert.rejects(write, errorCode('P0001'));
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          const locks = await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted', [pid]);
          if (locks.rowCount) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(waiting, 'legacy write must wait on owned RO lock');
        resume.resolve(); await committing; await rejected;
      } finally { resume.resolve(); await committing; if (write) await write.catch(() => undefined); writer.release(); }
      assert.equal((await snapshot(scope)).estimate_line_items.some(l => !l.panel_revision_id), false);
    });

    process.env.JWT_SECRET = 'isolated-revision-http-test-only';
    const db = { pool, dbGet: async (sql, params) => (await pool.query(sql, params)).rows[0],
      dbAll: async (sql, params) => (await pool.query(sql, params)).rows, dbRun: (sql, params) => pool.query(sql, params) };
    require.cache[paths[0]] = { id: paths[0], filename: paths[0], loaded: true, exports: db };
    delete require.cache[paths[1]]; delete require.cache[paths[2]];
    const app = express(); app.use(express.json());
    app.use('/api/estimate-items', require('../src/routes/estimateLineItems'));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, method = 'GET', body, role = 'owner', tenant = shopId) => {
      const token = jwt.sign({ id: actorId, shop_id: tenant, role, jti: randomUUID() }, process.env.JWT_SECRET);
      const response = await fetch(`${origin}/api/estimate-items/${path}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
    };
    await t.test('mounted production routes: commit/quote/cost roles, selected summary, draft isolation and tax freeze', async () => {
      const scope = await newScope(), base = `${scope.roId}/panel-estimator`;
      const preview = await request(`${base}/preview`, 'POST', { ...draft(), expected_version: 0 });
      assert.equal(preview.status, 200);
      const body = { ...draft(), expected_version: 0, input_hash: preview.body.input_hash, reviewed: true, idempotency_key: randomUUID() };
      const denied = await request(`${base}/commit`, 'POST', body, 'technician'); assert.equal(denied.status, 403);
      const response = await request(`${base}/commit`, 'POST', body, 'assistant'); assert.equal(response.status, 200);
      noPrivate(response.body); assert.equal(response.cache, 'no-store');
      assert.deepEqual((await request(`${base}/commit`, 'POST', body)).body, response.body);
      const revisionId = response.body.revision_id;
      assert.deepEqual((await request(`${base}/quote?revision_id=${revisionId}`)).body, response.body);
      assert.equal((await request(`${base}/quote?revision_id=${revisionId}`, 'GET', undefined, 'owner', foreignShop)).status, 404);
      assert.equal((await request(`${base}/cost-summary?revision_id=${revisionId}`, 'GET', undefined, 'assistant')).status, 403);
      assert.equal((await request(`${base}/cost-summary?revision_id=${revisionId}`, 'GET', undefined, 'admin')).status, 200);
      assert.equal((await request(base)).body.active_revision_id, revisionId);
      const summaryBefore = (await request(`${scope.roId}/summary`)).body;
      assert.equal(summaryBefore.summary.grand_total, 440); assert.equal(summaryBefore.summary.source, 'panel_estimator_revision');
      const roMoney = require('../src/services/roMoney');
      const moneyBefore = await roMoney.getRoMoneySummary(scope.roId, shopId); assert.equal(moneyBefore.totalCents, 44000);
      const before = await snapshot(scope);
      const alternate = draft({ assessments: [panel({ parts_sell_cents: 20000 })], scenario: { payer: 'insurance', provenance: 'shop_prepared' } });
      assert.equal((await request(`${base}/preview`, 'POST', { ...alternate, expected_version: 1 })).status, 200);
      assert.deepEqual(await snapshot(scope), before);
      const save = await request(`${base}/draft`, 'PUT', { ...alternate, expected_version: 1 });
      assert.equal(save.status, 200); assert.equal(save.body.active_revision_id, revisionId);
      const staleTax = await prepare(scope, alternate);
      await pool.query('UPDATE shops SET tax_rate=0.2 WHERE id=$1', [shopId]);
      try {
        assert.deepEqual((await request(`${scope.roId}/summary`)).body, summaryBefore);
        assert.deepEqual(await roMoney.getRoMoneySummary(scope.roId, shopId), moneyBefore);
        assert.deepEqual((await request(`${base}/quote?revision_id=${revisionId}`)).body, response.body);
        assert.deepEqual((await request(`${base}/commit`, 'POST', body)).body, response.body);
        assert.equal((await request(`${base}/commit`, 'POST', staleTax)).body.error, 'PREVIEW_CONFLICT');
      } finally { await pool.query('UPDATE shops SET tax_rate=0.1 WHERE id=$1', [shopId]); }
      const selectedState = await snapshot(scope);
      assert.deepEqual(selectedState.ro, before.ro); assert.deepEqual(selectedState.estimate_line_items, before.estimate_line_items);
      const line = before.estimate_line_items[0];
      for (const [path, method, payload] of [
        [scope.roId, 'POST', { type: 'parts', description: 'Unowned', quantity: 1, unit_price: 1,
          panel_revision_id: revisionId, 'revv.panel_commit': [shopId,scope.roId], internal_commit: true }],
        [`${scope.roId}/${line.id}`, 'PUT', { unit_price: 1 }], [`${scope.roId}/${line.id}`, 'DELETE'],
        [`${scope.roId}/import-financials`, 'POST', {}], [`metadata/${scope.roId}`, 'POST', { adjuster_totals: { total: 1 } }],
      ]) {
        const blocked = await request(path,method,payload); assert.equal(blocked.status,409); assert.equal(blocked.body.error,'PANEL_REVISION_CONFLICT');
      }
      assert.deepEqual(await snapshot(scope), selectedState);
      await assert.rejects(require('../src/routes/estimateLineItems').syncRepairOrderFinancials(scope.roId, shopId, {}), errorCode('P0001'));
      const legacy = await newScope();
      const normal = await request(legacy.roId, 'POST', { type: 'parts', description: 'Legacy', quantity: 1, unit_price: 10, taxable: false });
      assert.equal(normal.status, 201);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    paths.forEach((p, i) => { if (cached[i]) require.cache[p] = cached[i]; else delete require.cache[p]; });
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    if (pool) await pool.end();
    if (owned) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
