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
    `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}claimLinks.js`,
    `${path.sep}backend${path.sep}src${path.sep}middleware${path.sep}auth.js`,
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
      if (/FROM claim_links/i.test(text) && /ro_id = \$1 AND shop_id = \$2/i.test(text)) {
        return params[0] === 'ro-1' && params[1] === roShopId
          ? { id: 'claim-link-1', ro_id: 'ro-1', shop_id: roShopId, token: 'owner-token' }
          : null;
      }
      throw new Error(`Unexpected dbGet query: ${text}`);
    },
    async dbRun() {
      return { rowCount: 1 };
    },
  });
  installMock('../middleware/auth', (req, _res, next) => {
    req.user = { id: 'user-1', role: 'admin', shop_id: 'shop-1' };
    next();
  });

  const app = express();
  app.use(express.json());
  app.use('/api/claim-links', require('../routes/claimLinks'));
  return { app, calls };
}

test('GET /api/claim-links/ro/:roId for another shop returns no token', async () => {
  const { app, calls } = buildApp({ roShopId: 'shop-2' });

  const res = await inject(app, { method: 'GET', url: '/api/claim-links/ro/ro-1' });

  assert.equal(res.status, 404);
  assert.deepEqual(res.json, { error: 'Not found' });
  assert.equal(JSON.stringify(res.json).includes('owner-token'), false);
  assert.equal(calls.filter((call) => /FROM claim_links/i.test(call.sql)).length, 0);
});

test('GET /api/claim-links/ro/:roId returns owning shop link with token intact', async () => {
  const { app, calls } = buildApp({ roShopId: 'shop-1' });

  const res = await inject(app, { method: 'GET', url: '/api/claim-links/ro/ro-1' });

  assert.equal(res.status, 200);
  assert.equal(res.json.token, 'owner-token');
  const linkRead = calls.find((call) => /FROM claim_links/i.test(call.sql));
  assert.ok(linkRead);
  assert.match(linkRead.sql, /ro_id = \$1 AND shop_id = \$2/i);
  assert.deepEqual(linkRead.params, ['ro-1', 'shop-1']);
});
