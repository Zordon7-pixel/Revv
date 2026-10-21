const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function installMock(resolvedPath, exportsValue) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsValue,
  };
}

function clearRouteCache(routeName) {
  const routeSegment = `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}${routeName}.js`;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(routeSegment)) delete require.cache[key];
  }
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end() {},
  };
}

test('shop logo upload accepts only PDF-safe images and cannot target another shop', async () => {
  clearRouteCache('market');
  const calls = [];
  installMock(require.resolve('../db'), {
    async dbGet(sql, params) {
      calls.push({ kind: 'get', sql: String(sql), params });
      return { id: 'shop-a', logo_url: null };
    },
    async dbAll() { return []; },
    async dbRun(sql, params) {
      calls.push({ kind: 'run', sql: String(sql), params });
      return { rowCount: 1 };
    },
  });
  installMock(require.resolve('../middleware/auth'), (_req, _res, next) => next());
  installMock(require.resolve('../middleware/roles'), { requireAdmin: (_req, _res, next) => next() });
  installMock(require.resolve('../services/sms'), {
    getTwilioConfigForShop: async () => null,
    isConfiguredForShop: async () => false,
  });
  installMock(require.resolve('../services/mediaStorage'), {
    deleteStoredMedia: async () => ({ deleted: true }),
    discardUploadedMedia: async () => ({ discarded: true }),
    persistUploadedFile: async () => ({ mirrored: true }),
  });

  const router = require('../routes/market');
  assert.equal(router._test.isSupportedShopLogoMime('image/jpeg'), true);
  assert.equal(router._test.isSupportedShopLogoMime('image/png'), true);
  assert.equal(router._test.isSupportedShopLogoMime('image/svg+xml'), false);
  assert.equal(router._test.isSupportedShopLogoMime('text/html'), false);

  const layer = router.stack.find((entry) => entry.route?.path === '/shop/logo' && entry.route.methods.post);
  const handler = layer.route.stack.at(-1).handle;
  const req = {
    body: { shop_id: 'shop-b' },
    file: { filename: 'test-shop-logo.jpg' },
    user: { id: 'owner-a', role: 'owner', shop_id: 'shop-a' },
  };
  const res = responseRecorder();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.logo_url, '/uploads/shop-logos/test-shop-logo.jpg');
  const update = calls.find((call) => call.kind === 'run');
  assert.match(update.sql, /WHERE id::text = \$2::text/i);
  assert.deepEqual(update.params, ['/uploads/shop-logos/test-shop-logo.jpg', 'shop-a']);
  assert.equal(update.params.includes('shop-b'), false);
});

