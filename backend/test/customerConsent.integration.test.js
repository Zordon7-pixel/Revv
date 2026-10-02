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
const customerDDL = schemaSource.match(/CREATE TABLE IF NOT EXISTS customers \([\s\S]*?\n\);/)?.[0];
const migration = require('../src/db/customerConsent');
const { hasConfirmedSmsConsent, consentMutation, normalizePreferredContactMethod } = require('../src/services/customerConsent');

for (const idType of ['UUID', 'TEXT']) {
  for (const scenario of ['fresh', 'legacy default TRUE', 'missing column']) {
    test(`customer consent DDL and repeated upgrade: ${idType}, ${scenario}`, {
      skip: !url && 'Set CUSTOMER_CONSENT_TEST_DATABASE_URL to an explicit local disposable database',
    }, async t => {
      const address = disposableAddress(url);
      assert.ok(customerDDL, 'Actual customers schema DDL must be found');
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
        if (scenario !== 'missing column') {
          for (const label of ['later-stop', 'later-opt-in']) {
            await client.query('INSERT INTO customers (id, shop_id, name, sms_consent) VALUES ($1,$2,$3,true)',
              [id(label), shopId, label]);
          }
        }
        // Existing provenance must survive the very first upgrade, not just reruns.
        await client.query(`ALTER TABLE customers ADD COLUMN sms_consent_at TIMESTAMPTZ,
          ADD COLUMN sms_consent_method TEXT, ADD COLUMN sms_consent_by TEXT`);
        if (scenario !== 'missing column') {
          const preserved = await insertDefault('preexisting-confirmation');
          await client.query(`UPDATE customers SET sms_consent=true, sms_consent_at=now(),
            sms_consent_method='verbal', sms_consent_by='original-staff' WHERE id=$1`, [preserved.id]);
          const before = (await client.query('SELECT * FROM customers WHERE id=$1', [preserved.id])).rows[0];
          await migration.up(client);
          const after = (await client.query('SELECT * FROM customers WHERE id=$1', [preserved.id])).rows[0];
          assert.deepEqual(after, { ...before, sms_consent_revision: '0' });
        }
        await migration.up(client);
        assert.equal((await client.query('SELECT * FROM customers WHERE id=$1', [original.id])).rows[0].sms_consent,
          scenario === 'missing column' ? null : false);
        const audit = (await client.query('SELECT * FROM customer_consent_resets')).rows;
        assert.equal(audit.length, scenario === 'missing column' ? 0 : scenario === 'legacy default TRUE' ? 4 : 3);
        for (const row of audit) {
          assert.equal(row.prior_consent, true);
          assert.equal(row.shop_id, shopId);
          assert.equal(row.prior_at, null);
          assert.ok(row.reset_at instanceof Date);
          assert.match(row.reason, /Legacy TRUE/);
        }
        const confirmed = await insertDefault('confirmed');
        await client.query(`UPDATE customers SET sms_consent=true, sms_consent_at=now(),
          sms_consent_method='written', sms_consent_by='staff-text-id' WHERE id=$1`, [confirmed.id]);
        const explicit = (await client.query('SELECT * FROM customers WHERE id=$1', [confirmed.id])).rows[0];
        assert.ok(hasConfirmedSmsConsent(explicit));
        for (let pass = 0; pass < 3; pass++) {
          await migration.up(client);
          assert.deepEqual((await client.query('SELECT * FROM customer_consent_resets')).rows, audit);
          assert.deepEqual((await client.query('SELECT * FROM customers WHERE id=$1', [confirmed.id])).rows[0], explicit);
          assert.equal((await insertDefault(`after-${pass}`)).sms_consent, false);
        }
        // A redundant STOP write must invalidate rollback even without changing false.
        if (audit.length > 1) await client.query('UPDATE customers SET sms_consent=false WHERE id=$1', [audit[0].customer_id]);
        if (audit.length > 1) await client.query(`UPDATE customers SET sms_consent=true,
          sms_consent_at=now(), sms_consent_method='verbal', sms_consent_by='later-staff' WHERE id=$1`, [audit[1].customer_id]);
        await migration.down(client);
        const rolled = (await client.query('SELECT * FROM customers ORDER BY id')).rows;
        for (const [i, row] of audit.entries()) {
          assert.equal(rolled.find(c => c.id === row.customer_id).sms_consent, !(audit.length > 1 && i === 0));
          assert.equal(hasConfirmedSmsConsent(rolled.find(c => c.id === row.customer_id)), i === 1);
        }
        assert.deepEqual(rolled.find(c => c.id === confirmed.id), explicit);
        await migration.down(client);
        await migration.up(client); // one-time reset stays consumed after rollback
        assert.deepEqual((await client.query('SELECT * FROM customers ORDER BY id')).rows, rolled);
        // Exercise real route SQL against this transaction; route transactions
        // use savepoints so fixture cleanup remains a single outer rollback.
        const mock = (file, exports) => {
          const key = require.resolve(file);
          require.cache[key] = { id: key, filename: key, loaded: true, exports };
        };
        mock('../src/db', {
          dbGet: async (sql, params) => (await client.query(sql, params)).rows[0],
          dbRun: (sql, params) => client.query(sql, params),
          dbAll: async (sql, params) => (await client.query(sql, params)).rows,
          pool: { connect: async () => ({ release() {}, query: (sql, params) => client.query(
            sql === 'BEGIN' ? 'SAVEPOINT route_write' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT route_write'
              : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT route_write' : sql, params) }) },
        });
        mock('../src/middleware/auth', (req, res, next) => next());
        mock('../src/middleware/roles', { requireTechnician: (req, res, next) => next() });
        mock('../src/services/customerOptInConfirmation', { sendCustomerOptInConfirmation: async () => ({ attempted: false }) });
        delete require.cache[require.resolve('../src/routes/customers')];
        const router = require('../src/routes/customers');
        async function call(method, path, body, customerId, tenant = shopId) {
          const handler = router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;
          const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
          await handler({ body, params: { id: customerId }, user: { id: 'authenticated-staff', shop_id: tenant } }, res);
          return res;
        }
        let response = await call('post', '/', { name: 'Reconfirmed', sms_consent: true });
        assert.equal(response.statusCode, 400);
        response = await call('post', '/', { name: 'Reconfirmed', sms_consent: true,
          sms_consent_method: 'written', sms_consent_by: 'spoof', sms_consent_at: '1900-01-01' });
        assert.equal(response.statusCode, 201);
        const created = response.body;
        assert.ok(hasConfirmedSmsConsent(created));
        assert.equal(created.sms_consent_by, 'authenticated-staff');
        assert.ok(created.sms_consent_at.getFullYear() > 2020);
        response = await call('put', '/:id', { address: 'Changed', sms_consent_at: '1900-01-01', sms_consent_by: 'spoof' }, created.id);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.body.sms_consent_at, created.sms_consent_at);
        assert.equal(response.body.sms_consent_by, created.sms_consent_by);
        assert.equal(response.body.sms_consent_revision, created.sms_consent_revision);
        response = await call('put', '/:id', { sms_consent: false, preferred_contact_method: 'sms' }, created.id);
        assert.equal(response.body.sms_consent, false);
        assert.equal(response.body.sms_consent_at, null);
        assert.equal(response.body.preferred_contact_method, 'none');
        response = await call('put', '/:id', { sms_consent: true, sms_consent_method: 'verbal' }, created.id);
        assert.ok(hasConfirmedSmsConsent(response.body));
        // Real phone mutation/audit SQL, in both TEXT/UUID and fresh/legacy schemas.
        const resetHistory = (await client.query('SELECT * FROM customer_consent_resets ORDER BY customer_id')).rows;
        await client.query(`CREATE TABLE sms_opt_outs (shop_id TEXT, phone TEXT)`);
        await client.query('INSERT INTO sms_opt_outs VALUES ($1,$2)', [shopId, '+15557654321']);
        response = await call('put', '/:id', { phone: '+15557654321', sms_consent: true,
          sms_consent_method: 'written', sms_consent_by: 'spoof', sms_consent_at: '1900-01-01' }, created.id);
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.sms_consent, false);
        assert.equal(response.body.sms_consent_at, null);
        assert.equal(response.body.sms_consent_by, null);
        assert.equal(response.body.sms_consent_method, null);
        const phoneAudit = (await client.query('SELECT * FROM customer_consent_phone_changes')).rows;
        assert.equal(phoneAudit.length, 1);
        assert.deepEqual({ ...phoneAudit[0], id: undefined, changed_at: undefined }, {
          id: undefined, changed_at: undefined, customer_id: created.id, shop_id: shopId,
          old_phone_masked: '***', new_phone_masked: '***4321', staff_id: 'authenticated-staff', reason: 'phone_changed',
        });
        assert.ok(phoneAudit[0].changed_at instanceof Date);
        assert.ok(phoneAudit[0].changed_at.getFullYear() >= 2026);
        const cleared = response.body;
        response = await call('put', '/:id', { phone: '(555) 765-4321' }, created.id);
        assert.equal(response.body.sms_consent_revision, cleared.sms_consent_revision);
        assert.equal(response.body.sms_consent, false);
        response = await call('put', '/:id', { sms_consent: true, sms_consent_method: 'verbal' }, created.id);
        assert.ok(hasConfirmedSmsConsent(response.body));
        const reconfirmed = response.body;
        response = await call('put', '/:id', { phone: '+1 (555) 765-4321' }, created.id);
        assert.equal(response.body.sms_consent_revision, reconfirmed.sms_consent_revision);
        assert.deepEqual(response.body.sms_consent_at, reconfirmed.sms_consent_at);
        await migration.up(client);
        await migration.down(client);
        assert.deepEqual((await client.query('SELECT * FROM customer_consent_phone_changes')).rows, phoneAudit);
        assert.deepEqual((await client.query('SELECT * FROM customer_consent_resets ORDER BY customer_id')).rows, resetHistory);
        assert.deepEqual((await client.query('SELECT * FROM sms_opt_outs')).rows, [{ shop_id: shopId, phone: '+15557654321' }]);
        const beforeFailure = (await client.query('SELECT * FROM customers WHERE id=$1', [created.id])).rows[0];
        await client.query(`CREATE FUNCTION fail_phone_audit() RETURNS trigger AS $$
          BEGIN RAISE EXCEPTION 'Injected audit failure'; END; $$ LANGUAGE plpgsql;
          CREATE TRIGGER fail_phone_audit BEFORE INSERT ON customer_consent_phone_changes
          FOR EACH ROW EXECUTE FUNCTION fail_phone_audit()`);
        response = await call('put', '/:id', { phone: '+15559876543' }, created.id);
        assert.equal(response.statusCode, 500);
        assert.deepEqual((await client.query('SELECT * FROM customers WHERE id=$1', [created.id])).rows[0], beforeFailure);
        assert.deepEqual((await client.query('SELECT * FROM customer_consent_phone_changes')).rows, phoneAudit);
        await client.query('DROP TRIGGER fail_phone_audit ON customer_consent_phone_changes');
        response = await call('put', '/:id', { sms_consent: false }, created.id, id('other-shop'));
        assert.equal(response.statusCode, 404);
        response = await call('post', '/', { name: 'Null consent', sms_consent: null, preferred_contact_method: 'sms' });
        assert.equal(response.body.sms_consent, false);
        assert.equal(response.body.preferred_contact_method, 'none');

      } finally {
        await client.query('ROLLBACK');
      }
    });
  }
}

test('shared eligibility fails closed and staff provenance is server owned', () => {
  const good = consentMutation({ sms_consent: true, sms_consent_method: 'verbal',
    sms_consent_at: '1900-01-01', sms_consent_by: 'attacker' }, 'staff');
  assert.ok(hasConfirmedSmsConsent(good));
  assert.equal(good.sms_consent_by, 'staff');
  assert.ok(good.sms_consent_at.getFullYear() > 2020);
  for (const patch of [{ sms_consent: null }, { sms_consent: 'true' }, { sms_consent_at: null },
    { sms_consent_at: 'bad' }, { sms_consent_at: '2026-02-30T00:00:00Z' }, { sms_consent_at: Infinity }, { sms_consent_method: 'import' },
    { sms_consent_by: ' ' }, { sms_consent_by: null }]) assert.equal(hasConfirmedSmsConsent({ ...good, ...patch }), false);
  assert.throws(() => consentMutation({ sms_consent: true }, 'staff'), /verbal or written/);
  assert.throws(() => consentMutation({ sms_consent: true, sms_consent_method: 'verbal' }, null), /staff/);
  assert.equal(consentMutation({ sms_consent: null }, 'staff'), null);
  assert.equal(hasConfirmedSmsConsent(consentMutation({ sms_consent: false }, 'staff')), false);
  assert.equal(normalizePreferredContactMethod('sms', false, false), 'none');
  assert.equal(normalizePreferredContactMethod('both', null, true), 'email');
});
