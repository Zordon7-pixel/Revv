'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const { webhooks } = require('stripe'); // Offline signing/verification only; no SDK client.
const roles = require('../src/middleware/roles');
const migration = require('../src/db/paymentReservations');
const TEST_DATABASE = 'postgresql://revv_panel@127.0.0.1:55459/revv_panel_test';
const env = { JWT_SECRET: 'synthetic-late-success-jwt', STRIPE_SECRET_KEY: 'sk_test_synthetic',
  STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_late_success' };
const config = { host: '127.0.0.1', port: 55459, user: 'revv_panel', database: 'revv_panel_test',
  password: async () => '', ssl: false, connectionTimeoutMillis: 2000, statement_timeout: 7000 };

// Explicit module boundary: no app startup, dotenv, production DB or real provider
// client. Actual route/auth/Stripe signature wrapper/service/SQL are exercised.
function load(file, mocks) {
  const filename = path.resolve(__dirname, '../src', file), module = { exports: {} };
  const local = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports,process){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express', 'uuid', 'node:crypto', 'jsonwebtoken'].includes(name)) return local(name);
    throw Error(`Unmocked dependency ${name}`);
  }, module, module.exports, { env });
  return module.exports;
}

async function fixture(t, type) {
  assert.equal(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL, TEST_DATABASE, 'Dedicated loopback DB only');
  const admin = new Pool(config), schema = `late_success_${randomUUID().replaceAll('-', '')}`;
  let pool, server, created = false, providerCalls = 0, externalCalls = 0, service;
  const objects = new Map(), queries = [];
  const shop = type === 'TEXT' ? 'shop-local' : randomUUID();
  const other = type === 'TEXT' ? 'shop-foreign' : randomUUID();
  const users = [];
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await admin.query(`CREATE SCHEMA ${schema}`); created = true;
  const newPool = () => new Pool({ ...config, options: `-c search_path=${schema}`, max: 12 });
  pool = newPool();
  await pool.query(`CREATE TABLE shops(id ${type} PRIMARY KEY, tax_rate NUMERIC DEFAULT 0);
    CREATE TABLE users(id ${type} PRIMARY KEY, shop_id ${type}, role TEXT, revoke_all_before TIMESTAMPTZ);
    CREATE TABLE repair_orders(id ${type} PRIMARY KEY, shop_id ${type}, ro_number TEXT DEFAULT 'SYNTHETIC',
      payment_status TEXT DEFAULT 'unpaid', payment_received INTEGER DEFAULT 0, stripe_payment_intent_id TEXT,
      payment_received_at TEXT, payment_method TEXT, paid_at TEXT, paid_amount INTEGER, updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE estimate_line_items(id TEXT PRIMARY KEY, shop_id ${type}, ro_id ${type}, type TEXT, total NUMERIC, taxable BOOLEAN DEFAULT FALSE);
    CREATE TABLE revoked_tokens(id TEXT, token_jti TEXT)`);
  // Reuse the app's existing notification schema, covering both startup TEXT and
  // schema.pg.sql UUID variants rather than introducing a payment-specific table.
  const schemaSource = fs.readFileSync(path.resolve(__dirname,
    type === 'TEXT' ? '../src/db/index.js' : '../src/db/schema.pg.sql'), 'utf8');
  const notificationDDL = schemaSource.match(/CREATE TABLE IF NOT EXISTS notifications \([\s\S]*?\n\s*\)/)[0];
  await pool.query(notificationDDL);
  // Existing migrated installs also have message, used by shared createNotification.
  if (type === 'UUID') await pool.query('ALTER TABLE notifications ADD COLUMN message TEXT');
  await Promise.all([migration.up(pool), migration.up(pool)]);
  await pool.query('INSERT INTO shops(id) VALUES ($1),($2)', [shop, other]);
  for (const tenant of [shop, other]) {
    for (const role of ['owner', 'owner', 'admin', 'admin', 'assistant', 'superadmin', 'technician', 'employee', 'staff', 'customer', 'unknown']) {
      const id = type === 'TEXT' ? `${tenant}-${role}-${users.length}` : randomUUID();
      await pool.query('INSERT INTO users(id,shop_id,role) VALUES ($1,$2,$3)', [id, tenant, role]);
      users.push({ id, shop_id: tenant, role });
    }
  }
  const forbidden = () => { externalCalls++; throw Error('Unexpected external/ordinary notification call'); };
  const provider = {
    webhooks,
    paymentIntents: {
      retrieve: async id => { providerCalls++; assert.ok(objects.has(id)); return { ...objects.get(id) }; },
      cancel: async id => { providerCalls++; const o = objects.get(id); assert.ok(o); o.status = 'canceled'; return { ...o }; },
      create: forbidden,
    },
    checkout: { sessions: {
      retrieve: async id => { providerCalls++; assert.ok(objects.has(id)); return { ...objects.get(id) }; },
      expire: async id => { providerCalls++; const o = objects.get(id); assert.ok(o); o.status = 'expired'; return { ...o }; },
      create: forbidden,
    } },
  };
  const db = {
    pool: { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, args) => {
        queries.push(sql); assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/, 'No request-time DDL');
        return client.query(sql, args);
      } };
    } },
    dbGet: async (sql, args) => (await pool.query(sql, args)).rows[0],
    dbAll: async (sql, args) => (await pool.query(sql, args)).rows,
    dbRun: (sql, args) => pool.query(sql, args),
  };
  let sharedNotifications;
  function mount() {
    const stripe = load('services/stripe.js', { stripe: function SyntheticStripe() { return provider; } });
    sharedNotifications = load('services/notifications.js', { '../db': db });
    const money = load('services/roMoney.js', { '../db': db });
    service = load('services/paymentReservations.js', { '../db': db, './roMoney': money,
      './stripe': stripe, './notifications': sharedNotifications });
    const auth = load('middleware/auth.js', { '../db': db });
    const payments = load('routes/payments.js', { '../db': db, '../middleware/auth': auth, '../middleware/roles': roles,
      '../services/stripe': stripe, '../services/paymentReservations': service, '../services/roMoney': money,
      '../services/notifications': { createNotification: forbidden }, '../services/mailer': { sendMail: forbidden },
      '../services/emailTemplates': { paymentConfirmationEmail: forbidden },
      '../services/customerBilling': { createPaymentCheckoutLinkForRo: forbidden, sendClosedPaidInvoiceEmail: forbidden } });
    const notifications = load('routes/notifications.js', { '../db': db, '../middleware/auth': auth, '../middleware/roles': roles });
    const app = express();
    app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
    app.use(express.json()); app.use('/api/payments', payments); app.use('/api/notifications', notifications);
    server = app.listen(0, '127.0.0.1');
    return once(server, 'listening');
  }
  await mount();
  const request = async (url, { method = 'GET', body, user = users[0], signature } = {}) => {
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${jwt.sign(user, env.JWT_SECRET, { expiresIn: '1h' })}` };
    if (signature !== undefined) headers['stripe-signature'] = signature;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers, body });
    return { status: response.status, body: await response.json() };
  };
  const send = (event, signature) => {
    const body = JSON.stringify(event);
    return request('/api/payments/webhook', { method: 'POST', body,
      signature: signature === undefined ? webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET }) : signature });
  };
  const make = async (kind = 'intent', { tenant = shop, bindIntent = true, failedLedger = false } = {}) => {
    const roId = type === 'TEXT' ? `ro-${randomUUID()}` : randomUUID();
    await pool.query('INSERT INTO repair_orders(id,shop_id) VALUES ($1,$2)', [roId, tenant]);
    await pool.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type,total) VALUES ($1,$2,$3,'labor',100)", [randomUUID(), tenant, roId]);
    const attempt = await service.reservePayment({ roId, shopId: tenant, kind });
    const metadata = service.metadataFor(attempt), intentId = `pi_${randomUUID()}`, sessionId = `cs_${randomUUID()}`;
    const intent = { id: intentId, amount: 10000, amount_received: 10000, currency: 'usd', status: 'requires_payment_method', metadata };
    const session = { id: sessionId, amount_total: 10000, currency: 'usd', status: 'open', payment_status: 'unpaid',
      payment_intent: bindIntent ? intentId : null, metadata };
    objects.set(intentId, intent); objects.set(sessionId, session);
    await service.recordProviderResult(attempt, kind === 'intent' ? intent : session);
    if (failedLedger) await pool.query(`INSERT INTO ro_payments(id,shop_id,ro_id,stripe_payment_intent_id,amount_cents,status)
      VALUES ($1,$2,$3,$4,10000,'failed')`, [randomUUID(), tenant, roId, intentId]);
    assert.equal((await request(`/api/payments/reconcile/${roId}`, { method: 'POST', body: '{}', user: users.find(u => u.shop_id === tenant && u.role === 'owner') })).status, 200);
    assert.equal((await pool.query('SELECT status FROM ro_payment_attempts WHERE id=$1', [attempt.id])).rows[0].status, 'released');
    return { roId, attempt, intentId, sessionId,
      intentEvent: { id: 'evt_intent', type: 'payment_intent.succeeded', data: { object: { ...intent, status: 'succeeded' } } },
      checkoutEvent: { id: 'evt_checkout', type: 'checkout.session.completed', data: { object: { ...session, status: 'complete', payment_status: 'paid', payment_intent: intentId } } } };
  };
  const rows = async table => (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  const facts = async () => Object.fromEntries(await Promise.all(
    ['shops', 'users', 'repair_orders', 'estimate_line_items', 'ro_payment_attempts', 'ro_payment_attempt_audit', 'ro_payments'].map(async table => [table, await rows(table)])));
  const counts = async () => [(await rows('ro_payment_investigations')).length, (await rows('notifications')).length];
  const balance = roId => service.withLockedRo(roId, shop, (client, ro) => service.getPaymentBalance(client, ro));
  const restart = async () => {
    await new Promise(resolve => server.close(resolve)); server = null;
    await pool.end(); pool = newPool(); await mount();
  };
  return { shop, other, users, make, send, request, rows, facts, counts, balance, restart, queries,
    get pool() { return pool; }, get service() { return service; }, get sharedNotifications() { return sharedNotifications; },
    calls: () => ({ providerCalls, externalCalls }) };
}

function refused(response) {
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Payment webhook could not be processed' });
}

test('offline registered webhook signature gate rejects forged/tampered bodies before the settlement service', async () => {
  const stripe = load('services/stripe.js', { stripe: function SyntheticStripe() { return { webhooks }; } });
  let calls = 0;
  const forbidden = () => assert.fail('Unexpected notification or external delivery');
  const router = load('routes/payments.js', { '../db': {}, '../middleware/auth': forbidden, '../middleware/roles': roles,
    '../services/stripe': stripe, '../services/paymentReservations': { settlePaymentEvent: async () => { calls++; return null; } },
    '../services/notifications': { createNotification: forbidden }, '../services/mailer': { sendMail: forbidden },
    '../services/emailTemplates': {}, '../services/customerBilling': {},
    '../services/roMoney': load('services/roMoney.js', { '../db': { pool: { query: forbidden }, dbGet: forbidden } }) });
  const handler = router.stack.find(l => l.route?.path === '/webhook').route.stack[0].handle;
  const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_synthetic' } } });
  const signature = webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET });
  const invoke = async (payload, sig) => {
    const response = { status: 200, statusCode: 200, json(value) { this.body = value; return this; } };
    response.status = function (code) { this.statusCode = code; return this; };
    await handler({ body: Buffer.from(payload), headers: { 'stripe-signature': sig } }, response);
    return { status: response.statusCode, body: response.body };
  };
  refused(await invoke(body, 'forged'));
  refused(await invoke(body.replace('pi_synthetic', 'pi_tampered'), signature));
  assert.equal((await invoke(body, undefined)).status, 400); assert.equal(calls, 0);
  assert.equal((await invoke(body, signature)).status, 200); assert.equal(calls, 1);
});

for (const type of ['TEXT', 'UUID']) {
  for (const kind of ['intent', 'checkout']) test(`${type}/${kind}: released success persists once across concurrent representations, restart and role-scoped API`, { timeout: 60000 }, async t => {
    const f = await fixture(t, type), a = await f.make(kind, { failedLedger: true });
    // A new attempt has already consumed some released capacity; late success
    // must not settle the old attempt, change the failed ledger or consume capacity.
    await f.service.reservePayment({ roId: a.roId, shopId: f.shop, kind: 'intent', amount: 2000, allowPartial: true });
    const before = await f.facts(), balance = await f.balance(a.roId), calls = f.calls();
    const events = Array.from({ length: 12 }, (_, i) => {
      const event = structuredClone(kind === 'checkout' && i % 2 ? a.checkoutEvent : a.intentEvent);
      if (kind === 'checkout' && i % 3 === 0 && i % 2) event.type = 'checkout.session.async_payment_succeeded';
      if (i % 4 === 0) delete event.data.object.metadata.paymentAttemptId; // Exact provider lookup.
      event.id = `evt_${i % 3}`; return event;
    });
    (await Promise.all(events.map(e => f.send(e)))).forEach(refused);
    assert.deepEqual(await f.counts(), [1, 4]);
    assert.deepEqual(await f.facts(), before); assert.deepEqual(await f.balance(a.roId), balance);
    assert.deepEqual(f.calls(), calls); assert.equal(calls.externalCalls, 0);
    const investigations = await f.rows('ro_payment_investigations'), notifications = await f.rows('notifications');
    assert.equal(investigations[0].attempt_id, a.attempt.id); assert.equal(investigations[0].shop_id, f.shop);
    for (const n of notifications) {
      assert.equal(n.ro_id, a.roId); assert.equal(n.shop_id, f.shop); assert.ok(n.user_id);
      assert.equal(n.type, 'payment_investigation'); assert.equal(n.read, false);
      assert.match(n.body, /verify payment records/);
      assert.doesNotMatch(JSON.stringify(n), /pi_|cs_|evt_|client_secret|PRIVATE/);
    }
    assert.deepEqual(new Set(notifications.map(n => n.user_id)), new Set(f.users.filter(u => u.shop_id === f.shop && ['owner', 'admin'].includes(u.role)).map(u => u.id)));
    // Actual existing API SQL and real JWT middleware, including no broadcast to
    // higher-rank superadmin/assistant, customers or another shop's owners/admins.
    for (const user of f.users) {
      const response = await f.request('/api/notifications', { user });
      if (['customer', 'unknown'].includes(user.role)) { assert.equal(response.status, 403); continue; }
      assert.equal(response.status, 200);
      const allowed = user.shop_id === f.shop && ['owner', 'admin'].includes(user.role);
      assert.equal(response.body.notifications.length, allowed ? 1 : 0, JSON.stringify(user));
      if (allowed) assert.equal(response.body.notifications[0].ro_id, a.roId); // NotificationBell links /ros/:ro_id.
    }
    const alert = notifications[0], otherUser = f.users.find(u => u.shop_id === f.other && u.role === 'owner');
    for (const user of [otherUser, f.users.find(u => u.role === 'technician')]) {
      assert.equal((await f.request(`/api/notifications/${alert.id}/read`, { method: 'PATCH', user })).status, 200);
      assert.deepEqual(await f.rows('notifications'), notifications);
    }
    await f.restart();
    refused(await f.send(kind === 'intent' ? a.intentEvent : a.checkoutEvent));
    assert.deepEqual(await f.rows('ro_payment_investigations'), investigations);
    assert.deepEqual(await f.rows('notifications'), notifications); assert.deepEqual(await f.facts(), before);
    await migration.up(f.pool);
    assert.deepEqual(await f.rows('ro_payment_investigations'), investigations);
    assert.deepEqual(await f.facts(), before);
    await assert.rejects(f.pool.query('UPDATE ro_payment_investigations SET event_type=event_type'), /RO_HISTORY_PROTECTED/);
    const owner = f.users.find(u => u.id === alert.user_id);
    assert.equal((await f.request('/api/notifications/read-all', { method: 'PATCH', user: owner })).status, 200);
    refused(await f.send(a.intentEvent)); // A read alert must not be recreated.
    assert.deepEqual(await f.counts(), [1, 4]);
    assert.equal((await f.request('/api/notifications', { user: owner })).body.notifications.length, 0);
    assert.equal((await f.rows('notifications')).filter(n => n.read).length, 1);
    // Existing shared helper keeps its original message/body and read behavior.
    if (type === 'UUID') {
      const id = await f.sharedNotifications.createNotification(f.shop, owner.id, 'payment', 'Ordinary payment', 'Ordinary body', a.roId);
      const n = (await f.rows('notifications')).find(n => n.id === id);
      assert.equal(n.message, 'Ordinary body'); assert.equal(n.body, 'Ordinary body');
      assert.equal((await f.request('/api/notifications', { user: owner })).body.notifications[0].id, id);
    }
  });

  test(`${type}: forged, wrong tenant/RO/attempt/provider/kind/currency/amount and unbound identity create nothing`, { timeout: 60000 }, async t => {
    const f = await fixture(t, type), a = await f.make('checkout'), b = await f.make('intent', { tenant: f.other });
    const c = await f.make('checkout', { bindIntent: false }), d = await f.make('intent');
    const before = await f.facts(), calls = f.calls();
    const bad = (base, object = {}, metadata = {}) => {
      const event = structuredClone(base); Object.assign(event.data.object, object);
      Object.assign(event.data.object.metadata, metadata); return event;
    };
    const cases = [
      bad(a.intentEvent, { id: b.intentId }), bad(a.intentEvent, { id: 'pi_unknown' }),
      bad(a.intentEvent, {}, { shopId: f.other }), bad(a.intentEvent, {}, { roId: b.roId }),
      bad(a.intentEvent, {}, { paymentAttemptId: b.attempt.id }),
      bad(a.intentEvent, {}, { paymentAttemptId: randomUUID() }),
      bad(a.intentEvent, {}, { shopId: f.other, roId: b.roId, paymentAttemptId: b.attempt.id }),
      bad(a.intentEvent, { amount_received: 9999 }), bad(a.intentEvent, { amount: 9999 }),
      bad(a.intentEvent, { amount_received: '10000' }), bad(a.intentEvent, { amount: '10000' }),
      bad(a.intentEvent, { amount_received: null }), bad(a.intentEvent, { currency: 'eur' }),
      bad(a.checkoutEvent, { id: b.sessionId }), bad(a.checkoutEvent, { id: null }),
      bad(a.checkoutEvent, { payment_intent: b.intentId }), bad(a.checkoutEvent, { payment_intent: null }),
      bad(a.checkoutEvent, { amount_total: 9999 }), bad(a.checkoutEvent, { currency: 'eur' }),
      bad(a.checkoutEvent, { amount_total: '10000' }),
      bad(d.checkoutEvent), c.checkoutEvent, c.intentEvent,
    ];
    for (const event of cases) { refused(await f.send(event)); assert.deepEqual(await f.counts(), [0, 0]); }
    refused(await f.send(a.intentEvent, 'forged-private-signature'));
    const missing = await f.send(a.intentEvent, ''); assert.equal(missing.status, 400);
    const validForOriginal = webhooks.generateTestHeaderString({ payload: JSON.stringify(a.intentEvent), secret: env.STRIPE_WEBHOOK_SECRET });
    refused(await f.send(bad(a.intentEvent, { amount_received: 5000 }), validForOriginal));
    assert.deepEqual(await f.counts(), [0, 0]); assert.deepEqual(await f.facts(), before); assert.deepEqual(f.calls(), calls);
    // Stale failure after release remains an ordinary no-op, without investigation.
    const failure = bad(a.intentEvent, { status: 'requires_payment_method' }); failure.type = 'payment_intent.payment_failed';
    assert.equal((await f.send(failure)).status, 200);
    assert.deepEqual(await f.counts(), [0, 0]); assert.deepEqual(await f.facts(), before);
  });

  for (const failure of ['notification insert', 'deferred commit', 'missing users']) test(`${type}: ${failure} error rolls back evidence and every notification; retry is safe`, { timeout: 60000 }, async t => {
    const f = await fixture(t, type), a = await f.make('checkout');
    const before = await f.facts(), calls = f.calls(), logs = [], originalError = console.error;
    console.error = (...args) => logs.push(args);
    t.after(() => { console.error = originalError; });
    if (failure === 'missing users') await f.pool.query('ALTER TABLE users RENAME TO unavailable_users');
    else {
      // Fail on the second recipient using an actual PostgreSQL trigger: proves
      // rollback of an already-inserted notification as well as the evidence row.
      await f.pool.query(`CREATE FUNCTION fail_late_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (SELECT count(*) FROM notifications WHERE type='payment_investigation') >= 2 THEN
          RAISE EXCEPTION 'PRIVATE_DATABASE_DETAIL provider pi_private';
        END IF; RETURN NEW; END $$`);
      await f.pool.query(failure === 'deferred commit'
        ? `CREATE CONSTRAINT TRIGGER fail_late_notification AFTER INSERT ON notifications DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION fail_late_notification()`
        : `CREATE TRIGGER fail_late_notification AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_late_notification()`);
    }
    refused(await f.send(a.checkoutEvent));
    assert.equal(f.queries.at(-1), 'ROLLBACK');
    assert.deepEqual(await f.counts(), [0, 0]);
    if (failure === 'missing users') await f.pool.query('ALTER TABLE unavailable_users RENAME TO users');
    else await f.pool.query('DROP TRIGGER fail_late_notification ON notifications');
    assert.deepEqual(await f.facts(), before); assert.deepEqual(f.calls(), calls);
    (await Promise.all([f.send(a.checkoutEvent), f.send(a.intentEvent), f.send(a.checkoutEvent)])).forEach(refused);
    assert.deepEqual(await f.counts(), [1, 4]); assert.deepEqual(await f.facts(), before);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|pi_|cs_|provider|exception/i);
    assert.deepEqual(f.calls(), calls);
  });

  test(`${type}: no owner/admin retains investigation without a shop-wide broadcast`, { timeout: 60000 }, async t => {
    const f = await fixture(t, type), a = await f.make();
    await f.pool.query("UPDATE users SET role='technician' WHERE shop_id=$1 AND role IN ('owner','admin')", [f.shop]);
    const before = await f.facts(); refused(await f.send(a.intentEvent));
    assert.deepEqual(await f.counts(), [1, 0]); assert.deepEqual(await f.facts(), before);
  });
}