test('invoice and repair-order PDFs render exact roMoney cents plus the REVV footer', async () => {
  clearRouteCache('invoice');
  const documents = [];
  class FakePdfDocument {
    constructor() {
      this.page = { height: 792 };
      this.y = 50;
      this.textValues = [];
      documents.push(this);
    }
    pipe() { return this; }
    image() { return this; }
    font() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    text(value, x, y) {
      this.textValues.push(String(value));
      if (typeof y === 'number') this.y = y + 12;
      else this.y += 12;
      return this;
    }
    moveDown(amount = 1) { this.y += 12 * amount; return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    strokeColor() { return this; }
    lineWidth() { return this; }
    stroke() { return this; }
    addPage() { this.page = { height: 792 }; this.y = 50; return this; }
    end() { return this; }
  }

  installMock(require.resolve('pdfkit'), FakePdfDocument);
  installMock(require.resolve('../db'), {
    async dbGet() { return null; },
    async dbAll(sql, params) {
      assert.match(sql, /SELECT id::text AS id, is_internal_test_shop FROM shops/);
      return params[0] === 'synthetic-shop' ? [{ id: 'synthetic-shop', is_internal_test_shop: false }] : [];
    },
  });
  installMock(require.resolve('../middleware/auth'), (_req, _res, next) => next());
  installMock(require.resolve('../services/deliveryFees'), {
    calculateDeliveryFeeBreakdown: async () => ({ total_fee: 0 }),
  });
  installMock(require.resolve('../services/roMoney'), {
    dollarsToCents(value) { return Math.round(Number(value || 0) * 100); },
    getRoMoneySummary: async () => ({ subtotalCents: 12345, taxCents: 678, totalCents: 13023 }),
  });

  const router = require('../routes/invoice');
  const context = {
    ro: {
      id: 'ro-1', shop_id: 'synthetic-shop', ro_number: 'RO-1001', status: 'repair', created_at: '2026-07-10',
      insurance_company: 'Acme Insurance', claim_number: 'CLM-1', deductible: '500.00',
    },
    shop: { name: 'Miles Automotive', address: '100 Main St', city: 'Queens', state: 'NY', zip: '10001' },
    customer: { name: 'Alex Customer', phone: '555-0100', email: 'alex@example.com' },
    vehicle: { year: 2024, make: 'Honda', model: 'Accord', vin: 'VIN1', plate: 'NY1' },
    lineItems: [{ type: 'labor', description: 'Body labor', quantity: 1, unit_price: '123.45', total: '123.45' }],
    moneySummary: { subtotalCents: 12345, taxCents: 678, totalCents: 13023 },
    deliveryFeeBreakdown: { total_fee: 0 },
  };

  await router._test.streamDocumentPdf(responseRecorder(), context);
  await router._test.streamDocumentPdf(responseRecorder(), context, { documentType: 'repair-order' });

  for (const document of documents) {
    assert.ok(document.textValues.includes('$123.45'));
    assert.ok(document.textValues.includes('$6.78'));
    assert.ok(document.textValues.includes('$130.23'));
    assert.ok(document.textValues.includes('Estimated & tracked with REVV · revvshop.app'));
  }
  assert.ok(documents[1].textValues.includes('REPAIR ORDER'));
  assert.ok(documents[1].textValues.includes('Repair Authorization'));

  const source = fs.readFileSync(require.resolve('../routes/invoice'), 'utf8');
  assert.doesNotMatch(source, /centsToDollars|toMoney|toFixed\(2\)/);
  assert.doesNotMatch(source, /Number\(item\.(?:unit_price|total)/);
});

// Phase 5: comprehensive synthetic invoice/accounting/carryover policy suite.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ordinary = () => [{ id: 'shop', is_internal_test_shop: false }];
const flagged = () => [{ id: 'shop', is_internal_test_shop: true }];
const noop = (_req, _res, next) => next?.();
const plain = x => JSON.parse(JSON.stringify(x));

// Closed import graph: actual handlers, services and jobs; synthetic adapters
// only. No dotenv, real DB, SDK or socket is accessible. Missing rows stay missing.
function fixture(rows) {
  assert.notEqual(rows, undefined);
  const state = { rows, queries: [], writes: [], committed: [], calls: [], imports: 0,
    pdfs: [], streams: 0, pending: [], logs: [], policyReads: 0, released: 0, carried: false };
  const ro = { id: 'ro', shop_id: 'shop', ro_number: 'RO-SYNTHETIC', status: 'closed',
    payment_status: 'paid', total: 130.23, parts_cost: 123.45, tax: 6.78,
    customer_id: 'customer', customer_name: 'Synthetic Customer', customer_email: 'fixture@example.invalid',
    created_at: '2026-10-01', notes: 'Synthetic only' };
  const connection = { id: 'shop', name: 'Synthetic Shop', quickbooks_sync_enabled: true,
    quickbooks_realm_id: 'realm', quickbooks_refresh_token: 'refresh', quickbooks_access_token: 'access',
    quickbooks_token_expires_at: '2099-01-01' };
  async function query(sql, args = []) {
    state.queries.push({ sql, args });
    if (sql.includes('SELECT id::text AS id, is_internal_test_shop')) {
      state.policyReads++;
      await state.onPolicy?.();
      if (state.rows instanceof Error) throw state.rows;
      return { rows: args[0] === 'shop' ? state.rows : [] };
    }
    await state.onQuery?.(sql, args);
    let result = [];
    if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) {
      if (state.writeError) throw Error('synthetic write failure');
      state.writes.push({ sql, args });
      if (sql.includes('carried_over = TRUE')) state.carried = true;
      return { rows: [], rowCount: 1 };
    }
    if (sql === 'BEGIN') state.snapshot = state.carried;
    else if (sql === 'COMMIT') state.committed = [...state.writes];
    else if (sql === 'ROLLBACK') state.carried = state.snapshot;
    else if (sql.includes('SELECT id FROM shops WHERE is_internal_test_shop IS FALSE')) {
      assert.ok(sql.endsWith('IS FALSE'));
      result = Array.isArray(state.rows) ? state.rows.filter(r => r?.is_internal_test_shop === false) : [];
    } else if (sql.includes('FROM shops')) result = [connection];
    else if (sql.includes('FROM portal_tokens')) result = state.noToken ? [] : [{ ro_id: 'ro', shop_id: 'shop', token: 'persisted-token', ...state.token }];
    else if (sql.includes('FROM repair_orders')) {
      if (/ORDER BY id FOR UPDATE/.test(sql)) result = state.carried ? [] : [{ id: 'ro' }];
      else if (sql.includes('row_to_json')) result = [{ customer: { name: 'Synthetic Customer' }, log: [], parts: [] }];
      else result = args[0] === 'bad' ? [] : [ro];
    } else if (sql.includes('FROM customers')) result = [{ name: 'Synthetic Customer', email: 'fixture@example.invalid' }];
    else if (sql.includes('FROM vehicles')) result = [];
    else if (sql.includes('FROM estimate_line_items')) result = [{ type: 'parts', quantity: 1, total: '123.45', unit_price: '123.45' }];
    else if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) throw Error(`Unexpected SQL: ${sql}`);
    return { rows: result, rowCount: result.length };
  }
  const client = { query, release() { state.released++; } };
  const db = { pool: { connect: async () => client }, dbAll: async (...a) => (await query(...a)).rows,
    dbGet: async (...a) => (await query(...a)).rows[0], dbRun: query };
  const env = { JWT_SECRET: 'synthetic-state-signing', QUICKBOOKS_CLIENT_ID: 'synthetic-client',
    QUICKBOOKS_CLIENT_SECRET: 'synthetic-secret', RESEND_API_KEY: 'synthetic-resend' };
  async function fetchMock(url, options) {
    state.calls.push({ url, options });
    await state.onProvider?.(url, options);
    if (state.providerError) throw Error('synthetic provider failure');
    if (state.responses?.length) return state.responses.shift();
    let data = {};
    if (url.includes('/tokens/bearer')) data = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 };
    else if (url.includes('/query')) {
      const q = new URL(url).searchParams.get('query') || '';
      data = { QueryResponse: q.includes('from Customer') ? { Customer: [{ Id: 'customer-qb' }] }
        : q.includes('from Item') ? { Item: [{ Id: 'item-qb' }] }
          : q.includes('from Account') ? { Account: [{ Id: 'income' }] } : {} };
      if (state.createEntities && !q.includes('from Account')) data = { QueryResponse: {} };
    } else if (url.includes('/customer?')) data = { Customer: { Id: 'customer-new' } };
    else if (url.includes('/item?')) data = { Item: { Id: 'item-new' } };
    else if (url.includes('/invoice?')) data = { Invoice: { Id: 'invoice', TotalAmt: 130.23 } };
    else if (url.includes('resend')) data = { id: '00000000-0000-0000-0000-000000000000' };
    return { ok: true, status: 200, json: async () => data };
  }
  const cache = {};
  function load(file, extra = {}, suffix = '') {
    const filename = path.join(root, file), module = { exports: {} };
    const code = fs.readFileSync(filename, 'utf8');
    vm.runInNewContext(`(function(require,module,exports){${code}\n${suffix}\n})`, {
      process: { env }, Buffer, URL, URLSearchParams, __dirname: path.dirname(filename),
      console: Object.fromEntries(['log', 'warn', 'error'].map(k => [k, (...a) => state.logs.push(a)])),
      fetch: fetchMock, setImmediate: fn => state.pending.push(fn),
    }, { filename })(name => {
      if (Object.hasOwn(extra, name)) return extra[name];
      if (name === '../db') return db;
      if (name === 'crypto') return crypto;
      if (name === 'path') return path;
      if (name === 'fs') return { existsSync: () => false };
      if (name === 'uuid') return { v4: () => 'synthetic-uuid' };
      if (['./shopPolicy', '../services/shopPolicy', './mailer', '../services/mailer', '../services/quickbooks'].includes(name)) {
        const target = `services/${path.basename(name)}.js`;
        return cache[target] ||= load(target);
      }
      if (name === 'pdfkit') {
        state.imports++;
        return class {
          constructor() {
            this.y = 50; this.page = { height: 792 }; this.textValues = []; state.pdfs.push(this);
            for (const m of ['image','font','fontSize','fillColor','moveTo','lineTo','strokeColor','lineWidth','stroke','end']) this[m] = () => this;
          }
          pipe() { state.streams++; return this; }
          text(v) { this.textValues.push(String(v)); this.y += 12; return this; }
          moveDown() { this.y += 12; return this; }
          addPage() { this.y = 50; return this; }
        };
      }
      throw Error(`Forbidden dependency ${name} in ${file}`);
    }, module, module.exports);
    return module.exports;
  }
  const policy = load('services/shopPolicy.js');
  const qb = load('services/quickbooks.js', {}, 'module.exports.private = { refreshTokens, ensureAccessToken, qbRequest, ensureCustomer, ensureIncomeItem };');
  cache['services/quickbooks.js'] = qb;
  function route(file) {
    const routes = [], router = { use() {} };
    for (const method of ['get','post','patch','put','delete']) router[method] = (url, ...handlers) => routes.push({ method, url, fn: handlers.at(-1) });
    const extra = { express: { Router: () => router }, 'express-rate-limit': () => noop,
      '../middleware/auth': noop, '../middleware/roles': { requireAdmin: noop, requireTechnician: noop, ROLE_RANK: {} },
      '../services/deliveryFees': { calculateDeliveryFeeBreakdown: async () => { await state.onPreparation?.(); return { total_fee: 0 }; }, toMoney: n => n },
      '../services/roMoney': { dollarsToCents: n => Math.round(Number(n) * 100), getRoMoneySummary: async () => ({ subtotalCents: 12345, taxCents: 678, totalCents: 13023 }) },
    };
    if (file === 'routes/ros.js') Object.assign(extra, {
      '../services/customerConsent': {}, '../services/panelEstimatorEconomics': { selectedEconomics: async () => new Map(), redactSelectedRO: x => x },
      '../services/profit': load('services/profit.js', { './panelEstimator': {} }), '../services/paymentReservations': {}, '../services/sms': {},
      '../services/emailTemplates': {}, '../services/ownerActivity': {}, '../services/notifications': {},
      '../services/customerBilling': {}, '../services/customerOptInConfirmation': {}, '../middleware/roLimitGuard': noop,
      './insuranceOcr': { insuranceOcrLimiter: noop }, '../services/panelEstimatorApproval': { panelPublicHandler: () => noop, publicRequestError: () => noop },
    });
    const result = load(file, extra, file === 'routes/ros.js' ? 'module.exports.queueQuickBooksSync = queueQuickBooksSync;' : '');
    return { result, async call(method, url, overrides = {}) {
      const fn = routes.find(r => r.method === method && r.url === url)?.fn; assert.ok(fn, url);
      const res = { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; },
        json(body) { this.body = body; return this; }, redirect(url) { this.redirectUrl = url; return this; },
        setHeader(k,v) { this.headers[k] = v; }, end() {} };
      await fn({ user: { shop_id: 'shop', id: 'owner', is_internal_test_shop: false, role: 'admin' },
        params: { id: 'ro', roId: 'ro', token: 'persisted-token' }, query: {}, body: { is_internal_test_shop: false, shop_id: 'ordinary' }, ...overrides }, res);
      return res;
    } };
  }
  function billing() { return load('services/customerBilling.js', { './stripe': {}, './emailTemplates': {}, './roMoney': {}, './paymentReservations': {} }); }
  return { state, ro, connection, qb, policy, db, load, route, billing,
    carry: () => load('jobs/monthCarryover.js').runMonthCarryover('shop'),
    async drain() { while (state.pending.length) await state.pending.shift()(); } };
}
function zero(f) {
  assert.equal(f.state.imports, 0); assert.equal(f.state.pdfs.length, 0); assert.equal(f.state.streams, 0);
  assert.equal(f.state.calls.length, 0); assert.equal(f.state.writes.length, 0);
}
const denied = [
  ['flagged', flagged()], ['missing', []], ['null', [{ id: 'shop', is_internal_test_shop: null }]],
  ['string', [{ id: 'shop', is_internal_test_shop: 'false' }]], ['numeric', [{ id: 'shop', is_internal_test_shop: 0 }]],
  ['mismatch', [{ id: 'other', is_internal_test_shop: false }]], ['duplicate', [...ordinary(), ...ordinary()]],
  ['query failure', Error('synthetic DB unavailable')], ['missing column', [{ id: 'shop' }]],
];
const operations = {
  connect: f => f.qb.connectUrl({ shopId: 'shop', userId: 'owner', is_internal_test_shop: false }),
  exchange: f => f.qb.exchangeCodeForTokens('code', 'shop'),
  refresh: f => f.qb.private.refreshTokens('refresh', 'shop'),
  save: f => f.qb.saveTokens('shop', 'realm', { access_token: 'forged', is_internal_test_shop: false }),
  access: f => f.qb.private.ensureAccessToken('shop'), request: f => f.qb.private.qbRequest('shop'),
  customer: f => f.qb.private.ensureCustomer('shop', f.ro), item: f => f.qb.private.ensureIncomeItem('shop'),
  sync: f => f.qb.syncInvoiceForRo('shop', 'ro'), disconnect: f => f.qb.disconnect('shop'),
  enable: f => f.qb.setSyncEnabled('shop', true), disable: f => f.qb.setSyncEnabled('shop', false),
  token: f => f.billing().ensureTrackingToken('ro', 'shop'),
};
for (const [label, rows] of denied) {
  for (const [name, operation] of Object.entries(operations)) test(`${label}: direct ${name} has zero effects`, async () => {
    const f = fixture(rows); await assert.rejects(operation(f), /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/); zero(f);
  });
  for (const [file, method, url] of [
    ['invoice','get','/public/:token'], ['invoice','get','/:roId'], ['invoice','get','/:roId/repair-order'],
    ['ros','get','/:id/invoice'], ['ros','post','/:id/email-invoice'],
    ['accounting','get','/quickbooks/connect-url'], ['accounting','post','/quickbooks/disconnect'],
    ['accounting','patch','/quickbooks/sync-enabled'], ['accounting','post','/quickbooks/sync/ro/:id'],
    ['accounting','post','/quickbooks/sync/batch'],
  ]) test(`${label}: actual ${file} ${url} denies forged policy`, async () => {
    const f = fixture(rows), res = await f.route(`routes/${file}.js`).call(method, url);
    assert.match(res.body.error, /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/); zero(f);
  });
  test(`${label}: verified OAuth callback denies before exchange/save`, async () => {
    const f = fixture(ordinary()), url = await f.qb.connectUrl({ shopId: 'shop', userId: 'owner' });
    f.state.rows = rows;
    const res = await f.route('routes/accounting.js').call('get','/quickbooks/callback', {
      query: { state: new URL(url).searchParams.get('state'), code: 'code', realmId: 'realm', is_internal_test_shop: false } });
    assert.match(res.redirectUrl, /SHOP_POLICY_UNAVAILABLE|INTERNAL_TEST_SHOP/); zero(f);
  });
  test(`${label}: detached QuickBooks queue handles suppression`, async () => {
    const f = fixture(rows); f.route('routes/ros.js').result.queueQuickBooksSync('ro','shop'); await f.drain();
    assert.equal(f.state.logs.filter(a => String(a[0]).includes('Auto-sync failed')).length, 1); zero(f);
  });
  test(`${label}: direct transactional carryover rolls back without writes`, async () => {
    const f = fixture(rows); assert.equal(await f.carry(), 0); zero(f);
    assert.equal(f.state.queries.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.released, 1);
  });
}
for (const [label, rows] of [['true', flagged()], ['unavailable', []], ['failure', Error('late failure')]]) {
  for (const url of ['/public/:token','/:roId','/:roId/repair-order']) test(`late ${label}: PDF preparation never renders/streams (${url})`, async () => {
    const f = fixture(ordinary()); f.state.onPreparation = () => { f.state.rows = rows; };
    const res = await f.route('routes/invoice.js').call('get', url);
    assert.match(res.body.error, /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/); zero(f);
  });
  test(`late ${label}: invoice JSON enrichment rechecks policy`, async () => {
    const f = fixture(ordinary()); f.state.onQuery = sql => { if (sql.includes('row_to_json')) f.state.rows = rows; };
    const res = await f.route('routes/ros.js').call('get','/:id/invoice');
    assert.match(res.body.error, /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/); zero(f);
  });
  test(`late ${label}: invoice email preparation stops before mail`, async () => {
    const f = fixture(ordinary()); f.state.onQuery = sql => { if (sql.includes('SELECT name, phone FROM shops')) f.state.rows = rows; };
    const res = await f.route('routes/ros.js').call('post','/:id/email-invoice');
    assert.match(res.body.error, /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/); zero(f);
  });
  test(`late ${label}: retained token cannot be returned/reused`, async () => {
    const f = fixture(ordinary()); f.state.onQuery = sql => { if (sql.includes('FROM portal_tokens')) f.state.rows = rows; };
    await assert.rejects(f.billing().ensureTrackingToken('ro','shop'), /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/); zero(f);
  });
  for (const op of ['request','disconnect','access']) test(`late ${label}: QB ${op} after connection lookup`, async () => {
    const f = fixture(ordinary()); f.connection.quickbooks_token_expires_at = '2000-01-01';
    f.state.onQuery = sql => { if (sql.includes('FROM shops')) f.state.rows = rows; };
    await assert.rejects(operations[op](f), /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/); zero(f);
  });
  test(`late ${label}: detached queue after settings read`, async () => {
    const f = fixture(ordinary()); f.state.onQuery = sql => { if (sql.includes('FROM shops')) f.state.rows = rows; };
    f.route('routes/ros.js').result.queueQuickBooksSync('ro','shop'); await f.drain(); zero(f);
    assert.equal(f.state.logs.filter(a => String(a[0]).includes('Auto-sync failed')).length, 1);
  });
  test(`late ${label}: carryover after parent locks has no billing writes`, async () => {
    const f = fixture(ordinary()); f.state.onQuery = sql => { if (sql.includes('FOR UPDATE')) f.state.rows = rows; };
    assert.equal(await f.carry(), 0); zero(f); assert.equal(f.state.queries.at(-1).sql, 'ROLLBACK');
  });
  for (const op of ['exchange','refresh','sync','disconnect']) test(`late ${label}: QB ${op} provider completion cannot persist tokens/accounting`, async () => {
    const f = fixture(ordinary());
    f.state.onProvider = url => { if (op !== 'sync' || url.includes('/invoice?')) f.state.rows = rows; };
    if (op === 'exchange') {
      const data = await f.qb.exchangeCodeForTokens('code','shop');
      await assert.rejects(f.qb.saveTokens('shop','realm',data), /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/);
    } else if (op === 'refresh') {
      f.connection.quickbooks_token_expires_at = '2000-01-01';
      await assert.rejects(f.qb.private.ensureAccessToken('shop'), /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/);
    } else await assert.rejects(operations[op](f), /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/);
    assert.equal(f.state.writes.length, 0); assert.ok(f.state.calls.length >= 1);
  });
}

