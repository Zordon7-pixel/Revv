const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SMS_OPT_IN_CONFIRMATION_MESSAGE,
  sendCustomerOptInConfirmation,
} = require('../services/customerOptInConfirmation');

test('customer opt-in confirmation is attempted for consented create with phone', async () => {
  const calls = [];
  const result = await sendCustomerOptInConfirmation({
    phone: ' +15551234567 ',
    smsConsent: true,
    shopId: 'shop-1',
    send: async (...args) => {
      calls.push(args);
      return { ok: true, sid: 'SM123' };
    },
  });

  assert.equal(result.attempted, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    '+15551234567',
    SMS_OPT_IN_CONFIRMATION_MESSAGE,
    { shopId: 'shop-1' },
  ]);
});

test('customer opt-in confirmation is not attempted when sms_consent is false', async () => {
  const calls = [];
  const result = await sendCustomerOptInConfirmation({
    phone: '+15551234567',
    smsConsent: false,
    shopId: 'shop-1',
    send: async (...args) => calls.push(args),
  });

  assert.equal(result.attempted, false);
  assert.equal(calls.length, 0);
});

test('customer opt-in confirmation is not attempted when phone is empty', async () => {
  const calls = [];
  const result = await sendCustomerOptInConfirmation({
    phone: '   ',
    smsConsent: true,
    shopId: 'shop-1',
    send: async (...args) => calls.push(args),
  });

  assert.equal(result.attempted, false);
  assert.equal(calls.length, 0);
});

test('POST /customers attempts opt-in confirmation only for consented creates with phone', async () => {
  const smsCalls = [];
  const dbRuns = [];

  function mockModule(relativePath, exports) {
    const resolved = require.resolve(relativePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports,
    };
  }

  delete require.cache[require.resolve('../routes/customers')];
  delete require.cache[require.resolve('../services/customerOptInConfirmation')];

  mockModule('../db', {
    dbAll: async () => [],
    dbRun: async (sql, params) => {
      dbRuns.push({ sql, params });
      return { rowCount: 1 };
    },
    dbGet: async (sql, params) => {
      if (/FROM shops/.test(sql)) return { id: params[0] };
      if (/FROM customers/.test(sql)) {
        return {
          id: params[0],
          shop_id: params[1],
          name: 'Jane Customer',
          phone: dbRuns.at(-1)?.params?.[3] || null,
          sms_consent: dbRuns.at(-1)?.params?.[4] || false,
        };
      }
      return null;
    },
  });
  mockModule('../middleware/auth', (req, res, next) => next());
  mockModule('../middleware/roles', { requireTechnician: (req, res, next) => next() });
  mockModule('../services/sms', {
    sendSMS: async (...args) => {
      smsCalls.push(args);
      return { ok: true, sid: 'SM123' };
    },
  });

  const customersRouter = require('../routes/customers');
  const postCustomerStack = customersRouter.stack.find((layer) => (
    layer.route?.path === '/' && layer.route?.methods?.post
  )).route.stack;

  async function runCreate(body) {
    const req = {
      body,
      user: { id: 'user-1', shop_id: 'shop-1', role: 'technician' },
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
        const layer = postCustomerStack[index++];
        if (!layer) return resolve(res);
        try {
          const result = layer.handle(req, res, next);
          if (result?.then) {
            result.then(() => {
              if (index >= postCustomerStack.length) resolve(res);
            }, reject);
          }
        } catch (error) {
          reject(error);
        }
      };
      next();
    });
  }

  smsCalls.length = 0;
  dbRuns.length = 0;
  let res = await runCreate({ name: 'Jane Customer', phone: '+15551234567', sms_consent: true });
  assert.equal(res.statusCode, 201);
  assert.equal(smsCalls.length, 1);
  assert.deepEqual(smsCalls[0], [
    '+15551234567',
    SMS_OPT_IN_CONFIRMATION_MESSAGE,
    { shopId: 'shop-1' },
  ]);

  smsCalls.length = 0;
  dbRuns.length = 0;
  res = await runCreate({ name: 'No Consent', phone: '+15551234567', sms_consent: false });
  assert.equal(res.statusCode, 201);
  assert.equal(smsCalls.length, 0);

  smsCalls.length = 0;
  dbRuns.length = 0;
  res = await runCreate({ name: 'No Phone', phone: '   ', sms_consent: true });
  assert.equal(res.statusCode, 201);
  assert.equal(smsCalls.length, 0);
});

test('GET /customers returns shop-scoped vehicle and RO counts for customer cards', async () => {
  const queries = [];
  const mockModule = (relativePath, exports) => {
    const resolved = require.resolve(relativePath);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };

  delete require.cache[require.resolve('../routes/customers')];
  mockModule('../db', {
    pool: {},
    dbAll: async (sql, params) => {
      queries.push({ sql, params });
      return [{ id: 'customer-1', name: 'Jane Customer', vehicle_count: 2, ro_count: 4, active_ro_count: 1 }];
    },
    dbGet: async () => null,
    dbRun: async () => ({ rowCount: 0 }),
  });
  mockModule('../middleware/auth', (req, res, next) => next());
  mockModule('../middleware/roles', { requireTechnician: (req, res, next) => next() });

  const customersRouter = require('../routes/customers');
  const stack = customersRouter.stack.find((layer) => (
    layer.route?.path === '/' && layer.route?.methods?.get
  )).route.stack;
  const req = { user: { shop_id: 'shop-1', role: 'owner' } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };

  await new Promise((resolve, reject) => {
    let index = 0;
    const next = (err) => {
      if (err) return reject(err);
      const layer = stack[index++];
      if (!layer) return resolve();
      try {
        const result = layer.handle(req, res, next);
        if (result?.then) result.then(() => { if (index >= stack.length) resolve(); }, reject);
      } catch (error) {
        reject(error);
      }
    };
    next();
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.customers[0].vehicle_count, 2);
  assert.equal(res.body.customers[0].ro_count, 4);
  assert.equal(res.body.customers[0].active_ro_count, 1);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ['shop-1']);
  assert.match(queries[0].sql, /WHERE c\.shop_id::text = \$1::text/);
  assert.match(queries[0].sql, /v\.shop_id::text = c\.shop_id::text/);
  assert.equal((queries[0].sql.match(/ro\.shop_id::text = c\.shop_id::text/g) || []).length, 2);
});
