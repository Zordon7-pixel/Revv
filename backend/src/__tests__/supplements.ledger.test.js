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

function clearRosCache() {
  const segments = [
    `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}ros.js`,
    `${path.sep}backend${path.sep}src${path.sep}middleware${path.sep}auth.js`,
    `${path.sep}backend${path.sep}src${path.sep}middleware${path.sep}roles.js`,
  ];
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

function buildApp() {
  clearRosCache();
  const supplements = [];
  const repairOrder = {
    id: 'ro-1',
    shop_id: 'shop-1',
    ro_number: 'RO-1',
    insurance_approved_amount: 100000,
    supplement_status: 'none',
    supplement_amount: null,
    supplement_notes: null,
    total_insurer_owed: 100000,
  };

  const db = {
    pool: {},
    async dbAll() {
      return [];
    },
    async dbGet(sql, params = []) {
      const text = String(sql);
      if (/FROM repair_orders/i.test(text) && /WHERE id::text = \$1::text AND shop_id::text = \$2::text/i.test(text)) {
        return params[0] === repairOrder.id && params[1] === repairOrder.shop_id ? { ...repairOrder } : null;
      }
      if (/FROM ro_supplements/i.test(text) && /COALESCE\(amount_cents/i.test(text)) {
        const [roId, shopId, amountCents, notes] = params;
        return supplements.find((s) => (
          s.ro_id === roId &&
          s.shop_id === shopId &&
          s.amount_cents === amountCents &&
          (s.notes || '') === notes &&
          ['requested', 'pending', 'approved'].includes(String(s.status || '').toLowerCase())
        )) || null;
      }
      if (/COALESCE\(ro\.insurance_approved_amount/i.test(text) && /LEFT JOIN ro_supplements/i.test(text)) {
        const [roId, shopId] = params;
        if (roId !== repairOrder.id || shopId !== repairOrder.shop_id) return null;
        const supplementTotal = supplements
          .filter((s) => s.ro_id === roId && s.shop_id === shopId)
          .filter((s) => ['requested', 'pending', 'approved'].includes(String(s.status || '').toLowerCase()))
          .reduce((sum, s) => sum + Number(s.amount_cents || 0), 0);
        return {
          insurance_approved_amount: repairOrder.insurance_approved_amount,
          supplement_total_cents: supplementTotal,
        };
      }
      if (/SELECT id, amount_cents, amount, status, notes/i.test(text) && /FROM ro_supplements/i.test(text)) {
        const [roId, shopId] = params;
        return supplements.filter((s) => s.ro_id === roId && s.shop_id === shopId).at(-1) || null;
      }
      if (/SELECT id\s+FROM ro_supplements/i.test(text)) {
        const [supplementId, roId, shopId] = params;
        return supplements.find((s) => s.id === supplementId && s.ro_id === roId && s.shop_id === shopId) || null;
      }
      return null;
    },
    async dbRun(sql, params = []) {
      const text = String(sql);
      if (/INSERT INTO ro_supplements/i.test(text)) {
        supplements.push({
          id: params[0],
          ro_id: params[1],
          shop_id: params[2],
          description: params[3],
          amount: params[4],
          amount_cents: params[5],
          status: params[6],
          notes: params[7],
        });
        return { rowCount: 1 };
      }
      if (/UPDATE repair_orders/i.test(text) && /total_insurer_owed/i.test(text)) {
        repairOrder.supplement_status = params[0];
        repairOrder.supplement_amount = params[1];
        repairOrder.supplement_notes = params[2];
        repairOrder.total_insurer_owed = params[3];
        return { rowCount: 1 };
      }
      if (/UPDATE ro_supplements/i.test(text) && /SET status/i.test(text)) {
        const supplement = supplements.find((s) => s.id === params[2] && s.ro_id === params[3] && s.shop_id === params[4]);
        if (supplement) supplement.status = params[0];
        return { rowCount: supplement ? 1 : 0 };
      }
      return { rowCount: 1 };
    },
  };

  installMock('../db', db);
  installMock('../middleware/auth', (req, _res, next) => {
    req.user = { id: 'user-1', role: 'admin', shop_id: 'shop-1' };
    next();
  });
  installMock('../middleware/roles', {
    ROLE_RANK: { superadmin: 5, owner: 4, admin: 3, assistant: 3, technician: 2 },
    getRoleRank: (role) => ({ superadmin: 5, owner: 4, admin: 3, assistant: 3, technician: 2 }[role] ?? -1),
    requireAdmin: (_req, _res, next) => next(),
    requireTechnician: (_req, _res, next) => next(),
  });
  installMock('../services/profit', { calculateProfit: () => ({}) });
  installMock('../services/sms', { sendSMS: async () => ({}), isConfiguredForShop: async () => true });
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
  return { app, supplements, repairOrder };
}

test('supplement requests accumulate in total_insurer_owed instead of overwriting', async () => {
  const { app, repairOrder, supplements } = buildApp();

  const first = await inject(app, {
    method: 'POST',
    url: '/api/ros/ro-1/supplement',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ amount: 50000, notes: 'first supplement' })),
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.total_insurer_owed, 150000);

  const second = await inject(app, {
    method: 'POST',
    url: '/api/ros/ro-1/supplement',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ amount: 30000, notes: 'second supplement' })),
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.total_insurer_owed, 180000);
  assert.equal(repairOrder.total_insurer_owed, 180000);
  assert.equal(supplements.length, 2);
});

test('denied supplements are excluded from total_insurer_owed', async () => {
  const { app, supplements, repairOrder } = buildApp();

  await inject(app, {
    method: 'POST',
    url: '/api/ros/ro-1/supplement',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ amount: 50000, notes: 'first supplement' })),
  });
  const second = await inject(app, {
    method: 'POST',
    url: '/api/ros/ro-1/supplement',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ amount: 30000, notes: 'second supplement' })),
  });

  const deny = await inject(app, {
    method: 'PATCH',
    url: `/api/ros/ro-1/supplement/${second.json.supplement_id}`,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ status: 'denied' })),
  });

  assert.equal(deny.status, 200);
  assert.equal(deny.json.total_insurer_owed, 150000);
  assert.equal(repairOrder.total_insurer_owed, 150000);
  assert.equal(supplements.find((s) => s.id === second.json.supplement_id).status, 'denied');
});

test('duplicate active supplement submission is idempotent and does not double-count', async () => {
  const { app, supplements, repairOrder } = buildApp();
  const payload = { amount: 50000, notes: 'same logical supplement' };

  const first = await inject(app, {
    method: 'POST',
    url: '/api/ros/ro-1/supplement',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(payload)),
  });
  const duplicate = await inject(app, {
    method: 'POST',
    url: '/api/ros/ro-1/supplement',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(payload)),
  });

  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.json.duplicate, true);
  assert.equal(duplicate.json.supplement_id, first.json.supplement_id);
  assert.equal(supplements.length, 1);
  assert.equal(repairOrder.total_insurer_owed, 150000);
});
