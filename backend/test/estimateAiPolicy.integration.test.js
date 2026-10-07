'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const roles = require('../src/middleware/roles');
const { up } = require('../src/db/estimateAiPolicy');
const secret = 'synthetic-estimate-policy-jwt';
const epoch = Date.parse('2026-10-07T12:00:00Z');

// Deliberately exclude app startup, dotenv, production DB and provider clients.
// Every dependency is allowlisted; unexpected provider imports fail the fixture.
function load(file, dependencies) {
  const filename = path.resolve(__dirname, '../src', file);
  const module = { exports: {} }, local = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports,process){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (['express', 'jsonwebtoken'].includes(name)) return local(name);
    throw new Error(`Forbidden dependency: ${name}`);
  }, module, module.exports, { env: { JWT_SECRET: secret } });
  return module.exports;
}

async function fixture(t, type = 'TEXT') {
  assert.equal(process.env.PGHOST, '127.0.0.1', 'Explicit disposable loopback PGHOST required');
  assert.match(process.env.PGDATABASE || '', /^revv_estimate_ai_test(?:_[a-z0-9_]+)?$/, 'Disposable test database only');
  assert.match(process.env.PGPORT || '', /^\d+$/);
  assert.ok(process.env.PGUSER);
  assert.equal(process.env.DATABASE_URL, undefined, 'Use standard PG vars, never DATABASE_URL');
  const config = { ssl: false, connectionTimeoutMillis: 1500, statement_timeout: 5000 };
  const admin = new Pool(config), schema = `estimate_ai_${randomUUID().replaceAll('-', '')}`;
  const shop = type === 'TEXT' ? 'shop-local' : randomUUID();
  const other = type === 'TEXT' ? 'shop-other' : randomUUID();
  let pool, server, created = false, clock = null, failure = null;
  const queries = [];
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await admin.query(`CREATE SCHEMA ${schema}`); created = true;
  const newPool = () => new Pool({ ...config, options: `-c search_path=${schema}`, max: 20 });
  pool = newPool();
  await pool.query(`CREATE TABLE shops (id ${type} PRIMARY KEY,
    sms_notifications_enabled BOOLEAN DEFAULT TRUE, email_notifications_enabled BOOLEAN DEFAULT TRUE,
    parts_margin_pct REAL DEFAULT 0.25, materials_margin_pct REAL DEFAULT 0.45,
    sublet_margin_pct REAL DEFAULT 0.05, blended_labor_cost_per_hr REAL, tax_rate REAL DEFAULT 0.07);
    CREATE TABLE users (id TEXT PRIMARY KEY, revoke_all_before TIMESTAMPTZ);
    CREATE TABLE revoked_tokens (id TEXT, token_jti TEXT)`);
  await pool.query('INSERT INTO shops(id) VALUES ($1),($2)', [shop, other]);
  await Promise.all([up(pool), up(pool)]);
  const query = async (client, sql, args) => {
    queries.push(sql);
    assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/, 'No request-time DDL');
    if (failure?.(sql)) throw new Error('Synthetic database failure');
    // Isolated fixture seam: actual PG timestamp value, never body/header/env time.
    if (clock !== null && sql === 'SELECT clock_timestamp() AS now') {
      return client.query('SELECT $1::timestamptz AS now', [new Date(clock)]);
    }
    return client.query(sql, args);
  };
  const db = {
    pool: { connect: async () => {
      const client = await pool.connect();
      return { query: (sql, args) => query(client, sql, args), release: discard => client.release(discard) };
    } },
    dbGet: async (sql, args) => (await query(pool, sql, args)).rows[0],
    dbRun: (sql, args) => query(pool, sql, args),
  };
  const freshService = () => load('services/estimateAiPolicy.js', { '../db': db });
  let service = freshService();
  const auth = load('middleware/auth.js', { '../db': db });
  const settings = load('routes/settings.js', { '../db': db, '../middleware/auth': auth,
    '../middleware/roles': roles, '../services/publicShop': { newPublicIntakeSlug: () => assert.fail('Not in E1') },
    '../services/paymentReservations': { withLockedShopDeletion: () => assert.fail('Not in E1'), PaymentError: Error } });
  const app = express(); app.use(express.json()); app.use('/api/settings', settings);
  // Test-only harness for simultaneous authenticated users consuming the E2 API.
  app.post('/admission', auth, roles.requireTechnician, async (req, res) => {
    res.json(await service.admitEstimateAi(req.user.shop_id));
  });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  async function request(url = '/api/settings', { role = 'owner', tenant = shop, body, token, id = randomUUID() } = {}) {
    const bearer = token === undefined ? jwt.sign({ id, role, shop_id: tenant }, secret, { expiresIn: '1h' }) : token;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method: url === '/admission' ? 'POST' : body === undefined ? 'GET' : 'PATCH',
      headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { shop, other, schema, queries, request, db,
    sql: (sql, args) => pool.query(sql, args),
    admit: (...args) => service.admitEstimateAi(...args),
    time: value => { clock = value; }, fail: value => { failure = value; },
    restart: async () => { await pool.end(); pool = newPool(); service = freshService(); },
    initialize: () => up(pool),
    connect: () => pool.connect(),
    enable: id => pool.query('UPDATE shops SET estimate_ai_enabled = TRUE WHERE id = $1', [id || shop]),
  };
}

