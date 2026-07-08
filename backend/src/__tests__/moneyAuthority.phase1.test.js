const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

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
  ]);

  const state = { repairOrderUpdate: null, createIntentCalled: false };
  installMock('../db', {
    async dbGet(sql, params = []) {
      const text = String(sql);
      if (/FROM repair_orders WHERE id = \$1 AND shop_id = \$2/.test(text)) {
        return { id: params[0], shop_id: params[1], ro_number: 'RO-1', customer_id: null };
      }
      if (/SELECT id FROM ro_payments WHERE stripe_payment_intent_id/.test(text)) return { id: 'payment-1' };
      if (/SELECT ro_number FROM repair_orders/.test(text)) return { ro_number: 'RO-1' };
      return null;
    },
    async dbAll() { return []; },
    async dbRun(sql, params = []) {
      if (/UPDATE repair_orders/.test(String(sql))) state.repairOrderUpdate = { sql: String(sql), params };
      return { rowCount: 1 };
    },
  });
  installMock('../middleware/auth', (req, _res, next) => {
    req.user = { id: 'user-1', role: 'admin', shop_id: 'shop-1' };
    next();
  });
  installMock('../middleware/roles', { requireTechnician: (_req, _res, next) => next() });
  installMock('../services/stripe', {
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
    getRoMoneySummary: async () => ({ lineCount: 1, totalCents: owedCents }),
    getPaidCents: async () => paidCents,
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
  assert.equal(setup.state.repairOrderUpdate.params[7], 5000);
  assert.equal(setup.state.repairOrderUpdate.params[8], 10000);

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
  assert.equal(setup.state.repairOrderUpdate.params[7], 10000);
  assert.equal(setup.state.repairOrderUpdate.params[8], 10000);
});
