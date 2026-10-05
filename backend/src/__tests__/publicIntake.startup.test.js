const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { Readable, Writable } = require('node:stream');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'synthetic-public-intake-test-key';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ORPHAN = '99999999-9999-4999-8999-999999999999';
const TABLES = ['estimate_requests', 'appointment_requests'];

function guardedConfig() {
  const raw = process.env.PUBLIC_INTAKE_TEST_DATABASE_URL;
  assert.ok(raw, 'Set PUBLIC_INTAKE_TEST_DATABASE_URL to the explicitly isolated loopback test database');
  const url = new URL(raw);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55459');
  assert.equal(url.pathname, '/revv_public_intake_test');
  assert.equal(url.username, 'revv_panel');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return { host: '127.0.0.1', port: 55459, database: 'revv_public_intake_test', user: 'revv_panel',
    password: decodeURIComponent(url.password), ssl: false, connectionTimeoutMillis: 2000, max: 2 };
}

function mockModule(id, exports) {
  const filename = require.resolve(id);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function inject(app, { method, url, headers = {}, body = Buffer.alloc(0), ip = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body.length ? [body] : []);
    req.method = method;
    req.url = url;
    req.headers = {
      host: '127.0.0.1',
      'content-length': String(body.length),
      ...headers,
    };
    req.connection = { remoteAddress: ip };
    req.socket = req.connection;

    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (name, value) => {
      res.headers[String(name).toLowerCase()] = value;
    };
    res.getHeader = (name) => res.headers[String(name).toLowerCase()];
    res.removeHeader = (name) => {
      delete res.headers[String(name).toLowerCase()];
    };
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      for (const [name, value] of Object.entries(headersToSet)) res.setHeader(name, value);
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      Writable.prototype.end.call(res);
    };
    res.on('finish', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: res.statusCode,
        text,
        json: text ? JSON.parse(text) : null,
      });
    });
    res.on('error', reject);
    app.handle(req, res, reject);
  });
}
function routeApp() {
  const embeds = [];
  mockModule('../utils/discord', { sendDiscordEmbed: async embed => { embeds.push(embed); } });
  mockModule('../services/mailer', { sendMail: async () => null });
  mockModule('../services/sms', { getTwilioConfigForShop: async () => null, isConfiguredForShop: async () => false });
  mockModule('../services/mediaStorage', {});
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  delete require.cache[require.resolve('../middleware/auth')];
  for (const [prefix, route] of [['public', 'public'], ['appointments', 'appointments'],
    ['settings', 'settings'], ['estimate-requests', 'estimateRequests'], ['auth', 'auth']]) {
    delete require.cache[require.resolve(`../routes/${route}`)];
    app.use(`/api/${prefix}`, require(`../routes/${route}`));
  }
  let sequence = 1;
  return { embeds, async request(method, url, body = {}, shop, role = 'owner') {
    const headers = { 'content-type': 'application/json' };
    if (shop) headers.authorization = `Bearer ${jwt.sign({ id: ORPHAN, shop_id: shop, role }, process.env.JWT_SECRET)}`;
    const response = await inject(app, { method, url, headers, body: Buffer.from(JSON.stringify(body)), ip: `127.0.0.${sequence++}` });
    await new Promise(resolve => setImmediate(resolve));
    return response;
  } };
}

