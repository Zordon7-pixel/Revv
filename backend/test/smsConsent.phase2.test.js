const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const consent = require('../src/services/customerConsent');
const root = path.resolve(__dirname, '../src');
const phone = '+15551234567';
const good = () => ({ shop_id: 'shop-a', phone, ...consent.consentMutation({ sms_consent: true, sms_consent_method: 'verbal' }, 'staff-a') });
const bad = [false, null, undefined, 'true', true]; // last value is legacy TRUE without evidence

// Execute real source with an explicit dependency boundary: no DB, .env, sockets,
// or provider SDK can load. Routes run their actual handlers without a listener.
function load(file, mocks, suffix = '') {
  const filename = path.join(root, file);
  const module = { exports: {} };
  const requireLocal = createRequire(filename);
  const resolve = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express', 'crypto', 'path', 'uuid'].includes(name)) return requireLocal(name);
    if (name.endsWith('/customerConsent') || name === './customerConsent') return consent;
    throw new Error(`Unmocked dependency: ${name} in ${file}`);
  };
  vm.runInThisContext(`(function(require,module,exports,__dirname){${fs.readFileSync(filename, 'utf8')}\n${suffix}\n})`, { filename })(resolve, module, module.exports, path.dirname(filename));
  return module.exports;
}

function harness(customer = good()) {
  const state = { customers: customer ? [customer] : [], optedOut: false, calls: [], writes: [], queries: [], failLookup: false };
  const shop = { id: 'shop-a', name: 'Test shop', plan: 'pro', twilio_account_sid: 'test', twilio_auth_token: 'test', twilio_phone_number: '+15550000000' };
  const key = value => { const d = String(value || '').replace(/\D/g, ''); return d.length === 10 ? `1${d}` : d; };
  const db = {
    dbAll: async (sql, params) => {
      state.queries.push({ sql, params });
      if (/FROM customers WHERE/.test(sql)) {
        assert.match(sql, /sms_consent_at, sms_consent_method, sms_consent_by/);
        assert.match(sql, /shop_id = \$1/);
        assert.match(sql, /regexp_replace/);
        if (state.failLookup) throw new Error('Database unavailable');
        return state.customers.filter(c => c.shop_id === params[0] && key(c.phone) === params[1]);
      }
      return [];
    },
    dbGet: async (sql, params) => {
      state.queries.push({ sql, params });
      if (/FROM sms_opt_outs/.test(sql)) return state.optedOut ? { exists: 1 } : null;
      if (/FROM shops/.test(sql)) return shop;
      if (/FROM users/.test(sql)) return params[0] === 'admin-a' && params[1] === 'shop-a' ? { phone } : null;
      if (/FROM vehicles/.test(sql)) return { id: 'vehicle', make: 'Test', model: 'Car' };
      if (/FROM customers/.test(sql) && !/repair_orders/.test(sql)) return { id: 'customer', ...state.customers[0] };
      if (/MAX\(/.test(sql)) return { n: 0 };
      if (/estimate_approval_links/.test(sql)) return null;
      if (/customer_phone/.test(sql)) {
        for (const column of ['sms_consent', 'sms_consent_at', 'sms_consent_method', 'sms_consent_by']) assert.ok(sql.includes(`c.${column}`));
        assert.match(sql, /c.shop_id = ro.shop_id/);
        assert.match(sql, /ro.shop_id = \$2/);
        return { id: 'ro', shop_id: 'shop-a', customer_phone: phone, sms_notifications_enabled: true, ...state.customers[0] };
      }
      if (/FROM repair_orders/.test(sql)) return { id: 'ro', shop_id: 'shop-a', ro_number: 'RO-TEST' };
      return null;
    },
    dbRun: async (sql, params) => {
      state.writes.push({ sql, params });
      if (/INSERT INTO sms_opt_outs/.test(sql)) state.optedOut = true;
      if (/DELETE FROM sms_opt_outs/.test(sql)) state.optedOut = false;
      if (/UPDATE customers SET sms_consent = FALSE/.test(sql)) {
        assert.match(sql, /WHERE shop_id = \$1/);
        for (const c of state.customers) if (c.shop_id === params[0] && key(c.phone) === params[1]) Object.assign(c, consent.consentMutation({ sms_consent: false }, 'staff'));
      } else if (/UPDATE customers SET sms_consent = \$1/.test(sql)) {
        assert.match(sql, /WHERE id = \$5 AND shop_id = \$6/);
        Object.assign(state.customers[0], { sms_consent: params[0], sms_consent_at: params[1], sms_consent_method: params[2], sms_consent_by: params[3] });
      }
      return { rowCount: 1 };
    },
  };
  db.pool = { connect: async () => ({
    query: async (sql, params = []) => {
      if (/INSERT INTO customers/.test(sql)) {
        state.customers = [{ shop_id: params[1], phone: params[3], sms_consent: params[4], sms_consent_at: params[9], sms_consent_method: params[10], sms_consent_by: params[11] }];
      }
      await db.dbRun(sql, params);
      return { rows: /SELECT/.test(sql) ? [{ id: 'ro', shop_id: 'shop-a' }] : [], rowCount: 1 };
    }, release() {},
  }) };
  const sms = load('services/sms.js', { '../db': db, twilio: () => ({ messages: { create: async payload => {
    state.calls.push(payload);
    return { sid: `SM${'a'.repeat(32)}` };
  } } }) });
  const auto = load('services/smsAutoReply.js', { '../db': db, './sms': sms });
  return { state, db, sms, auto, shop };
}

function routes(h) {
  const noop = (_req, _res, next) => next?.();
  const billing = { ensureTrackingToken: async () => 'token', createPaymentCheckoutLinkForRo: async () => ({ ok: false }), sendClosedPaidInvoiceEmail: async () => {} };
  const common = {
    '../db': h.db, '../middleware/auth': noop,
    '../services/sms': h.sms,
    '../services/customerBilling': billing,
    '../services/notifications': { createNotification: async () => {} },
    'express-rate-limit': () => noop,
  };
  const ro = load('routes/ros.js', {
    ...common,
    '../middleware/roles': { requireAdmin: noop, requireTechnician: noop, ROLE_RANK: {}, getRoleRank: () => 2 },
    '../middleware/roLimitGuard': noop, './insuranceOcr': { insuranceOcrLimiter: noop },
    '../services/panelEstimatorEconomics': { selectedEconomics: async () => new Map(), redactSelectedRO: r => r },
    '../services/profit': { calculateProfit: () => ({}) },
    '../services/roMoney': { roundToIntCents: Math.round, dollarsToCents: n => Math.round(Number(n || 0) * 100) },
    '../services/mailer': { sendMail: async () => { throw new Error('Unexpected email'); } },
    '../services/emailTemplates': {}, '../services/ownerActivity': { recordOwnerActivity() {} },
    '../services/deliveryFees': { toMoney: n => Number(n || 0) }, '../services/quickbooks': {},
    '../services/customerOptInConfirmation': load('services/customerOptInConfirmation.js', { './sms': h.sms }),
    '../services/panelEstimatorApproval': { noStore: noop, panelPublicHandler: () => noop, publicRequestError: () => noop },
  }, '\nmodule.exports.queueStatusSMSForTest = queueStatusSMS;');
  const multer = () => ({ array: () => noop, single: () => noop });
  multer.diskStorage = () => ({});
  const portal = load('routes/portal.js', { ...common, '../services/partsDelivery': {}, '../services/mediaStorage': {}, fs: { mkdirSync() {} }, multer });
  const direct = load('routes/sms.js', { ...common, '../middleware/roles': { requireAdmin: noop }, '../services/smsAutoReply': h.auto });
  return { ro, portal, direct };
}
async function call(router, route, body = {}, params = {}) {
  const handler = router.stack.find(l => l.route?.path === route && l.route.methods.post).route.stack.at(-1).handle;
  const req = { body, params, user: { id: 'staff-a', shop_id: 'shop-a' }, protocol: 'https', get: () => 'example.test' };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
}

for (const value of bad) test(`lowest sender suppresses ${String(value)} without provenance`, async () => {
  const h = harness({ shop_id: 'shop-a', phone, sms_consent: value });
  const result = await h.sms.sendSMS(phone, 'Private body', { shopId: 'shop-a', customerFacing: false, skipOptOutCheck: true, sms_consent: true, ...good() });
  assert.equal(result.reason, 'no_confirmed_consent');
  assert.equal(h.state.calls.length, 0);
});
test('confirmed customer reaches messages.create; unknown, cross-shop, ambiguous and failed lookup do not', async () => {
  const h = harness();
  assert.equal((await h.sms.sendSMS(phone, 'Private body', { shopId: 'shop-a', customerFacing: false })).ok, true);
  assert.equal(h.state.calls.length, 1);
  assert.match(h.state.calls[0].body, /Reply STOP/);
  for (const [number, shopId] of [[phone, 'shop-b'], ['+15559999999', 'shop-a'], [phone, undefined]]) {
    assert.equal((await h.sms.sendSMS(number, 'Private body', { shopId })).ok, false);
  }
  h.state.customers.push({ shop_id: 'shop-a', phone, sms_consent: false });
  assert.equal((await h.sms.sendSMS(phone, 'Private body', 'shop-a')).ok, false);
  h.state.failLookup = true;
  assert.equal((await h.sms.sendSMS(phone, 'Private body', 'shop-a')).reason, 'consent_lookup_failed');
  assert.equal(h.state.calls.length, 1);
});
test('explicit staff wrapper resolves staff in shop; JSON cannot forge its capability', async () => {
  const h = harness(null);
  assert.equal((await h.sms.sendStaffSMS('admin-a', 'Staff notification', { shopId: 'shop-a' })).ok, true);
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.calls[0].body, 'Staff notification');
  assert.equal((await h.sms.sendStaffSMS('admin-a', 'Staff notification', { shopId: 'shop-b' })).ok, false);
  assert.equal((await h.sms.sendSMS(phone, 'Customer notification', { shopId: 'shop-a', customerFacing: false, staffId: 'admin-a' })).ok, false);
  assert.equal(h.state.calls.length, 1);
});
test('STOP revokes matching customer only; HELP sends nothing; reconfirm preserves STOP; START alone cannot consent', async () => {
  const h = harness();
  h.state.customers[0].phone = '(555) 123-4567';
  h.state.customers.push({ ...good(), shop_id: 'shop-b' });
  const incoming = body => h.auto.maybeSendInboundAutoReply({ shop: h.shop, from: phone, to: h.shop.twilio_phone_number, body });
  assert.equal((await incoming('STOP')).action, 'opt_out');
  assert.equal(h.state.customers[0].sms_consent, false);
  assert.equal(h.state.customers[0].sms_consent_at, null);
  assert.equal(h.state.customers[1].sms_consent, true);
  assert.equal((await incoming('HELP')).action, 'help');
  Object.assign(h.state.customers[0], good());
  assert.equal((await h.sms.sendSMS(phone, 'Ordinary', { shopId: 'shop-a', skipOptOutCheck: true })).reason, 'opted_out');
  await incoming('STOP');
  await incoming('START');
  assert.equal((await h.sms.sendSMS(phone, 'Ordinary', 'shop-a')).reason, 'no_confirmed_consent');
  assert.equal(h.state.calls.length, 0);
  Object.assign(h.state.customers[0], good());
  assert.equal((await incoming('Any news?')).action, 'auto_reply');
  assert.equal(h.state.calls.length, 1);
});