for (const type of ['TEXT', 'UUID']) {
  test(`real PG ${type}: additive default, mounted settings exact roles, privacy, validation and tenant isolation`, async t => {
    const f = await fixture(t, type);
    assert.equal((await f.request()).body.estimate_ai_enabled, false);
    for (const role of ['owner', 'admin', 'assistant', 'superadmin', 'technician', 'employee', 'staff', 'customer', 'unknown', 'OWNER', 'Admin', ' owner']) {
      const read = await f.request('/api/settings', { role });
      const canRead = !['customer', 'unknown', ' owner'].includes(role);
      assert.equal(read.status, canRead ? 200 : 403, role);
      if (canRead) {
        assert.equal(typeof read.body.estimate_ai_enabled, 'boolean');
        assert.equal(Object.hasOwn(read.body, 'parts_margin_pct'), ['owner', 'admin'].includes(role), role);
        assert.doesNotMatch(JSON.stringify(read.body), /api_key|secret|budget|window_started_at|admission_count/);
      }
      const write = await f.request('/api/settings', { role, body: { estimate_ai_enabled: true, role: 'owner', shop_id: f.other } });
      assert.equal(write.status, ['owner', 'admin'].includes(role) ? 200 : 403, role);
      if (write.status === 200) assert.equal(write.body.estimate_ai_enabled, true);
    }
    assert.equal((await f.request('/api/settings', { tenant: f.other })).body.estimate_ai_enabled, false);
    assert.equal((await f.request('/api/settings', { body: { estimate_ai_enabled: false } })).body.estimate_ai_enabled, false);
    for (const value of [null, 'true', 'false', '', 1, 0, {}, []]) {
      const before = (await f.sql('SELECT * FROM shops WHERE id = $1', [f.shop])).rows[0];
      assert.equal((await f.request('/api/settings', { body: { estimate_ai_enabled: value, sms_notifications_enabled: false, parts_margin_pct: 0.1 } })).status, 400);
      assert.deepEqual((await f.sql('SELECT * FROM shops WHERE id = $1', [f.shop])).rows[0], before);
    }
    assert.equal((await f.request('/api/settings', { body: {} })).status, 400);
    await f.request('/api/settings', { body: { estimate_ai_enabled: true } });
    const preserved = await f.request('/api/settings', { body: { email_notifications_enabled: false, parts_margin_pct: 0.33, blended_labor_cost_per_hr: 51 } });
    assert.equal(preserved.body.estimate_ai_enabled, true);
    assert.equal(preserved.body.parts_margin_pct, 0.33);
    assert.equal(preserved.body.blended_labor_cost_per_hr, 51);
    assert.equal(preserved.body.email_notifications_enabled, false);
    assert.equal((await f.sql('SELECT tax_rate FROM shops WHERE id = $1', [f.shop])).rows[0].tax_rate, 0.07);
    const forged = jwt.sign({ id: 'forged', role: 'owner', shop_id: f.shop }, 'wrong-signature');
    assert.equal((await f.request('/api/settings', { token: forged, body: { estimate_ai_enabled: false } })).status, 401);
    assert.equal((await f.request('/api/settings', { token: '', body: { estimate_ai_enabled: false } })).status, 401);
    assert.equal((await f.request()).body.estimate_ai_enabled, true);
    await f.initialize();
    assert.equal((await f.request()).body.estimate_ai_enabled, true);
    const newShop = type === 'TEXT' ? 'new-shop' : randomUUID();
    await f.sql('INSERT INTO shops(id) VALUES ($1)', [newShop]);
    assert.equal((await f.request('/api/settings', { tenant: newShop })).body.estimate_ai_enabled, false);
  });

  test(`real PG ${type}: 15 aggregate multi-user admissions, independent shop, exact boundary and restart`, async t => {
    const f = await fixture(t, type); f.time(epoch);
    assert.deepEqual(await f.admit(f.shop), { status: 'off' });
    assert.equal((await f.sql('SELECT * FROM estimate_ai_budgets')).rowCount, 0);
    await f.enable(); await f.enable(f.other);
    const results = await Promise.all(Array.from({ length: 40 }, (_, index) => f.request('/admission', {
      role: ['owner', 'admin', 'staff', 'technician'][index % 4],
      body: { shop_id: f.other, now: epoch + 600000, limit: 999, estimate_ai_enabled: true },
    })));
    assert.equal(results.filter(r => r.body.status === 'admitted').length, 15);
    assert.equal(results.filter(r => r.body.status === 'quota').length, 25);
    assert.deepEqual(await f.admit(f.other), { status: 'admitted' });
    await f.initialize();
    await f.restart(); f.time(epoch + 599999);
    assert.deepEqual(await f.admit(f.shop), { status: 'quota' });
    f.time(epoch + 600000);
    assert.deepEqual(await f.admit(f.shop), { status: 'admitted' });
    const row = (await f.sql('SELECT * FROM estimate_ai_budgets WHERE shop_id = $1', [f.shop])).rows[0];
    assert.equal(row.admission_count, 1); assert.equal(row.window_started_at.getTime(), epoch + 600000);
    await f.request('/api/settings', { body: { estimate_ai_enabled: false } });
    assert.deepEqual(await f.admit(f.shop), { status: 'off' });
    await f.enable(); assert.deepEqual(await f.admit(f.shop), { status: 'admitted' });
    assert.equal((await f.sql('SELECT admission_count FROM estimate_ai_budgets WHERE shop_id = $1', [f.shop])).rows[0].admission_count, 2);
  });
}

