const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
// Preserve the real pure decimal helper used transitively by panel approvals.
const { exactMoney } = require('../services/roMoney');

function installMock(relativePath, exportsValue) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue,
  };
}

function clearModules(names) {
  const segments = names.map((name) => `${path.sep}backend${path.sep}src${path.sep}${name}`);
  for (const key of Object.keys(require.cache)) {
    if (segments.some((segment) => key.includes(segment))) delete require.cache[key];
  }
}

function inject(app, { method, url, headers = {}, body = Buffer.alloc(0) }) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body.length ? [body] : []);
    req.method = method;
    req.url = url;
    req.headers = {
      host: '127.0.0.1',
      'content-length': String(body.length),
      ...headers,
    };
    req.connection = { remoteAddress: '127.0.0.1' };
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

function installRosMocks({ paymentStatus = 'partial' } = {}) {
  clearModules([
    `routes${path.sep}ros.js`,
    `middleware${path.sep}auth.js`,
    `middleware${path.sep}roles.js`,
    `services${path.sep}roMoney.js`,
    `services${path.sep}paymentReservations.js`,
  ]);

  const calls = { dbRun: [] };
  installMock('../db', {
    pool: {},
    async dbGet(sql, params = []) {
      const text = String(sql);
      if (/SELECT \* FROM repair_orders WHERE id = \$1 AND shop_id = \$2/.test(text)) {
        return { id: params[0], shop_id: params[1], status: 'delivery', payment_status: paymentStatus };
      }
      if (/SELECT \* FROM repair_orders WHERE id = \$1$/.test(text)) {
        return { id: params[0], shop_id: 'shop-1', status: 'delivery', payment_status: paymentStatus };
      }
      if (/SELECT ro\.\*/.test(text)) {
        return { id: params[0], shop_id: 'shop-1', status: 'delivery', payment_status: paymentStatus, log: [], parts: [] };
      }
      return null;
    },
    async dbAll() { return []; },
    async dbRun(sql, params = []) {
      calls.dbRun.push({ sql: String(sql), params });
      return { rowCount: 1 };
    },
  });
  installMock('../middleware/auth', (req, _res, next) => {
    req.user = { id: 'user-1', role: 'admin', shop_id: 'shop-1' };
    next();
  });
  installMock('../middleware/roles', {
    ROLE_RANK: { owner: 4, admin: 3, technician: 2 },
    getRoleRank: (role) => ({ owner: 4, admin: 3, technician: 2 }[role] || -1),
    requireAdmin: (_req, _res, next) => next(),
    requireTechnician: (_req, _res, next) => next(),
  });
  installMock('../services/roMoney', {
    exactMoney,
    getRoMoneySummary: async () => ({ lineCount: 1, totalCents: 10000 }),
    isPaidStatus: (status) => String(status || '').toLowerCase() === 'paid',
  });
  installMock('../services/profit', { calculateProfit: () => ({ trueProfit: 0 }) });
  installMock('../services/sms', { sendSMS: async () => ({}), isConfiguredForShop: async () => false });
  installMock('../services/mailer', { sendMail: async () => ({}) });
  installMock('../services/emailTemplates', { statusChangeEmail: () => ({ subject: '', html: '' }) });
  installMock('../services/notifications', { createNotification: async () => ({}) });
  installMock('../services/deliveryFees', { calculateDeliveryFeeBreakdown: () => ({}), toMoney: (value) => value });
  installMock('../services/customerBilling', {
    createPaymentCheckoutLinkForRo: async () => ({}),
    ensureTrackingToken: async () => 'token',
    sendClosedPaidInvoiceEmail: async () => ({}),
  });
  installMock('../services/quickbooks', { syncInvoiceForRo: async () => ({}) });
  installMock('../services/customerOptInConfirmation', { sendCustomerOptInConfirmation: async () => ({}) });
  installMock('../middleware/roLimitGuard', (_req, _res, next) => next());
  installMock('../routes/insuranceOcr', { insuranceOcrLimiter: (_req, _res, next) => next() });

  const app = express();
  app.use(express.json());
  app.use('/api/ros', require('../routes/ros'));
  return { app, calls };
}