for (const value of [...bad, 'confirmed']) test(`RO, portal, direct and status paths: ${value}`, async () => {
  const h = harness(value === 'confirmed' ? good() : { shop_id: 'shop-a', phone, sms_consent: value });
  const r = routes(h);
  const expected = value === 'confirmed' ? 1 : 0;
  let res = await call(r.ro, '/', { customer_id: 'customer', vehicle_id: 'vehicle' });
  assert.equal(res.statusCode, 201);
  assert.equal(h.state.calls.length, expected);
  res = await call(r.portal, '/magic-link/:ro_id', {}, { ro_id: 'ro' });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body.message, /SMS sent/);
  assert.equal(h.state.calls.length, 2 * expected);
  res = await call(r.direct, '/send', { to_phone: phone, message: 'Direct', customerFacing: false, skipOptOutCheck: true });
  assert.equal(res.statusCode, expected ? 200 : 502);
  assert.equal(h.state.calls.length, 3 * expected);
  r.ro.queueStatusSMSForTest('ro', 'shop-a', 'repair');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.calls.length, 4 * expected);
  res = await call(r.ro, '/:id/approval-link', {}, { id: 'ro' });
  assert.equal(res.statusCode, 200);
  r.ro.queueStatusSMSForTest('ro', 'shop-a', 'approval');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.calls.length, 4 * expected, 'approval does not enable an SMS template');
});

