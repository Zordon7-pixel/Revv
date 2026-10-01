const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Explicitly opt in with CUSTOMER_CONSENT_TEST_DATABASE_URL pointing at a local,
// disposable database named revv_customer_consent_test. Never use DATABASE_URL,
// dotenv, application initialization, broad migrations, seeds, or provider clients.
const url = process.env.CUSTOMER_CONSENT_TEST_DATABASE_URL;
function disposableAddress(value) {
  const address = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(address.protocol), 'PostgreSQL URL required');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(address.hostname), 'Local database required');
  assert.equal(address.pathname, '/revv_customer_consent_test', 'Dedicated disposable database required');
  assert.equal(address.search, '', 'Connection overrides are not allowed');
  assert.equal(address.hash, '', 'URL fragments are not allowed');
  return address;
}

test('consent integration rejects non-disposable connection targets', () => {
  for (const value of [
    'postgres://example.com/revv_customer_consent_test',
    'postgres://localhost/revv',
    'postgres://localhost/revv_customer_consent_test?host=example.com',
    'https://localhost/revv_customer_consent_test',
  ]) assert.throws(() => disposableAddress(value));
  assert.equal(disposableAddress('postgres://127.0.0.1/revv_customer_consent_test').hostname, '127.0.0.1');
});

const schemaSource = fs.readFileSync(path.join(__dirname, '../src/db/schema.pg.sql'), 'utf8');
const migrationSource = fs.readFileSync(path.join(__dirname, '../src/db/migrate.js'), 'utf8');
const customerDDL = schemaSource.match(/CREATE TABLE IF NOT EXISTS customers \([\s\S]*?\n\);/)?.[0];
// Execute the actual targeted statements without importing/running the app migrator.
const consentStatements = [...migrationSource.matchAll(/`(ALTER TABLE customers [^`]*\bsms_consent\b[^`]*)`/g)]
  .map(match => match[1]);

for (const idType of ['UUID', 'TEXT']) {
  for (const scenario of ['fresh', 'legacy default TRUE', 'missing column']) {
    test(`customer consent DDL and repeated upgrade: ${idType}, ${scenario}`, {
      skip: !url && 'Set CUSTOMER_CONSENT_TEST_DATABASE_URL to an explicit local disposable database',
    }, async t => {
      const address = disposableAddress(url);
      assert.ok(customerDDL, 'Actual customers schema DDL must be found');
      assert.equal(consentStatements.length, 2, 'Expected targeted add-column and set-default statements');
      // Explicit fields avoid ambient PGHOST/PGDATABASE/PGOPTIONS/service overrides.
      const { Client } = require('pg');
      const client = new Client({
        host: address.hostname.replace(/^\[|\]$/g, ''),
        port: Number(address.port || 5432),
        database: 'revv_customer_consent_test',
        user: decodeURIComponent(address.username) || 'postgres',
        // A callback also prevents pg from consulting PGPASSWORD or ~/.pgpass.
        password: async () => decodeURIComponent(address.password),
        ssl: false,
        options: '-c application_name=revv_customer_consent_test',
        connectionTimeoutMillis: 3000,
        statement_timeout: 5000,
      });
      await client.connect();
      t.after(() => client.end());
      // Everything, including the unique fixture schema, rolls back on failure.
      await client.query('BEGIN');
      try {
        const schema = `consent_${randomUUID().replaceAll('-', '')}`;
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`SET LOCAL search_path TO ${schema}`);
        await client.query(`CREATE TABLE shops (id ${idType} PRIMARY KEY)`);
        // UUID executes the fresh DDL verbatim. TEXT adapts only the ID types to
        // exercise the legacy layout; consent/default SQL remains source-derived.
        let ddl = idType === 'UUID' ? customerDDL : customerDDL.replace(/\bUUID\b/g, 'TEXT');
        if (scenario === 'legacy default TRUE') ddl = ddl.replace(/sms_consent BOOLEAN DEFAULT FALSE/, 'sms_consent BOOLEAN DEFAULT TRUE');
        if (scenario === 'missing column') ddl = ddl.replace(/^\s*sms_consent[^\n]*\n/m, '');
        await client.query(ddl);
        const id = label => idType === 'UUID' ? randomUUID() : `synthetic-${label}`;
        const shopId = id('shop');
        await client.query('INSERT INTO shops (id) VALUES ($1)', [shopId]);
        const insertDefault = async label => (await client.query(
          'INSERT INTO customers (id, shop_id, name) VALUES ($1, $2, $3) RETURNING *',
          [id(label), shopId, `Synthetic ${label}`],
        )).rows[0];
        const original = await insertDefault('original');
        if (scenario !== 'missing column') {
          assert.equal(original.sms_consent, scenario === 'legacy default TRUE');
          for (const value of [true, false, null]) {
            await client.query('INSERT INTO customers (id, shop_id, name, sms_consent) VALUES ($1, $2, $3, $4)',
              [id(String(value)), shopId, `Synthetic ${value}`, value]);
          }
        }
        const before = (await client.query('SELECT * FROM customers ORDER BY id')).rows;
        const expected = scenario === 'missing column' ? before.map(row => ({ ...row, sms_consent: null })) : before;
        for (let pass = 0; pass < 3; pass++) {
          for (const sql of consentStatements) await client.query(sql);
          // Whole rows, including timestamps, IDs and contact data, stay intact.
          const originals = (await client.query('SELECT * FROM customers WHERE id = ANY($1) ORDER BY id', [before.map(row => row.id)])).rows;
          assert.deepEqual(originals, expected);
          const defaults = await client.query(`SELECT column_default FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'customers' AND column_name = 'sms_consent'`, [schema]);
          assert.equal(defaults.rows[0].column_default, 'false');
          assert.equal((await insertDefault(`after-${pass}`)).sms_consent, false);
        }
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }
}
