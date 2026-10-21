'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { up, down, INTERNAL_TEST_SHOP_SCHEMA_REQUIRED } = require('../src/db/internalTestShop');
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

function migrationPool({ fail, rollbackFails = false, connectFails = false, present = false, hold = false } = {}) {
  const queries = [], releases = [];
  return { queries, releases, async connect() {
    if (connectFails) throw Error('synthetic-private-database-detail');
    return { async query(sql) {
      queries.push(sql);
      if (fail?.(sql) || (rollbackFails && sql === 'ROLLBACK')) throw Error('synthetic-private-database-detail');
      if (sql.startsWith('SELECT\n    EXISTS')) return { rows: [{ present, hold }] };
      if (sql.startsWith('ALTER TABLE shops ADD COLUMN')) present = true;
      if (sql.startsWith('ALTER TABLE shops DROP CONSTRAINT')) hold = false;
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

// Dedicated disposable UNIX socket only; never read DATABASE_URL or .env.
const socket = process.env.REVV_INTERNAL_TEST_PG_SOCKET;
function pgPool(schema = 'public', queries = []) {
  assert.match(socket || '', /^\/private\/tmp\/revv-t6002-[A-Za-z0-9_-]+\/socket$/);
  assert.match(schema, /^[a-z0-9_]+$/);
  const { Pool } = require('pg');
  const pool = new Pool({ host: socket, port: 55462, database: 'revv_internal_test_shop_test',
    user: 'revv_test', password: '', ssl: false, options: `-c search_path=${schema}`, max: 4 });
  const connect = pool.connect.bind(pool);
  pool.connect = async function (...args) {
    // pg's internal pool.query uses the callback form.
    if (args.length) return connect(...args);
    const client = await connect();
    const query = client.query.bind(client), release = client.release.bind(client);
    client.query = (sql, ...rest) => { queries.push(sql); return query(sql, ...rest); };
    client.release = (...rest) => { client.query = query; return release(...rest); };
    return client;
  };
  return pool;
}
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
async function disposable(fn) {
  const schema = `test_shop_${crypto.randomUUID().replaceAll('-', '')}`;
  psql(`CREATE SCHEMA ${schema}`);
  const queries = [], pool = pgPool(schema, queries);
  try { await fn(pool, schema, queries); }
  finally { await pool.end(); psql(`DROP SCHEMA ${schema} CASCADE`); }
}

for (const [label, definition, value] of [
  ['wrong true default', 'BOOLEAN NOT NULL DEFAULT TRUE', 'TRUE'],
  ['existing null', 'BOOLEAN', 'NULL'],
  ['wrong type', 'TEXT', "'false'"],
  ['weakened constraint', 'BOOLEAN NOT NULL DEFAULT FALSE CONSTRAINT shops_internal_test_shop_hold CHECK (TRUE)', 'FALSE'],
  ['unknown constraint', 'BOOLEAN NOT NULL DEFAULT FALSE CHECK (is_internal_test_shop IS FALSE)', 'FALSE'],
]) test(`real PostgreSQL refuses ${label} without rewriting existing policy`, { skip: !socket }, async () => {
  await disposable(async pool => {
    await pool.query(`CREATE TABLE shops (id TEXT PRIMARY KEY, is_internal_test_shop ${definition});
      INSERT INTO shops VALUES ('synthetic',${value});`);
    const snapshot = async () => (await pool.query(`SELECT row_to_json(s)::text || ':' || xmin::text AS state FROM shops s`)).rows;
    const before = await snapshot();
    await assert.rejects(up(pool), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
    await assert.rejects(down(pool), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
    assert.deepEqual(await snapshot(), before);
  });
});

for (const file of ['db/index.js', 'db/schema.pg.sql']) {
  test(`real PostgreSQL fresh shops declaration in ${file} defaults false before migrations`, { skip: !socket }, async () => {
    await disposable(async pool => {
      const sql = fs.readFileSync(path.join(sourceRoot, file), 'utf8')
        .match(/CREATE TABLE IF NOT EXISTS shops \([\s\S]*?\n\s*\);/)[0];
      await pool.query(`CREATE FUNCTION public_intake_new_slug() RETURNS TEXT LANGUAGE sql AS $$ SELECT 'synthetic-slug'::text $$;
        ${sql}`);
      const result = await pool.query("INSERT INTO shops(id,name) VALUES ($1,'synthetic') RETURNING is_internal_test_shop", [crypto.randomUUID()]);
      assert.equal(result.rows[0].is_internal_test_shop, false);
    });
  });
}
for (const type of ['TEXT', 'UUID']) {
  test(`real PostgreSQL ${type}: transition, used fixture, catalog-only repeat boot and safe rollback`, { skip: !socket }, async () => {
    await disposable(async (pool, schema, queries) => {
      const id = crypto.randomUUID(), ordinary = crypto.randomUUID();
      await pool.query(`CREATE TABLE shops (id ${type} PRIMARY KEY, name TEXT, onboarded BOOLEAN DEFAULT FALSE);
        CREATE TABLE customers (id TEXT PRIMARY KEY, shop_id ${type} REFERENCES shops);
        CREATE TABLE repair_orders (id TEXT PRIMARY KEY, shop_id ${type} REFERENCES shops, customer_id TEXT REFERENCES customers);`);
      await pool.query("INSERT INTO shops(id,name) VALUES ($1,'fixture'),($2,'ordinary')", [id, ordinary]);
      await up(pool);
      await pool.query('UPDATE shops SET is_internal_test_shop=TRUE,onboarded=TRUE WHERE id=$1', [id]);
      await pool.query("INSERT INTO customers VALUES ('synthetic-customer',$1);", [id]);
      await pool.query("INSERT INTO repair_orders VALUES ('synthetic-ro',$1,'synthetic-customer')", [id]);
      const snapshot = async () => (await pool.query(`SELECT row_to_json(s) AS row, xmin::text FROM shops s ORDER BY name`)).rows;
      const before = await snapshot();
      // A concurrent reader must not block an already-correct boot.
      const reader = await pool.connect();
      try {
        await reader.query('BEGIN'); await reader.query('SELECT * FROM shops');
        queries.length = 0;
        await pool.query("SET statement_timeout='1500ms'");
        for (let i = 0; i < 3; i++) await up(pool);
        assert.equal(queries.some(sql => /ALTER TABLE|LOCK TABLE|pg_advisory/.test(sql)), false);
        assert.equal(queries.some(sql => /FROM shops|FROM users/.test(sql)), false);
      } finally { await reader.query('ROLLBACK'); reader.release(); }
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(down(pool), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
      assert.deepEqual(await snapshot(), before);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM repair_orders')).rows[0].n, 1);
      await assert.rejects(pool.query('UPDATE shops SET is_internal_test_shop=NULL WHERE id=$1', [ordinary]), { code: '23502' });
      // Disposable fixture ONLY: clearing its flag models a separately approved
      // rollback data plan. Production down never does this for the operator.
      await pool.query('UPDATE shops SET is_internal_test_shop=FALSE WHERE id=$1', [id]);
      const safeBefore = await snapshot();
      await down(pool); await down(pool); await up(pool);
      assert.deepEqual(await snapshot(), safeBefore);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM repair_orders')).rows[0].n, 1);
    });
  });
}

test('real PostgreSQL exact historical hold transition and dependency-safe rollback', { skip: !socket }, async () => {
  await disposable(async pool => {
    await pool.query(`CREATE TABLE shops(id TEXT PRIMARY KEY, is_internal_test_shop BOOLEAN NOT NULL DEFAULT FALSE
      CONSTRAINT shops_internal_test_shop_hold CHECK(is_internal_test_shop IS FALSE));
      INSERT INTO shops(id) VALUES ('ordinary');`);
    await up(pool);
    await pool.query('CREATE VIEW synthetic_policy_evidence AS SELECT is_internal_test_shop FROM shops');
    await assert.rejects(down(pool), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
    assert.equal((await pool.query('SELECT * FROM synthetic_policy_evidence')).rows[0].is_internal_test_shop, false);
  });
});

// Run the actual initDb and migration runner SQL, with ONLY transports/jobs and
// configuration replaced. The failing internalTestShop path is never mocked.
test('real PostgreSQL used flagged shop survives actual initDb, migrate and app boot', { skip: !socket }, async () => {
  await disposable(async pool => {
    const real = file => require(path.join(sourceRoot, file));
    const common = {
      './internalTestShop': real('db/internalTestShop'), './customerConsent': real('db/customerConsent'),
      './paymentReservations': real('db/paymentReservations'), './estimateAiPolicy': real('db/estimateAiPolicy'),
      './shopTwilioNumber': real('db/shopTwilioNumber'), './panelEstimator': real('db/panelEstimator'),
    };
    const db = load('db/index.js', { ...common, dotenv: { config() {} }, pg: { Pool: function () { return pool; } },
      '../services/publicShop': { newPublicIntakeSlug: () => crypto.randomBytes(13).toString('hex') },
      '../services/stockCapture': real('services/stockCapture'), '../services/partsDelivery': real('services/partsDelivery'),
    });
    const runner = load('db/migrate.js', { ...common, fs, path, './index': db,
      './postgres': { pool, query: pool.query.bind(pool) },
    }, { DATABASE_URL: 'synthetic-isolated-adapter' });
    await db.initDb(); await runner.runMigrations();
    const fixture = crypto.randomUUID(), ordinary = crypto.randomUUID(), customer = crypto.randomUUID(), ro = crypto.randomUUID();
    await pool.query("INSERT INTO shops(id,name,is_internal_test_shop,onboarded) VALUES ($1,'used synthetic',TRUE,TRUE),($2,'ordinary',FALSE,TRUE)", [fixture, ordinary]);
    await pool.query("INSERT INTO customers(id,shop_id,name) VALUES ($1,$2,'synthetic customer')", [customer, fixture]);
    await pool.query("INSERT INTO repair_orders(id,shop_id,customer_id,ro_number) VALUES ($1,$2,$3,'SYN-USED')", [ro, fixture, customer]);
    const snapshot = async () => (await pool.query(`SELECT s.id,s.is_internal_test_shop,s.onboarded,c.id AS customer_id,r.id AS ro_id
      FROM shops s LEFT JOIN customers c ON c.shop_id=s.id LEFT JOIN repair_orders r ON r.customer_id=c.id ORDER BY s.id`)).rows;
    const before = await snapshot();
    await db.initDb(); await runner.runMigrations();
    assert.deepEqual(await snapshot(), before);
    const events = [], noop = () => {};
    let finish, fail;
    const boot = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const app = { set: noop, use: noop, get: noop, listen: () => { events.push('listen'); finish(); } };
    const deps = {
      dotenv: { config: noop }, express: Object.assign(() => app, { raw: noop, json: noop, static: noop }),
      cors: noop, path, helmet: noop, 'express-rate-limit': noop,
      './lib/sentry': { init: noop, requestHandler: noop, errorHandler: noop },
      './services/mediaStorage': {}, './services/panelEstimatorApproval': {},
      './services/smsProvisioningEvents': { router: noop }, './db': db, './db/migrate': runner,
    };
    vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, 'app.js'), 'utf8'), {
      __dirname: sourceRoot, console: { log: noop, error: noop },
      process: { env: { JWT_SECRET: 'synthetic-only', DATABASE_URL: 'synthetic-isolated-adapter' }, exit: code => fail(Error(`boot exit ${code}`)) },
      require: name => {
        if (Object.hasOwn(deps, name)) return deps[name];
        if (name.startsWith('./routes/') || name.startsWith('./jobs/')) return {};
        throw Error(`Forbidden startup dependency: ${name}`);
      },
    });
    await boot;
    assert.deepEqual(events, ['listen']);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await db.dbAll('SELECT id::text FROM shops WHERE is_internal_test_shop IS FALSE')).map(r => r.id), [ordinary]);
    assert.equal((await pool.query("INSERT INTO shops(id,name) VALUES ($1,'new ordinary') RETURNING is_internal_test_shop", [crypto.randomUUID()])).rows[0].is_internal_test_shop, false);
    const { resolveShopPolicy } = real('services/shopPolicy');
    assert.equal((await resolveShopPolicy(ordinary, db.dbAll)).allowExternalEffects, true);
    assert.equal((await resolveShopPolicy(fixture, db.dbAll)).reason, 'INTERNAL_TEST_SHOP');
    await pool.query('ALTER TABLE shops ALTER COLUMN is_internal_test_shop SET DEFAULT TRUE');
    await assert.rejects(db.initDb(), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
    await assert.rejects(runner.runMigrations(), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });
  });
});

test('real PostgreSQL concurrent installers issue one transition and down refuses a racing TRUE write', { skip: !socket, timeout: 15000 }, async () => {
  await disposable(async (pool, schema, queries) => {
    await pool.query("CREATE TABLE shops(id TEXT PRIMARY KEY); INSERT INTO shops VALUES ('synthetic')");
    await Promise.all(Array.from({length: 4}, () => up(pool)));
    assert.equal(queries.filter(sql => sql.startsWith('ALTER TABLE shops ADD COLUMN')).length, 1);
    const writer = await pool.connect();
    let outcome;
    try {
      await writer.query('BEGIN');
      await writer.query("UPDATE shops SET is_internal_test_shop=TRUE WHERE id='synthetic'");
      outcome = down(pool).then(() => null, error => error);
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE relation='shops'::regclass AND mode='AccessExclusiveLock' AND NOT granted) AS blocked`);
        if (result.rows[0].blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true, 'down waits for concurrent policy writer');
      await writer.query('COMMIT');
      assert.equal((await outcome)?.code, INTERNAL_TEST_SHOP_SCHEMA_REQUIRED);
      assert.equal((await pool.query('SELECT is_internal_test_shop FROM shops')).rows[0].is_internal_test_shop, true);
    } finally {
      await writer.query('ROLLBACK'); writer.release();
      if (outcome) await outcome;
    }
  });
});
