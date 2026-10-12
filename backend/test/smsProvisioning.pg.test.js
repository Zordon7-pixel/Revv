'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PgStore, processJob } = require('../src/services/smsProvisioningQueue');
const migration = require('../src/db/smsProvisioning');
const url = process.env.SMS_PROVISION_TEST_DATABASE_URL;
function address(value) {
  const a = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(a.protocol));
  // Literal loopback only: no DNS or Unix socket escape.
  assert.ok(['127.0.0.1', '[::1]'].includes(a.hostname));
  assert.equal(a.pathname, '/revv_sms_provision_test');
  assert.equal(a.search, ''); assert.equal(a.hash, '');
  return a;
}
test('DB guard rejects real/nonloopback/override databases before loading pg', () => {
  for (const v of ['postgres://remote/revv_sms_provision_test', 'postgres://127.0.0.1/production',
    'postgres://127.0.0.1/revv_sms_provision_test?host=remote', 'https://127.0.0.1/revv_sms_provision_test']) assert.throws(() => address(v));
  assert.equal(address('postgres://127.0.0.1/revv_sms_provision_test').hostname, '127.0.0.1');
});
for (const idType of ['TEXT', 'UUID']) test(`real PG ${idType}: migration, restart, locks, budget, recovery, rollback`, {
  skip: !url && 'Requires explicit disposable loopback SMS_PROVISION_TEST_DATABASE_URL; not a database pass',
}, async t => {
  const a = address(url);
  // Do not import app/db, dotenv, startup, seeds or any provider SDK.
  const { Pool } = require('pg');
  const schema = `sms_auto_${randomUUID().replaceAll('-', '')}`;
  const config = { host: a.hostname.replace(/^\[|\]$/g, ''), port: Number(a.port || 5432),
    database: 'revv_sms_provision_test', user: decodeURIComponent(a.username) || 'postgres',
    password: async () => decodeURIComponent(a.password), ssl: false,
    connectionTimeoutMillis: 3000, statement_timeout: 5000, max: 8,
    options: '-c application_name=revv_sms_provision_test' };
  const admin = new Pool(config);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ ...config, options: `${config.options} -c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  await pool.query(`CREATE TABLE shops(id ${idType} PRIMARY KEY,plan TEXT,sms_comp BOOLEAN,
    twilio_account_sid TEXT,twilio_phone_number TEXT)`);
  await migration.up(pool); await migration.up(pool);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO shops(id,plan) VALUES($1,'pro'),($2,'agency'),($3,'free')`, ids);
  const sid = (prefix, i) => prefix + String(i).repeat(32);
  const bindings = ids.map((shop_id, i) => ({ shop_id, account_sid: sid('AC', 1), service_sid: sid('MG', i + 1),
    campaign_sid: sid('QE', i + 1), brand_sid: sid('BN', i + 1), authorization_ref: 'synthetic-only', callback: 'https://synthetic.invalid/api/sms/webhook' }));
  for (const b of bindings) await pool.query(`INSERT INTO sms_provision_mapping
    (shop_id,account_sid,service_sid,campaign_sid,brand_sid,authorization_ref) VALUES($1,$2,$3,$4,$5,$6)`,
  [b.shop_id,b.account_sid,b.service_sid,b.campaign_sid,b.brand_sid,b.authorization_ref]);
  const env = { REVV_SMS_AUTOPROVISION: 'true', REVV_SMS_AUTOPROVISION_RUN_ID: 'synthetic-run-001', REVV_SMS_AUTOPROVISION_PURCHASE_CAP: '1' };
  const oldUrl = process.env.APP_URL; process.env.APP_URL = 'https://synthetic.invalid';
  t.after(() => { if (oldUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = oldUrl; });
  const store = new PgStore(pool, env);
  await store.configure(); await store.discover(); await store.discover();
  assert.equal((await pool.query('SELECT count(*)::int n FROM sms_provision_jobs')).rows[0].n, 2);
  await pool.query('UPDATE shops SET sms_comp=TRUE WHERE id=$1', [ids[2]]);
  await store.discover(); assert.equal((await store.due()).length, 3);

  // A concurrent claimant never enters; terminating a session releases ownership.
  let entered; const entry = new Promise(r => { entered = r; }); let release;
  const held = store.claim(ids[0], async () => { entered(); await new Promise(r => { release = r; }); });
  await entry;
  await store.claim(ids[0], () => assert.fail('overlapping worker'));
  release(); await held;
  let recovered = false;
  await new PgStore(pool, env).claim(ids[0], async () => { recovered = true; });
  assert.equal(recovered, true);

  // Cross-shop transactions atomically reserve one shared persisted cap.
  const reserve = (storeInstance, i) => storeInstance.claim(ids[i], async (s, j) => {
    j.binding = bindings[i]; j.intent_id = randomUUID(); j.candidate = `+1202555010${i}`; j.reason = 'PURCHASE_INTENT';
    return s.guard(j, () => s.reserve(j));
  });
  const results = await Promise.allSettled([reserve(store, 0), reserve(new PgStore(pool, env), 1)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.reason, 'CAP_DEFERRED');
  assert.equal((await pool.query('SELECT consumed FROM sms_provision_control')).rows[0].consumed, 1);
  await new PgStore(pool, env).configure();
  await assert.rejects(new PgStore(pool, { ...env, REVV_SMS_AUTOPROVISION_RUN_ID: 'different-run-002' }).configure(), /RUN_CONFIG/);
  const intent = (await pool.query('SELECT * FROM sms_provision_jobs WHERE intent_id IS NOT NULL')).rows[0];
  assert.ok(intent.candidate); assert.equal(intent.run_id, env.REVV_SMS_AUTOPROVISION_RUN_ID);

  // Real row locks serialize subscription/admin entitlement updates with an effect.
  const writer = await pool.connect();
  try {
    await store.claim(intent.shop_id, async (s, j) => s.guard(j, async () => {
      await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout='50ms'");
      await assert.rejects(writer.query("UPDATE shops SET plan='free' WHERE id=$1", [j.shop_id]), e => e.code === '55P03');
      await writer.query('ROLLBACK');
    }));
  } finally { writer.release(); }

  // Restart sees uncertain intent, exact inventory absence is terminal; no create.
  let purchases = 0;
  await store.claim(intent.shop_id, (s, j) => processJob(s, j, { env, callback: () => bindings[0].callback,
    provider: async () => ({ prerequisite: async () => {}, inventory: async () => { throw { reason: 'PURCHASE_UNCERTAIN' }; }, purchase: async () => purchases++ }) }));
  assert.equal(purchases, 0);
  assert.equal((await pool.query('SELECT state FROM sms_provision_jobs WHERE shop_id=$1', [intent.shop_id])).rows[0].state, 'failed');
  assert.ok((await pool.query('SELECT count(*)::int n FROM sms_provision_history')).rows[0].n > 0);
  const alerts = [];
  await Promise.all(Array.from({ length: 5 }, () => new PgStore(pool, env).alert('PURCHASE_UNCERTAIN', intent.shop_id, async (...args) => alerts.push(args))));
  assert.equal(alerts.length, 1);
  await new PgStore(pool, env).alert('PURCHASE_UNCERTAIN', intent.shop_id, async () => assert.fail('restart alert storm'));

  // OFF including queued jobs does not claim, discover or configure.
  const off = new PgStore(pool, { ...env, REVV_SMS_AUTOPROVISION: 'false' });
  await off.configure(); await off.discover(); await off.claim(ids[1], () => assert.fail('OFF claim'));
  // Persisted backoff survives a new store/worker; no early claim.
  await pool.query("UPDATE sms_provision_jobs SET next_at=now()+interval '1 hour' WHERE shop_id=$1", [ids[2]]);
  await new PgStore(pool, env).claim(ids[2], () => assert.fail('ignored persisted backoff'));
  assert.ok(!(await new PgStore(pool, env).due()).some(j => j.shop_id === ids[2]));
  // Retained acquisition and existing sender are preserved by down/up, too.
  await pool.query("UPDATE shops SET twilio_phone_number='+12025550199' WHERE id=$1", [ids[2]]);
  const evidenceClient = await pool.connect();
  try {
    const j = (await evidenceClient.query('SELECT * FROM sms_provision_jobs WHERE shop_id=$1', [ids[2]])).rows[0];
    j.phone_sid = sid('PN', 9); j.phone_number = '+12025550199'; j.reason = 'ACQUIRED';
    await store.session(evidenceClient).save(j);
  } finally { evidenceClient.release(); }
  const before = (await pool.query('SELECT * FROM sms_provision_jobs ORDER BY shop_id')).rows;
  const history = (await pool.query('SELECT * FROM sms_provision_history ORDER BY id')).rows;
  await migration.down(pool); await migration.up(pool);
  assert.equal((await pool.query('SELECT enabled FROM sms_provision_control')).rows[0].enabled, false);
  const after = (await pool.query('SELECT * FROM sms_provision_jobs ORDER BY shop_id')).rows;
  assert.deepEqual(after.map(j => [j.shop_id,j.intent_id,j.candidate,j.phone_sid]), before.map(j => [j.shop_id,j.intent_id,j.candidate,j.phone_sid]));
  assert.deepEqual((await pool.query('SELECT * FROM sms_provision_history ORDER BY id')).rows, history);
  assert.equal((await pool.query('SELECT count(*)::int n FROM shops')).rows[0].n, 3);
  assert.equal((await pool.query('SELECT twilio_phone_number FROM shops WHERE id=$1', [ids[2]])).rows[0].twilio_phone_number, '+12025550199');
});
