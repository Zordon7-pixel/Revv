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

function runGetRos({ role, userId, query = {} }) {
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

async function assertRoleQuery({ role, userId, query, assertSql }) {
  calls.length = 0;

  const res = await runGetRos({ role, userId, query });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ros: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ro\.shop_id = \$1/);
  assertSql(calls[0]);
}

test('GET /ros forces technician callers to their own assigned_to id', async () => {
  await assertRoleQuery({
    role: 'technician',
    userId: 'tech-1',
    query: { assigned_to: 'tech-2' },
    assertSql: ({ sql, params }) => {
      assert.match(sql, /ro\.assigned_to = \$2/);
      assert.deepEqual(params, ['shop-1', 'tech-1']);
    },
  });
});

for (const role of ['employee', 'staff']) {
  test(`GET /ros lets ${role} callers see the full shop board`, async () => {
    await assertRoleQuery({
      role,
      userId: `${role}-1`,
      query: { assigned_to: 'tech-2' },
      assertSql: ({ sql, params }) => {
        assert.doesNotMatch(sql, /ro\.assigned_to =/);
        assert.deepEqual(params, ['shop-1']);
      },
    });
  });
}

for (const role of ['assistant', 'admin', 'owner']) {
  test(`GET /ros does not force ${role} callers to their own assigned_to id`, async () => {
    await assertRoleQuery({
      role,
      userId: `${role}-1`,
      query: {},
      assertSql: ({ sql, params }) => {
        assert.doesNotMatch(sql, /ro\.assigned_to =/);
        assert.deepEqual(params, ['shop-1']);
      },
    });
  });
}