test('real PG: policy revocation serializes with admission and schema errors return safe HTTP errors', async t => {
  const f = await fixture(t); await f.enable();
  const client = await f.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE shops SET estimate_ai_enabled = FALSE WHERE id = $1', [f.shop]);
    const admission = f.admit(f.shop);
    await client.query('COMMIT');
    assert.deepEqual(await admission, { status: 'off' });
    assert.equal((await f.sql('SELECT * FROM estimate_ai_budgets')).rowCount, 0);
  } finally { client.release(); }
  f.fail(sql => /SELECT/.test(sql) && /FROM shops/.test(sql));
  const read = await f.request();
  assert.deepEqual(read, { status: 500, body: { error: 'Could not load settings' } });
  f.fail(sql => /UPDATE shops/.test(sql));
  const write = await f.request('/api/settings', { body: { estimate_ai_enabled: true } });
  assert.deepEqual(write, { status: 500, body: { error: 'Could not save settings' } });
  f.fail(null);
  assert.equal((await f.request()).body.estimate_ai_enabled, false);
  await f.sql('ALTER TABLE estimate_ai_budgets DROP CONSTRAINT estimate_ai_budgets_admission_count_check');
  await f.sql('ALTER TABLE estimate_ai_budgets ALTER COLUMN admission_count TYPE TEXT');
  await assert.rejects(f.initialize(), { code: 'ESTIMATE_AI_SCHEMA_REQUIRED' });
});

