'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { up, INTERNAL_TEST_SHOP_SCHEMA_REQUIRED } = require('../src/db/internalTestShop');
const roles = require('../src/middleware/roles');
const sourceRoot = path.resolve(__dirname, '../src');

// No app DB, dotenv, SDK, network, credential or seed imports are permitted.
function load(file, mocks, env = {}) {
  const filename = path.join(sourceRoot, file), module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports,__dirname,process){${fs.readFileSync(filename, 'utf8')}\n})`, {
    console: { log() {}, warn() {}, error() {} },
  }, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Forbidden dependency: ${name}`);
  }, module, module.exports, path.dirname(filename), { env });
  return module.exports;
}

function routeHarness(file) {
  const routes = [], writes = [], events = [], claims = [];
  const router = { use() {} };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    router[method] = (url, ...handlers) => routes.push({ method, url, handlers });
  }
  const next = (_req, _res, next) => next();
  const multer = () => ({ single: () => next }); multer.diskStorage = () => ({});
  const mocks = {
    express: { Router: () => router }, 'express-rate-limit': () => next,
    bcryptjs: { hashSync: () => 'synthetic-hash-only' },
    jsonwebtoken: { sign: payload => { claims.push(payload); return 'synthetic-token'; } },
    crypto, uuid: { v4: crypto.randomUUID }, path, fs: { mkdirSync() {} }, multer,
    '../middleware/auth': (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }),
    '../middleware/roles': roles,
    '../db/shopTwilioNumber': {}, '../services/paymentReservations': {},
    '../services/mediaStorage': {}, '../data/market-rates': { getRatesForState: () => null },
    '../services/publicShop': { newPublicIntakeSlug: () => 'synthetic-slug' },
    '../services/mailer': { sendMail: () => assert.fail('No email allowed') },
    '../utils/discord': { sendDiscordEmbed: () => events.push('registration-webhook-mock') },
    '../services/sms': { getTwilioConfigForShop: async () => null, isConfiguredForShop: async () => false },
    '../db': {
      dbGet: async sql => /WHERE (LOWER\(email\)|email) =/.test(sql) ? null : { id: 'synthetic-user', name: 'Shop' },
      dbAll: async () => [],
      dbRun: async (sql, params) => { writes.push({ sql, params }); return { rowCount: 1 }; },
    },
  };
  load(file, mocks);
  async function invoke(method, url, body, role = 'owner') {
    const route = routes.find(r => r.method === method && r.url === url);
    assert.ok(route, `${method} ${url}`);
    const req = { body, params: { id: 'synthetic-user' },
      user: role ? { id: 'synthetic-user', role, shop_id: 'synthetic-shop' } : null };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } };
    const pending = []; let index = 0;
    const next = () => {
      const result = route.handlers[index++]?.(req, res, next);
      if (result?.then) pending.push(result);
    };
    next();
    for (let i = 0; i < pending.length; i++) await pending[i];
    return res;
  }
  return { invoke, writes, events, claims };
}

const forged = { is_internal_test_shop: true, is_test: true, is_test_shop: true,
  test_shop: true, testShop: true, isInternalTestShop: true,
  shop: { is_internal_test_shop: true }, exclusions: { billing: true, metrics: true } };

for (const designation of [undefined, false, true, 'true', 'false', 1, null, {}, []]) {
  test(`public registration always inserts FALSE (input ${JSON.stringify(designation)})`, async () => {
    const h = routeHarness('routes/auth.js');
    const body = { name: 'Synthetic Owner', email: 'owner@example.invalid', shop_name: 'Synthetic Shop',
      password: crypto.randomBytes(24).toString('hex'), ...forged, role: 'superadmin',
      is_internal_test_shop: designation };
    const result = await h.invoke('post', '/shop-register', body, null);
    assert.equal(result.statusCode, 201);
    assert.equal(h.writes.length, 2);
    assert.match(h.writes[0].sql, /is_internal_test_shop\) VALUES \(\$1, \$2, \$3, FALSE\)/);
    assert.equal(h.writes[0].params.length, 3);
    assert.equal(h.writes[1].params.at(-1), 'owner');
    assert.equal(result.body.user.role, 'owner');
    assert.equal(h.claims[0].role, 'owner');
    assert.equal(Object.hasOwn(h.claims[0], 'is_internal_test_shop'), false);
    assert.equal(Object.hasOwn(result.body, 'password'), false);
    assert.deepEqual(h.events, ['registration-webhook-mock'], 'ordinary registration behavior retained; no live send');
  });
}