function installPaymentsMocks({ paidCents = 0, owedCents = 10000 } = {}) {
  clearModules([
    `routes${path.sep}payments.js`,
    `middleware${path.sep}auth.js`,
    `middleware${path.sep}roles.js`,
    `services${path.sep}stripe.js`,
    `services${path.sep}roMoney.js`,
    `services${path.sep}paymentReservations.js`,
  ]);

  const state = { repairOrderUpdate: null, createIntentCalled: false };
  const client = { release() {}, async query(sql, params = []) {
    state.queries.push(String(sql));
    if (/SELECT \* FROM repair_orders/.test(sql)) {
      assert.match(sql, /shop_id = \$2 FOR UPDATE/);
      return { rows: [{ id: params[0], shop_id: params[1], ro_number: 'RO-1', customer_id: null }] };
    }
    if (/UPDATE repair_orders/.test(sql)) state.repairOrderUpdate = { sql: String(sql), params };
    return { rows: [], rowCount: 1 };
  } };
  state.queries = [];
  installMock('../db', {
    pool: { connect: async () => client, query: () => { throw Error('Money escaped transaction'); } },
    async dbGet() { return null; }, async dbAll() { return []; },
    async dbRun() { throw Error('Payment write escaped transaction'); },
  });
  installMock('../middleware/auth', (req, _res, next) => {
    req.user = { id: 'user-1', role: 'admin', shop_id: 'shop-1' };
    next();
  });
  installMock('../middleware/roles', { requireTechnician: (_req, _res, next) => next() });
  installMock('../services/stripe', {
    getStripeClient: () => ({}),
    createPaymentIntent: async (...args) => {
      state.createIntentCalled = true;
      return { id: 'pi_1', client_secret: 'secret', currency: 'usd', status: 'requires_payment_method', args };
    },
    constructWebhookEvent: () => ({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          amount: paidCents,
          amount_received: paidCents,
          currency: 'usd',
          created: 1700000000,
          metadata: { roId: 'ro-1', shopId: 'shop-1' },
        },
      },
    }),
  });
  installMock('../services/roMoney', {
    exactMoney,
    getRoMoneySummary: async (roId, shopId, usedClient) => {
      assert.equal(usedClient, client); return { lineCount: 1, totalCents: owedCents };
    },
    // No prior ledger: the webhook adds this event's amount exactly once.
    getPaidCents: async (roId, shopId, usedClient) => { assert.equal(usedClient, client); return 0; },
    reconcilePaymentStatus: ({ paidCents: paid, owedCents: owed }) => (paid >= owed ? 'paid' : paid > 0 ? 'partial' : 'unpaid'),
  });
  installMock('../services/notifications', { createNotification: async () => ({}) });
  installMock('../services/mailer', { sendMail: async () => ({}) });
  installMock('../services/emailTemplates', { paymentConfirmationEmail: () => ({ subject: '', html: '' }) });
  installMock('../services/customerBilling', {
    createPaymentCheckoutLinkForRo: async () => ({}),
    sendClosedPaidInvoiceEmail: async () => ({}),
  });

  const app = express();
  app.use(express.json());
  app.use('/api/payments', require('../routes/payments'));
  return { app, state };
}

test('PATCH /api/ros/:id rejects client-controlled scalar money fields', async () => {
  const { app, calls } = installRosMocks({ paymentStatus: 'unpaid' });

  const res = await inject(app, {
    method: 'PATCH',
    url: '/api/ros/ro-1',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ total: 1, tax: 1, parts_cost: 1, labor_cost: 1, sublet_cost: 1 })),
  });

  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'No valid fields to update');
  assert.equal(calls.dbRun.length, 0);
});

test('partial payment status cannot close an RO', async () => {
  const { app } = installRosMocks({ paymentStatus: 'partial' });

  const res = await inject(app, {
    method: 'PUT',
    url: '/api/ros/ro-1/status',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ status: 'closed' })),
  });

  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'Payment must be received before closing this RO');
});

test('payment intent rejects underpayment unless explicitly partial', async () => {
  const { app, state } = installPaymentsMocks({ owedCents: 10000 });

  const res = await inject(app, {
    method: 'POST',
    url: '/api/payments/intent',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ ro_id: 'ro-1', amount: 5000 })),
  });

  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'Payment amount must match the server-calculated amount owed');
  assert.equal(state.createIntentCalled, false);
});

test('payment webhook reconciles partial and paid statuses from cents', async () => {
  let setup = installPaymentsMocks({ paidCents: 5000, owedCents: 10000 });
  let res = await inject(setup.app, {
    method: 'POST',
    url: '/api/payments/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'sig' },
    body: Buffer.from(JSON.stringify({})),
  });
  assert.equal(res.status, 200);
  assert.equal(setup.state.repairOrderUpdate.params[0], 'partial');
  assert.equal(setup.state.repairOrderUpdate.params[2], 0);
  assert.equal(setup.state.repairOrderUpdate.params[6], 5000);
  assert.equal(setup.state.repairOrderUpdate.params[7], 10000);
  assert.equal(setup.state.queries.at(-1), 'COMMIT');
  assert.deepEqual(setup.state.repairOrderUpdate.params.slice(8), ['ro-1', 'shop-1']);

  setup = installPaymentsMocks({ paidCents: 10000, owedCents: 10000 });
  res = await inject(setup.app, {
    method: 'POST',
    url: '/api/payments/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'sig' },
    body: Buffer.from(JSON.stringify({})),
  });
  assert.equal(res.status, 200);
  assert.equal(setup.state.repairOrderUpdate.params[0], 'paid');
  assert.equal(setup.state.repairOrderUpdate.params[2], 1);
  assert.equal(setup.state.repairOrderUpdate.params[6], 10000);
  assert.equal(setup.state.repairOrderUpdate.params[7], 10000);
  assert.equal(setup.state.queries.at(-1), 'COMMIT');
  assert.deepEqual(setup.state.repairOrderUpdate.params.slice(8), ['ro-1', 'shop-1']);
});
