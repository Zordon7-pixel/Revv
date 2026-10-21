'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHmac } = require('node:crypto');
const { createRequire } = require('node:module');

// Real production modules with a closed import map; no app/db bootstrap, dotenv,
// provider SDK, account, listening socket or live transport is reachable.
function load(file, mocks, env) {
  const filename = path.resolve(__dirname, '../src', file), module = { exports: {} };
  const local = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports,process){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express', 'uuid', 'node:crypto'].includes(name)) return local(name);
    throw Error(`Unmocked dependency ${name}`);
  }, module, module.exports, { env });
  return module.exports;
}
const ordinary = () => [{ id: 'shop', is_internal_test_shop: false }];
const flagged = () => [{ id: 'shop', is_internal_test_shop: true }];
function fixture(rows) {
  assert.notEqual(rows, undefined, 'each fixture explicitly supplies persisted policy');
  const env = { STRIPE_SECRET_KEY: 'synthetic-key', STRIPE_WEBHOOK_SECRET: 'synthetic-signature-key',
    STRIPE_PRICE_ID_PRO: 'price_pro', STRIPE_PRICE_ID_AGENCY: 'price_agency' };
  const state = { rows, shopsByCustomer: [{ id: 'shop' }], queries: [], writes: [], calls: [], imports: 0, clients: 0,
    attempts: [], ledger: [], committed: [], ro: { id: 'ro', shop_id: 'shop', ro_number: 'SYNTHETIC',
      status: 'closed', payment_status: 'unpaid', amount_paid_cents: 0 }, onQuery: null, onProvider: null };
  const query = async (sql, args = []) => {
    state.queries.push([sql, args]);
    let result = [];
    if (/is_internal_test_shop FROM shops/.test(sql)) {
      if (state.rows instanceof Error) throw state.rows;
      result = Array.isArray(state.rows) ? state.rows.filter(r => !r || r.id === args[0] || state.mismatched) : state.rows;
    } else if (/SELECT id::text AS id FROM shops WHERE stripe_customer_id/.test(sql)) {
      if (state.shopsByCustomer instanceof Error) throw state.shopsByCustomer;
      result = state.shopsByCustomer;
    } else if (/FROM shops/.test(sql)) result = [{ id: 'shop', name: 'Synthetic', plan: 'free',
      stripe_customer_id: state.customerId || null, stripe_subscription_id: null }];
    else if (/FROM users/.test(sql)) result = /SELECT email, name/.test(sql) ? [{ email: 'local@example.invalid' }] : [];
    else if (/SELECT \* FROM repair_orders|FROM repair_orders ro/.test(sql)) result = args[1] === 'shop' ? [state.ro] : [];
    else if (/SELECT \* FROM ro_payment_attempts/.test(sql)) result = state.attempts.filter(a => /WHERE id =/.test(sql) ? a.id === args[0] : true).map(a => ({ ...a }));
    else if (/SELECT \* FROM ro_payments/.test(sql)) result = state.ledger;
    else if (/FROM portal_tokens/.test(sql)) result = state.token ? [{ token: state.token }] : [];
    else if (sql === 'COMMIT') state.committed = structuredClone(state.writes);
    if (/^\s*(INSERT|UPDATE|DELETE)\b/.test(sql)) {
      state.writes.push([sql, args]);
      if (/INSERT INTO ro_payment_attempts/.test(sql)) state.attempts.push({ id: args[0], shop_id: args[1], ro_id: args[2],
        idempotency_key: args[3], amount_cents: args[4], kind: args[5], status: 'reserved', created_at: '2020-01-01' });
      if (/UPDATE ro_payment_attempts SET\s+stripe_payment_intent_id/.test(sql)) {
        const a = state.attempts.find(a => a.id === args[3]);
        a.stripe_payment_intent_id ||= args[0]; a.stripe_checkout_session_id ||= args[1];
        if (!['settled', 'released'].includes(a.status)) a.status = args[2];
      }
      if (/INSERT INTO ro_payments/.test(sql)) state.ledger.push({ id: args[0], shop_id: args[1], ro_id: args[2],
        stripe_payment_intent_id: args[3], amount_cents: args[4], status: 'succeeded', currency: 'usd' });
    }
    // Simulate a concurrent policy commit completing during an awaited DB read.
    if (state.onQuery) await state.onQuery(sql, args);
    return { rows: result, rowCount: Array.isArray(result) ? result.length : 0 };
  };
  const client = { query, release() {} };
  const db = { dbAll: async (sql, args) => (await query(sql, args)).rows,
    dbGet: async (sql, args) => (await query(sql, args)).rows[0], dbRun: query,
    pool: { connect: async () => client } };
  const policy = load('services/shopPolicy.js', { '../db': db }, env);
  const effect = name => async (...args) => {
    state.calls.push([name, ...args]);
    if (state.onProvider) await state.onProvider(name, args);
    if (name === 'customers.create') return { id: 'cus_mock' };
    if (name === 'paymentIntents.retrieve') return { id: 'pi_mock', amount: 12345, currency: 'usd', status: 'requires_payment_method' };
    if (name === 'paymentIntents.cancel') return { id: 'pi_mock', amount: 12345, currency: 'usd', status: 'canceled' };
    if (name === 'checkout.sessions.retrieve') return { id: 'cs_mock', amount_total: 12345, currency: 'usd', status: 'open', payment_intent: 'pi_mock' };
    if (name === 'checkout.sessions.expire') return { id: 'cs_mock', amount_total: 12345, currency: 'usd', status: 'expired', payment_intent: 'pi_mock' };
    return { id: name === 'paymentIntents.create' ? 'pi_mock' : 'cs_mock', client_secret: 'synthetic', url: 'https://synthetic.invalid' };
  };
  const stripeMocks = { './shopPolicy': policy };
  Object.defineProperty(stripeMocks, 'stripe', { get() {
    state.imports++;
    return class {
      constructor() {
        state.clients++;
        this.customers = { create: effect('customers.create') };
        this.paymentIntents = Object.fromEntries(['create', 'retrieve', 'cancel'].map(k => [k, effect(`paymentIntents.${k}`)]));
        this.checkout = { sessions: Object.fromEntries(['create', 'retrieve', 'expire'].map(k => [k, effect(`checkout.sessions.${k}`)])) };
        this.billingPortal = { sessions: { create: effect('billingPortal.sessions.create') } };
        this.refunds = { create: effect('refunds.create') };
        this.invoices = { pay: effect('invoices.pay') };
        this.subscriptions = { create: effect('subscriptions.create') };
      }
    };
  } });
  const stripe = load('services/stripe.js', stripeMocks, env);
  const money = { getRoMoneySummary: async () => ({ totalCents: 12345, lineCount: 1 }),
    getPaidCents: async () => state.ledger.reduce((n, p) => n + p.amount_cents, 0),
    reconcilePaymentStatus: ({ paidCents, owedCents }) => paidCents >= owedCents ? 'paid' : 'partial' };
  const reservations = load('services/paymentReservations.js', { '../db': db, './shopPolicy': policy,
    './stripe': stripe, './roMoney': money, './notifications': { createPaymentInvestigationNotifications: async () => { state.writes.push(['investigation notification']); } } }, env);
  const billing = load('services/customerBilling.js', { '../db': db, './shopPolicy': policy, './stripe': stripe,
    './roMoney': money, './paymentReservations': reservations, './mailer': { sendMail: effect('mail') },
    './emailTemplates': { closedPaidInvoiceEmail: () => ({ subject: 'synthetic', html: 'synthetic' }) } }, env);
  const shared = { '../db': db, '../services/shopPolicy': policy, '../services/stripe': stripe,
    '../middleware/auth': (_q, _s, next) => next(), '../middleware/roles': require('../src/middleware/roles') };
  const subscriptions = load('routes/subscriptions.js', shared, env);
  const payments = load('routes/payments.js', { ...shared, '../services/notifications': { createNotification: effect('notification') },
    '../services/mailer': { sendMail: effect('mail') }, '../services/emailTemplates': {},
    '../services/customerBilling': billing, '../services/paymentReservations': reservations, '../services/roMoney': money }, env);
  return { state, env, db, client, policy, stripe, reservations, billing, subscriptions, payments };
}
function signed(f, event, timestamp = Math.floor(Date.now() / 1000)) {
  const body = Buffer.from(JSON.stringify(event));
  const hash = createHmac('sha256', f.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.`).update(body).digest('hex');
  return { body, signature: `t=${timestamp},v1=${hash}` };
}
async function invoke(router, route, { body = {}, signature, method = 'post', user = {} } = {}) {
  const layer = router.stack.find(l => l.route?.path === route && l.route.methods[method]);
  assert.ok(layer, route);
  const req = { body, params: { roId: 'ro', shopId: 'shop' }, headers: { 'stripe-signature': signature },
    user: { id: 'actor', shop_id: 'shop', role: 'owner', ...user } };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, set() { return this; } };
  let index = 0;
  const next = () => layer.route.stack[index++]?.handle(req, res, next);
  await next();
  return res;
}
const attempt = (kind = 'intent') => ({ id: 'attempt', ro_id: 'ro', shop_id: 'shop', kind, amount_cents: 12345,
  status: 'open', stripe_payment_intent_id: 'pi_mock', stripe_checkout_session_id: kind === 'checkout' ? 'cs_mock' : null,
  created_at: '2020-01-01' });
function event(type = 'payment_intent.succeeded') {
  return { type, data: { object: { id: type.startsWith('checkout.') ? 'cs_mock' : 'pi_mock',
    payment_intent: 'pi_mock', amount: 12345, amount_received: 12345, amount_total: 12345, currency: 'usd',
    payment_status: 'paid', metadata: { roId: 'ro', shopId: 'shop', paymentAttemptId: 'attempt', is_internal_test_shop: false } } } };
}
function subscriptionEvent(type) {
  return { type, data: { object: { id: 'sub_mock', customer: 'cus_mock', items: { data: [{ price: { id: 'price_pro' } }] },
    metadata: { shop_id: 'ordinary-forged', is_internal_test_shop: false, plan: 'agency', role: 'superadmin' } } } };
}
const zero = f => {
  assert.equal(f.state.imports, 0, 'Stripe SDK imports'); assert.equal(f.state.clients, 0, 'Stripe clients');
  assert.deepEqual(f.state.calls, [], 'provider calls'); assert.deepEqual(f.state.writes, [], 'billing writes');
};
const unavailable = [
  ['missing', () => []], ['duplicate', () => [...ordinary(), ...ordinary()]],
  ['null flag', () => [{ id: 'shop', is_internal_test_shop: null }]],
  ['string false', () => [{ id: 'shop', is_internal_test_shop: 'false' }]],
  ['numeric zero', () => [{ id: 'shop', is_internal_test_shop: 0 }]],
  ['omitted flag', () => [{ id: 'shop' }]], ['invalid rows', () => null],
  ['query failed', () => Error('PRIVATE SQL FAILURE')], ['mismatched identity', () => [{ id: 'different', is_internal_test_shop: false }]],
];
for (const [label, rows, reason] of [['flagged', flagged, 'INTERNAL_TEST_SHOP'], ...unavailable.map(([l, r]) => [l, r, 'SHOP_POLICY_UNAVAILABLE'])]) {
  for (const [kind, route] of [['payments', '/intent'], ['payments', '/create-intent'], ['payments', '/link/:roId'],
    ['payments', '/reconcile/:roId'], ['subscriptions', '/checkout'], ['subscriptions', '/portal'], ['subscriptions', '/status']]) {
    test(`${label}: actual ${kind} ${route} suppresses forged body/JWT policy`, async () => {
      const f = fixture(rows()); f.state.mismatched = true;
      const res = await invoke(f[kind], route, { method: route === '/status' ? 'get' : 'post',
        body: { ro_id: 'ro', roId: 'ro', shop_id: 'ordinary-forged', is_internal_test_shop: false, plan: 'pro', role: 'superadmin' },
        user: { is_internal_test_shop: false, plan: 'agency', admin: true } });
      assert.equal(res.statusCode, reason === 'INTERNAL_TEST_SHOP' ? 409 : 503);
      assert.deepEqual(res.body, { error: reason, reason, suppressed: true,
        ...(kind === 'payments' ? { excluded: true } : {}) }); zero(f);
    });
  }
}
for (const rows of [flagged, () => []]) {
  for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    for (const route of ['/', '/webhook']) test(`${rows.name || 'missing'}: signed subscription ${type} alias ${route}`, async () => {
      const f = fixture(rows());
      const res = await invoke(f.subscriptions, route, signed(f, subscriptionEvent(type)));
      assert.equal(res.body.suppressed, true); assert.notEqual(res.statusCode, 200); zero(f);
    });
  }
  for (const type of ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled',
    'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired']) {
    test(`${rows.name || 'missing'}: signed payment ${type} cannot settle, release or reconcile`, async () => {
      const f = fixture(rows()); f.state.attempts = [attempt(type.startsWith('checkout.') ? 'checkout' : 'intent')];
      const res = await invoke(f.payments, '/webhook', signed(f, event(type)));
      assert.equal(res.body.suppressed, true); assert.notEqual(res.statusCode, 200); zero(f);
      assert.equal(f.state.attempts[0].status, 'open');
    });
  }
  for (const operation of ['reserve', 'bind', 'reconcile', 'locked reconcile', 'checkout', 'token', 'invoice', 'intent helper', 'client']) {
    test(`${rows.name || 'missing'}: direct ${operation} has zero effects`, async () => {
      const f = fixture(rows()); f.state.attempts = [attempt()];
      const actions = {
        reserve: () => f.reservations.reservePayment({ roId: 'ro', shopId: 'shop', kind: 'intent' }),
        bind: () => f.reservations.recordProviderResult({ id: 'attempt', ro: f.state.ro, kind: 'intent' }, { id: 'pi_mock' }),
        reconcile: () => f.reservations.reconcileReservations({ roId: 'ro', shopId: 'shop' }),
        'locked reconcile': () => f.reservations.reconcileLocked(f.client, f.state.ro),
        checkout: async () => { const r = await f.billing.createPaymentCheckoutLinkForRo({ roId: 'ro', shopId: 'shop' }); assert.equal(r.suppressed, true); },
        token: () => f.billing.ensureTrackingToken('ro', 'shop'),
        invoice: () => f.billing.sendClosedPaidInvoiceEmail({ roId: 'ro', shopId: 'shop', force: true }),
        'intent helper': () => f.stripe.createPaymentIntent(12345, 'usd', { shopId: 'ordinary-forged' }, 'key', 'shop'),
        client: () => f.stripe.getStripeClient('shop'),
      };
      if (operation === 'checkout') await actions[operation]();
      else await assert.rejects(actions[operation], e => f.policy.isShopPolicyError(e));
      zero(f);
    });
  }
}
for (const mapping of [[], [{ id: 'shop' }, { id: 'other' }], null, Error('private mapping failure')]) {
  test(`subscription customer mapping ${JSON.stringify(mapping)} fails closed`, async () => {
    const f = fixture(ordinary()); f.state.shopsByCustomer = mapping;
    const r = await invoke(f.subscriptions, '/', signed(f, subscriptionEvent('customer.subscription.updated')));
    assert.equal(r.statusCode, 503); zero(f);
  });
}
for (const route of ['/', '/webhook']) test(`ordinary subscription ${route} verified customer scopes writes`, async () => {
  const f = fixture(ordinary());
  for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    const r = await invoke(f.subscriptions, route, signed(f, subscriptionEvent(type)));
    assert.equal(r.statusCode, 200); assert.equal(r.body.received, true);
  }
  assert.equal(f.state.writes.length, 3);
  for (const [sql, args] of f.state.writes) { assert.match(sql, /stripe_customer_id = \$\d AND id = \$\d/); assert.equal(args.at(-1), 'shop'); }
  assert.equal(f.state.writes[0][1][0], 'pro'); assert.equal(f.state.imports, 0);
});
for (const kind of ['payments', 'subscriptions']) {
  for (const bad of ['tampered body', 'bad signature', 'expired', 'parsed body', 'missing signature', 'missing secret']) {
    test(`${kind}: ${bad} is rejected before policy/data/provider work`, async () => {
      const f = fixture(ordinary()), payload = signed(f, kind === 'payments' ? event() : subscriptionEvent('customer.subscription.updated'));
      if (bad === 'tampered body') payload.body = Buffer.from('{}');
      if (bad === 'bad signature') payload.signature = 't=1,v1=bad';
      if (bad === 'expired') Object.assign(payload, signed(f, event(), Math.floor(Date.now() / 1000) - 301));
      if (bad === 'parsed body') payload.body = event();
      if (bad === 'missing signature') delete payload.signature;
      if (bad === 'missing secret') delete f.env.STRIPE_WEBHOOK_SECRET;
      const r = await invoke(f[kind], '/webhook', payload);
      assert.notEqual(r.statusCode, 200); zero(f); assert.equal(f.state.queries.length, 0);
    });
  }
}
test('local signature verification accepts rotated v1 signatures and exact UTF-8 bytes', () => {
  const f = fixture(flagged()), expected = { type: 'synthetic', text: 'Café 🔧' }, payload = signed(f, expected);
  payload.signature += ',v1=' + '0'.repeat(64);
  assert.deepEqual(f.stripe.constructWebhookEvent(payload.body, payload.signature), expected); zero(f);
});
test('Stripe helper never derives authority from metadata or omitted tenancy', async () => {
  const f = fixture(ordinary());
  await assert.rejects(() => f.stripe.createPaymentIntent(123, 'usd', { shopId: 'shop', is_internal_test_shop: false }), /SHOP_POLICY_UNAVAILABLE/);
  await assert.rejects(() => f.stripe.getStripeClient({ id: 'shop', is_internal_test_shop: false }), /SHOP_POLICY_UNAVAILABLE/); zero(f);
});
for (const route of ['/intent', '/create-intent']) test(`ordinary ${route}: cents, durable reservation, provider key and binding`, async () => {
  const f = fixture(ordinary());
  f.state.onProvider = async () => { assert.equal(f.state.committed.length, 1, 'reservation committed before provider creation'); };
  const r = await invoke(f.payments, route, { body: { ro_id: 'ro', amount: 12345 } });
  assert.equal(r.statusCode, 200); assert.equal(r.body.amountCents, 12345);
  assert.equal(f.state.calls[0][1].amount, 12345);
  assert.equal(f.state.calls[0][2].idempotencyKey, `ro-payment-${f.state.attempts[0].id}`);
  assert.equal(f.state.attempts[0].stripe_payment_intent_id, 'pi_mock');
});
test('ordinary checkout, customer, portal and direct RO checkout preserve payloads', async () => {
  const f = fixture(ordinary());
  assert.equal((await invoke(f.subscriptions, '/checkout', { body: { plan: 'pro' } })).statusCode, 200);
  assert.equal(f.state.calls[0][0], 'customers.create');
  assert.equal(f.state.calls[1][1].line_items[0].price, 'price_pro');
  f.state.customerId = 'cus_mock';
  assert.equal((await invoke(f.subscriptions, '/portal')).statusCode, 200);
  const r = await f.billing.createPaymentCheckoutLinkForRo({ roId: 'ro', shopId: 'shop' });
  assert.equal(r.ok, true); assert.equal(r.amountCents, 12345);
  assert.equal(f.state.calls.at(-1)[1].line_items[0].price_data.unit_amount, 12345);
});
test('ordinary signed payment success remains idempotent without Stripe initialization', async () => {
  const f = fixture(ordinary()); f.state.attempts = [attempt()];
  for (let n = 0; n < 2; n++) assert.equal((await invoke(f.payments, '/webhook', signed(f, event()))).statusCode, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.ledger.length, 1); assert.equal(f.state.ledger[0].amount_cents, 12345);
  assert.equal(f.state.attempts[0].status, 'settled'); assert.equal(f.state.imports, 0);
});
for (const lateRows of [flagged, () => []]) for (const method of ['refunds.create', 'invoices.pay', 'subscriptions.create', 'customers.create', 'paymentIntents.create',
  'paymentIntents.retrieve', 'paymentIntents.cancel', 'checkout.sessions.create', 'checkout.sessions.retrieve',
  'checkout.sessions.expire', 'billingPortal.sessions.create']) {
  test(`retained adapter ${method} rechecks ${lateRows.name || "missing"} policy after await`, async () => {
    const f = fixture(ordinary()), client = await f.stripe.getStripeClient('shop');
    const fn = method.split('.').reduce((o, key) => o[key], client);
    f.state.rows = lateRows();
    await assert.rejects(() => fn('synthetic'), e => f.policy.isShopPolicyError(e));
    assert.deepEqual(f.state.calls, []); assert.deepEqual(f.state.writes, []);
  });
}
for (const lateRows of [flagged, () => Error('synthetic unavailable')]) for (const stage of ['owner lookup', 'customer create', 'customer mapping', 'reservation balance', 'webhook attempt', 'reconcile retrieve', 'token lookup', 'invoice send']) {
  test(`late ${lateRows.name || "unavailable"} policy at ${stage} stops next provider/mutation`, async () => {
    const f = fixture(ordinary());
    const expectedStatus = lateRows === flagged ? 409 : 503;
    const flip = () => { f.state.rows = lateRows(); };
    if (stage === 'owner lookup') {
      f.state.onQuery = async sql => { if (/SELECT email, name/.test(sql)) flip(); };
      const r = await invoke(f.subscriptions, '/checkout', { body: { plan: 'pro' } }); assert.equal(r.statusCode, expectedStatus);
    } else if (stage === 'customer create') {
      f.state.onProvider = async name => { if (name === 'customers.create') flip(); };
      assert.equal((await invoke(f.subscriptions, '/checkout', { body: { plan: 'pro' } })).statusCode, expectedStatus);
    } else if (stage === 'customer mapping') {
      f.state.onQuery = async sql => { if (/WHERE stripe_customer_id/.test(sql)) flip(); };
      assert.equal((await invoke(f.subscriptions, '/', signed(f, subscriptionEvent('customer.subscription.updated')))).statusCode, expectedStatus);
    } else if (stage === 'reservation balance') {
      f.state.onQuery = async sql => { if (/SELECT \* FROM ro_payments/.test(sql)) flip(); };
      await assert.rejects(() => f.reservations.reservePayment({ roId: 'ro', shopId: 'shop', kind: 'intent' }), e => f.policy.isShopPolicyError(e));
    } else if (stage === 'webhook attempt') {
      f.state.attempts = [attempt()];
      f.state.onQuery = async sql => { if (/SELECT \* FROM ro_payment_attempts WHERE id/.test(sql)) flip(); };
      assert.equal((await invoke(f.payments, '/webhook', signed(f, event()))).statusCode, expectedStatus);
    } else if (stage === 'reconcile retrieve') {
      f.state.attempts = [attempt()]; f.state.onProvider = async () => flip();
      await assert.rejects(() => f.reservations.reconcileReservations({ roId: 'ro', shopId: 'shop' }), e => f.policy.isShopPolicyError(e));
      assert.equal(f.state.calls[0][0], 'paymentIntents.retrieve'); assert.equal(f.state.attempts[0].status, 'open');
    } else if (stage === 'token lookup') {
      f.state.onQuery = async sql => { if (/FROM portal_tokens/.test(sql)) flip(); };
      await assert.rejects(() => f.billing.ensureTrackingToken('ro', 'shop'), e => f.policy.isShopPolicyError(e));
    } else {
      Object.assign(f.state.ro, { payment_status: 'paid', customer_email: 'local@example.invalid' }); f.state.token = 'synthetic';
      f.state.onProvider = async () => flip();
      await assert.rejects(() => f.billing.sendClosedPaidInvoiceEmail({ roId: 'ro', shopId: 'shop', force: true }), e => f.policy.isShopPolicyError(e));
    }
    assert.deepEqual(f.state.writes, []);
    assert.equal(f.state.calls.length, ['customer create', 'reconcile retrieve', 'invoice send'].includes(stage) ? 1 : 0);
  });
}
test('hold and public registration remain unchanged safety gates', () => {
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/db/internalTestShop.js'), 'utf8'), /shops_internal_test_shop_hold/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/routes/auth.js'), 'utf8'), /is_internal_test_shop/);
});

test('late flag after intent creation preserves committed reservation without binding or release', async () => {
  const f = fixture(ordinary());
  f.state.onProvider = async () => { f.state.rows = flagged(); };
  const r = await invoke(f.payments, '/intent', { body: { ro_id: 'ro' } });
  assert.equal(r.statusCode, 409); assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.writes.length, 1); assert.match(f.state.writes[0][0], /INSERT INTO ro_payment_attempts/);
  assert.equal(f.state.attempts[0].status, 'reserved');
  assert.equal(f.state.attempts[0].stripe_payment_intent_id, undefined);
});
test('late flag during Checkout retrieval prevents expiry, intent lookup and audit', async () => {
  const f = fixture(ordinary()); f.state.attempts = [attempt('checkout')];
  f.state.onProvider = async () => { f.state.rows = flagged(); };
  await assert.rejects(() => f.reservations.reconcileReservations({ roId: 'ro', shopId: 'shop' }), /INTERNAL_TEST_SHOP/);
  assert.deepEqual(f.state.calls.map(c => c[0]), ['checkout.sessions.retrieve']);
  assert.deepEqual(f.state.writes, []); assert.equal(f.state.attempts[0].status, 'open');
});
test('late unavailable policy prevents legacy reservation adoption', async () => {
  const f = fixture(ordinary()); f.state.ledger = [{ stripe_payment_intent_id: 'pi_mock', amount_cents: 12345, status: 'failed' }];
  f.state.onQuery = async sql => { if (/SELECT \* FROM ro_payments/.test(sql)) f.state.rows = []; };
  await assert.rejects(() => f.reservations.reconcileReservations({ roId: 'ro', shopId: 'shop' }), /SHOP_POLICY_UNAVAILABLE/);
  zero(f); assert.equal(f.state.attempts.length, 0);
});
test('ordinary scoped adapter reconciliation keeps cancellation and audit safeguards', async () => {
  const f = fixture(ordinary()); f.state.attempts = [attempt()];
  await f.reservations.reconcileLocked(f.client, f.state.ro, { reason: 'staff' });
  assert.deepEqual(f.state.calls.map(c => c[0]), ['paymentIntents.retrieve', 'paymentIntents.cancel']);
  assert.equal(f.state.writes.find(([sql]) => /UPDATE ro_payment_attempts SET status/.test(sql))[1][0], 'released');
  assert.equal(f.state.writes.filter(([sql]) => /INSERT INTO ro_payment_attempt_audit/.test(sql)).length, 1);
});
test('ordinary cancellation timeout persists unknown and never releases capacity', async () => {
  const f = fixture(ordinary()); f.state.attempts = [attempt()];
  f.state.onProvider = async name => { if (name.endsWith('.cancel')) throw Error('synthetic timeout'); };
  await f.reservations.reconcileLocked(f.client, f.state.ro, { reason: 'staff' });
  assert.equal(f.state.writes.find(([sql]) => /UPDATE ro_payment_attempts SET status/.test(sql))[1][0], 'unknown');
  assert.equal(f.state.writes.filter(([sql]) => /INSERT INTO ro_payment_attempt_audit/.test(sql)).length, 1);
});
