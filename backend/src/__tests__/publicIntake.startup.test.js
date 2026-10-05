const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

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
