const assert = require('node:assert/strict');
const test = require('node:test');

const calls = {
  stripe: [],
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
  state.attempts = [];
  state.ledger = [];
  state.totalCents = 0;
  state.lineCount = 0;
  state.selectedMoney = null;
  state.failOn = null;
  state.persisted = [];
  state.transactions = [];
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
  pool: {
    async connect() {
      // Synthetic transaction adapter: serialize parent locks and undo all writes
      // on failure. The real withLockedRo and money authority execute unchanged.
      let unlock;
      const predecessor = state.lock || Promise.resolve();
      state.lock = new Promise(resolve => { unlock = resolve; });
      await predecessor;
      const snapshot = structuredClone({ ro: state.ro, persisted: state.persisted });
      return {
        release() { unlock(); },
        async query(sql, params = []) {
          const text = String(sql);
          state.transactions.push(text);
          if (state.failOn && text.includes(state.failOn)) throw new Error('Synthetic write failure');
          if (text === 'ROLLBACK') { Object.assign(state, snapshot); return { rows: [] }; }
          if (/^(BEGIN|COMMIT)/.test(text)) return { rows: [] };
          if (text.includes("to_regclass('ro_panel_estimator_revisions')")) return { rows: [{ revisions: !!state.selectedMoney, pointer: !!state.selectedMoney }] };
          if (text.includes('SELECT d.active_revision_id')) return { rows: [{ active_revision_id: 'revision-1', accounting_snapshot: { money: state.selectedMoney } }] };
          if (text.includes('FROM estimate_line_items')) {
            assert.deepEqual(params, ['ro-1', 'shop-1']);
            return { rows: [{ subtotal: state.totalCents / 100, line_count: state.lineCount }] };
          }
          if (text.includes('AS paid_cents')) return { rows: [{ paid_cents: state.ledger.filter(p => ['paid', 'succeeded'].includes(p.status)).reduce((n, p) => n + p.amount_cents, 0) }] };
          if (text.startsWith('SELECT * FROM ro_payment')) {
            assert.deepEqual(params, ['ro-1', 'shop-1']);
            return { rows: text.includes('ro_payment_attempts') ? state.attempts : state.ledger };
          }
          if (text.includes("SET payment_status = 'paid'")) {
            assert.deepEqual(params.slice(4), ['ro-1', 'shop-1']);
            assert.equal(params[0], params[3]);
            assert.match(text, /payment_received_at = \$1,/);
            assert.match(text, /updated_at = \$4\s+WHERE id = \$5 AND shop_id = \$6/);
            Object.assign(state.ro, { payment_status: 'paid', payment_received: 1, payment_received_at: params[0], updated_at: params[3], amount_paid_cents: params[1], amount_owed_cents: params[2] });
          }
          if (/^(UPDATE|INSERT)/.test(text)) {
            state.persisted.push({ sql: text, params });
            return require('../db').dbRun(sql, params);
          }
          const row = await require('../db').dbGet(sql, params);
          return { rows: row ? [row] : [] };
        },
      };
    },
  },
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
mockModule('../services/stripe', { getStripeClient: () => { calls.stripe.push('access'); throw new Error('Unexpected provider access'); } });
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
  let finish;
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      finish?.(this);
      return this;
    },
  };

  return new Promise((resolve, reject) => {
    finish = resolve;
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

const close = (body = {}, user = {}) => runRoute('/:id/status', 'put', {
  params: { id: 'ro-1' }, body: { status: 'closed', confirm_zero_settlement: true, ...body }, user,
});

test('explicit zero settlement permits every existing technician-gate role, without charging', async () => {
  for (const role of ['technician', 'employee', 'staff', 'assistant', 'admin', 'owner', 'superadmin']) {
    reset({ status: 'delivery' });
    const result = await close({}, { role });
    assert.equal(result.statusCode, 200, role);
    assert.equal(state.ro.status, 'closed');
    assert.equal(state.ro.payment_status, 'paid');
    assert.equal(state.ro.amount_paid_cents, 0);
    assert.equal(state.ledger.length, 0);
    assert.equal(calls.stripe.length, 0);
    assert.ok(!state.transactions.some(sql => /INSERT INTO ro_payments|INSERT INTO ro_payment_attempts/.test(sql)));
    const audit = state.persisted.find(p => p.sql.includes('INSERT INTO audit_log'));
    assert.equal(audit.params[2], 'user-1');
    assert.equal(audit.params[3], 'shop-1');
    assert.equal(JSON.parse(audit.params[4]).explicit_confirmation, true);
    assert.match(state.persisted.find(p => p.sql.includes('INSERT INTO job_status_log')).params[5], /without charge/);
    assert.equal(state.transactions.at(-1), 'COMMIT');
    await nextImmediate();
  }
});

test('confirmation must be literal true and closed; unauthorized and cross-shop requests refuse', async () => {
  for (const body of [{ confirm_zero_settlement: false }, { confirm_zero_settlement: 'true' }, { status: 'repair' }, { confirm_zero_settlement: undefined }]) {
    reset({ status: 'delivery' });
    assert.equal((await close(body)).statusCode, 400);
    assert.equal(state.persisted.length, 0);
  }
  for (const [user, status] of [[{ role: 'customer' }, 403], [{ role: 'unknown' }, 403], [{ shop_id: 'other-shop' }, 404]]) {
    reset({ status: 'delivery' });
    assert.equal((await close({}, user)).statusCode, status);
    assert.equal(state.persisted.length, 0);
  }
});

test('server-authoritative balance rejects positive, negative, already-paid and unresolved money', async () => {
  const cases = [
    () => { state.totalCents = 1; state.lineCount = 1; },
    () => { state.totalCents = -1; state.lineCount = 1; },
    () => { state.ro.amount_paid_cents = 1; },
    () => { state.ro.payment_status = 'paid'; },
    () => { state.ro.payment_status = 'succeeded'; },
    () => { state.ro.payment_received = 1; },
    ...['pending', 'unknown', 'open'].map(status => () => { state.ro.payment_status = status; }),
    () => { state.ro.stripe_payment_intent_id = 'dangling'; },
    ...['open', 'reserved', 'unknown', 'retryable', 'pending'].map(status => () => { state.attempts = [{ status, amount_cents: 0 }]; }),
    ...['pending', 'failed', 'unknown'].map(status => () => { state.ledger = [{ status, amount_cents: 0 }]; }),
    () => { state.attempts = [{ status: 'settled', amount_cents: 0 }]; },
    () => { state.selectedMoney = { totalCents: 100, lineCount: 1 }; },
  ];
  for (const setup of cases) {
    reset({ status: 'delivery' }); setup();
    const before = structuredClone(state.ro);
    const result = await close({ amount_owed_cents: 0, amount_paid_cents: 0, balance: 0 });
    assert.ok([400, 409].includes(result.statusCode), JSON.stringify(result));
    assert.deepEqual(state.ro, before);
    assert.equal(state.persisted.length, 0);
    assert.equal(state.transactions.at(-1), 'ROLLBACK');
  }
});

test('zero remaining uses max of successful ledger and legacy paid cents, including selected authority', async () => {
  for (const selected of [false, true]) {
    reset({ status: 'delivery' });
    state.totalCents = 100; state.lineCount = 1;
    if (selected) { state.totalCents = 999; state.selectedMoney = { totalCents: 100, lineCount: 1 }; }
    state.ledger = [{ status: 'succeeded', amount_cents: 100 }];
    state.ro.amount_paid_cents = 100;
    assert.equal((await close()).statusCode, 200);
    assert.equal(state.ro.amount_paid_cents, 100);
    assert.equal(state.ledger.length, 1);
    await nextImmediate();
  }
});

test('SIU message unchanged and settlement, audit and history all roll back on write failure', async () => {
  reset({ status: 'siu_hold' });
  const siu = await close();
  assert.deepEqual(siu.body, { error: 'This RO is under SIU investigation. Clear the SIU hold before changing status.' });
  assert.equal(state.persisted.length, 0);
  for (const sql of ['INSERT INTO audit_log', 'UPDATE repair_orders SET status', 'INSERT INTO job_status_log', 'COMMIT']) {
    reset({ status: 'delivery' });
    const before = structuredClone(state.ro);
    state.failOn = sql;
    assert.equal((await close()).statusCode, 500);
    assert.deepEqual(state.ro, before);
    assert.equal(state.persisted.length, 0);
    assert.equal(calls.sendClosedPaidInvoiceEmail.length, 0);
  }
});

test('repeat and concurrent confirmations settle only once under the parent lock', async () => {
  reset({ status: 'delivery' });
  const results = await Promise.all([close(), close()]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 400]);
  assert.equal((await close()).statusCode, 400);
  assert.equal(state.persisted.filter(p => p.sql.includes('INSERT INTO audit_log')).length, 1);
  assert.equal(state.persisted.filter(p => p.sql.includes('INSERT INTO job_status_log')).length, 1);
});

test('real PostgreSQL accepts the route settlement query with legacy TEXT and TIMESTAMPTZ columns', {
  skip: !process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL,
  timeout: 15000,
}, async () => {
  assert.equal(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL,
    'postgresql://revv_panel@127.0.0.1:55459/revv_panel_test',
    'Only the dedicated loopback disposable database is allowed');

  // Capture the executed route query, not a hand-maintained copy of its SQL.
  // Existing route tests cover guards, money authority, rollback and concurrency.
  reset({ status: 'delivery' });
  assert.equal((await close()).statusCode, 200);
  await nextImmediate();
  const update = state.persisted.find(p => p.sql.includes("SET payment_status = 'paid'"));
  assert.ok(update);

  const { Client } = require('pg');
  const client = new Client({
    host: '127.0.0.1', port: 55459, user: 'revv_panel', database: 'revv_panel_test',
    password: async () => '', ssl: false, connectionTimeoutMillis: 3000, statement_timeout: 5000,
  });
  let transactionStarted = false;
  try {
    await client.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    // Session-local synthetic table only; never resolve a persistent app table.
    await client.query('SET LOCAL search_path TO pg_temp');
    await client.query(`CREATE TEMP TABLE repair_orders (
      id TEXT, shop_id TEXT, payment_status TEXT DEFAULT 'unpaid',
      payment_received INTEGER DEFAULT 0, payment_received_at TEXT,
      amount_paid_cents BIGINT DEFAULT 0, amount_owed_cents BIGINT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT '2000-01-01T00:00:00Z',
      PRIMARY KEY (id, shop_id)
    ) ON COMMIT DROP`);
    await client.query(`INSERT INTO repair_orders (id, shop_id)
      VALUES ('ro-1', 'shop-1'), ('ro-1', 'other-shop')`);
    const otherBefore = (await client.query("SELECT * FROM repair_orders WHERE shop_id = 'other-shop'")).rows[0];

    const result = await client.query(update.sql, update.params);
    assert.equal(result.rowCount, 1);
    const row = (await client.query("SELECT * FROM repair_orders WHERE shop_id = 'shop-1'")).rows[0];
    assert.equal(row.payment_status, 'paid');
    assert.equal(row.payment_received, 1);
    assert.equal(row.amount_paid_cents, '0');
    assert.equal(row.amount_owed_cents, '0');
    assert.equal(row.payment_received_at, update.params[0]);
    assert.equal(row.updated_at.toISOString(), row.payment_received_at);
    assert.deepEqual((await client.query("SELECT * FROM repair_orders WHERE shop_id = 'other-shop'")).rows[0], otherBefore);
  } finally {
    try {
      if (transactionStarted) await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  }
});
