'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const schema = require('../src/db/shopTwilioNumber');

// Deny unexpected imports so neither dotenv, a real pool nor a provider loads.
function load(file, mocks) {
  const filename = path.resolve(__dirname, '../src', file), module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,__dirname){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express', 'uuid', 'path'].includes(name)) return require(name);
    throw Error(`Unexpected dependency: ${name}`);
  }, module, module.exports, path.dirname(filename));
  return module.exports;
}

function harness({ failure, db: realDb } = {}) {
  const calls = [];
  const db = realDb || {
    dbGet: async (sql, params) => {
      calls.push({ sql, params });
      return /FROM users/.test(sql) ? null : { id: params[0], name: 'Synthetic shop' };
    },
    dbRun: async (sql, params) => {
      calls.push({ sql, params });
      if (failure) throw failure;
      return { rowCount: 1 };
    },
  };
  const auth = load('middleware/auth.js', { jsonwebtoken: jwt, '../db': db });
  const next = (_req, _res, next) => next();
  const multer = () => ({ single: () => next }); multer.diskStorage = () => ({});
  const router = load('routes/market.js', {
    fs: { mkdirSync() {} }, multer, '../db': db, '../db/shopTwilioNumber': schema,
    '../middleware/auth': auth, '../middleware/roles': require('../src/middleware/roles'),
    '../services/paymentReservations': {}, '../data/market-rates': {}, '../services/mediaStorage': {},
    '../services/sms': {
      getTwilioConfigForShop: async shop => { calls.push({ smsShop: shop }); return null; },
      isConfiguredForShop: async shop => { calls.push({ smsShop: shop }); return false; },
    },
  });
  const route = router.stack.find(l => l.route?.path === '/shop' && l.route.methods.put).route;
  async function invoke(body, role = 'owner', shop = 'shop-a', token = true) {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'synthetic-phase-b-secret';
    try {
      const claims = { id: 'synthetic-user', shop_id: shop, ...(role === 'missing' ? {} : { role }) };
      const req = { body, headers: token ? { authorization: `Bearer ${jwt.sign(claims, process.env.JWT_SECRET)}` } : {} };
      const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
      const pending = []; let i = 0;
      const next = () => {
        const result = route.stack[i++]?.handle(req, res, next);
        if (result?.then) pending.push(result);
      };
      next();
      // Real auth is async and adds downstream promises after its DB lookup.
      for (let j = 0; j < pending.length; j++) await pending[j];
      return res;
    } finally {
      if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
    }
  }
  return { invoke, calls };
}

for (const role of ['owner', 'admin', 'assistant', 'technician', 'employee', 'staff', 'customer', 'superadmin', 'unknown', 'missing', null, 'OWNER']) {
  test(`market PUT authenticated role ${role}: exact allowlist and body spoofing`, async () => {
    const h = harness();
    const res = await h.invoke({ name: 'Changed', twilio_phone_number: ' \t+15551234567\n',
      role: 'owner', shop_id: 'other-shop', id: 'other-shop', user: { role: 'admin', shop_id: 'other-shop' },
      plan: 'pro', sms_comp: true }, role);
    const allowed = ['owner', 'admin'].includes(role);
    assert.equal(res.statusCode, allowed ? 200 : 403);
    const writes = h.calls.filter(c => /UPDATE/.test(c.sql));
    assert.equal(writes.length, allowed ? 1 : 0);
    if (allowed) {
      assert.equal(writes[0].sql, 'UPDATE shops SET name = $1, twilio_phone_number = $2 WHERE id = $3');
      assert.deepEqual(writes[0].params, ['Changed', '+15551234567', 'shop-a']);
      assert.ok(h.calls.every(c => !c.params?.includes('other-shop')));
      assert.ok(h.calls.filter(c => c.smsShop).every(c => c.smsShop === 'shop-a'));
    } else {
      assert.ok(h.calls.every(c => /FROM users/.test(c.sql)), 'denial must precede shop reads and config access');
    }
  });
}

test('market PUT requires real authentication even with an owner body', async () => {
  const h = harness();
  assert.equal((await h.invoke({ role: 'owner', name: 'Spoofed' }, 'owner', 'shop-a', false)).statusCode, 401);
  assert.deepEqual(h.calls, []);
});

