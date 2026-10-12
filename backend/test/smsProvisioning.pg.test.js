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
    twilio_account_sid TEXT,twilio_auth_token TEXT,twilio_phone_number TEXT,sms_consent BOOLEAN)`);
  await migration.up(pool); await migration.up(pool);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO shops(id,plan) VALUES($1,'pro'),($2,'agency'),($3,'free')`, ids);
  const sid = (prefix, i) => prefix + String(i).repeat(32);
  const bindings = ids.map((shop_id, i) => ({ shop_id, account_sid: sid('AC', 1), service_sid: sid('MG', i + 1),
    campaign_sid: sid('QE', i + 1), event_campaign_sid: sid('CM', i + 1), event_callback_url: 'https://synthetic.invalid/api/sms/provisioning-events', brand_sid: sid('BN', i + 1), authorization_ref: 'synthetic-only', callback: 'https://synthetic.invalid/api/sms/webhook' }));
  for (const b of bindings) await pool.query(`INSERT INTO sms_provision_mapping
    (shop_id,account_sid,service_sid,campaign_sid,brand_sid,authorization_ref,event_campaign_sid,event_callback_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
  [b.shop_id,b.account_sid,b.service_sid,b.campaign_sid,b.brand_sid,b.authorization_ref,b.event_campaign_sid,b.event_callback_url]);
  const env = { APP_URL: 'https://synthetic.invalid', REVV_SMS_AUTOPROVISION: 'true', REVV_SMS_AUTOPROVISION_RUN_ID: 'synthetic-run-001', REVV_SMS_AUTOPROVISION_PURCHASE_CAP: '1' };
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
    j.binding = require('../src/services/smsProvisioningEvents').bindingOf(bindings[i], bindings[i].callback); j.intent_id = randomUUID(); j.candidate = `+1202555010${i}`; j.reason = 'PURCHASE_INTENT';
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
    const j = (await evidenceClient.query('SELECT *,xmin::text AS version FROM sms_provision_jobs WHERE shop_id=$1', [ids[2]])).rows[0];
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

for (const idType of ['TEXT', 'UUID']) test(`real PG ${idType}: signed receipt transactions, activation, revocation and recovery`, {
  skip: !url && 'Requires explicit disposable loopback SMS_PROVISION_TEST_DATABASE_URL; not a database pass',
}, async t => {
  const a = address(url);
  const { Pool } = require('pg');
  const { PgEventStore, bindingOf, registration } = require('../src/services/smsProvisioningEvents');
  const { createProvider } = require('../src/services/smsProvisioningProvider');
  const { request, appFor, fakeClient, event, env, mapping, callback, token, sid } = require('./smsProvisioning.events.test');
  const schema = `sms_events_${randomUUID().replaceAll('-', '')}`;
  const config = { host: a.hostname.replace(/^\[|\]$/g, ''), port: Number(a.port || 5432),
    database: 'revv_sms_provision_test', user: decodeURIComponent(a.username) || 'postgres',
    password: async () => decodeURIComponent(a.password), ssl: false, connectionTimeoutMillis: 3000,
    statement_timeout: 5000, max: 8, options: '-c application_name=revv_sms_provision_test' };
  const admin = new Pool(config);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ ...config, options: `${config.options} -c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  const oldUrl = process.env.APP_URL; process.env.APP_URL = env.APP_URL;
  t.after(() => { if (oldUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = oldUrl; });
  await pool.query(`CREATE TABLE shops(id ${idType} PRIMARY KEY,plan TEXT,sms_comp BOOLEAN,
    twilio_account_sid TEXT,twilio_auth_token TEXT,twilio_phone_number TEXT,sms_consent BOOLEAN)`);
  await migration.up(pool); await migration.up(pool);
  const m = { ...mapping, shop_id: randomUUID() };
  const other = { ...m, shop_id: randomUUID(), account_sid: sid('AC', 'b'), service_sid: sid('MG', 'b'),
    campaign_sid: sid('QE', 'b'), event_campaign_sid: sid('CM', 'b') };
  for (const b of [m, other]) {
    await pool.query(`INSERT INTO shops(id,plan,twilio_account_sid,twilio_auth_token,sms_consent)
      VALUES($1,'pro',$2,$3,TRUE)`, [b.shop_id,b.account_sid,b === m ? token : 'other-account-token']);
    await pool.query(`INSERT INTO sms_provision_mapping
      (shop_id,account_sid,service_sid,campaign_sid,brand_sid,authorization_ref,event_campaign_sid,event_callback_url)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [b.shop_id,b.account_sid,b.service_sid,b.campaign_sid,b.brand_sid,b.authorization_ref,b.event_campaign_sid,b.event_callback_url]);
  }
  const store = new PgStore(pool, env);
  await store.configure(); await store.discover();
  const app = appFor(new PgEventStore(pool, env));
  const count = async () => (await pool.query('SELECT count(*)::int n FROM sms_provision_receipts')).rows[0].n;
  const binding = bindingOf(m, callback);
  const status = (pn = sid('PN'), b = binding) => registration(pool, m.shop_id, pn, b);
  const row = async () => (await pool.query('SELECT * FROM shops WHERE id=$1', [m.shop_id])).rows[0];
  const job = async () => (await pool.query('SELECT * FROM sms_provision_jobs WHERE shop_id=$1', [m.shop_id])).rows[0];
  const receipt = (kind, time, id, b = m, pn = sid('PN')) => event(kind, time, id, b, pn);
  const successful = (time, id, b, pn) => receipt('number-registration.successful', time, id, b, pn);
  const ts = 1791800000000;

  await t.test('all six V2 contracts reject old/unknown version, missing or wrong MG, wrong CM and signed-body tamper without writes', async () => {
    const { corpus } = require('./fixtures/smsProvisioning.v2');
    for (const { kind } of corpus.events) {
      const good = receipt(kind, ts, `contract-${kind.replace('.', '-')}`);
      assert.equal(require('../src/services/smsProvisioningEvents').parseEvents(JSON.stringify([good]))[0].kind, kind);
      const invalids = [];
      for (const version of ['1', '3']) {
        const changed = structuredClone(good); changed.dataschema = changed.dataschema.replace('/2', `/${version}`);
        invalids.push(changed);
        if (version === '1') {
          const officialV1 = structuredClone(changed); delete officialV1.data.messagingservicesid;
          invalids.push(officialV1);
        }
      }
      for (const mg of [undefined, null, '', '*', sid('MG', 'c')]) {
        const changed = structuredClone(good); changed.data.messagingservicesid = mg; invalids.push(changed);
      }
      const wrongCampaign = structuredClone(good); wrongCampaign.data.campaignsid = sid('CM', 'c');
      invalids.push(wrongCampaign);
      for (const invalid of invalids) assert.equal((await request(app, [invalid])).status, 403, kind);
      const raw = JSON.stringify([good]);
      assert.equal((await request(app, [good], { raw: raw.replace('contract-', 'tampered-'),
        hash: require('twilio').getExpectedBodyHash(raw) })).status, 403, kind);
    }
    assert.equal(await count(), 0); assert.equal((await row()).twilio_phone_sid, null);
  });

  await t.test('unknown tenant/token/account, hash, signature and a mixed batch produce zero receipts', async () => {
    for (const options of [{ signature: 'bad' }, { token: 'api-secret' }, { hash: '0'.repeat(64) },
      { signBase: 'https://host-spoof.invalid' }]) assert.equal((await request(app, [successful(ts, 'invalid')], options)).status, 403);
    assert.equal((await request(app, [successful(ts, 'unknown', { ...m, service_sid: sid('MG', 'c') })])).status, 403);
    assert.equal((await request(app, [successful(ts, 'mixed-first'), successful(ts, 'mixed-other', other)])).status, 403);
    await pool.query('UPDATE shops SET twilio_auth_token=NULL WHERE id=$1', [m.shop_id]);
    assert.equal((await request(app, [successful(ts, 'no-token')])).status, 403);
    await pool.query('UPDATE shops SET twilio_auth_token=$2,twilio_account_sid=$3 WHERE id=$1', [m.shop_id,token,other.account_sid]);
    assert.equal((await request(app, [successful(ts, 'wrong-account')])).status, 403);
    await pool.query('UPDATE shops SET twilio_account_sid=$2 WHERE id=$1', [m.shop_id,m.account_sid]);
    await pool.query('UPDATE shops SET twilio_phone_sid=$2 WHERE id=$1', [other.shop_id,sid('PN')]);
    assert.equal((await request(app, [successful(ts, 'manual-other-tenant')])).status, 403);
    await pool.query('UPDATE shops SET twilio_phone_sid=NULL WHERE id=$1', [other.shop_id]);
    assert.equal(await count(), 0);
  });
  await t.test('campaignless negative cannot authorize an unknown PN or seed a batch binding', async () => {
    const missing = receipt('number-deregistration.successful', ts, 'unowned-negative');
    assert.equal((await request(app, [missing])).status, 403);
    assert.equal((await request(app, [successful(ts, 'uncommitted-binding'), missing])).status, 403);
    assert.equal(await count(), 0);
  });
  await t.test('receipt may precede purchase DB write; no raw phone/data/error is persisted', async () => {
    assert.equal((await job()).phone_sid, null);
    assert.equal((await request(app, [successful(ts, 'before-db-write')])).status, 204);
    assert.equal((await status()).status, 'REGISTERED');
    assert.equal((await status(sid('PN', 'b'))).status, 'UNAVAILABLE');
    assert.equal((await status(sid('PN'), { ...binding, event_campaign_sid: sid('CM', 'c') })).status, 'UNAVAILABLE');
    const rows = (await pool.query('SELECT * FROM sms_provision_receipts')).rows;
    assert.equal(JSON.stringify(rows).includes('+12025550100'), false);
    assert.equal(JSON.stringify(rows).includes('NEVER-PERSIST'), false);
  });
  await t.test('duplicates/concurrency are idempotent, old events cannot regress, conflicting IDs rollback whole batch', async () => {
    await Promise.all(Array.from({ length: 3 }, async () => assert.equal((await request(app, [successful(ts, 'before-db-write')])).status, 204)));
    assert.equal(await count(), 1);
    assert.equal((await request(app, [receipt('number-registration.pending', ts - 1, 'older')])).status, 204);
    assert.equal((await status()).status, 'REGISTERED');
    assert.equal((await request(app, [successful(ts + 2, 'rollback-first'), receipt('number-registration.failed', ts, 'before-db-write')])).status, 403);
    assert.equal(await count(), 2);
    assert.equal((await status()).status, 'REGISTERED');
    assert.equal((await request(app, [receipt('number-registration.pending', ts, 'equal-conflict')])).status, 204);
    assert.equal((await status()).status, 'FAILURE');
    assert.equal((await request(app, [successful(ts, 'before-db-write')])).status, 204);
    assert.equal((await status()).status, 'FAILURE');
    assert.equal((await request(app, [successful(ts + 10, 'newer-success')])).status, 204);
  });
  await t.test('campaignless negative resolves prior receipt before acquisition and retains exact campaign', async () => {
    assert.equal((await job()).phone_sid, null);
    const negative = receipt('number-deregistration.successful', ts + 10, 'prior-receipt-negative');
    assert.equal((await request(app, [negative])).status, 204);
    assert.equal((await status()).status, 'FAILURE'); // equal-time conflict is fail-closed
    const saved = (await pool.query('SELECT * FROM sms_provision_receipts WHERE event_id=$1', ['prior-receipt-negative'])).rows[0];
    assert.deepEqual(saved.binding, binding); assert.equal(saved.event_campaign_sid, m.event_campaign_sid);
    assert.equal((await row()).twilio_phone_sid, null);
  });
  const f = fakeClient(m);
  const provider = (id, b, context) => createProvider(id, b, { ...context, clientFactory: () => f.client });
  const run = async () => {
    await pool.query('UPDATE sms_provision_jobs SET next_at=now() WHERE shop_id=$1', [m.shop_id]);
    return store.claim(m.shop_id, (s, j) => processJob(s, j, { env, provider, callback: () => callback }));
  };
  await t.test('missing local event setup blocks all acquisition and cap consumption', async () => {
    for (const field of ['event_campaign_sid', 'event_callback_url']) {
      await pool.query(`UPDATE sms_provision_mapping SET ${field}=NULL WHERE shop_id=$1`, [m.shop_id]);
      await run(); assert.equal(f.purchases, 0);
      await pool.query(`UPDATE sms_provision_mapping SET ${field}=$2 WHERE shop_id=$1`, [m.shop_id,m[field]]);
    }
    await pool.query('UPDATE shops SET twilio_auth_token=NULL WHERE id=$1', [m.shop_id]);
    await run(); assert.equal(f.purchases, 0);
    assert.equal((await job()).reason, 'EVENT_SETUP_REQUIRED');
    assert.equal((await pool.query('SELECT consumed FROM sms_provision_control')).rows[0].consumed, 0);
    await pool.query('UPDATE shops SET twilio_auth_token=$2 WHERE id=$1', [m.shop_id,token]);
  });
  await t.test('failure before first automatic publication cannot clear an existing legacy sender', async () => {
    assert.equal((await job()).routing_published_at, null);
    await pool.query(`UPDATE shops SET twilio_phone_sid=$2,twilio_phone_number=$3,
      twilio_messaging_service_sid=$4,twilio_sender_mode='managed',twilio_sender_updated_at=now() WHERE id=$1`,
    [m.shop_id,sid('PN', 'e'),'+12025550188',m.service_sid]);
    const legacy = await row();
    f.campaignStatus = 'FAILED'; await run(); f.campaignStatus = 'VERIFIED';
    assert.equal((await job()).reason, 'CAMPAIGN_FAILED');
    assert.deepEqual(await row(), legacy); assert.equal(f.purchases, 0);
    await pool.query(`UPDATE shops SET twilio_phone_sid=NULL,twilio_phone_number=NULL,
      twilio_messaging_service_sid=NULL,twilio_sender_mode=NULL,twilio_sender_updated_at=NULL WHERE id=$1`, [m.shop_id]);
    await pool.query("UPDATE sms_provision_jobs SET state='pending',attempts=0 WHERE shop_id=$1", [m.shop_id]);
  });
  await t.test('production adapter recovers purchased inventory from durable intent and publishes only after signed receipt', async () => {
    // Simulate provider success followed by process death before DB acquisition write.
    const intent = randomUUID();
    await pool.query('UPDATE sms_provision_jobs SET next_at=now() WHERE shop_id=$1', [m.shop_id]);
    await store.claim(m.shop_id, async (s, j) => {
      j.binding = binding; j.intent_id = intent; j.candidate = f.number.phoneNumber; j.reason = 'PURCHASE_INTENT';
      await s.guard(j, () => s.reserve(j));
    });
    await f.client.incomingPhoneNumbers.create({ phoneNumber: f.number.phoneNumber, friendlyName: `REVV-AUTO:${intent}` });
    assert.equal((await request(app, [receipt('number-registration.pending', ts + 11, 'acquisition-pending')])).status, 204);
    const pending = await run(); assert.equal(pending.state, 'pending'); assert.equal(pending.reason, 'REGISTRATION_PENDING');
    // A pending callback after acquisition must not make the job terminal.
    assert.equal((await request(app, [receipt('number-registration.pending', ts + 11, 'acquired-still-pending')])).status, 204);
    assert.equal((await job()).state, 'pending'); assert.equal((await row()).twilio_phone_sid, null);
    assert.equal((await request(app, [successful(ts + 12, 'activation-success')])).status, 204);
    const active = await run(); assert.equal(active.state, 'active'); assert.equal(f.purchases, 1);
    assert.equal((await row()).twilio_phone_sid, sid('PN'));
    assert.equal((await job()).phone_sid, sid('PN')); assert.ok((await job()).routing_published_at);
    await run(); assert.equal(f.purchases, 1);
    assert.equal((await pool.query('SELECT consumed FROM sms_provision_control')).rows[0].consumed, 1);
  });
  await t.test('wrong tenant/PN cannot control another acquired number; unrelated PN cannot revoke active routing', async () => {
    assert.equal((await request(app, [successful(ts + 20, 'cross-tenant', other)], { token: 'other-account-token' })).status, 403);
    assert.equal((await request(app, [receipt('number-registration.failed', ts + 20, 'other-phone', m, sid('PN', 'b'))])).status, 204);
    assert.equal((await row()).twilio_phone_sid, sid('PN'));
  });
  await t.test('plain entitlement downgrade retains active routing and acquired history with admin attention', async () => {
    await pool.query("UPDATE shops SET plan='free' WHERE id=$1", [m.shop_id]);
    await store.discover(); await run();
    assert.equal((await job()).reason, 'INELIGIBLE');
    assert.equal((await row()).twilio_phone_sid, sid('PN'));
    assert.equal((await job()).phone_sid, sid('PN')); assert.equal((await job()).admin_attention, true);
    await pool.query("UPDATE shops SET plan='pro' WHERE id=$1", [m.shop_id]);
  });
  await t.test('equal-time conflict revokes automatic routing while keeping number, consent and history', async () => {
    assert.equal((await request(app, [receipt('number-deregistration.pending', ts + 12, 'revoke-conflict')])).status, 204);
    const shop = await row(); const j = await job();
    assert.equal(shop.twilio_phone_sid, null); assert.equal(shop.twilio_phone_number, null);
    assert.equal(shop.twilio_messaging_service_sid, null); assert.equal(shop.sms_consent, true);
    assert.equal(j.phone_sid, sid('PN')); assert.equal(j.phone_number, f.number.phoneNumber);
    assert.equal(j.admin_attention, true); assert.equal(j.reason, 'REGISTRATION_REVOKED');
    assert.ok((await pool.query("SELECT 1 FROM sms_provision_history WHERE shop_id=$1 AND event='REGISTRATION_REVOKED'", [m.shop_id])).rows.length);
    assert.equal((await request(app, [successful(ts + 12, 'activation-success')])).status, 204);
    assert.equal((await row()).twilio_phone_sid, null);
  });
  await t.test('each newer pending/failed/deregistration type revokes only the automatic sender', async () => {
    const kinds = ['number-registration.pending', 'number-registration.failed',
      'number-deregistration.successful', 'number-deregistration.pending', 'number-deregistration.failed'];
    for (let i = 0; i < kinds.length; i++) {
      await pool.query("UPDATE sms_provision_jobs SET state='pending' WHERE shop_id=$1", [m.shop_id]);
      assert.equal((await request(app, [successful(ts + 13 + i * 2, `cycle-success-${i}`)])).status, 204);
      await run(); assert.equal((await row()).twilio_phone_sid, sid('PN'));
      const negative = receipt(kinds[i], ts + 14 + i * 2, `cycle-negative-${i}`);
      const raw = JSON.stringify([negative]);
      assert.equal((await request(app, [negative], { raw: raw.replace('cycle-negative', 'tampered-negative'),
        hash: require('twilio').getExpectedBodyHash(raw) })).status, 403);
      assert.equal((await row()).twilio_phone_sid, sid('PN'));
      assert.equal((await request(app, [negative])).status, 204);
      assert.equal((await row()).twilio_phone_sid, null); assert.equal((await job()).phone_sid, sid('PN'));
      assert.equal((await row()).sms_consent, true); assert.equal(f.purchases, 1);
      const saved = (await pool.query('SELECT * FROM sms_provision_receipts WHERE event_id=$1', [negative.id])).rows[0];
      assert.equal(saved.kind, kinds[i]); assert.deepEqual(saved.binding, binding);
      assert.equal(saved.event_campaign_sid, m.event_campaign_sid);
      if (kinds[i] === 'number-deregistration.successful') assert.equal(Object.hasOwn(negative.data, 'campaignsid'), false);
      const beforeReplay = await count();
      assert.equal((await request(app, [negative])).status, 204);
      assert.equal(await count(), beforeReplay); assert.equal((await row()).twilio_phone_sid, null);
      // A stale successful receipt cannot revive routing after any of the five outcomes.
      assert.equal((await request(app, [successful(ts + 13 + i * 2, `cycle-success-${i}`)])).status, 204);
      assert.notEqual((await status()).status, 'REGISTERED');
      assert.equal((await row()).twilio_phone_sid, null);
    }
  });
  await t.test('campaignless negative rejects tamper, wrong account/service/PN, drift and ambiguous prior binding', async () => {
    const negative = receipt('number-deregistration.successful', ts + 24, 'negative-auth');
    const before = await count();
    for (const field of ['accountsid', 'messagingservicesid', 'phonenumbersid']) {
      const changed = structuredClone(negative); changed.data[field] = sid(changed.data[field].slice(0, 2), 'c');
      assert.equal((await request(app, [changed])).status, 403);
    }
    assert.equal((await request(app, [receipt('number-deregistration.successful', ts + 24, 'negative-other', other)],
      { token: 'other-account-token' })).status, 403);
    const raw = JSON.stringify([negative]);
    assert.equal((await request(app, [negative], { raw: raw.replace('negative-auth', 'tampered-auth'),
      hash: require('twilio').getExpectedBodyHash(raw) })).status, 403);
    await pool.query("UPDATE sms_provision_mapping SET authorization_ref='changed' WHERE shop_id=$1", [m.shop_id]);
    assert.equal((await request(app, [negative])).status, 403);
    await pool.query('UPDATE sms_provision_mapping SET authorization_ref=$2 WHERE shop_id=$1', [m.shop_id,m.authorization_ref]);
    await pool.query('UPDATE sms_provision_jobs SET binding=$2 WHERE shop_id=$1', [m.shop_id,{ ...binding, authorization_ref: 'other-history' }]);
    assert.equal((await request(app, [negative])).status, 403);
    await pool.query('UPDATE sms_provision_jobs SET binding=$2 WHERE shop_id=$1', [m.shop_id,binding]);
    assert.equal(await count(), before);
  });
  const reactivate = async (time, id) => {
    await pool.query("UPDATE sms_provision_jobs SET state='pending',attempts=0 WHERE shop_id=$1", [m.shop_id]);
    assert.equal((await request(app, [successful(time, id)])).status, 204);
    await run(); assert.equal((await job()).state, 'active');
    assert.equal((await row()).twilio_phone_sid, sid('PN'));
  };
  await t.test('processJob active to campaign FAILED, callback/config drift and transient failure withdraws routing only', async () => {
    for (const reason of ['CAMPAIGN_FAILED', 'CALLBACK_MISMATCH', 'CONFIG_DRIFT', 'PROVIDER_TRANSIENT', 'RETRIES_EXHAUSTED']) {
      await reactivate(ts + 24, `failure-setup-${reason}`);
      const before = await job();
      const fetch = f.service.fetch;
      if (reason === 'CAMPAIGN_FAILED') f.campaignStatus = 'FAILED';
      if (reason === 'CALLBACK_MISMATCH') f.service.fetch = async () => ({ ...await fetch(), inboundRequestUrl: 'https://drift.invalid' });
      if (reason === 'CONFIG_DRIFT') await pool.query("UPDATE sms_provision_mapping SET authorization_ref='drift' WHERE shop_id=$1", [m.shop_id]);
      if (['PROVIDER_TRANSIENT', 'RETRIES_EXHAUSTED'].includes(reason)) f.service.fetch = async () => { throw { status: 503 }; };
      if (reason === 'RETRIES_EXHAUSTED') await pool.query('UPDATE sms_provision_jobs SET attempts=4 WHERE shop_id=$1', [m.shop_id]);
      await run();
      const after = await job(); const shop = await row();
      assert.equal(after.reason, reason); assert.notEqual(after.state, 'active');
      assert.equal(shop.twilio_phone_sid, null); assert.equal(shop.twilio_phone_number, null);
      assert.equal(shop.twilio_messaging_service_sid, null); assert.equal(shop.twilio_sender_mode, null);
      assert.equal(shop.sms_consent, true); assert.equal(after.admin_attention, true);
      for (const key of ['phone_sid', 'phone_number', 'intent_id', 'candidate', 'run_id', 'binding', 'routing_published_at']) assert.deepEqual(after[key], before[key]);
      assert.ok((await pool.query('SELECT 1 FROM sms_provision_history WHERE shop_id=$1 AND event=$2', [m.shop_id,reason])).rows.length);
      assert.equal(f.purchases, 1);
      assert.equal((await pool.query('SELECT consumed FROM sms_provision_control')).rows[0].consumed, 1);
      f.campaignStatus = 'VERIFIED'; f.service.fetch = fetch;
      await pool.query('UPDATE sms_provision_mapping SET authorization_ref=$2 WHERE shop_id=$1', [m.shop_id,m.authorization_ref]);
    }
  });
  await t.test('stale worker cannot save or publish over a negative event or a newer publication', async () => {
    await reactivate(ts + 25, 'stale-setup');
    const c = await pool.connect();
    try {
      const session = store.session(c);
      const stale = await session.current(m.shop_id);
      assert.equal((await request(app, [receipt('number-deregistration.successful', ts + 26, 'stale-revoke')])).status, 204);
      const revoked = await job();
      stale.state = 'pending'; stale.reason = 'PROVIDER_TRANSIENT';
      await assert.rejects(session.save(stale), /STALE_JOB/);
      assert.deepEqual(await job(), revoked); assert.equal((await row()).twilio_phone_sid, null);
      const result = await processJob(session, stale, { env, provider: () => assert.fail('stale provider call'), callback: () => callback });
      assert.equal(result.reason, 'REGISTRATION_REVOKED');
      const beforePublish = await session.current(m.shop_id);
      await reactivate(ts + 27, 'fresh-publication');
      const fresh = await job(); const routed = await row();
      beforePublish.state = 'failed'; beforePublish.reason = 'CAMPAIGN_FAILED';
      await assert.rejects(session.save(beforePublish), /STALE_JOB/);
      await assert.rejects(session.guard(beforePublish, shop => session.publish(beforePublish, shop)), /STALE_JOB/);
      assert.deepEqual(await job(), fresh); assert.deepEqual(await row(), routed);
      // A negative arriving between a provider failure and its catch save wins too.
      const racing = await session.current(m.shop_id);
      const originalGuard = session.guard;
      let guards = 0;
      session.guard = async (...args) => {
        if (++guards === 2) {
          assert.equal((await request(app, [receipt('number-deregistration.successful', ts + 28, 'catch-race')])).status, 204);
          throw { reason: 'CAMPAIGN_FAILED' };
        }
        return originalGuard(...args);
      };
      const result2 = await processJob(session, racing, { env, provider, callback: () => callback });
      assert.equal(result2.reason, 'REGISTRATION_REVOKED'); assert.equal((await job()).reason, 'REGISTRATION_REVOKED');
    } finally { c.release(); }
  });
  await t.test('OFF and downgrade concurrent with config failure retain active custody and history', async () => {
    await reactivate(ts + 29, 'exceptions-setup');
    const before = await job(); const shop = await row();
    const c = await pool.connect();
    try {
      const offEnv = { ...env, REVV_SMS_AUTOPROVISION: 'false' };
      const offSession = new PgStore(pool, offEnv).session(c);
      const offJob = await store.session(c).current(m.shop_id);
      await processJob(offSession, offJob, { env: offEnv, provider: () => assert.fail('OFF provider') });
      assert.deepEqual(await job(), before); assert.deepEqual(await row(), shop);
      await pool.query("UPDATE shops SET plan='free' WHERE id=$1", [m.shop_id]);
      await pool.query("UPDATE sms_provision_mapping SET authorization_ref='drift' WHERE shop_id=$1", [m.shop_id]);
      await run(); assert.equal((await job()).reason, 'INELIGIBLE');
      assert.equal((await row()).twilio_phone_sid, sid('PN')); assert.equal((await job()).phone_sid, sid('PN'));
      await pool.query("UPDATE shops SET plan='pro' WHERE id=$1", [m.shop_id]);
      await pool.query('UPDATE sms_provision_mapping SET authorization_ref=$2 WHERE shop_id=$1', [m.shop_id,m.authorization_ref]);
    } finally { c.release(); }
  });
  await t.test('manual replacement including same PN with changed publication timestamp is retained', async () => {
    // Explicit synthetic operator retry; receiver never resets a failed job itself.
    await pool.query("UPDATE sms_provision_jobs SET state='pending' WHERE shop_id=$1", [m.shop_id]);
    assert.equal((await request(app, [successful(ts + 30, 'restore')])).status, 204);
    await run(); assert.equal((await row()).twilio_phone_sid, sid('PN'));
    await pool.query("UPDATE shops SET twilio_sender_updated_at=twilio_sender_updated_at+interval '1 second' WHERE id=$1", [m.shop_id]);
    await run(); assert.equal((await job()).reason, 'CONFIG_DRIFT');
    const manual = await row();
    for (const [i, { kind }] of require('./fixtures/smsProvisioning.v2').corpus.events.entries()) {
      assert.equal((await request(app, [receipt(kind, ts + 40 + i, `manual-same-number-${i}`)])).status, 204);
      assert.deepEqual(await row(), manual);
    }
    await pool.query('UPDATE shops SET twilio_phone_sid=$2,twilio_phone_number=$3 WHERE id=$1', [m.shop_id,sid('PN', 'd'),'+12025550199']);
    await pool.query("UPDATE sms_provision_jobs SET state='pending' WHERE shop_id=$1", [m.shop_id]);
    f.campaignStatus = 'FAILED'; await run(); f.campaignStatus = 'VERIFIED';
    assert.equal((await job()).reason, 'CAMPAIGN_FAILED');
    assert.equal((await request(app, [receipt('number-registration.failed', ts + 50, 'manual-other-number')])).status, 204);
    assert.equal((await row()).twilio_phone_sid, sid('PN', 'd'));
    assert.equal((await job()).phone_sid, sid('PN'));
  });
  await t.test('failed acquired jobs detect later downgrade; OFF and missing/new mappings have no sender authority', async () => {
    await pool.query("UPDATE shops SET plan='free' WHERE id=$1", [m.shop_id]);
    await pool.query('UPDATE sms_provision_jobs SET admin_attention=FALSE WHERE shop_id=$1', [m.shop_id]);
    await store.discover(); const j = await job();
    assert.equal(j.reason, 'INELIGIBLE'); assert.equal(j.admin_attention, true); assert.equal(j.phone_sid, sid('PN'));
    assert.equal((await row()).twilio_phone_sid, sid('PN', 'd'));
    const before = await count();
    const off = appFor(new PgEventStore(pool, { ...env, REVV_SMS_AUTOPROVISION: 'false' }), { ...env, REVV_SMS_AUTOPROVISION: 'false' });
    assert.equal((await request(off, [successful(ts + 60, 'off')])).status, 204); assert.equal(await count(), before);
    await pool.query('UPDATE sms_provision_mapping SET event_campaign_sid=NULL WHERE shop_id=$1', [m.shop_id]);
    assert.equal((await request(app, [successful(ts + 60, 'missing-map')])).status, 403);
    await pool.query('UPDATE sms_provision_mapping SET event_campaign_sid=$2 WHERE shop_id=$1', [m.shop_id,sid('CM', 'c')]);
    assert.equal((await request(app, [receipt('number-registration.failed', ts + 70, 'new-map', { ...m, event_campaign_sid: sid('CM', 'c') })])).status, 204);
    assert.equal((await row()).twilio_phone_sid, sid('PN', 'd'));
    assert.equal((await job()).reason, 'INELIGIBLE');
    const retained = (await pool.query('SELECT * FROM sms_provision_receipts ORDER BY event_id')).rows;
    await migration.down(pool); await migration.up(pool);
    assert.deepEqual((await pool.query('SELECT * FROM sms_provision_receipts ORDER BY event_id')).rows, retained);
    assert.equal((await request(app, [successful(ts + 80, 'paused')])).status, 503);
    assert.equal((await job()).phone_sid, sid('PN'));
    assert.ok(await count() > 0);
  });
});
