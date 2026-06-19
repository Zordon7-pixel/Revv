const assert = require('node:assert/strict');
const test = require('node:test');

const calls = {
  dbGet: [],
  dbRun: [],
  dbAll: [],
  sendSMS: [],
  sendClosedPaidInvoiceEmail: [],
};

const state = {
  initialRo: null,
  updatedRo: null,
};

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
  dbGet: async (sql, params) => {
    calls.dbGet.push({ sql, params });
    if (/FROM repair_orders\s+WHERE id = \$1 AND shop_id = \$2/.test(sql)) {
      return state.initialRo;
    }
    if (/SELECT \* FROM repair_orders WHERE id = \$1$/.test(sql)) {
      return state.updatedRo;
    }
    if (/SELECT ro\.\*/.test(sql) && /WHERE ro\.id = \$1/.test(sql)) {
      return {
        ...state.updatedRo,
        vehicle: null,
        customer: null,
        assigned_tech: null,
        log: [],
        parts: [],
      };
    }
    return null;
  },
  dbRun: async (sql, params) => {
    calls.dbRun.push({ sql, params });
    return { rowCount: 1 };
  },
  dbAll: async (sql, params) => {
    calls.dbAll.push({ sql, params });
    return [];
  },
});
mockModule('../middleware/auth', (req, res, next) => next());
mockModule('../middleware/roles', {
  ROLE_RANK: { admin: 3 },
  getRoleRank: (role) => (role === 'assistant' || role === 'admin' || role === 'owner' ? 3 : 1),
  requireAdmin: (req, res, next) => next(),
  requireTechnician: (req, res, next) => next(),
});
mockModule('../services/profit', { calculateProfit: () => ({ trueProfit: 123 }) });
mockModule('../services/sms', {
  sendSMS: async (...args) => {
    calls.sendSMS.push(args);
    return { ok: true };
  },
  isConfiguredForShop: async () => true,
});
mockModule('../services/mailer', { sendMail: async () => ({}) });
mockModule('../services/emailTemplates', { statusChangeEmail: () => ({ subject: '', html: '' }) });
mockModule('../services/notifications', { createNotification: async () => ({}) });
mockModule('../services/deliveryFees', { calculateDeliveryFeeBreakdown: () => ({}), toMoney: (value) => value });
mockModule('../services/customerBilling', {
  createPaymentCheckoutLinkForRo: async () => ({}),
  ensureTrackingToken: async () => 'token',
  sendClosedPaidInvoiceEmail: async (...args) => {
    calls.sendClosedPaidInvoiceEmail.push(args);
    return {};
  },
});
mockModule('../services/quickbooks', { syncInvoiceForRo: async () => ({}) });
mockModule('../services/customerOptInConfirmation', { sendCustomerOptInConfirmation: async () => ({}) });
mockModule('../middleware/roLimitGuard', (req, res, next) => next());
mockModule('../routes/insuranceOcr', { insuranceOcrLimiter: (req, res, next) => next() });

const rosRouter = require('../routes/ros');

function resetCalls() {
  Object.values(calls).forEach((list) => {
    list.length = 0;
  });
}

function runRoute(routePath, method, { params = {}, query = {}, body = {}, user = {} } = {}) {
  const route = rosRouter.stack.find((layer) => (
    layer.route?.path === routePath && layer.route?.methods?.[method]
  ))?.route;
  assert.ok(route, `${method.toUpperCase()} ${routePath} route exists`);

  const req = {
    headers: {},
    params,
    query,
    body,
    user: {
      id: 'tech-1',
      role: 'technician',
      shop_id: 'shop-1',
      ...user,
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
      const layer = route.stack[index++];
      if (!layer) return resolve(res);
      try {
        const result = layer.handle(req, res, next);
        if (result?.then) result.then(() => {
          if (index >= route.stack.length) resolve(res);
        }, reject);
      } catch (error) {
        reject(error);
      }
    };
    next();
  });
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

test('PUT /ros/:id/status total_loss stamps close date, logs status, and skips invoice/SMS side effects', async () => {
  resetCalls();
  state.initialRo = {
    id: 'ro-1',
    shop_id: 'shop-1',
    ro_number: 'RO-1',
    status: 'repair',
    total: 999,
    true_profit: 222,
  };
  state.updatedRo = {
    ...state.initialRo,
    status: 'total_loss',
    actual_delivery: new Date().toISOString().split('T')[0],
  };

  const res = await runRoute('/:id/status', 'put', {
    params: { id: 'ro-1' },
    body: { status: 'total_loss', note: 'Carrier declared total loss' },
  });
  await nextTick();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'total_loss');
  assert.equal(res.body.total, 999);
  assert.equal(res.body.true_profit, 222);

  const update = calls.dbRun.find((call) => /UPDATE repair_orders SET status = \$1/.test(call.sql));
  assert.ok(update);
  assert.match(update.sql, /actual_delivery = \$3/);
  assert.match(update.sql, /WHERE id = \$4 AND shop_id = \$5/);
  assert.deepEqual(update.params.slice(0, 1), ['total_loss']);
  assert.equal(update.params[4], 'shop-1');
  assert.doesNotMatch(update.sql, /total\s*=|true_profit|payment_received|payment_status/);

  const log = calls.dbRun.find((call) => /INSERT INTO job_status_log/.test(call.sql));
  assert.ok(log);
  assert.equal(log.params[2], 'repair');
  assert.equal(log.params[3], 'total_loss');
  assert.equal(log.params[5], 'Carrier declared total loss');

  assert.equal(calls.sendSMS.length, 0);
  assert.equal(calls.sendClosedPaidInvoiceEmail.length, 0);
});

test('PUT /ros/:id/status is scoped to shop_id and cannot total another shop RO', async () => {
  resetCalls();
  state.initialRo = null;
  state.updatedRo = null;

  const res = await runRoute('/:id/status', 'put', {
    params: { id: 'other-shop-ro' },
    body: { status: 'total_loss' },
  });

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Not found' });
  assert.equal(calls.dbRun.length, 0);
  assert.match(calls.dbGet[0].sql, /WHERE id = \$1 AND shop_id = \$2/);
  assert.deepEqual(calls.dbGet[0].params, ['other-shop-ro', 'shop-1']);
});

test('GET /ros classifies total_loss as completed, not open', async () => {
  resetCalls();
  state.initialRo = null;
  state.updatedRo = null;

  let res = await runRoute('/', 'get', { query: { status: 'completed' } });
  assert.equal(res.statusCode, 200);
  assert.match(calls.dbAll[0].sql, /IN \('closed', 'completed', 'total_loss'\)/);

  resetCalls();
  res = await runRoute('/', 'get', { query: { status: 'open' } });
  assert.equal(res.statusCode, 200);
  assert.match(calls.dbAll[0].sql, /NOT IN \('closed', 'completed', 'total_loss'\)/);
});
