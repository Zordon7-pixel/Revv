const assert = require('node:assert/strict');
const test = require('node:test');

const calls = {
  dbGet: [],
  dbRun: [],
  dbAll: [],
  sendClosedPaidInvoiceEmail: [],
  syncInvoiceForRo: [],
};

const state = {
  ro: null,
};

function mockModule(relativePath, exportsValue) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue,
  };
}

function reset({ status = 'repair', payment_received = false } = {}) {
  Object.values(calls).forEach((list) => {
    list.length = 0;
  });
  state.ro = {
    id: 'ro-1',
    shop_id: 'shop-1',
    ro_number: 'RO-1',
    status,
    payment_received,
    payment_status: payment_received ? 'paid' : 'unpaid',
    total: 0,
    true_profit: 0,
  };
}

mockModule('../db', {
  pool: {},
  dbGet: async (sql, params = []) => {
    calls.dbGet.push({ sql: String(sql), params });
    const text = String(sql);
    if (/FROM repair_orders\s+WHERE id = \$1 AND shop_id = \$2/.test(text)) {
      return params[0] === state.ro?.id && params[1] === state.ro?.shop_id ? { ...state.ro } : null;
    }
    if (/SELECT \* FROM repair_orders WHERE id = \$1$/.test(text)) {
      return params[0] === state.ro?.id ? { ...state.ro } : null;
    }
    if (/SELECT ro\.\*/.test(text) && /WHERE ro\.id = \$1/.test(text)) {
      return {
        ...state.ro,
        vehicle: null,
        customer: null,
        assigned_tech: null,
        log: [],
        parts: [],
      };
    }
    if (/FROM shops/.test(text)) {
      return {
        quickbooks_sync_enabled: true,
        quickbooks_realm_id: 'realm-1',
        quickbooks_refresh_token: 'refresh-1',
      };
    }
    return null;
  },
  dbRun: async (sql, params = []) => {
    calls.dbRun.push({ sql: String(sql), params });
    if (/UPDATE repair_orders SET status = \$1/.test(String(sql))) {
      state.ro.status = params[0];
      state.ro.updated_at = params[1];
      if (/actual_delivery = \$3/.test(String(sql))) {
        state.ro.actual_delivery = params[2];
      }
    }
    return { rowCount: 1 };
  },
  dbAll: async (sql, params = []) => {
    calls.dbAll.push({ sql: String(sql), params });
    return [];
  },
});
mockModule('../middleware/auth', (req, _res, next) => next());
mockModule('../middleware/roles', {
  ROLE_RANK: { superadmin: 5, owner: 4, admin: 3, assistant: 3, technician: 2 },
  getRoleRank: (role) => ({ superadmin: 5, owner: 4, admin: 3, assistant: 3, technician: 2 }[role] ?? -1),
  requireAdmin: (_req, _res, next) => next(),
  requireTechnician: (_req, _res, next) => next(),
});
mockModule('../services/profit', { calculateProfit: () => ({ trueProfit: 0 }) });
mockModule('../services/sms', { sendSMS: async () => ({}), isConfiguredForShop: async () => true });
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
mockModule('../services/quickbooks', {
  syncInvoiceForRo: async (...args) => {
    calls.syncInvoiceForRo.push(args);
    return {};
  },
});
mockModule('../services/customerOptInConfirmation', { sendCustomerOptInConfirmation: async () => ({}) });
mockModule('../middleware/roLimitGuard', (_req, _res, next) => next());
mockModule('../routes/insuranceOcr', { insuranceOcrLimiter: (_req, _res, next) => next() });

const rosRouter = require('../routes/ros');

function runRoute(routePath, method, { params = {}, body = {}, user = {} } = {}) {
  const route = rosRouter.stack.find((layer) => (
    layer.route?.path === routePath && layer.route?.methods?.[method]
  ))?.route;
  assert.ok(route, `${method.toUpperCase()} ${routePath} route exists`);

  const req = {
    headers: {},
    params,
    query: {},
    body,
    user: {
      id: 'user-1',
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
        if (result?.then) {
          result.then(() => {
            if (index >= route.stack.length) resolve(res);
          }, reject);
        }
      } catch (error) {
        reject(error);
      }
    };
    next();
  });
}

const nextImmediate = () => new Promise((resolve) => setImmediate(resolve));

test('PUT /ros/:id/status blocks closing an unpaid RO before side effects', async () => {
  reset({ status: 'delivery', payment_received: false });

  const res = await runRoute('/:id/status', 'put', {
    params: { id: 'ro-1' },
    body: { status: 'closed' },
  });
  await nextImmediate();

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Payment must be received before closing this RO' });
  assert.equal(calls.dbRun.length, 0);
  assert.equal(calls.sendClosedPaidInvoiceEmail.length, 0);
  assert.equal(calls.syncInvoiceForRo.length, 0);
});

test('PUT /ros/:id/status blocks technicians from reopening closed ROs', async () => {
  reset({ status: 'closed', payment_received: true });

  const res = await runRoute('/:id/status', 'put', {
    params: { id: 'ro-1' },
    body: { status: 'repair' },
    user: { role: 'technician' },
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Only admins can reopen a closed RO' });
  assert.equal(calls.dbRun.length, 0);
});

test('PUT /ros/:id/status blocks normal workflow movement during SIU hold', async () => {
  reset({ status: 'siu_hold', payment_received: true });

  const res = await runRoute('/:id/status', 'put', {
    params: { id: 'ro-1' },
    body: { status: 'repair' },
    user: { role: 'admin' },
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: 'This RO is under SIU investigation. Clear the SIU hold before changing status.',
  });
  assert.equal(calls.dbRun.length, 0);
});

test('PUT /ros/:id/status allows a legitimate paid close and fires closed side effects once', async () => {
  reset({ status: 'delivery', payment_received: true });

  const res = await runRoute('/:id/status', 'put', {
    params: { id: 'ro-1' },
    body: { status: 'closed', note: 'Vehicle picked up and paid' },
    user: { role: 'admin' },
  });
  await nextImmediate();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'closed');

  const update = calls.dbRun.find((call) => /UPDATE repair_orders SET status = \$1/.test(call.sql));
  assert.ok(update);
  assert.equal(update.params[0], 'closed');

  const log = calls.dbRun.find((call) => /INSERT INTO job_status_log/.test(call.sql));
  assert.ok(log);
  assert.equal(log.params[2], 'delivery');
  assert.equal(log.params[3], 'closed');
  assert.equal(log.params[5], 'Vehicle picked up and paid');

  assert.equal(calls.sendClosedPaidInvoiceEmail.length, 1);
  assert.deepEqual(calls.sendClosedPaidInvoiceEmail[0], [{ roId: 'ro-1', shopId: 'shop-1' }]);
  assert.equal(calls.syncInvoiceForRo.length, 1);
  assert.deepEqual(calls.syncInvoiceForRo[0], ['shop-1', 'ro-1']);
});