// Exercise independent Node processes/pools against the same persisted budget.
test('real PG: separate processes share one quota and no time or user seam', async t => {
  const f = await fixture(t); await f.enable();
  const source = `const fs=require('node:fs'),vm=require('node:vm');
    const {Pool}=require(${JSON.stringify(require.resolve('pg'))}); const pool=new Pool({ssl:false});
    const moduleObject={exports:{}};
    vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync('backend/src/services/estimateAiPolicy.js','utf8')+'\\n})')(
      name=>{if(name!=='../db')throw Error('Provider forbidden');return {pool}},moduleObject,moduleObject.exports);
    (async()=>{const r=await Promise.all(Array.from({length:12},()=>moduleObject.exports.admitEstimateAi('shop-local')));
    process.stdout.write(JSON.stringify(r));await pool.end()})().catch(()=>process.exit(1));`;
  const env = { PATH: process.env.PATH, PGHOST: process.env.PGHOST, PGPORT: process.env.PGPORT,
    PGDATABASE: process.env.PGDATABASE, PGUSER: process.env.PGUSER, PGOPTIONS: `-c search_path=${f.schema}` };
  const results = await Promise.all(Array.from({ length: 3 }, () => promisify(execFile)(process.execPath, ['-e', source], {
    cwd: path.resolve(__dirname, '../..'), env,
  })));
  const admissions = results.flatMap(result => JSON.parse(result.stdout));
  assert.equal(admissions.filter(r => r.status === 'admitted').length, 15);
  assert.equal(admissions.filter(r => r.status === 'quota').length, 21);
});

test('real PG: missing/invalid policy, missing schema, invalid budget, DB failures close before provider', async t => {
  const f = await fixture(t); f.time(epoch);
  assert.deepEqual(await f.admit('missing'), { status: 'unavailable' });
  await f.enable();
  for (const pattern of [/SELECT id::text/, /clock_timestamp/, /SELECT window_started_at/, /INSERT INTO/, /COMMIT/]) {
    f.fail(sql => pattern.test(sql));
    assert.deepEqual(await f.admit(f.shop), { status: 'unavailable' });
    f.fail(null);
    assert.equal((await f.sql('SELECT * FROM estimate_ai_budgets')).rowCount, 0);
  }
  await f.admit(f.shop); f.time(epoch - 1);
  assert.deepEqual(await f.admit(f.shop), { status: 'unavailable' });
  f.time(epoch);
  await f.sql('ALTER TABLE estimate_ai_budgets DROP CONSTRAINT estimate_ai_budgets_admission_count_check');
  await f.sql('UPDATE estimate_ai_budgets SET admission_count = -1 WHERE shop_id = $1', [f.shop]);
  assert.deepEqual(await f.admit(f.shop), { status: 'unavailable' });
  await f.sql('DROP TABLE estimate_ai_budgets');
  assert.deepEqual(await f.admit(f.shop), { status: 'unavailable' });
  await f.sql('ALTER TABLE shops ALTER COLUMN estimate_ai_enabled DROP NOT NULL');
  await f.sql('UPDATE shops SET estimate_ai_enabled = NULL WHERE id = $1', [f.shop]);
  assert.deepEqual(await f.admit(f.shop), { status: 'unavailable' });
  await f.sql('ALTER TABLE shops ALTER COLUMN estimate_ai_enabled DROP DEFAULT');
  await f.sql('ALTER TABLE shops ALTER COLUMN estimate_ai_enabled TYPE TEXT USING estimate_ai_enabled::text');
  await f.sql("UPDATE shops SET estimate_ai_enabled = 'true' WHERE id = $1", [f.shop]);
  assert.deepEqual(await f.admit(f.shop), { status: 'unavailable' });
  await assert.rejects(f.initialize(), { code: 'ESTIMATE_AI_SCHEMA_REQUIRED' });
  await f.sql('ALTER TABLE shops DROP COLUMN estimate_ai_enabled');
  assert.deepEqual(await f.admit(f.shop), { status: 'unavailable' });
});

