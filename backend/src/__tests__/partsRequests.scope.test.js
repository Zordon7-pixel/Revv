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

function clearRouteCache() {
  const segments = [
    `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}partsRequests.js`,
    `${path.sep}backend${path.sep}src${path.sep}middleware${path.sep}auth.js`,
    `${path.sep}backend${path.sep}src${path.sep}middleware${path.sep}roles.js`,
    `${path.sep}backend${path.sep}src${path.sep}middleware${path.sep}roOwnership.js`,
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

function buildApp({ roShopId = 'shop-1' } = {}) {
  clearRouteCache();
  const calls = [];
  installMock('../db', {
    async dbGet(sql, params = []) {
      const text = String(sql);
      calls.push({ type: 'dbGet', sql: text, params });
      if (/FROM repair_orders/i.test(text) && /shop_id::text = \$2::text/i.test(text)) {
        return params[0] === 'ro-1' && params[1] === roShopId ? { id: 'ro-1' } : null;
      }
      throw new Error(`Unexpected dbGet query: ${text}`);
    },
    async dbAll(sql, params = []) {
      const text = String(sql);
      calls.push({ type: 'dbAll', sql: text, params });
      if (/FROM parts_requests pr/i.test(text) && /JOIN repair_orders ro/i.test(text)) {
        return params[0] === 'ro-1' && params[1] === roShopId
          ? [{ id: 'part-request-1', ro_id: 'ro-1', part_name: 'Bumper cover' }]
          : [];
      }
      throw new Error(`Unexpected dbAll query: ${text}`);
    },
    async dbRun() {
      return { rowCount: 1 };
    },
  });
  installMock('../middleware/auth', (req, _res, next) => {
    req.user = { id: 'user-1', role: 'admin', shop_id: 'shop-1' };
    next();
  });
  installMock('../middleware/roles', {
    requireAdmin: (_req, _res, next) => next(),
    requireTechnician: (_req, _res, next) => next(),
  });
  installMock('../services/notifications', { createNotification: async () => ({}) });

  const app = express();
  app.use(express.json());
  app.use('/api/parts-requests', require('../routes/partsRequests'));
  return { app, calls };
}

test('GET /api/parts-requests/:ro_id for another shop returns no rows', async () => {
  const { app, calls } = buildApp({ roShopId: 'shop-2' });

  const res = await inject(app, { method: 'GET', url: '/api/parts-requests/ro-1' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.json, { error: 'Not found' });
  assert.equal(calls.filter((call) => call.type === 'dbAll').length, 0);
});

test('GET /api/parts-requests/:ro_id returns own-shop requests through repair_orders join scope', async () => {
  const { app, calls } = buildApp({ roShopId: 'shop-1' });

  const res = await inject(app, { method: 'GET', url: '/api/parts-requests/ro-1' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, {
    requests: [{ id: 'part-request-1', ro_id: 'ro-1', part_name: 'Bumper cover' }],
  });
  const requestRead = calls.find((call) => call.type === 'dbAll');
  assert.ok(requestRead);
  assert.match(requestRead.sql, /JOIN repair_orders ro ON ro\.id = pr\.ro_id/i);
  assert.match(requestRead.sql, /WHERE pr\.ro_id = \$1 AND ro\.shop_id = \$2/i);
  assert.doesNotMatch(requestRead.sql, /SELECT \* FROM parts_requests WHERE ro_id = \$1/i);
  assert.deepEqual(requestRead.params, ['ro-1', 'shop-1']);
});