test('ordinary registration with no designation keys remains ordinary', async () => {
  const h = routeHarness('routes/auth.js');
  const response = await h.invoke('post', '/shop-register', { name: 'Owner', shop_name: 'Shop',
    email: 'ordinary@example.invalid', password: crypto.randomBytes(24).toString('hex') }, null);
  assert.equal(response.statusCode, 201);
  assert.match(h.writes[0].sql, /FALSE\)/);
  assert.equal(h.writes[1].params.at(-1), 'owner');
});

const updateRoutes = [
  ['routes/auth.js', 'put', '/onboarding', { shop_name: 'Shop', phone: '5550100', address: 'Synthetic', city: 'City', state: 'NY', zip: '10001' }],
  ['routes/market.js', 'put', '/shop', { name: 'Shop' }],
  ['routes/settings.js', 'patch', '/', { sms_notifications_enabled: false }],
  ['routes/users.js', 'put', '/me', { name: 'Owner' }],
  ['routes/users.js', 'put', '/:id', { name: 'Staff' }],
];
for (const [file, method, url, ordinary] of updateRoutes) {
  test(`${file} ${method} ${url}: designation fields cannot escalate through an ordinary update`, async () => {
    const h = routeHarness(file);
    const result = await h.invoke(method, url, { ...ordinary, ...forged });
    assert.equal(result.statusCode, 200);
    assert.equal(h.writes.length, 1);
    assert.doesNotMatch(h.writes[0].sql, /is_internal_test_shop|is_test|test_shop|exclusions/);
    assert.equal(h.writes[0].params.at(-1), url === '/me' || url === '/:id' ? 'synthetic-user' : 'synthetic-shop');
    assert.deepEqual(h.events, []);
  });
}
for (const [file, method, url] of updateRoutes.slice(1)) {
  test(`${file} ${url}: designation-only update performs no write`, async () => {
    const h = routeHarness(file);
    assert.equal((await h.invoke(method, url, forged)).statusCode, 400);
    assert.deepEqual(h.writes, []);
  });
}
test('retired public customer registration cannot designate or create anything', async () => {
  const h = routeHarness('routes/auth.js');
  assert.equal((await h.invoke('post', '/register', forged, null)).statusCode, 410);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.events, []);
});