test('isolated: invalid identity and unavailable DB never reach provider or runtime DDL', async () => {
  let connections = 0;
  const service = load('services/estimateAiPolicy.js', { '../db': { pool: { connect: async () => {
    connections++; throw Error('DB unavailable');
  } } } });
  for (const id of [undefined, null, '', ' ', {}, 12]) assert.deepEqual(await service.admitEstimateAi(id), { status: 'unavailable' });
  assert.equal(connections, 0);
  assert.deepEqual(await service.admitEstimateAi('shop'), { status: 'unavailable' });
  assert.equal(connections, 1);
});

test('isolated: persisted-policy decisions and transaction failures never authorize a provider', async t => {
  const scenarios = [
    { name: 'false is off', enabled: false, expected: 'off' },
    { name: 'missing shop is unavailable', missing: true },
    { name: 'null is unavailable', enabled: null },
    { name: 'truthy string is unavailable', enabled: 'true' },
    { name: 'first admission commits', expected: 'admitted' },
    { name: 'full budget refuses', count: 15, expected: 'quota' },
    { name: 'bad persisted count refuses', count: '1' },
    { name: 'negative count refuses', count: -1 },
    { name: 'future start refuses', count: 1, start: epoch + 1 },
    { name: 'failed insert refuses', fail: /INSERT/ },
    { name: 'failed update refuses', count: 1, fail: /UPDATE/ },
    { name: 'failed commit refuses', fail: /COMMIT/ },
    { name: 'ambiguous schema write refuses', savedCount: '1' },
    { name: 'bad rollback discards connection', fail: /INSERT|ROLLBACK/, discard: true },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const statements = [], releases = [];
    const client = { release: value => releases.push(value), query: async (sql, args) => {
      statements.push(sql);
      assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/);
      if (scenario.fail?.test(sql)) throw Error('Synthetic failure');
      if (sql.startsWith('SELECT id::text')) return { rows: scenario.missing ? [] : [{ id: 'shop',
        estimate_ai_enabled: Object.hasOwn(scenario, 'enabled') ? scenario.enabled : true }] };
      if (sql === 'SELECT clock_timestamp() AS now') return { rows: [{ now: new Date(epoch) }] };
      if (sql.startsWith('SELECT window_started_at')) return { rows: Object.hasOwn(scenario, 'count')
        ? [{ window_started_at: new Date(scenario.start ?? epoch), admission_count: scenario.count }] : [] };
      if (/^(INSERT|UPDATE)/.test(sql)) return { rowCount: 1, rows: [{ identity_type: 'text',
        window_started_at: args[1], admission_count: scenario.savedCount ?? args[2] }] };
      return { rows: [] };
    } };
    const service = load('services/estimateAiPolicy.js', { '../db': { pool: { connect: async () => client } } });
    assert.deepEqual(await service.admitEstimateAi('shop'), { status: scenario.expected || 'unavailable' });
    assert.deepEqual(releases, [scenario.discard || false]);
    if (scenario.expected === 'admitted') assert.equal(statements.at(-1), 'COMMIT');
    else assert.equal(statements.at(-1), 'ROLLBACK');
    if (Object.hasOwn(scenario, 'enabled') || scenario.missing) {
      assert.ok(statements.every(sql => !/estimate_ai_budgets/.test(sql)), 'No budget touched without persisted true');
    }
  });
});

test('isolated: startup connection failures carry the required-schema error', async () => {
  await assert.rejects(up({ connect: async () => { throw Error('Unavailable'); } }), {
    code: 'ESTIMATE_AI_SCHEMA_REQUIRED', message: 'Estimate AI schema initialization failed; policy and budget rows preserved',
  });
});
