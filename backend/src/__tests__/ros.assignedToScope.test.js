const assert = require('node:assert/strict');
const test = require('node:test');

const calls = [];

function mockModule(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

mockModule('../db', {
  pool: {},
  dbGet: async () => null,
  dbRun: async () => ({ rowCount: 1 }),
  dbAll: async (sql, params) => {
    calls.push({ sql, params });
    return [];
  },
});
mockModule('../middleware/auth', (req, res, next) => next());
mockModule('../services/profit', { calculateProfit: () => ({}) });
mockModule('../services/sms', { sendSMS: async () => ({}), isConfiguredForShop: async () => true });
mockModule('../services/mailer', { sendMail: async () => ({}) });
mockModule('../services/emailTemplates', { statusChangeEmail: () => ({ subject: '', html: '' }) });
mockModule('../services/notifications', { createNotification: async () => ({}) });
mockModule('../services/deliveryFees', { calculateDeliveryFeeBreakdown: () => ({}), toMoney: (value) => value });
mockModule('../services/customerBilling', {
  createPaymentCheckoutLinkForRo: async () => ({}),
  ensureTrackingToken: async () => 'token',
  sendClosedPaidInvoiceEmail: async () => ({}),
});
mockModule('../services/quickbooks', { syncInvoiceForRo: async () => ({}) });
mockModule('../middleware/roLimitGuard', (req, res, next) => next());
mockModule('../routes/insuranceOcr', { insuranceOcrLimiter: (req, res, next) => next() });

const rosRouter = require('../routes/ros');

const getRosRoute = rosRouter.stack.find((layer) => (
  layer.route?.path === '/' && layer.route?.methods?.get
)).route.stack;

function runGetRos({ role, userId, query }) {
  const req = {
    headers: {},
    query,
    user: {
      id: userId,
      role,
      shop_id: 'shop-1',
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  return new Promise((resolve, reject) => {
    let index = 0;
    const next = (err) => {
      if (err) return reject(err);
      const layer = getRosRoute[index++];
      if (!layer) return resolve(res);
      try {
        const result = layer.handle(req, res, next);
        if (result?.then) {
          result.then(() => {
            if (index >= getRosRoute.length) resolve(res);
          }, reject);
        }
      } catch (error) {
        reject(error);
      }
    };
    next();
  });
}

test('GET /ros lets assistant callers filter by arbitrary assigned_to within shop scope', async () => {
  calls.length = 0;

  const res = await runGetRos({
    role: 'assistant',
    userId: 'assistant-1',
    query: { assigned_to: 'tech-2' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ros: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ro\.shop_id = \$1/);
  assert.match(calls[0].sql, /ro\.assigned_to = \$2/);
  assert.deepEqual(calls[0].params, ['shop-1', 'tech-2']);
});

test('GET /ros forces technician callers to their own assigned_to id', async () => {
  calls.length = 0;

  const res = await runGetRos({
    role: 'technician',
    userId: 'tech-1',
    query: { assigned_to: 'tech-2' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ros: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ro\.shop_id = \$1/);
  assert.match(calls[0].sql, /ro\.assigned_to = \$2/);
  assert.deepEqual(calls[0].params, ['shop-1', 'tech-1']);
});
