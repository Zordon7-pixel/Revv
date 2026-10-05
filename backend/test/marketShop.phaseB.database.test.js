'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const schemaHelper = require('../src/db/shopTwilioNumber');

function market(pool) {
  const filename = require.resolve('../src/routes/market'), module = { exports: {} };
  const next = (_req, _res, next) => next();
  const multer = () => ({ single: () => next }); multer.diskStorage = () => ({});
  const mocks = {
    fs: { mkdirSync() {} }, multer, '../db/shopTwilioNumber': schemaHelper,
    '../db': { dbRun: (sql, params) => pool.query(sql, params), dbGet: async (sql, params) => (await pool.query(sql, params)).rows[0] },
    '../middleware/auth': next, '../middleware/roles': require('../src/middleware/roles'),
    '../services/paymentReservations': {}, '../data/market-rates': {}, '../services/mediaStorage': {},
    '../services/sms': { getTwilioConfigForShop: async () => null, isConfiguredForShop: async () => false },
  };
  vm.runInThisContext(`(function(require,module,exports,__dirname){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express', 'uuid', 'path'].includes(name)) return require(name);
    throw Error(`Unexpected dependency: ${name}`);
  }, module, module.exports, path.dirname(filename));
  const route = module.exports.stack.find(l => l.route?.path === '/shop' && l.route.methods.put).route;
  return async (shop, body, role = 'owner') => {
    const req = { user: { shop_id: shop, role }, body };
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
    const pending = []; let i = 0;
    const next = () => { const result = route.stack[i++]?.handle(req, res, next); if (result?.then) pending.push(result); };
    next(); await Promise.all(pending); return res;
  };
}

test('real PostgreSQL Phase B isolated TEXT/UUID routing uniqueness and update races', { timeout: 60000 }, async t => {
  assert.equal(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL,
    'postgresql://revv_panel@127.0.0.1:55459/revv_panel_test', 'Dedicated loopback test DB required; never use DATABASE_URL');
  const config = { host: '127.0.0.1', port: 55459, user: 'revv_panel', database: 'revv_panel_test',
    password: async () => '', ssl: false, connectionTimeoutMillis: 2000, statement_timeout: 7000 };
  const admin = new Pool(config);
  async function isolated(type, legacy, work) {
    const schema = `market_b_${randomUUID().replaceAll('-', '')}`;
    let pool, created = false;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`); created = true;
      pool = new Pool({ ...config, options: `-c search_path=${schema}`, application_name: schema, max: 4 });
      await pool.query(`CREATE TABLE shops (
        id ${type} PRIMARY KEY, name TEXT, phone TEXT, logo_url TEXT, address TEXT, city TEXT,
        state TEXT, zip TEXT, market_tier INTEGER, labor_rate NUMERIC, paint_rate NUMERIC,
        parts_markup NUMERIC, tax_rate NUMERIC, lat NUMERIC, lng NUMERIC, geofence_radius NUMERIC,
        monthly_revenue_target INTEGER, twilio_auth_token TEXT, public_intake_slug TEXT UNIQUE NOT NULL
        ${legacy ? '' : ', twilio_phone_number TEXT'}
      )`);
      const ids = [1, 2, 3, 4].map(n => type === 'UUID' ? randomUUID() : `shop-${n}`);
      for (const [i, id] of ids.entries()) await pool.query('INSERT INTO shops(id,name,public_intake_slug) VALUES($1,$2,$3)',
        [id, 'Unchanged', 'a'.repeat(25) + 'abcd'[i]]);
      await work(pool, ids);
    } finally {
      if (pool) await pool.end();
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  }
  try {
    for (const type of ['TEXT', 'UUID']) {
      for (const legacy of [false, true]) await t.test(`${type} ${legacy ? 'missing-column legacy' : 'fresh'} install, idempotency, roles, race`, async () => {
        await isolated(type, legacy, async (pool, ids) => {
          await schemaHelper.ensureShopTwilioNumber(pool);
          const snapshot = (await pool.query('SELECT * FROM shops ORDER BY id')).rows;
          await schemaHelper.ensureShopTwilioNumber(pool);
          assert.deepEqual((await pool.query('SELECT * FROM shops ORDER BY id')).rows, snapshot);
          const index = (await pool.query(`SELECT i.indisunique, i.indisvalid, i.indisready FROM pg_index i
            JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='shops'::regclass AND c.relname=$1`,
          [schemaHelper.SHOP_TWILIO_NUMBER_UNIQUE])).rows;
          assert.deepEqual(index, [{ indisunique: true, indisvalid: true, indisready: true }]);
          const put = market(pool);
          for (const role of ['assistant', 'technician', 'employee', 'staff', 'customer', 'superadmin', 'unknown', null]) {
            const denied = await put(ids[0], { role: 'owner', shop_id: ids[1], name: 'Spoofed',
              twilio_phone_number: '+15551234567', twilio_auth_token: 'PRIVATE_TOKEN' }, role);
            assert.equal(denied.statusCode, 403);
          }
          assert.deepEqual((await pool.query('SELECT * FROM shops ORDER BY id')).rows, snapshot);
          const results = await Promise.all(ids.slice(0, 2).map((id, i) => put(id, {
            twilio_phone_number: ' \t+15551234567\n', name: `Winner-${i}`, role: 'owner', shop_id: ids[2],
          }, i ? 'admin' : 'owner')));
          assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
          const winner = results.findIndex(r => r.statusCode === 200), loser = 1 - winner;
          assert.equal(results[winner].body.public_intake_slug, snapshot.find(r => r.id === ids[winner]).public_intake_slug);
          assert.doesNotMatch(JSON.stringify(results[loser].body), /15551234567|PRIVATE|shops_twilio|Winner-/);
          const rows = (await pool.query('SELECT id,name,twilio_phone_number FROM shops')).rows;
          assert.equal(rows.find(r => r.id === ids[loser]).name, 'Unchanged', 'conflicting statement is atomic');
          assert.equal(rows.find(r => r.id === ids[2]).twilio_phone_number, null, 'body cannot select tenant');
          assert.equal(rows.find(r => r.id === ids[winner]).twilio_phone_number, '+15551234567');
          assert.equal((await put(ids[winner], { twilio_phone_number: '+15551234567' })).statusCode, 200);
          await assert.rejects(pool.query('UPDATE shops SET twilio_phone_number=$1 WHERE id=$2', ['+15551234567', ids[loser]]),
            err => err.code === '23505' && err.constraint === schemaHelper.SHOP_TWILIO_NUMBER_UNIQUE);
          for (const empty of [null, '', ' ', '\t\n']) {
            // Direct writes prove the index permits legacy blank values too.
            await pool.query('UPDATE shops SET twilio_phone_number=$1', [empty]);
            await schemaHelper.ensureShopTwilioNumber(pool);
            for (const id of ids) assert.equal((await put(id, { twilio_phone_number: empty })).statusCode, 200);
          }
        });
      });
      await t.test(`${type} duplicate existing numbers fail safely without data changes`, async () => {
        await isolated(type, false, async (pool, ids) => {
          await pool.query('UPDATE shops SET twilio_phone_number=$1,twilio_auth_token=$2 WHERE id IN ($3,$4)',
            ['+15551234567', 'PRIVATE_TOKEN', ids[0], ids[1]]);
          const before = (await pool.query('SELECT * FROM shops ORDER BY id')).rows;
          for (let i = 0; i < 2; i++) {
            await assert.rejects(schemaHelper.ensureShopTwilioNumber(pool), err => {
              assert.equal(err.code, schemaHelper.SHOP_TWILIO_SCHEMA_REQUIRED);
              assert.match(err.message, /duplicate nonempty numbers.*operator/);
              assert.doesNotMatch(`${err.stack} ${JSON.stringify(err)}`, /15551234567|PRIVATE_TOKEN|shop-1/);
              return true;
            });
            assert.deepEqual((await pool.query('SELECT * FROM shops ORDER BY id')).rows, before);
            assert.equal((await pool.query('SELECT to_regclass($1) AS index', [schemaHelper.SHOP_TWILIO_NUMBER_UNIQUE])).rows[0].index, null);
          }
        });
      });
      await t.test(`${type} a pre-existing incompatible index cannot masquerade as protection`, async () => {
        await isolated(type, false, async pool => {
          for (const definition of [
            'ON shops(twilio_phone_number)',
            "UNIQUE ON shops(twilio_phone_number) WHERE twilio_phone_number = 'unprotected'",
          ]) {
            const unique = definition.startsWith('UNIQUE ');
            await pool.query(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${schemaHelper.SHOP_TWILIO_NUMBER_UNIQUE} ${definition.replace(/^UNIQUE /, '')}`);
            await assert.rejects(schemaHelper.ensureShopTwilioNumber(pool), err => err.code === schemaHelper.SHOP_TWILIO_SCHEMA_REQUIRED);
            await pool.query(`DROP INDEX ${schemaHelper.SHOP_TWILIO_NUMBER_UNIQUE}`);
          }
        });
      });
    }
  } finally { await admin.end(); }
});