test('RO intake validates before writes and stamps authenticated evidence; omitted preserves and false clears', async () => {
  const h = harness();
  const r = routes(h);
  for (const route of ['/', '/import-estimate']) {
    for (const method of [undefined, null, '', 'ocr']) {
      const res = await call(r.ro, route, { customer_id: 'customer', vehicle_id: 'vehicle', sms_consent: true, sms_consent_method: method, vehicle: { make: 'Test', model: 'Car' } });
      assert.equal(res.statusCode, 400);
      assert.equal(h.state.writes.length, 0);
      assert.equal(h.state.calls.length, 0);
    }
  }
  let res = await call(r.ro, '/', { customer_id: 'customer', vehicle_id: 'vehicle', sms_consent: true, sms_consent_method: 'written', sms_consent_by: 'forged', sms_consent_at: '1900-01-01' });
  assert.equal(res.statusCode, 201);
  const saved = h.state.customers[0];
  assert.equal(saved.sms_consent_by, 'staff-a');
  assert.equal(saved.sms_consent_method, 'written');
  assert.ok(saved.sms_consent_at.getFullYear() >= 2026);
  assert.equal(h.state.calls.length, 1);
  const evidence = { ...saved };
  await call(r.ro, '/', { customer_id: 'customer', vehicle_id: 'vehicle', sms_consent_at: '1900-01-01', sms_consent_by: 'forged' });
  assert.deepEqual(saved, evidence);
  assert.equal(h.state.calls.length, 2);
  res = await call(r.ro, '/', { customer_id: 'customer', vehicle_id: 'vehicle', sms_consent: false });
  assert.equal(res.statusCode, 201);
  assert.equal(saved.sms_consent, false);
  assert.equal(saved.sms_consent_at, null);
  assert.equal(h.state.calls.length, 2);
});

