'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { ensurePanelEstimator } = require('../src/db/panelEstimator');
const { createPanelEstimatorStore } = require('../src/services/panelEstimatorStore');

// Deliberately no dotenv/default DB fallback. Never clean up any pre-existing schema.
function testDatabase(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Postgres URL required');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Loopback database required');
  assert.match(decodeURIComponent(url.pathname).slice(1), /(?:^|_)test(?:_|$)/, 'Named test database required');
  assert.equal(url.search, '', 'URL connection overrides are prohibited');
  assert.equal(url.hash, '', 'URL fragments are prohibited');
  return value;
}
const database = process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL;
const validPanel = (patch = {}) => ({ panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light',
  damage_type: 'dent', area: 'center', operation: 'repair', refinish: true,
  body_hours: 1.25, refinish_hours: 0, body_rate_cents: 6500, refinish_rate_cents: 0,
  parts_sell_cents: 0, materials_sell_cents: null, sublet_sell_cents: 0,
  customer_notes: 'Repair hood', reviewed: false, preset_version_id: null, photo_ids: [], ...patch });
const saveInput = (scope, patch = {}) => ({ ...scope, expectedVersion: 0, assessments: [validPanel()],
  scenario: { payer: 'cash', provenance: 'shop_prepared', allocation: null }, adjustments: {}, ...patch });
const failure = (code, status = 400) => err => err.code === code && err.status === status;

test('test database guard refuses unsafe targets', () => {
  for (const url of ['postgresql://example.com/revv_test', 'postgresql://127.0.0.1/revv',
    'postgresql://127.0.0.1/revv_test?host=example.com', 'postgresql://127.0.0.1/revv_test?options=anything']) {
    assert.throws(() => testDatabase(url));
  }
});