async function withSchema(config, admin, run) {
  const schema = `public_intake_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^public_intake_test_[a-f0-9]{32}$/);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  // No public schema in search_path: all application DDL/data is synthetic and isolated.
  const pool = new Pool({ ...config, options: `-c search_path=${schema}` });
  try {
    mockModule('dotenv', { config() {} }); // Never load .env, including from the symlinked dependencies.
    mockModule('pg', { Pool: class { constructor() { return pool; } } });
    mockModule('../services/openai', { getOpenAI() { throw new Error('Provider calls forbidden'); } });
    delete require.cache[require.resolve('../db')];
    delete require.cache[require.resolve('../services/publicShop')];
    process.env.DEMO_OWNER_EMAIL = '';
    const { initDb } = require('../db');
    await run(pool, initDb);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

async function assertShopType(pool, type) {
  for (const table of TABLES) {
    const { rows: [column] } = await pool.query(`SELECT atttypid::regtype::text AS type, attnotnull
      FROM pg_attribute WHERE attrelid = $1::regclass AND attname = 'shop_id'`, [table]);
    assert.equal(column.type, type, table);
    assert.equal(column.attnotnull, true, table);
    const { rows } = await pool.query(`SELECT c.convalidated, c.confdeltype FROM pg_constraint c
      WHERE c.conrelid = $1::regclass AND c.contype = 'f' AND c.confrelid = 'shops'::regclass`, [table]);
    assert.equal(rows.length, 1, table);
    assert.equal(rows[0].convalidated, true, table);
    assert.equal(rows[0].confdeltype, 'a', 'NO ACTION preserves tenant ownership');
  }
}

async function legacyShops(pool, type = 'uuid', id = A) {
  assert.ok(['uuid', 'text'].includes(type));
  await pool.query(`CREATE TABLE shops (id ${type} PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query('INSERT INTO shops (id, name) VALUES ($1, $2)', [id, 'Synthetic legacy shop']);
}

async function legacyChild(pool, table, value) {
  assert.ok(TABLES.includes(table));
  await pool.query(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, shop_id TEXT, payload TEXT)`);
  await pool.query(`INSERT INTO ${table} VALUES ($1, $2, $3)`, [`${table}-preserved`, value, 'Synthetic data must survive']);
}

test('full initDb on guarded real PostgreSQL (no provider calls or skipped cases)', async t => {
  t.mock.method(global, 'fetch', async () => { throw new Error('Outbound requests forbidden'); });
  const config = guardedConfig();
  const admin = new Pool({ ...config, max: 1, options: '-c search_path=pg_catalog' });
  try {
    // A denied loopback connection fails the suite once; never retry via another transport.
    const { rows: [identity] } = await admin.query('SELECT current_database() AS name');
    assert.equal(identity.name, 'revv_public_intake_test');

    await t.test('empty UUID database boots twice; slug defaults, uniqueness and NOT NULL survive', async () => {
      await withSchema(config, admin, async (pool, initDb) => {
        await initDb();
        await initDb();
        await assertShopType(pool, 'uuid');
        await pool.query('INSERT INTO shops (id, name) VALUES ($1, $2), ($3, $4)', [A, 'Synthetic A', B, 'Synthetic B']);
        const before = (await pool.query('SELECT id, public_intake_slug FROM shops ORDER BY id')).rows;
        for (const row of before) assert.match(row.public_intake_slug, /^[a-z2-7]{26}$/);
        assert.notEqual(before[0].public_intake_slug, before[1].public_intake_slug);
        await assert.rejects(pool.query('UPDATE shops SET public_intake_slug = NULL WHERE id = $1', [A]), { code: '23502' });
        await assert.rejects(pool.query('UPDATE shops SET public_intake_slug = $1 WHERE id = $2', [before[0].public_intake_slug, B]), { code: '23505' });
        await initDb();
        await assertShopType(pool, 'uuid');
        assert.deepEqual((await pool.query('SELECT id, public_intake_slug FROM shops ORDER BY id')).rows, before);
        for (const table of TABLES) {
          await assert.rejects(pool.query(`INSERT INTO ${table} (id, shop_id, name, phone${table === 'estimate_requests' ? ', email, year, make, model, damage_type' : ', service'})
            VALUES ($1, $2, 'Synthetic', '2125550100'${table === 'estimate_requests' ? ", 'test@example.test', '2020', 'Test', 'Fixture', 'hail'" : ", 'test'"})`, [randomUUID(), ORPHAN]), { code: '23503' });
        }
      });
    });

    await t.test('real routes persist only to resolved tenants, exact photo rows, rotation and staff isolation', async () => {
      await withSchema(config, admin, async (pool, initDb) => {
        await initDb();
        const { newPublicIntakeSlug } = require('../services/publicShop');
        const slugs = { [A]: newPublicIntakeSlug(), [B]: newPublicIntakeSlug() };
        await pool.query(`INSERT INTO shops (id, name, logo_url, public_intake_slug, created_at)
          VALUES ($1, 'Synthetic oldest', '/uploads/a.png', $2, '2020-01-01'),
                 ($3, 'Synthetic selected', '/uploads/b.png', $4, '2021-01-01')`, [A, slugs[A], B, slugs[B]]);
        const { request, embeds } = routeApp();
        const body = { name: 'Synthetic Customer', phone: '2125550100', email: 'synthetic@example.test',
          year: '2020', make: 'Test', model: 'Fixture', damage_type: 'hail', service: 'Body work', shop_id: A };
        const photos = ['data:image/png;base64,iVBORw0KGgo='];
        async function rows(table) {
          assert.ok(TABLES.includes(table));
          return (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
        }
        for (const path of ['/api/public/estimate-request', '/api/appointments/request']) {
          for (const [query, status] of [['', 400], ['?shop=garbage', 404], ['?shop=cccccccccccccccccccccccccc', 404], [`?shop=${ORPHAN}`, 404]]) {
            assert.equal((await request('POST', path + query, body)).status, status);
            for (const table of TABLES) assert.deepEqual(await rows(table), []);
          }
        }
        assert.equal(embeds.length, 0);
        assert.equal((await request('GET', '/api/public/shop/garbage')).status, 404);
        assert.equal((await request('GET', `/api/public/shop/${ORPHAN}`)).status, 404);
        const beforeProfile = await request('GET', `/api/public/shop/${B}`);
        assert.equal(beforeProfile.status, 200);
        assert.equal(beforeProfile.json.shop.public_intake_slug, slugs[B]);
        assert.deepEqual((await request('GET', `/api/public/intake/${slugs[B]}`)).json,
          { name: 'Synthetic selected', logo_url: '/uploads/b.png' });
        for (const shop of [B, A]) {
          const estimate = await request('POST', `/api/public/estimate-request?shop=${slugs[shop]}`, { ...body, shop_id: shop === A ? B : A, photos });
          const appointment = await request('POST', `/api/appointments/request?shop=${slugs[shop]}`, { ...body, shop_id: shop === A ? B : A });
          assert.equal(estimate.status, 201);
          assert.equal(appointment.status, 201);
          const estimates = await rows('estimate_requests');
          const appointments = await rows('appointment_requests');
          assert.equal(estimates.length, shop === B ? 1 : 2);
          assert.equal(appointments.length, shop === B ? 1 : 2);
          const saved = estimates.find(row => row.shop_id === shop);
          assert.equal(embeds.at(-1).fields.find(field => field.name === 'Request ID').value, saved.id);
          assert.equal(saved.shop_id, shop);
          assert.deepEqual(JSON.parse(saved.photos_json), photos);
          assert.equal(appointments.find(row => row.id === appointment.json.id).shop_id, shop);
          if (shop === B) {
            assert.equal(estimates.filter(row => row.shop_id === A).length, 0, 'no oldest-shop fallback row');
            assert.equal(appointments.filter(row => row.shop_id === A).length, 0);
          }
          const detail = `/api/estimate-requests/${saved.id}`;
          assert.equal((await request('GET', detail, {}, shop === A ? B : A, 'staff')).status, 404);
          assert.equal((await request('PATCH', `${detail}/status`, { status: 'contacted' }, shop === A ? B : A, 'staff')).status, 404);
          assert.deepEqual(await rows('estimate_requests'), estimates, 'cross-tenant mutation changes no rows');
          assert.equal((await request('GET', detail, {}, shop, 'staff')).status, 200);
          assert.equal((await request('PATCH', `${detail}/status`, { status: 'contacted' }, shop, 'staff')).status, 200);
        }
        const rotation = await request('POST', '/api/settings/public-intake/rotate', { shop_id: A }, B);
        assert.equal(rotation.status, 200);
        const persisted = (await pool.query('SELECT public_intake_slug FROM shops WHERE id=$1', [B])).rows[0].public_intake_slug;
        assert.notEqual(persisted, slugs[B]);
        assert.equal(rotation.json.public_intake_slug, persisted);
        assert.equal((await request('GET', `/api/public/shop/${B}`)).json.shop.public_intake_slug, persisted);
        assert.equal((await request('GET', `/api/public/shop/${A}`)).json.shop.public_intake_slug, slugs[A]);
        for (const path of ['/api/public/estimate-request', '/api/appointments/request']) {
          assert.equal((await request('POST', `${path}?shop=${slugs[B]}`, body)).status, 404);
          assert.equal((await request('POST', `${path}?shop=${persisted}`, body)).status, 201);
        }
        assert.equal((await request('GET', `/api/public/intake/${slugs[B]}`)).status, 404);
        assert.deepEqual((await request('GET', `/api/public/intake/${persisted}`)).json,
          { name: 'Synthetic selected', logo_url: '/uploads/b.png' });
        for (const table of TABLES) {
          const saved = await rows(table);
          assert.equal(saved.length, 3);
          assert.equal(saved.filter(row => row.shop_id === B).length, 2);
          assert.equal(saved.filter(row => row.shop_id === A).length, 1);
        }
        const registration = await request('POST', '/api/auth/shop-register', {
          name: 'Synthetic Owner', email: 'owner@example.test', password: 'synthetic-only-password', shop_name: 'Synthetic new shop',
        });
        assert.equal(registration.status, 201);
        const registered = (await pool.query('SELECT public_intake_slug FROM shops WHERE id=$1', [registration.json.user.shop_id])).rows[0];
        assert.match(registered.public_intake_slug, /^[a-z2-7]{25}[aeimquy4]$/);
      });
    });

    await t.test('legacy TEXT children upgrade to UUID without losing rows; backfill is idempotent', async () => {
      await withSchema(config, admin, async (pool, initDb) => {
        await legacyShops(pool);
        for (const table of TABLES) await legacyChild(pool, table, A);
        await initDb();
        await assertShopType(pool, 'uuid');
        const slug = (await pool.query('SELECT public_intake_slug FROM shops')).rows[0].public_intake_slug;
        assert.match(slug, /^[a-z2-7]{26}$/);
        await initDb();
        assert.equal((await pool.query('SELECT public_intake_slug FROM shops')).rows[0].public_intake_slug, slug);
        for (const table of TABLES) {
          assert.deepEqual((await pool.query(`SELECT * FROM ${table}`)).rows, [{ id: `${table}-preserved`, shop_id: A, payload: 'Synthetic data must survive' }]);
          await assert.rejects(pool.query(`UPDATE ${table} SET shop_id = NULL`), { code: '23502' });
          await assert.rejects(pool.query(`UPDATE ${table} SET shop_id = $1`, [ORPHAN]), { code: '23503' });
        }
      });
    });

    await t.test('legacy TEXT parent remains TEXT; fresh and legacy children both work', async () => {
      await withSchema(config, admin, async (pool, initDb) => {
        await legacyShops(pool, 'text', 'synthetic-text-shop');
        await legacyChild(pool, 'estimate_requests', 'synthetic-text-shop');
        // Exercise replacement of an existing FK with ON DELETE SET NULL.
        await pool.query('ALTER TABLE estimate_requests ADD CONSTRAINT legacy_shop_fk FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL');
        await initDb();
        await initDb();
        await assertShopType(pool, 'text');
        assert.equal((await pool.query("SELECT atttypid::regtype::text AS type FROM pg_attribute WHERE attrelid='shops'::regclass AND attname='id'")).rows[0].type, 'text');
        assert.equal((await pool.query('SELECT shop_id FROM estimate_requests')).rows[0].shop_id, 'synthetic-text-shop');
        const { rows: [shop] } = await pool.query("INSERT INTO shops (id, name) VALUES ('future-text-shop', 'Synthetic future') RETURNING public_intake_slug");
        assert.match(shop.public_intake_slug, /^[a-z2-7]{26}$/);
      });
    });

    for (const table of TABLES) {
      for (const [label, value] of [['invalid', 'not-a-uuid'], ['null', null], ['orphan', ORPHAN]]) {
        await t.test(`${table}: ${label} legacy data fails startup and remains intact`, async () => {
          await withSchema(config, admin, async (pool, initDb) => {
            await legacyShops(pool);
            await legacyChild(pool, table, value);
            const before = (await pool.query(`SELECT * FROM ${table}`)).rows;
            await assert.rejects(initDb(), error => {
              assert.match(error.message, new RegExp(`${table}\\.shop_id alignment failed`));
              assert.match(error.message, /rows preserved/);
              assert.ok(!error.message.includes('not-a-uuid'));
              return true;
            });
            assert.deepEqual((await pool.query(`SELECT * FROM ${table}`)).rows, before);
            const column = (await pool.query("SELECT atttypid::regtype::text AS type, attnotnull FROM pg_attribute WHERE attrelid=$1::regclass AND attname='shop_id'", [table])).rows[0];
            assert.deepEqual(column, { type: 'text', attnotnull: false }, 'failed conversion/constraint changes rolled back');
          });
        });
      }
    }
  } finally {
    await admin.end();
  }
});