test('import ignores nested/OCR consent and client provenance; explicit staff attestation sends confirmation', async () => {
  for (const input of [{ customer: { ...good() } }, { sms_consent: 'true' }, { sms_consent: null }, {}, { sms_consent: true, sms_consent_method: 'verbal', sms_consent_at: '1900-01-01', sms_consent_by: 'forged' }]) {
    const h = harness();
    const r = routes(h);
    const res = await call(r.ro, '/import-estimate', { vehicle: { make: 'Test', model: 'Car' }, customer_phone: phone, ...input });
    assert.equal(res.statusCode, 201);
    const c = h.state.customers[0];
    const confirmed = input.sms_consent === true;
    assert.equal(c.sms_consent, confirmed);
    assert.equal(consent.hasConfirmedSmsConsent(c), confirmed);
    assert.equal(c.sms_consent_by, confirmed ? 'staff-a' : null);
    assert.equal(h.state.calls.length, confirmed ? 1 : 0);
  }
});

test('STOP suppression is never recorded as direct success or logged as tracking success', async () => {
  const h = harness();
  h.state.optedOut = true;
  const r = routes(h);
  const res = await call(r.direct, '/send-status', { ro_id: 'ro', status: 'Ready', customer_phone: phone });
  assert.equal(res.statusCode, 502);
  assert.equal(h.state.writes.length, 0);
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await call(r.ro, '/', { customer_id: 'customer', vehicle_id: 'vehicle' });
    await call(r.portal, '/magic-link/:ro_id', {}, { ro_id: 'ro' });
  } finally { console.log = original; }
  assert.equal(h.state.calls.length, 0);
  assert.ok(logs.some(line => line.includes('not sent')));
  assert.ok(logs.every(line => !line.includes('SMS sent') && !line.includes(phone)));
});

test('parts notification provenance gate and actual mocked provider acceptance', async () => {
  for (const c of [...bad.map(sms_consent => ({ shop_id: 'shop-a', phone, sms_consent })), good()]) {
    const h = harness(c);
    const parts = load('services/partsNotifications.js', { './partsDelivery': { ensureDelivery: async () => {} }, './sms': h.sms });
    const context = { ...c, preferred_contact_method: 'sms', before_state: { status: 'ordered' }, after_state: { status: 'received', quantity: 1, received_quantity: 1 } };
    const db = { query: async sql => ({ rows: /SELECT/.test(sql) ? [context] : [], rowCount: 1 }) };
    const result = await parts.notifyPartUpdate(db, 'shop-a', { id: 'part', delivery_revision: 1 }, 0);
    const allowed = consent.hasConfirmedSmsConsent(c);
    assert.equal(result.channels[0].status, allowed ? 'accepted' : 'skipped');
    assert.equal(h.state.calls.length, allowed ? 1 : 0);
  }
});