function migrationPool({ fail, rollbackFails = false, connectFails = false } = {}) {
  const queries = [], releases = [];
  return { queries, releases, async connect() {
    if (connectFails) throw Error('synthetic-private-database-detail');
    return { async query(sql) {
      queries.push(sql);
      if (fail?.(sql) || (rollbackFails && sql === 'ROLLBACK')) throw Error('synthetic-private-database-detail');
      return { rows: [] };
    }, release: discard => releases.push(discard) };
  } };
}
test('startup migration is transactional, additive and idempotent without data backfill', async () => {
  const pool = migrationPool(); await up(pool); await up(pool);
  assert.equal(pool.queries.filter(q => q === 'COMMIT').length, 2);
  assert.equal(pool.queries.filter(q => q === 'BEGIN ISOLATION LEVEL READ COMMITTED').length, 2);
  assert.match(pool.queries.join('\n'), /pg_advisory_xact_lock/);
  assert.doesNotMatch(pool.queries.join('\n'), /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/);
  assert.deepEqual(pool.releases, [false, false]);
});
for (const stage of ['BEGIN', 'pg_advisory', 'ALTER TABLE', 'COMMIT']) {
  test(`migration failure at ${stage} aborts and returns only a safe error`, async () => {
    const pool = migrationPool({ fail: sql => sql.includes(stage) });
    await assert.rejects(up(pool), error => error.code === INTERNAL_TEST_SHOP_SCHEMA_REQUIRED
      && !error.message.includes('synthetic-private'));
    assert.equal(pool.queries.at(-1), 'ROLLBACK');
    assert.deepEqual(pool.releases, [false]);
  });
}
test('connection and rollback failures cannot report migration success', async () => {
  await assert.rejects(up(migrationPool({ connectFails: true })), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
  const pool = migrationPool({ fail: sql => sql.includes('ALTER TABLE'), rollbackFails: true });
  await assert.rejects(up(pool), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
  assert.deepEqual(pool.releases, [true]);
});

test('both fresh schema paths default FALSE without the historical hold', () => {
  for (const file of ['db/index.js', 'db/schema.pg.sql']) {
    assert.match(fs.readFileSync(path.join(sourceRoot, file), 'utf8'),
      /is_internal_test_shop BOOLEAN NOT NULL DEFAULT FALSE,/);
  }
  assert.match(fs.readFileSync(path.join(sourceRoot, 'db/index.js'), 'utf8'), /await require\('\.\/internalTestShop'\)\.up\(pool\)/);
});

test('migration runner propagates designation initialization failures', async () => {
  const failure = Object.assign(new Error('Synthetic schema failure'), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
  const calls = [];
  const runner = load('db/migrate.js', {
    fs: { readFileSync: () => '' }, path, './shopTwilioNumber': { ensureShopTwilioNumber: async () => {} },
    './postgres': { pool: {}, query: async () => ({ rows: [{ exists: true }] }) },
    './internalTestShop': { up: async () => { calls.push('up'); throw failure; } },
  }, { DATABASE_URL: 'synthetic-not-a-connection' });
  await assert.rejects(runner.runMigrations(), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
  assert.deepEqual(calls, ['up']);
});

test('app cannot listen or start jobs after a required designation migration failure', async () => {
  const events = [], noop = () => {};
  const app = { set: noop, use: noop, get: noop, listen: () => events.push('listen') };
  const filename = path.join(sourceRoot, 'app.js');
  let finish; const finished = new Promise(resolve => { finish = resolve; });
  const mocks = {
    dotenv: { config: noop }, express: Object.assign(() => app, { raw: noop, json: noop, static: noop }),
    cors: noop, path, helmet: noop, 'express-rate-limit': noop,
    './lib/sentry': { init: noop, requestHandler: noop, errorHandler: noop },
    './services/mediaStorage': {}, './services/panelEstimatorApproval': {},
    './services/smsProvisioningEvents': { router: noop },
    './db': { initDb: async () => events.push('init') },
    './db/migrate': { runMigrations: async () => {
      events.push('migration');
      throw Object.assign(new Error('Synthetic schema failure'), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
    } },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    __dirname: sourceRoot, console: { log: noop, error: noop },
    process: { env: { JWT_SECRET: 'synthetic-only', DATABASE_URL: 'synthetic-only' },
      exit: code => { events.push(code); finish(); } },
    require: name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('./routes/') || name.startsWith('./jobs/')) return {};
      throw Error(`Forbidden dependency: ${name}`);
    },
  }, { filename, timeout: 1000 });
  await finished;
  assert.deepEqual(events, ['init', 'migration', 1]);
});

// Optional real PostgreSQL gate: dedicated task-only UNIX socket, no TCP or app DB.
// Tests execute the exact SQL emitted by up(), in one psql session/transaction.
const socket = process.env.REVV_INTERNAL_TEST_PG_SOCKET;
function psql(sql, expectedStatus = 0) {
  assert.match(socket || '', /^\/private\/tmp\/revv-t6002-[A-Za-z0-9_-]+\/socket$/);
  const result = spawnSync('/opt/homebrew/bin/psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: sql, encoding: 'utf8', timeout: 10000,
    env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', PGHOST: socket,
      PGDATABASE: 'revv_internal_test_shop_test', PGUSER: 'revv_test', PGPORT: '55462' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, expectedStatus, result.stderr);
  return result.stdout.trim();
}

for (const [label, definition, value] of [
  ['wrong true default', 'BOOLEAN NOT NULL DEFAULT TRUE', 'TRUE'],
  ['existing null', 'BOOLEAN', 'NULL'],
  ['wrong type', 'TEXT', "'false'"],
  ['weakened constraint', 'BOOLEAN CONSTRAINT shops_internal_test_shop_hold CHECK (TRUE)', 'FALSE'],
]) {
  test(`real PostgreSQL refuses ${label} without rewriting existing policy`, { skip: !socket }, async () => {
    const pool = migrationPool(); await up(pool);
    const schema = `test_shop_${crypto.randomUUID().replaceAll('-', '')}`;
    try {
      psql(`CREATE SCHEMA ${schema}; SET search_path=${schema};
        CREATE TABLE shops (id TEXT PRIMARY KEY, is_internal_test_shop ${definition});
        INSERT INTO shops VALUES ('synthetic',${value});`);
      const snapshot = `SET search_path=${schema};
        SELECT row_to_json(s)::text || ':' || xmin::text FROM shops s;
        SELECT attnotnull::text || ':' || atttypid::regtype::text FROM pg_attribute
          WHERE attrelid='shops'::regclass AND attname='is_internal_test_shop';`;
      const before = psql(snapshot);
      psql(`SET search_path=${schema}; ${pool.queries.join(';\n')};`, 3);
      assert.equal(psql(snapshot), before, 'failed transaction preserves rows, types and nullability');
    } finally { psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`); }
  });
}

for (const file of ['db/index.js', 'db/schema.pg.sql']) {
  test(`real PostgreSQL fresh shops declaration in ${file} defaults false before migrations`, { skip: !socket }, () => {
    const sql = fs.readFileSync(path.join(sourceRoot, file), 'utf8')
      .match(/CREATE TABLE IF NOT EXISTS shops \([\s\S]*?\n\s*\);/)[0];
    const schema = `test_shop_${crypto.randomUUID().replaceAll('-', '')}`;
    const id = crypto.randomUUID();
    try {
      psql(`CREATE SCHEMA ${schema}; SET search_path=${schema};
        CREATE FUNCTION public_intake_new_slug() RETURNS TEXT LANGUAGE sql AS $$ SELECT 'synthetic-slug'::text $$;
        ${sql}
        INSERT INTO shops(id,name) VALUES ('${id}','synthetic');`);
      assert.equal(psql(`SET search_path=${schema}; SELECT is_internal_test_shop FROM shops;`), 'f');
      psql(`SET search_path=${schema}; UPDATE shops SET is_internal_test_shop=TRUE WHERE id='${id}';`);
      assert.equal(psql(`SET search_path=${schema}; SELECT is_internal_test_shop FROM shops;`), 't');
    } finally { psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`); }
  });
}
for (const type of ['TEXT', 'UUID']) {
  test(`real PostgreSQL ${type}: defaults, repeat migration, row preservation, NULL rejection`, { skip: !socket }, async () => {
    const pool = migrationPool(); await up(pool);
    const schema = `test_shop_${crypto.randomUUID().replaceAll('-', '')}`;
    const id = type === 'TEXT' ? 'synthetic-existing' : crypto.randomUUID();
    const fresh = type === 'TEXT' ? 'synthetic-new' : crypto.randomUUID();
    try {
      psql(`CREATE SCHEMA ${schema}; SET search_path = ${schema};
        CREATE TABLE shops (id ${type} PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO shops VALUES ('${id}', 'preserve-me');`);
      const before = psql(`SET search_path=${schema}; SELECT xmin::text || ':' || name FROM shops;`);
      for (let i = 0; i < 2; i++) psql(`SET search_path=${schema}; ${pool.queries.join(';\n')};`);
      assert.equal(psql(`SET search_path=${schema}; SELECT xmin::text || ':' || name FROM shops;`), before);
      assert.equal(psql(`SET search_path=${schema}; INSERT INTO shops(id,name) VALUES ('${fresh}','new') RETURNING is_internal_test_shop;`), 'f');
      assert.equal(psql(`SET search_path=${schema}; SELECT bool_and(is_internal_test_shop IS FALSE) FROM shops;`), 't');
      psql(`SET search_path=${schema}; DO $gate$ BEGIN
        BEGIN
          UPDATE shops SET is_internal_test_shop=NULL WHERE id='${id}';
          RAISE EXCEPTION 'null accepted';
        EXCEPTION WHEN not_null_violation THEN NULL; END;
      END $gate$;`);
      assert.equal(psql(`SET search_path=${schema}; SELECT count(*) FROM shops;`), '2');
    } finally { psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`); }
  });
}