test('public invoice tenancy comes only from stored token and scoped RO; expiration retained', async () => {
  const f = fixture(ordinary()); f.state.token = { shop_id: 'unknown' };
  const route = f.route('routes/invoice.js');
  const res = await route.call('get','/public/:token', { query: { shop_id: 'shop' }, body: { shop_id: 'shop' } });
  assert.match(res.body.error, /SHOP_POLICY_UNAVAILABLE/); zero(f);
  f.state.token = { expires_at: '2000-01-01' };
  assert.equal((await route.call('get','/public/:token')).statusCode, 410);
  f.state.noToken = true;
  assert.equal((await route.call('get','/public/:token')).statusCode, 404);
});
test('direct PDF renderer rechecks even forged context policy metadata', async () => {
  const f = fixture(flagged());
  await assert.rejects(f.route('routes/invoice.js').result._test.streamDocumentPdf({}, {
    ro: { ...f.ro, is_internal_test_shop: false }, shop: { is_internal_test_shop: false } }), /INTERNAL_TEST_SHOP/); zero(f);
});
test('strict false: invoice PDFs keep exact cents, branding and repair authorization', async () => {
  const f = fixture(ordinary()), route = f.route('routes/invoice.js');
  for (const url of ['/public/:token','/:roId','/:roId/repair-order']) {
    const res = await route.call('get',url); assert.equal(res.statusCode, 200); assert.equal(res.headers['Content-Type'],'application/pdf');
  }
  assert.equal(f.state.streams, 3);
  for (const pdf of f.state.pdfs) for (const text of ['$123.45','$6.78','$130.23','Estimated & tracked with REVV · revvshop.app']) assert.ok(pdf.textValues.includes(text), text);
  assert.ok(f.state.pdfs[2].textValues.includes('Repair Authorization'));
  const scoped = f.state.queries.filter(q => q.sql.startsWith('SELECT * FROM repair_orders'));
  assert.equal(scoped.length, 3); for (const q of scoped) assert.deepEqual(plain(q.args), ['ro','shop']);
});
test('strict false: invoice JSON and email preserve content and totals despite forged true metadata', async () => {
  const f = fixture(ordinary()), route = f.route('routes/ros.js');
  const json = await route.call('get','/:id/invoice', { body: { is_internal_test_shop: true } });
  assert.equal(json.body.invoice_total_with_delivery,130.23); assert.equal(json.body.id,'ro');
  const email = await route.call('post','/:id/email-invoice'); assert.equal(email.body.ok,true);
  const payload = JSON.parse(f.state.calls[0].options.body); assert.match(payload.html,/130\.23/); assert.match(payload.subject,/RO-SYNTHETIC/);
});
test('strict false: OAuth URL, state verification, exchange and save retain contract', async () => {
  const f = fixture(ordinary()), route = f.route('routes/accounting.js');
  const connect = await route.call('get','/quickbooks/connect-url');
  const url = new URL(connect.body.url), state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('client_id'),'synthetic-client'); assert.equal(f.qb.verifyState(state).shop_id,'shop');
  const res = await route.call('get','/quickbooks/callback', { query: { state, code: 'synthetic-code', realmId: 'realm' } });
  assert.match(res.redirectUrl,/qb=connected/); assert.equal(f.state.calls.length,1); assert.equal(f.state.writes.length,1);
  assert.equal(f.state.calls[0].options.body.get('grant_type'),'authorization_code');
  assert.deepEqual(plain(f.state.writes[0].args).slice(0,3),['realm','new-access','new-refresh']);
  assert.equal(f.state.writes[0].args.at(-1),'shop');
  for (const badState of ['invalid', state.slice(0,-1)+'!', signedState({shop_id:'shop', ts:Date.now()-700000}, 'synthetic-state-signing')]) {
    const deniedRes = await route.call('get','/quickbooks/callback', { query: { state: badState, code:'code', realmId:'realm' } });
    assert.match(deniedRes.redirectUrl,/qb=error/);
  }
  assert.equal(f.state.calls.length,1); assert.equal(f.state.writes.length,1);
});
function signedState(payload, key) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256',key).update(body).digest('base64url')}`;
}
test('missing shop argument cannot exchange or refresh using provider metadata', async () => {
  const f = fixture(ordinary());
  await assert.rejects(f.qb.exchangeCodeForTokens({ code:'code',shop_id:'shop' }),/SHOP_POLICY_UNAVAILABLE/);
  await assert.rejects(f.qb.private.refreshTokens('refresh'),/SHOP_POLICY_UNAVAILABLE/); zero(f);
});
test('strict false: expired token refresh and 401 retry retain tokens and bounded retry', async () => {
  const f = fixture(ordinary()); f.connection.quickbooks_token_expires_at = '2000-01-01';
  assert.equal((await f.qb.private.ensureAccessToken('shop')).accessToken,'new-access');
  assert.equal(f.state.calls[0].options.body.get('grant_type'),'refresh_token'); assert.equal(f.state.writes.length,1);
  f.connection.quickbooks_token_expires_at = '2099-01-01';
  f.state.responses = [{ok:false,status:401,json:async()=>({})}];
  await f.qb.private.qbRequest('shop',{path:'/query'});
  assert.equal(f.state.calls.length,4); assert.equal(f.state.writes.length,2);
});
test('strict false: creates QB customers/items/invoices; ordinary batch isolates failure', async () => {
  const f = fixture(ordinary()); f.state.createEntities = true;
  const res = await f.route('routes/accounting.js').call('post','/quickbooks/sync/batch', { body: { ro_ids: ['bad','ro'], shop_id:'forged', is_internal_test_shop:true } });
  assert.equal(res.body.synced_count,1); assert.equal(res.body.failed_count,1); assert.equal(res.body.failed[0].ro_id,'bad');
  for (const p of ['/customer?','/item?','/invoice?']) assert.ok(f.state.calls.some(c=>c.url.includes(p)));
  const invoice = JSON.parse(f.state.calls.find(c=>c.url.includes('/invoice?')).options.body);
  assert.equal(invoice.DocNumber,'RO-SYNTHETIC'); assert.deepEqual(invoice.Line.map(l=>l.Amount),[123.45,6.78]);
  assert.equal(f.state.writes.length,1);
});
test('batch late policy change blocks remaining shops effects and isolates errors', async () => {
  const f = fixture(ordinary()); f.state.onProvider = url => { if(url.includes('/invoice?')) f.state.rows=flagged(); };
  const res = await f.route('routes/accounting.js').call('post','/quickbooks/sync/batch',{ body:{ro_ids:['ro','ro']} });
  assert.equal(res.body.failed_count,2); assert.equal(res.body.synced_count,0); assert.equal(f.state.writes.length,0);
  assert.equal(f.state.calls.filter(c=>c.url.includes('/invoice?')).length,1);
});
test('strict false: detached queue succeeds and logs provider errors without unhandled rejection', async () => {
  const f=fixture(ordinary()), route=f.route('routes/ros.js');
  route.result.queueQuickBooksSync('ro','shop'); await f.drain(); assert.equal(f.state.writes.length,1);
  f.state.providerError=true; route.result.queueQuickBooksSync('ro','shop'); await f.drain();
  assert.ok(f.state.logs.some(a=>String(a[0]).includes('Auto-sync failed')));
});
test('strict false: disconnect and enable preserve scoped writes', async () => {
  const f=fixture(ordinary()); await f.qb.disconnect('shop'); await f.qb.setSyncEnabled('shop',true);
  assert.equal(f.state.calls.length,1); assert.equal(f.state.writes.length,2);
  assert.match(f.state.writes[0].sql,/quickbooks_access_token = NULL/); assert.deepEqual(plain(f.state.writes[1].args),[true,'shop']);
});
test('strict false: carryover locks parent then policy; rowCount and repeat idempotency retained', async () => {
  const f=fixture(ordinary()); assert.equal(await f.carry(),1); assert.equal(await f.carry(),0);
  assert.equal(f.state.writes.length,1); assert.equal(f.state.released,2);
  const sqls=f.state.queries.map(q=>q.sql);
  assert.ok(sqls.findIndex(s=>s.includes('FOR UPDATE')) < sqls.findIndex(s=>s.includes('FOR SHARE')));
  assert.match(f.state.writes[0].sql,/AND id::text = ANY\(\$2::text\[\]\)/);
  assert.doesNotMatch(f.state.writes[0].sql,/SET billing_month/);
});
test('carryover failure releases transaction and propagates; late final policy rolls back', async () => {
  const f=fixture(ordinary()); f.state.writeError=true; await assert.rejects(f.carry(),/synthetic write failure/);
  assert.equal(f.state.queries.at(-1).sql,'ROLLBACK'); assert.equal(f.state.released,1);
  const g=fixture(ordinary()); g.state.onPolicy=()=>{if(g.state.policyReads===3)g.state.rows=flagged();};
  assert.equal(await g.carry(),0); assert.equal(g.state.committed.length,0); assert.equal(g.state.carried,false);
});
test('actual startup carryover enumeration SQL excludes true/null/missing and job independently guards', async () => {
  const f=fixture([...ordinary(),{id:'fixture',is_internal_test_shop:true},{id:'null',is_internal_test_shop:null},{id:'missing'}]);
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const code=app.slice(app.indexOf('async function runCarryoverForActiveShops()'),app.indexOf('\n}',app.indexOf('async function runCarryoverForActiveShops()'))+2);
  const seen=[];
  // Execute the exact startup function without booting app/config/listeners.
  await vm.runInNewContext(`${code}; runCarryoverForActiveShops()`,{ dbAll:f.db.dbAll,
    runMonthCarryover:async id=>{seen.push(id);return 0;},console:{log(){},error(){assert.fail('startup enumeration failed');}} });
  assert.deepEqual(seen,['shop']); zero(f);
});
test('strict false: existing/new invoice token behavior retained and late missing token cannot write', async () => {
  const f=fixture(ordinary()); assert.equal(await f.billing().ensureTrackingToken('ro','shop'),'persisted-token'); assert.equal(f.state.writes.length,0);
  f.state.noToken=true; assert.equal(await f.billing().ensureTrackingToken('ro','shop'),'syntheticuuid'); assert.equal(f.state.writes.length,1);
  const g=fixture(ordinary()); g.state.noToken=true; g.state.onQuery=sql=>{if(sql.includes('FROM portal_tokens'))g.state.rows=[];};
  await assert.rejects(g.billing().ensureTrackingToken('ro','shop'),/SHOP_POLICY_UNAVAILABLE/);zero(g);
});

