'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = require('../src/services/internalTestShopProvisioning');
const { main } = require('../scripts/provision-internal-test-shop');
const { up, validateSchema } = require('../src/db/internalTestShop');
const email = 'fixture@example.invalid';
const ids = core.identity(email);
const syntheticPassword = 'synthetic-only-input';
const env = value => ({ REVV_INTERNAL_TEST_SHOP_EMAIL: email, REVV_INTERNAL_TEST_SHOP_PASSWORD: syntheticPassword, ...value });
const safeShop = () => ({ id: ids.shop_id, name: 'REVV Internal Test Shop', is_internal_test_shop: true,
  onboarded: false, plan: 'free', plan_expires_at: null, trial_ends_at: null, sms_comp: false,
  sms_notifications_enabled: false, email_notifications_enabled: false, public_intake_slug: 'a'.repeat(26),
  labor_rate: 62, quickbooks_environment: 'production', twilio_account_sid: null, estimate_ai_enabled: false });
const safeUser = () => ({ id: ids.user_id, shop_id: ids.shop_id, email, name: 'Internal Test Owner',
  role: 'owner', password_valid: true, customer_id: null });

// This adapter is a transaction/lock model, not PostgreSQL. It interprets only
// the emitted statements and fails on any unexpected SQL. No config/pg imports.
function harness({ shops = [], users = [], related = [], schema = {}, failAt, rollbackFails = false, releaseFails = false, shopInsertOverrides = {}, userInsertOverrides = {} } = {}) {
  const state = { shops: structuredClone(shops), users: structuredClone(users), related,
    schema: { type: 'boolean', notNull: true, default: 'false', hold: null, idType: 'text', ...schema },
    queries: [], writes: 0, hashes: 0, connections: 0, releases: [], maxLocked: 0, locked: 0 };
  let tail = Promise.resolve();
  const pool = { end: async () => {}, async connect() {
    state.connections++;
    let unlock, snapshot, ownsLock = false;
    return { release(discard) { state.releases.push(discard); if (releaseFails) throw Error('private release detail'); }, async query(sql, params = []) {
      state.queries.push({ sql, params: params.map((p, i) => /INSERT INTO users/.test(sql) && i === 3 ? '[redacted]' : p) });
      if (failAt?.(sql)) throw Error('private DB/provider/password detail');
      if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED' || sql === 'SET LOCAL row_security = off') return { rows: [] };
      if (/pg_advisory_xact_lock/.test(sql)) {
        const prior = tail; tail = new Promise(resolve => { unlock = resolve; });
        await prior; ownsLock = true; state.locked++; state.maxLocked = Math.max(state.maxLocked, state.locked);
        snapshot = structuredClone({ shops: state.shops, users: state.users, schema: state.schema });
        return { rows: [] };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        if (sql === 'ROLLBACK' && snapshot) Object.assign(state, snapshot);
        if (ownsLock) { ownsLock = false; state.locked--; unlock(); }
        if (sql === 'ROLLBACK' && rollbackFails) throw Error('private rollback detail');
        return { rows: [] };
      }
      if (sql.startsWith('SELECT\n    EXISTS')) return { rows: [{
        present: state.schema.type !== 'absent', hold: state.schema.hold !== null,
      }] };
      if (/^LOCK TABLE/.test(sql)) return { rows: [] };
      if (/^ALTER TABLE shops ADD COLUMN/.test(sql)) {
        if (state.schema.type === 'absent') Object.assign(state.schema, { type: 'boolean', notNull: true, default: 'false' });
        return { rows: [] };
      }
      if (/DO \$test_shop\$/.test(sql)) {
        const s = state.schema;
        if (state.shops.some(shop => shop.is_internal_test_shop === null) || s.type !== 'boolean' || s.notNull !== true || s.default !== 'false' || s.unknownConstraint
          || (s.hold !== null && (s.hold !== 'exact' || !sql.includes('NOT (TRUE AND')))) throw Error('private schema detail');
        return { rows: [] };
      }
      if (/DO \$identity\$/.test(sql)) {
        if (state.schema.insertTrigger || state.schema.rls || state.schema.rule || !['text', 'uuid', 'varchar(36)'].includes(state.schema.idType)) throw Error('private type');
        return { rows: [] };
      }
      if (/^ALTER TABLE shops DROP CONSTRAINT/.test(sql)) { state.schema.hold = null; return { rows: [] }; }
      if (/^SELECT id::text FROM shops/.test(sql)) return { rows: state.shops.filter(s => s.is_internal_test_shop === true).map(s => ({ id: s.id })) };
      if (/^SELECT email FROM users/.test(sql)) return { rows: state.users.filter(u => u.shop_id === params[0]).map(u => ({ email: u.email })) };
      if (/SELECT to_jsonb\(s\)/.test(sql)) return { rows: state.shops.filter(s => s.id === params[0]).map(data => ({ data: structuredClone(data) })) };
      if (/SELECT \(to_jsonb\(u\)/.test(sql)) return { rows: state.users.filter(u => u.email?.trim().toLowerCase() === params[0] || u.shop_id === params[1] || u.id === params[2]).map(data => ({ data: structuredClone(data) })) };
      if (/SELECT DISTINCT n.nspname/.test(sql)) return { rows: state.related.map((r, i) => ({ nspname: 'synthetic', relname: 'related' + i, attname: r.kind === 'user' ? 'user_id' : 'shop_id', kind: r.kind || 'shop' })) };
      if (/SELECT 1 FROM "synthetic"/.test(sql)) return { rows: state.related[Number(sql.match(/related(\d+)/)[1])].present ? [{ exists: 1 }] : [] };
      if (/^INSERT INTO shops/.test(sql)) {
        state.writes++; state.shops.push({ ...safeShop(), id: params[0], name: params[1], ...shopInsertOverrides }); return { rows: [] };
      }
      if (/^INSERT INTO users/.test(sql)) {
        state.writes++; state.users.push({ ...safeUser(), id: params[0], shop_id: params[1], email: params[2], ...userInsertOverrides }); return { rows: [] };
      }
      assert.fail('Unexpected synthetic SQL: ' + sql);
    } };
  } };
  const adapters = { pool, validateSchema, hashPassword: async (password, cost) => {
    state.hashes++; assert.equal(password, syntheticPassword); assert.equal(cost, 10); return 'synthetic-hash-never-output';
  } };
  return { state, adapters, run: (input = env(), argv = []) => core.provision({ env: input, argv, ...adapters }) };
}

test('importing CLI/core has no environment, config, DB, file or network access', () => {
  const file = path.resolve(__dirname, '../scripts/provision-internal-test-shop.js');
  const module = { exports: {} }, imports = [];
  const requireOnly = name => { imports.push(name); assert.equal(name, '../src/services/internalTestShopProvisioning'); return core; };
  const process = new Proxy({}, { get() { assert.fail('Process access during import'); } });
  vm.runInNewContext(fs.readFileSync(file, 'utf8').replace(/^#!.*\n/, ''), { module, exports: module.exports, require: requireOnly, process });
  assert.deepEqual(imports, ['../src/services/internalTestShopProvisioning']);
  assert.equal(typeof module.exports.main, 'function');
});
for (const type of ['text', 'uuid', 'varchar(36)']) test(`${type}: one owner/free tenant; persisted stable receipt; rerun never hashes or writes`, async () => {
  const h = harness({ schema: { idType: type } });
  const input = env({ REVV_INTERNAL_TEST_SHOP_EMAIL: '  FIXTURE@EXAMPLE.INVALID  ' });
  const first = await h.run(input);
  assert.equal(Object.hasOwn(input, 'REVV_INTERNAL_TEST_SHOP_PASSWORD'), false);
  assert.deepEqual(first, { version: core.VERSION, ...ids, role: 'owner', is_internal_test_shop: true,
    verified_exclusions: core.EXCLUSIONS, public_flow_limitation: core.PUBLIC_FLOW_LIMITATION });
  const before = structuredClone({ shops: h.state.shops, users: h.state.users });
  const second = await h.run(env({ REVV_INTERNAL_TEST_SHOP_PASSWORD: 'different-synthetic-input' }));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(h.state.writes, 2); assert.equal(h.state.hashes, 1);
  assert.deepEqual({ shops: h.state.shops, users: h.state.users }, before);
  const sql = h.state.queries.map(q => q.sql).join('\n');
  assert.match(sql, /TRUE, FALSE, 'free', NULL, NULL, FALSE, FALSE, FALSE/);
  assert.doesNotMatch(sql, /(?:^|\n)(?:UPDATE|DELETE) /);
});

test('concurrent normalized-email attempts serialize and converge without password reset', async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 12 }, (_, n) => h.run(env({
    REVV_INTERNAL_TEST_SHOP_EMAIL: n % 2 ? email.toUpperCase() : ` ${email} `,
  }))));
  assert.equal(new Set(results.map(JSON.stringify)).size, 1);
  assert.equal(h.state.maxLocked, 1); assert.equal(h.state.shops.length, 1); assert.equal(h.state.users.length, 1);
  assert.equal(h.state.hashes, 1); assert.equal(h.state.writes, 2);
  const locks = h.state.queries.filter(q => /hashtextextended/.test(q.sql));
  assert.equal(locks.length, 12); assert.ok(locks.every(q => q.params[0] === email));
  const sql = h.state.queries.map(q => q.sql);
  assert.ok(sql.indexOf('LOCK TABLE shops, users IN SHARE ROW EXCLUSIVE MODE') < sql.findIndex(q => /SELECT to_jsonb/.test(q)));
});
for (const value of [undefined, '', 'a', 'a@b', '.a@x.invalid', 'a..b@x.invalid', 'a.@x.invalid', 'a b@x.invalid', 'a@-x.invalid', 'a@x-.invalid', 'a@x..invalid', 'a\n@x.invalid', '\na@x.invalid', 'é@x.invalid', 'a'.repeat(65) + '@x.invalid', 42, {}]) {
  test(`invalid email refuses before DB (${JSON.stringify(value)})`, async () => {
    const h = harness(), input = env({ REVV_INTERNAL_TEST_SHOP_EMAIL: value });
    await assert.rejects(h.run(input), { code: 'INVALID_EMAIL', message: 'INVALID_EMAIL' });
    assert.equal(h.state.connections, 0); assert.equal(Object.hasOwn(input, 'REVV_INTERNAL_TEST_SHOP_PASSWORD'), false);
  });
}
for (const value of [undefined, '', 'short', 'a'.repeat(73), 'é'.repeat(37), 'abc\0def', 123456, {}]) {
  test(`invalid password case ${typeof value}/${typeof value === 'string' ? value.length : 'missing'} refuses before DB`, async () => {
    const h = harness(), input = env({ REVV_INTERNAL_TEST_SHOP_PASSWORD: value });
    await assert.rejects(h.run(input), { code: 'INVALID_PASSWORD', message: 'INVALID_PASSWORD' });
    assert.equal(h.state.connections, 0); assert.equal(Object.hasOwn(input, 'REVV_INTERNAL_TEST_SHOP_PASSWORD'), false);
  });
}
for (const argv of [['--password', 'synthetic-argv'], ['--email', email], ['--role=owner'], ['--force'], ['-'], ['--password-file=/synthetic'], ['--help']]) {
  test(`CLI rejects argv ${argv[0]} without reading alternate input or config`, async () => {
    const h = harness(); let output = '';
    assert.equal(await main({ env: env(), argv, adapters: h.adapters, write: s => { output += s; } }), 1);
    assert.equal(output, '{"error":"INVALID_ARGUMENTS"}\n'); assert.equal(h.state.connections, 0);
  });
}
const collisions = [
  ['ordinary account', { shops: [{ ...safeShop(), is_internal_test_shop: false }], users: [safeUser()] }],
  ['ordinary different tenant', { users: [{ ...safeUser(), id: 'ordinary-user', shop_id: 'ordinary-shop' }] }],
  ['cross tenant', { shops: [safeShop()], users: [{ ...safeUser(), shop_id: 'another-tenant' }] }],
  ['partial shop', { shops: [safeShop()] }], ['partial owner', { users: [safeUser()] }],
  ['duplicate email', { shops: [safeShop()], users: [safeUser(), { ...safeUser(), id: 'other', email: email.toUpperCase() }] }],
  ['extra tenant user', { shops: [safeShop()], users: [safeUser(), { ...safeUser(), id: 'other', email: 'other@example.invalid' }] }],
  ['duplicate shops', { shops: [safeShop(), safeShop()], users: [safeUser()] }],
  ...['admin', 'superadmin', 'staff', 'customer', 'assistant'].map(role => [`wrong role ${role}`, { shops: [safeShop()], users: [{ ...safeUser(), role }] }]),
  ...['pro', 'agency', 'trial', null].map(plan => [`plan ${plan}`, { shops: [{ ...safeShop(), plan }], users: [safeUser()] }]),
  ...['stripe_customer_id', 'stripe_subscription_id', 'twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number',
    'quickbooks_access_token', 'tracking_api_key', 'trial_ends_at', 'plan_expires_at', 'unknown_provider_identity'].map(key =>
    [key, { shops: [{ ...safeShop(), [key]: 'synthetic-private-identity' }], users: [safeUser()] }]),
  ...['sms_comp', 'sms_notifications_enabled', 'email_notifications_enabled', 'estimate_ai_enabled'].map(key =>
    [key, { shops: [{ ...safeShop(), [key]: true }], users: [safeUser()] }]),
  ['customer identity', { shops: [safeShop()], users: [{ ...safeUser(), customer_id: 'synthetic-customer' }] }],
  ['wrong owner ID', { shops: [safeShop()], users: [{ ...safeUser(), id: 'other' }] }],
  ['missing hash', { shops: [safeShop()], users: [{ ...safeUser(), password_valid: false }] }],
  ['provider row', { shops: [safeShop()], users: [safeUser()], related: [{ present: true }] }],
  ['orphan child before create', { related: [{ present: true }] }],
  ['user scoped identity', { shops: [safeShop()], users: [safeUser()], related: [{ kind: 'user', present: true }] }],
];
for (const [label, initial] of collisions) test(`collision ${label} rolls back without hashing, conversion or mutation`, async () => {
  const h = harness(initial), before = structuredClone({ shops: h.state.shops, users: h.state.users });
  await assert.rejects(h.run(), { code: 'FIXTURE_COLLISION', message: 'FIXTURE_COLLISION' });
  assert.equal(h.state.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(h.state.hashes, 0); assert.equal(h.state.writes, 0);
  assert.deepEqual({ shops: h.state.shops, users: h.state.users }, before);
});
for (const stage of ['BEGIN', 'hashtextextended', 'DO $test_shop$', 'INSERT INTO shops', 'INSERT INTO users', 'COMMIT']) {
  test(`failure at ${stage} redacts all output and rolls back`, async () => {
    const h = harness({ failAt: sql => sql.includes(stage) }); let output = '';
    assert.equal(await main({ env: env(), argv: [], adapters: h.adapters, write: s => { output += s; } }), 1);
    assert.equal(output, '{"error":"PROVISIONING_FAILED"}\n');
    assert.equal(h.state.shops.length, 0); assert.equal(h.state.users.length, 0);
    assert.equal(h.state.queries.at(-1).sql, 'ROLLBACK');
  });
}
test('rollback failure discards connection and never reports success', async () => {
  const h = harness({ failAt: sql => /INSERT INTO users/.test(sql), rollbackFails: true });
  await assert.rejects(h.run(), { code: 'PROVISIONING_FAILED' }); assert.deepEqual(h.state.releases, [true]);
});
test('connection, hashing and release errors have only fixed enums', async () => {
  for (const kind of ['connect', 'hash', 'release', 'end']) {
    const h = harness({ releaseFails: kind === 'release' });
    if (kind === 'connect') h.adapters.pool.connect = async () => { throw Error(syntheticPassword); };
    if (kind === 'hash') h.adapters.hashPassword = async () => { throw Error(syntheticPassword); };
    if (kind === 'end') h.adapters.pool.end = async () => { throw Error(syntheticPassword); };
    let output = '';
    assert.equal(await main({ env: env(), argv: [], adapters: h.adapters, write: s => { output += s; } }), 1);
    assert.equal(output, '{"error":"PROVISIONING_FAILED"}\n');
  }
});
test('successful CLI emits exactly one stable JSON line with no secret/hash/token material', async () => {
  const h = harness(); let output = '';
  assert.equal(await main({ env: env(), argv: [], adapters: h.adapters, write: s => { output += s; } }), 0);
  assert.equal(output, JSON.stringify(core.verifyState(ids, [safeShop()], [safeUser()])) + '\n');
  assert.doesNotMatch(output, /synthetic-only-input|synthetic-hash|password|token|stripe|twilio/i);
});
for (const hold of [null, 'exact']) test(`startup safely transitions hold=${hold} and accepts complete TRUE fixture`, async () => {
  const h = harness({ shops: [safeShop()], users: [safeUser()], schema: { hold } });
  const before = structuredClone({ shops: h.state.shops, users: h.state.users });
  await up(h.adapters.pool); await up(h.adapters.pool);
  assert.equal(h.state.schema.hold, null); assert.equal(h.state.writes, 0); assert.equal(h.state.hashes, 0);
  assert.deepEqual({ shops: h.state.shops, users: h.state.users }, before);
  const sql = h.state.queries.map(q => q.sql);
  if (hold) assert.ok(sql.findIndex(q => q.includes('NOT (TRUE AND')) < sql.indexOf('ALTER TABLE shops DROP CONSTRAINT shops_internal_test_shop_hold'));
  else assert.equal(sql.some(q => /ALTER TABLE|LOCK TABLE|pg_advisory/.test(q)), false);
  assert.match(sql.join('\n'), /convalidated AND NOT connoinherit/);
  assert.match(sql.join('\n'), /conislocal AND coninhcount=0/);
  assert.doesNotMatch(sql.join('\n'), /ALTER COLUMN.*(?:SET DEFAULT|SET NOT NULL)/);
});
for (const schema of [{ type: 'text' }, { notNull: false }, { default: 'true' }, { default: null },
  { hold: 'weakened' }, { hold: 'unvalidated' }, { hold: 'inherited' }, { unknownConstraint: true }]) {
  test(`startup refuses incompatible schema ${JSON.stringify(schema)} before DROP and preserves state`, async () => {
    const h = harness({ schema }), before = structuredClone(h.state.schema);
    await assert.rejects(up(h.adapters.pool), { code: 'INTERNAL_TEST_SHOP_SCHEMA_REQUIRED' });
    assert.deepEqual(h.state.schema, before);
    assert.equal(h.state.queries.some(q => /DROP CONSTRAINT/.test(q.sql)), false);
    assert.equal(h.state.queries.at(-1).sql, 'ROLLBACK');
  });
}
test('absent policy column receives FALSE, existing default is not silently repaired', async () => {
  const h = harness({ schema: { type: 'absent', notNull: false, default: null } });
  await up(h.adapters.pool); assert.equal(h.state.schema.default, 'false'); assert.equal(h.state.schema.notNull, true);
});
test('startup permits used TRUE fixtures without invoking pristine provisioning checks', async () => {
  const h = harness({ shops: [{ ...safeShop(), onboarded: true }], users: [safeUser()],
    related: [{ present: true }] });
  await up(h.adapters.pool);
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.queries.some(q => /to_jsonb|SELECT DISTINCT n.nspname/.test(q.sql)), false);
  await assert.rejects(h.run(), { code: 'FIXTURE_COLLISION' });
});
for (const schema of [{ hold: 'exact' }, { default: 'true' }, { idType: 'integer' }, { idType: 'varchar(12)' }, { insertTrigger: true }, { rls: true }, { rule: true }]) {
  test(`CLI requires completed compatible transition ${JSON.stringify(schema)}`, async () => {
    const h = harness({ schema }); await assert.rejects(h.run(), { code: 'PROVISIONING_FAILED' });
    assert.equal(h.state.writes, 0); assert.equal(h.state.hashes, 0);
  });
}
test('schema validation pins type, default, nullability, unknown constraints and VARCHAR(36)', async () => {
  const queries = []; await validateSchema({ query: async sql => { queries.push(sql); return { rows: [] }; } });
  const sql = queries.join('\n');
  for (const pattern of [/atttypid='boolean'::regtype/, /a.attnotnull/, /pg_get_expr\(d.adbin, d.adrelid\)='false'/,
    /policy_attnum=ANY\(conkey\)/, /NOT \(FALSE AND/, /atttypmod=40/, /atttypid IN \('text'::regtype,'uuid'::regtype\)/]) assert.match(sql, pattern);
});
test('production importer inventory has no public route/setter for provisioning', () => {
  for (const file of fs.readdirSync(path.resolve(__dirname, '../src/routes'))) {
    if (file.endsWith('.js')) assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../src/routes', file), 'utf8'), /internalTestShopProvisioning|provision-internal-test-shop/);
  }
});

test('core import permits only built-in crypto and never reads process/config', () => {
  const file = path.resolve(__dirname, '../src/services/internalTestShopProvisioning.js'), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports,
    require: name => { assert.equal(name, 'node:crypto'); return require('node:crypto'); },
    process: new Proxy({}, { get() { assert.fail('Core read process during import'); } }),
  });
  assert.equal(typeof module.exports.provision, 'function');
});
for (const overrides of [
  { shopInsertOverrides: { stripe_customer_id: 'synthetic-unexpected-default' } },
  { shopInsertOverrides: { sms_comp: true } },
  { shopInsertOverrides: { trial_ends_at: 'synthetic-trial' } },
  { shopInsertOverrides: { plan: 'pro' } },
  { userInsertOverrides: { role: 'superadmin' } },
  { userInsertOverrides: { shop_id: 'wrong-tenant' } },
]) test(`post-insert persisted verification rolls back unexpected defaults ${JSON.stringify(overrides)}`, async () => {
  const h = harness(overrides);
  await assert.rejects(h.run(), { code: 'FIXTURE_COLLISION' });
  assert.equal(h.state.shops.length, 0); assert.equal(h.state.users.length, 0);
  assert.equal(h.state.queries.at(-1).sql, 'ROLLBACK');
});
test('unused alternate password fields cannot supply input', async () => {
  const h = harness();
  await assert.rejects(h.run(env({ REVV_INTERNAL_TEST_SHOP_PASSWORD: undefined,
    PASSWORD: syntheticPassword, REVV_INTERNAL_TEST_SHOP_PASSWORD_FILE: '/synthetic/no-read',
    JWT_ROLE: 'superadmin', REVV_INTERNAL_TEST_SHOP_FORCE: 'true' })), { code: 'INVALID_PASSWORD' });
  assert.equal(h.state.connections, 0);
});
test('safe schema and absence checks precede hashing; receipt follows COMMIT', async () => {
  const h = harness(); let output = '';
  await main({ env: env(), argv: [], adapters: h.adapters, write: s => {
    assert.equal(h.state.queries.at(-1).sql, 'COMMIT'); output += s;
  } });
  assert.equal(JSON.parse(output).shop_id, ids.shop_id);
  const sql = h.state.queries.map(q => q.sql);
  assert.ok(sql.findIndex(q => /DO \$identity\$/.test(q)) < sql.findIndex(q => /INSERT INTO shops/.test(q)));
  assert.match(sql.find(q => /to_jsonb\(u\)/.test(q)), /to_jsonb\(u\) - 'password_hash'/);
  assert.match(sql.find(q => /SELECT DISTINCT n.nspname/.test(q)), /f.confrelid IN \('shops'::regclass,'users'::regclass\)/);
});
test('startup connection release failure is redacted', async () => {
  const h = harness({ releaseFails: true });
  await assert.rejects(up(h.adapters.pool), { code: 'INTERNAL_TEST_SHOP_SCHEMA_REQUIRED', message: 'INTERNAL_TEST_SHOP_SCHEMA_REQUIRED' });
});
test('asynchronous pool errors cannot emit DB details or a success receipt', async () => {
  const h = harness(), events = new (require('node:events').EventEmitter)();
  h.adapters.pool.on = events.on.bind(events);
  h.adapters.pool.removeListener = events.removeListener.bind(events);
  h.adapters.pool.end = async () => { events.emit('error', Error('synthetic-private-provider-detail')); };
  let output = '';
  assert.equal(await main({ env: env(), argv: [], adapters: h.adapters, write: s => { output += s; } }), 1);
  assert.equal(output, '{"error":"PROVISIONING_FAILED"}\n');
  assert.equal(events.listenerCount('error'), 0);
});
test('only provisioning rejects incompatible fixture identity schema', async () => {
  const h = harness({ shops: [safeShop()], users: [safeUser()], schema: { idType: 'varchar(12)' } });
  await up(h.adapters.pool);
  await assert.rejects(h.run(), { code: 'PROVISIONING_FAILED' });
  assert.equal(h.state.queries.at(-1).sql, 'ROLLBACK');
});