for (const value of ['15551234567', '(555) 123-4567', '+1 5551234567', '+01234567', '+1', '+1234567890123456', '+15551234567\n+15557654321', 15551234567, {}, [], true]) {
  test(`market PUT rejects noncanonical SMS number ${JSON.stringify(value)}`, async () => {
    const h = harness();
    const res = await h.invoke({ twilio_phone_number: value, twilio_auth_token: 'PRIVATE_TOKEN' });
    assert.equal(res.statusCode, 400);
    assert.equal(h.calls.some(c => /UPDATE/.test(c.sql)), false);
    assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_TOKEN/);
  });
}
for (const value of [null, '', ' \t\n ', '+15551234567', ' +15551234567 ']) {
  test(`market PUT accepts unset/trimmed SMS number ${JSON.stringify(value)}`, async () => {
    const h = harness();
    assert.equal((await h.invoke({ twilio_phone_number: value })).statusCode, 200);
    assert.deepEqual(h.calls.find(c => /UPDATE/.test(c.sql)).params, [value?.trim() ?? null, 'shop-a']);
  });
}
test('omitted phone stays omitted and a spoof-only payload cannot update a tenant', async () => {
  const h = harness();
  assert.equal((await h.invoke({ name: 'Changed' })).statusCode, 200);
  assert.equal(h.calls.find(c => /UPDATE/.test(c.sql)).sql, 'UPDATE shops SET name = $1 WHERE id = $2');
  assert.equal((await h.invoke({ role: 'admin', shop_id: 'other-shop' })).statusCode, 400);
});

test('only the named unique-number 23505 maps to sanitized 409; floor/other status contracts stay intact', async () => {
  const conflict = Object.assign(Error('PRIVATE_PHONE PRIVATE_TOKEN OTHER_SHOP'), {
    code: '23505', constraint: schema.SHOP_TWILIO_NUMBER_UNIQUE, detail: 'PRIVATE_DETAIL',
  });
  const h = harness({ failure: conflict });
  const res = await h.invoke({ twilio_phone_number: '+15551234567' });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /already assigned/);
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE|OTHER_SHOP|23505|shops_twilio/);
  assert.equal(h.calls.some(c => c.smsShop), false);
  for (const failure of [
    Object.assign(Error('other unique failure'), { code: '23505', constraint: 'unrelated_unique' }),
    Object.assign(Error('RO_FINANCIAL_HOLD'), { code: '23514', constraint: schema.SHOP_TWILIO_NUMBER_UNIQUE }),
    Object.assign(Error('unspecified unique failure'), { code: '23505' }),
    Object.assign(Error('connection unavailable'), { code: '08006' }),
  ]) {
    const result = await harness({ failure }).invoke({ tax_rate: 0 });
    assert.equal(result.statusCode, 500);
    assert.equal(result.body.error, failure.message);
  }
});

for (const code of ['23505', '42501', '08006', 'P0001']) {
  test(`schema installation error ${code} is fatal and sanitized`, async () => {
    await assert.rejects(schema.ensureShopTwilioNumber({ query: async () => {
      throw Object.assign(Error('+15551234567 PRIVATE_TOKEN'), { code, detail: 'PRIVATE_DETAIL' });
    } }), err => {
      assert.equal(err.code, schema.SHOP_TWILIO_SCHEMA_REQUIRED);
      assert.doesNotMatch(`${err.stack} ${JSON.stringify(err)}`, /15551234567|PRIVATE/);
      assert.equal(err.cause, undefined);
      assert.match(err.message, /operator/);
      if (code === '23505') assert.match(err.message, /duplicate nonempty numbers/);
      return true;
    });
  });
}

test('startup and migration entrypoints await the shared installer and propagate its failure', async () => {
  for (const entry of ['db/index.js', 'db/migrate.js']) {
    let attempted = 0, queries = 0;
    const fatal = Object.assign(Error('sanitized routing migration failure'), { code: schema.SHOP_TWILIO_SCHEMA_REQUIRED });
    const db = { query: async () => { queries++; return { rows: [{ exists: true }] }; } };
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'synthetic-not-connected';
    try {
      const loaded = load(entry, {
        dotenv: { config() {} }, pg: { Pool: function () { return db; } },
        fs, './postgres': db,
        './shopTwilioNumber': { ...schema, ensureShopTwilioNumber: async target => {
          attempted++; assert.equal(typeof target.query, 'function'); throw fatal;
        } },
      });
      await assert.rejects(entry === 'db/index.js' ? loaded.initDb() : loaded.runMigrations(), err => err === fatal);
      assert.equal(attempted, 1);
      assert.ok(queries > 0);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    }
  }
});

test('server never listens or seeds after either routing-schema entrypoint fails', async () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
  const start = appSource.slice(appSource.indexOf('\ninitDb()') + 1);
  assert.ok(start.startsWith('initDb()'));
  for (const point of ['startup', 'migration']) {
    const exits = [], logs = [];
    const fatal = Object.assign(Error('sanitized routing migration failure'), { code: schema.SHOP_TWILIO_SCHEMA_REQUIRED });
    const context = {
      initDb: async () => { if (point === 'startup') throw fatal; },
      process: { env: { DATABASE_URL: 'synthetic' }, exit: code => exits.push(code) },
      console: { error: (...args) => logs.push(args) },
      require: name => {
        assert.equal(name, './db/migrate', 'must never load seed after schema failure');
        return { runMigrations: async () => { throw fatal; } };
      },
      app: { listen: () => assert.fail('unprotected server started') },
    };
    await vm.runInNewContext(start, context);
    assert.deepEqual(exits, [1]);
    assert.equal(logs.length, 1);
    assert.match(logs[0].join(' '), /Init failed.*sanitized/);
  }
});