test('partial or forged provenance and ordinary inbound auto-replies cannot reach Twilio', async () => {
  for (const patch of [{ sms_consent: 'true' }, { sms_consent_at: null }, { sms_consent_at: 'invalid' },
    { sms_consent_method: null }, { sms_consent_method: 'ocr' }, { sms_consent_by: '' }, { sms_consent_by: null }]) {
    const h = harness({ ...good(), ...patch });
    assert.equal((await h.sms.sendSMS(phone, 'Ordinary', 'shop-a')).ok, false);
    const result = await h.auto.maybeSendInboundAutoReply({ shop: h.shop, from: phone, body: 'Any news?' });
    assert.equal(result.action, 'suppressed');
    assert.equal(h.state.calls.length, 0);
    assert.equal(h.state.writes.length, 0);
  }
});

const databaseUrl = process.env.CUSTOMER_CONSENT_TEST_DATABASE_URL;
test('real PostgreSQL phone/shop matching, STOP revocation and reconfirmation suppression', { skip: !databaseUrl }, async () => {
  const address = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(address.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname));
  assert.equal(address.pathname, '/revv_customer_consent_test');
  assert.equal(address.search, '');
  assert.equal(address.hash, '');
  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  await client.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE customers (
      id TEXT, shop_id TEXT, phone TEXT, sms_consent BOOLEAN, sms_consent_at TIMESTAMPTZ,
      sms_consent_method TEXT, sms_consent_by TEXT);
      CREATE TEMP TABLE sms_opt_outs (shop_id TEXT, phone TEXT, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(shop_id, phone));`);
    const db = {
      dbGet: async (sql, params) => (await client.query(sql, params)).rows[0],
      dbAll: async (sql, params) => (await client.query(sql, params)).rows,
      dbRun: (sql, params) => client.query(sql, params),
    };
    const sms = load('services/sms.js', { '../db': db, twilio: () => ({ messages: { create: async () => { count++; return { sid: `SM${'b'.repeat(32)}` }; } } }) });
    const auto = load('services/smsAutoReply.js', { '../db': db, './sms': sms });
    const options = { shopId: 'shop-a', twilioConfig: { plan: 'pro', accountSid: 'test', authToken: 'test', phoneNumber: '+15550000000' } };
    await client.query(`INSERT INTO customers VALUES ('c', 'shop-a', '(555) 123-4567', TRUE, now(), 'verbal', 'staff-a'),
      ('other', 'shop-b', '+1 555 123 4567', TRUE, now(), 'written', 'staff-b')`);
    assert.equal((await sms.sendSMS(phone, 'Confirmed', options)).ok, true);
    assert.equal(count, 1);
    assert.equal((await sms.sendSMS(phone, 'Cross-shop', { ...options, shopId: 'shop-c' })).ok, false);
    for (const value of [false, null, true]) {
      await client.query('UPDATE customers SET sms_consent=$1, sms_consent_at=NULL WHERE shop_id=$2', [value, 'shop-a']);
      assert.equal((await sms.sendSMS(phone, 'Unconfirmed', options)).ok, false);
    }
    await auto.maybeSendInboundAutoReply({ shop: { id: 'shop-a' }, from: phone, body: 'STOP' });
    const revoked = (await client.query("SELECT * FROM customers WHERE shop_id='shop-a'")).rows[0];
    assert.equal(revoked.sms_consent, false);
    assert.equal(revoked.sms_consent_by, null);
    assert.equal((await client.query("SELECT sms_consent FROM customers WHERE shop_id='shop-b'")).rows[0].sms_consent, true);
    await client.query("UPDATE customers SET sms_consent=TRUE,sms_consent_at=now(),sms_consent_method='written',sms_consent_by='staff-a' WHERE shop_id='shop-a'");
    assert.equal((await sms.sendSMS(phone, 'Reconfirmed but STOP', { ...options, skipOptOutCheck: true })).reason, 'opted_out');
    assert.equal(count, 1);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