for (const [label, rows] of [['flagged', flagged()], ['unavailable', []]]) {
  test(`late ${label}: cached access token is not returned after lookup`, async () => {
    const f=fixture(ordinary()); f.state.onQuery=sql=>{if(sql.includes('FROM shops'))f.state.rows=rows;};
    await assert.rejects(f.qb.private.ensureAccessToken('shop'), /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/);zero(f);
  });
  for (const [entity, queryName] of [['customer','from Customer'],['item','from Account']]) {
    test(`late ${label}: ${entity} query cannot become provider create`, async () => {
      const f=fixture(ordinary()); f.state.createEntities=true;
      f.state.onProvider=url=>{if(new URL(url).searchParams.get('query')?.includes(queryName))f.state.rows=rows;};
      await assert.rejects(operations[entity](f), /INTERNAL_TEST_SHOP|SHOP_POLICY_UNAVAILABLE/);
      assert.equal(f.state.calls.filter(c=>c.options.method==='POST').length,0);assert.equal(f.state.writes.length,0);
    });
  }
}
test('strict false: manual accounting route and connection status retain responses', async () => {
  const f=fixture(ordinary()), route=f.route('routes/accounting.js');
  const res=await route.call('post','/quickbooks/sync/ro/:id');
  assert.equal(res.body.ok,true);assert.equal(res.body.total,130.23);assert.equal(res.body.quickbooks_invoice_id,'invoice');
  const status=await route.call('get','/quickbooks/status');
  assert.equal(status.body.connected,true);assert.equal(status.body.sync_enabled,true);
  assert.equal(status.body.access_token,undefined);assert.equal(status.body.refresh_token,undefined);
});
test('strict false: batch enumeration stays shop scoped with date/limit bounds', async () => {
  const f=fixture(ordinary());
  const res=await f.route('routes/accounting.js').call('post','/quickbooks/sync/batch',{
    body:{from:'2026-10-01',to:'2026-10-21',limit:999,shop_id:'other'} });
  assert.equal(res.body.synced_count,1);
  const q=f.state.queries.find(q=>q.sql.includes('LIMIT $4'));
  assert.match(q.sql,/shop_id = \$1/);assert.deepEqual(plain(q.args),['shop','2026-10-01','2026-10-21',200]);
});
test('failed QB refresh cannot save tokens; repeated 401 is bounded', async () => {
  const f=fixture(ordinary());f.connection.quickbooks_token_expires_at='2000-01-01';f.state.providerError=true;
  await assert.rejects(f.qb.private.ensureAccessToken('shop'),/synthetic provider failure/);assert.equal(f.state.writes.length,0);
  const g=fixture(ordinary());
  g.state.responses=[{ok:false,status:401,json:async()=>({})},
    {ok:true,status:200,json:async()=>({access_token:'new',refresh_token:'new',expires_in:3600})},
    {ok:false,status:401,json:async()=>({})}];
  await assert.rejects(g.qb.private.qbRequest('shop'),/QuickBooks API error 401/);assert.equal(g.state.calls.length,3);
});
test('public invoice eligibility and missing RO still refuse rendering for ordinary shops', async () => {
  const f=fixture(ordinary()), route=f.route('routes/invoice.js');
  f.ro.status='repair';assert.equal((await route.call('get','/public/:token')).statusCode,403);
  f.ro.status='closed';f.ro.payment_status='unpaid';assert.equal((await route.call('get','/public/:token')).statusCode,403);
  assert.equal((await route.call('get','/:roId',{params:{roId:'bad'}})).statusCode,404);zero(f);
});

}
