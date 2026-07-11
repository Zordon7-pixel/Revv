const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase-2-test-secret';

function installMock(resolvedPath, exportsValue) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsValue,
  };
}

function clearRouteCache() {
  const targets = [
    `${path.sep}routes${path.sep}search.js`,
    `${path.sep}routes${path.sep}dashboard.js`,
    `${path.sep}middleware${path.sep}auth.js`,
    `${path.sep}middleware${path.sep}roles.js`,
    `${path.sep}services${path.sep}roMoney.js`,
  ];
  for (const key of Object.keys(require.cache)) {
    if (targets.some((target) => key.includes(target))) delete require.cache[key];
  }
}

function inject(app, { method = 'GET', url, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([]);
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1', ...headers };
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
    res.setHeader = (name, value) => { res.headers[String(name).toLowerCase()] = value; };
    res.getHeader = (name) => res.headers[String(name).toLowerCase()];
    res.removeHeader = (name) => { delete res.headers[String(name).toLowerCase()]; };
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode;
      for (const [name, value] of Object.entries(headersToSet)) res.setHeader(name, value);
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      Writable.prototype.end.call(res);
    };
    res.on('finish', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null });
    });
    res.on('error', reject);
    app.handle(req, res, reject);
  });
}

function authHeader(shopId = 'shop-1', role = 'admin') {
  const token = jwt.sign({ id: `${role}-1`, role, shop_id: shopId }, process.env.JWT_SECRET);
  return { authorization: `Bearer ${token}` };
}

function buildApp(db) {
  clearRouteCache();
  installMock(require.resolve('../db'), db);
  const app = express();
  app.use('/api/search', require('../routes/search'));
  app.use('/api/dashboard', require('../routes/dashboard'));
  return app;
}

test('global search is authenticated, shop-scoped, ranked, and cannot return another shop RO', async () => {
  const calls = [];
  const app = buildApp({
    async dbAll(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (params[0] !== 'shop-1') return [];
      return [{
        id: 'ro-own',
        ro_number: 'RO-100',
        status: 'repair',
        customer_name: 'Miles Customer',
        year: 2024,
        make: 'Honda',
        model: 'Accord',
        plate: 'OWN100',
        vin: 'VIN100',
        claim_number: 'CLAIM100',
      }];
    },
    async dbGet() { return null; },
  });

  const unauthenticated = await inject(app, { url: '/api/search?q=RO-100' });
  assert.equal(unauthenticated.status, 401);

  const own = await inject(app, {
    url: '/api/search?q=RO-100',
    headers: authHeader('shop-1'),
  });
  assert.equal(own.status, 200);
  assert.equal(own.json.results.length, 1);
  assert.equal(own.json.results[0].id, 'ro-own');

  const foreign = await inject(app, {
    url: '/api/search?q=RO-100',
    headers: authHeader('shop-2'),
  });
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.json.results, []);

  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /WHERE ro\.shop_id::text = \$1::text/i);
  assert.match(calls[0].sql, /c\.shop_id::text = ro\.shop_id::text/i);
  assert.match(calls[0].sql, /v\.shop_id::text = ro\.shop_id::text/i);
  assert.match(calls[0].sql, /LIMIT 20/i);
  assert.doesNotMatch(calls[0].sql, /SELECT\s+\*/i);
  assert.equal(calls[0].params[0], 'shop-1');
  assert.equal(calls[1].params[0], 'shop-2');

  const technician = await inject(app, {
    url: '/api/search?q=RO-100',
    headers: authHeader('shop-1', 'technician'),
  });
  assert.equal(technician.status, 200);
  assert.match(calls[2].sql, /ro\.assigned_to::text = \$5::text/i);
  assert.equal(calls[2].params[4], 'technician-1');
});

test('dashboard instruments expose server-derived integer cents for every money KPI', async () => {
  const calls = [];
  const app = buildApp({
    async dbAll() { return []; },
    async dbGet(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/SUM\(total\)/.test(text)) {
        return { revenue_mtd: '123.45', true_profit_mtd: '45.67', ro_count: 2 };
      }
      if (/FROM monthly_goals/.test(text)) return { revenue_goal: '1000.00' };
      if (/total_supplement_opportunity/.test(text)) {
        return { total_supplement_opportunity: '88.88', ro_count: 1 };
      }
      return null;
    },
  });

  const response = await inject(app, {
    url: '/api/dashboard/instruments',
    headers: authHeader('shop-1', 'owner'),
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.revenue_mtd_cents, 12345);
  assert.equal(response.json.revenue_goal_cents, 100000);
  assert.equal(response.json.true_profit_cents, 4567);
  assert.equal(response.json.supplement_opportunity_cents, 8888);
  assert.equal(response.json.profit_margin_percent, 36.99);
  for (const key of ['revenue_mtd_cents', 'revenue_goal_cents', 'true_profit_cents', 'supplement_opportunity_cents']) {
    assert.equal(Number.isInteger(response.json[key]), true, `${key} must be integer cents`);
  }
  const instrumentCalls = calls.filter((call) => /repair_orders|monthly_goals|estimate_line_items/.test(call.sql));
  assert.equal(instrumentCalls.length, 3);
  assert.equal(instrumentCalls.every((call) => call.params[0] === 'shop-1'), true);
});