for (const type of ['TEXT', 'UUID', 'VARCHAR(36)']) {
  test(`real PostgreSQL persistence: ${type}`, { skip: !database && 'PANEL_ESTIMATOR_TEST_DATABASE_URL missing; persistence NOT verified' }, async t => {
    const connectionString = testDatabase(database);
    const schema = `panel_estimator_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(schema, /^panel_estimator_test_[a-f0-9]{32}$/);
    const admin = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
    let pool;
    let owned = false;
    try {
      // Connection errors are test failures, never a fake database or passing skip.
      await admin.query(`CREATE SCHEMA "${schema}"`);
      owned = true;
      pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 8, connectionTimeoutMillis: 3000 });
      await pool.query(`CREATE TABLE shops (id ${type} PRIMARY KEY)`);
      await pool.query(`CREATE TABLE repair_orders (id ${type} PRIMARY KEY, shop_id ${type} NOT NULL REFERENCES shops(id),
        total NUMERIC NOT NULL DEFAULT 123.45, parts_total NUMERIC NOT NULL DEFAULT 67.89, labor_total NUMERIC NOT NULL DEFAULT 20)`);
      const id = () => type === 'TEXT' ? `text-${randomUUID()}` : randomUUID();
      const shopId = id(), otherShop = id();
      await pool.query('INSERT INTO shops(id) VALUES ($1), ($2)', [shopId, otherShop]);
      const newScope = async (shop = shopId) => {
        const roId = id();
        await pool.query('INSERT INTO repair_orders(id, shop_id) VALUES ($1, $2)', [roId, shop]);
        return { shopId: shop, roId };
      };
      const store = createPanelEstimatorStore(pool);

      await t.test('migration reruns/concurrent initialization; catalog types match parents', async () => {
        await Promise.all([ensurePanelEstimator(pool), ensurePanelEstimator(pool)]);
        await ensurePanelEstimator(pool);
        const rows = (await pool.query(`SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type
          FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relnamespace = $1::regnamespace AND c.relname IN ('ro_panel_estimator_drafts', 'ro_panel_estimator_costs')
          AND a.attname IN ('shop_id', 'ro_id')`, [schema])).rows;
        assert.equal(rows.length, 4);
        assert.ok(rows.every(row => row.type === ({ TEXT: 'text', UUID: 'uuid', 'VARCHAR(36)': 'character varying(36)' })[type]));
      });

      await t.test('empty reads return version zero without writes', async () => {
        const scope = await newScope();
        const draft = await store.getDraft(scope), costs = await store.getCosts(scope);
        assert.equal(draft.version, 0);
        assert.deepEqual(draft.assessments, []);
        assert.equal(draft.scenario.payer, 'cash');
        assert.equal(costs.version, 0);
        assert.equal(costs.overhead_cents, null);
        assert.equal((await pool.query('SELECT * FROM ro_panel_estimator_drafts WHERE shop_id=$1 AND ro_id=$2', [scope.shopId, scope.roId])).rowCount, 0);
        assert.equal((await pool.query('SELECT * FROM ro_panel_estimator_costs WHERE shop_id=$1 AND ro_id=$2', [scope.shopId, scope.roId])).rowCount, 0);
      });

      await t.test('save/reload, explicit zero vs null, independent costs, shared version and no RO money changes', async () => {
        const scope = await newScope();
        const moneyBefore = (await pool.query('SELECT * FROM repair_orders WHERE id=$1', [scope.roId])).rows;
        const saved = await store.saveDraft(saveInput(scope));
        assert.equal(saved.version, 1);
        assert.deepEqual(await store.getDraft(scope), saved);
        assert.equal(saved.assessments[0].refinish_hours, 0);
        assert.equal(saved.assessments[0].parts_sell_cents, 0);
        assert.equal(saved.assessments[0].materials_sell_cents, null);
        const costInput = { ...scope, expectedVersion: 1, lines: [{ panel_id: 'hood', parts_cost_cents: 0 }],
          target_margin_bps: 0, overhead_cents: 0, reason: 'PRIVATE cost note' };
        const cost = await store.saveCosts(costInput);
        assert.equal(cost.version, 2);
        assert.equal(cost.lines[0].body_cost_rate_cents, null);
        assert.equal(cost.lines[0].parts_cost_cents, 0);
        assert.deepEqual(await store.getCosts(scope), cost);
        assert.deepEqual(await store.getDraft(scope), { ...saved, version: 2 });
        await assert.rejects(store.saveDraft(saveInput(scope, { expectedVersion: 1 })), failure('VERSION_CONFLICT', 409));
        const second = await store.saveDraft(saveInput(scope, { expectedVersion: 2, assessments: [validPanel({ body_hours: 0 })] }));
        assert.equal(second.version, 3);
        assert.deepEqual(await store.getCosts(scope), { ...cost, version: 3 });
        assert.deepEqual((await pool.query('SELECT * FROM repair_orders WHERE id=$1', [scope.roId])).rows, moneyBefore);
        await ensurePanelEstimator(pool);
        assert.deepEqual(await store.getDraft(scope), second);
      });

      await t.test('cost-first save establishes version and leaves public draft empty', async () => {
        const scope = await newScope();
        await store.saveCosts({ ...scope, expectedVersion: 0, lines: [], reason: 'Private only' });
        const draft = await store.getDraft(scope);
        assert.equal(draft.version, 1);
        assert.deepEqual(draft.assessments, []);
        assert.ok(!JSON.stringify(draft).includes('Private only'));
      });

      await t.test('recursive allowlists strip private JSON on writes AND legacy reads', async () => {
        const scope = await newScope();
        const privateFields = { private_notes: 'SECRET', costs: { secret: 'SECRET' }, margin_bps: 1234, arbitrary: ['SECRET'] };
        const input = saveInput(scope, { ...privateFields,
          assessments: [validPanel({ ...privateFields, parts_cost_cents: 1 })],
          scenario: { payer: 'insurance', provenance: 'imported_carrier', ...privateFields,
            allocation: { customer_cents: 0, ...privateFields } },
          adjustments: { discount_cents: 0, ...privateFields } });
        const saved = await store.saveDraft(input);
        assert.ok(!JSON.stringify(saved).includes('SECRET'));
        assert.ok(!JSON.stringify(saved).includes('cost'));
        assert.equal(saved.scenario.allocation.customer_cents, 0);
        assert.equal(saved.adjustments.discount_cents, 0);
        const raw = (await pool.query('SELECT assessments, scenario, adjustments FROM ro_panel_estimator_drafts WHERE shop_id=$1 AND ro_id=$2', [scope.shopId, scope.roId])).rows[0];
        assert.ok(!JSON.stringify(raw).includes('SECRET'));
        // Simulate legacy/future storage contamination; safe public DTO is still explicit.
        await pool.query(`UPDATE ro_panel_estimator_drafts SET assessments=$3, scenario=$4, adjustments=$5
          WHERE shop_id=$1 AND ro_id=$2`, [scope.shopId, scope.roId, JSON.stringify(input.assessments), JSON.stringify(input.scenario), JSON.stringify(input.adjustments)]);
        assert.deepEqual(await store.getDraft(scope), saved);
        await assert.rejects(store.saveDraft(saveInput(scope, { expectedVersion: 1,
          scenario: { payer: 'insurance', provenance: 'carrier_approved' } })), failure('INVALID_INPUT'));
      });

      await t.test('unknown and wrong-tenant parents cannot read or write; DB also enforces ownership', async () => {
        const scope = await newScope();
        for (const bad of [{ ...scope, shopId: otherShop }, { ...scope, roId: id() }]) {
          for (const method of ['getDraft', 'getCosts', 'saveDraft', 'saveCosts']) {
            await assert.rejects(store[method](saveInput(bad)), failure('NOT_FOUND', 404));
          }
        }
        await assert.rejects(pool.query('INSERT INTO ro_panel_estimator_drafts(shop_id, ro_id) VALUES ($1,$2)', [otherShop, scope.roId]), err => err.code === '23503');
        await assert.rejects(pool.query('INSERT INTO ro_panel_estimator_costs(shop_id, ro_id) VALUES ($1,$2)', [otherShop, scope.roId]), err => err.code === '23503');
        assert.equal((await store.getDraft(scope)).version, 0);
      });

      await t.test('concurrent same version has exactly one winner, including draft versus cost', async () => {
        for (const mixed of [false, true]) {
          const scope = await newScope();
          const result = await Promise.allSettled([store.saveDraft(saveInput(scope)), mixed
            ? store.saveCosts({ ...scope, expectedVersion: 0, lines: [], reason: 'Race' })
            : store.saveDraft(saveInput(scope, { assessments: [validPanel({ body_hours: 2 })] }))]);
          assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
          const rejection = result.find(item => item.status === 'rejected').reason;
          assert.ok(failure('VERSION_CONFLICT', 409)(rejection));
          assert.equal((await store.getDraft(scope)).version, 1);
        }
      });

      await t.test('invalid numbers, booleans, panels, operations, sizes and duplicate panels fail without writes', async () => {
        const scope = await newScope();
        const patches = [
          ...[-1, 1.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, true, '0'].map(parts_sell_cents => ({ parts_sell_cents })),
          ...[-1, 1.001, 1000001, NaN, false, '1.25'].map(body_hours => ({ body_hours })),
          { refinish: 1 }, { reviewed: 0 }, { panel_id: 'made_up_panel' }, { operation: 'approved' },
          { customer_notes: { private_notes: 'SECRET' } }, { label: 'x'.repeat(201) },
        ];
        for (const patch of patches) await assert.rejects(store.saveDraft(saveInput(scope, { assessments: [validPanel(patch)] })), failure('INVALID_INPUT'));
        for (const expectedVersion of [undefined, null, true, '0', -1, 0.1]) {
          await assert.rejects(store.saveDraft(saveInput(scope, { expectedVersion })), failure('INVALID_INPUT'));
        }
        await assert.rejects(store.saveDraft(saveInput(scope, { assessments: [validPanel(), validPanel()] })), failure('INVALID_INPUT'));
        await assert.rejects(store.saveDraft(saveInput(scope, { assessments: Array(35).fill(validPanel()) })), failure('INVALID_INPUT'));
        await assert.rejects(store.saveCosts({ ...scope, expectedVersion: 0, target_margin_bps: 10000 }), failure('INVALID_INPUT'));
        await assert.rejects(store.saveCosts({ ...scope, expectedVersion: 0, overhead_cents: false }), failure('INVALID_INPUT'));
        await assert.rejects(store.saveCosts({ ...scope, expectedVersion: 0, lines: [{ panel_id: 'hood', parts_cost_cents: -1 }] }), failure('INVALID_INPUT'));
        assert.equal((await store.getDraft(scope)).version, 0);
        const upper = await store.saveDraft(saveInput(scope, { assessments: [validPanel({ body_hours: 0.29, parts_sell_cents: Number.MAX_SAFE_INTEGER })] }));
        assert.equal(upper.assessments[0].parts_sell_cents, Number.MAX_SAFE_INTEGER);
      });

      await t.test('reference validation fails closed absent storage; existing photos require same shop AND RO', async () => {
        const scope = await newScope();
        const photoId = id();
        await assert.rejects(store.saveDraft(saveInput(scope, { assessments: [validPanel({ photo_ids: [photoId] })] })), failure('INVALID_REFERENCE'));
        await assert.rejects(store.saveDraft(saveInput(scope, { assessments: [validPanel({ preset_version_id: id() })] })), failure('INVALID_REFERENCE'));
        await pool.query(`CREATE TABLE ro_photos (id ${type} PRIMARY KEY, ro_id ${type} NOT NULL REFERENCES repair_orders(id))`);
        const sibling = await newScope(), foreign = await newScope(otherShop);
        const siblingPhoto = id(), foreignPhoto = id();
        for (const [pid, ro] of [[photoId, scope.roId], [siblingPhoto, sibling.roId], [foreignPhoto, foreign.roId]]) {
          await pool.query('INSERT INTO ro_photos(id, ro_id) VALUES ($1,$2)', [pid, ro]);
        }
        for (const pid of [siblingPhoto, foreignPhoto, id()]) {
          await assert.rejects(store.saveDraft(saveInput(scope, { assessments: [validPanel({ photo_ids: [pid] })] })), failure('INVALID_REFERENCE'));
        }
        const saved = await store.saveDraft(saveInput(scope, { assessments: [validPanel({ photo_ids: [photoId] })] }));
        assert.deepEqual(saved.assessments[0].photo_ids, [photoId]);
      });

      await t.test('database failure after mutation rolls back public/private writes and version; clients release', async () => {
        const scope = await newScope();
        const before = await store.saveDraft(saveInput(scope));
        const beforeCosts = await store.getCosts(scope);
        await pool.query(`CREATE FUNCTION reject_panel_version() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'synthetic mutation failure'; END $$`);
        await pool.query(`CREATE TRIGGER reject_panel_version BEFORE UPDATE OF version ON ro_panel_estimator_drafts
          FOR EACH ROW EXECUTE FUNCTION reject_panel_version()`);
        await assert.rejects(store.saveDraft(saveInput(scope, { expectedVersion: 1, assessments: [] })), /synthetic mutation failure/);
        await assert.rejects(store.saveCosts({ ...scope, expectedVersion: 1, lines: [{ panel_id: 'hood', parts_cost_cents: 1200 }], reason: 'Must roll back' }), /synthetic mutation failure/);
        assert.deepEqual(await store.getDraft(scope), before);
        assert.deepEqual(await store.getCosts(scope), beforeCosts);
        const empty = await newScope();
        await assert.rejects(store.saveCosts({ ...empty, expectedVersion: 0, lines: [] }), /synthetic mutation failure/);
        assert.equal((await pool.query('SELECT * FROM ro_panel_estimator_drafts WHERE shop_id=$1 AND ro_id=$2', [empty.shopId, empty.roId])).rowCount, 0);
        assert.equal(pool.waitingCount, 0);
        assert.equal(pool.idleCount, pool.totalCount);
      });
    } finally {
      try {
        if (pool) await pool.end();
        if (owned) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  });
}
