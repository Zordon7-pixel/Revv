const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const express = require('express');

function installMock(resolvedPath, exportsValue) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsValue,
  };
}

function clearPhotosCache() {
  const segments = [
    `${path.sep}backend${path.sep}src${path.sep}routes${path.sep}photos.js`,
    `${path.sep}backend${path.sep}src${path.sep}middleware${path.sep}auth.js`,
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

function buildApp(db) {
  clearPhotosCache();
  installMock(require.resolve('../db'), db);
  installMock(require.resolve('../middleware/auth'), (req, _res, next) => {
    req.user = {
      id: 'user-1',
      role: 'admin',
      shop_id: req.headers['x-shop-id'] || 'shop-1',
    };
    next();
  });

  const app = express();
  app.use(express.json());
  app.use('/api/photos', require('../routes/photos'));
  return app;
}

test('GET /api/photos/:ro_id returns only photos scoped through repair_orders', async () => {
  const calls = [];
  const app = buildApp({
    async dbGet() { return null; },
    async dbRun() { return { rowCount: 1 }; },
    async dbAll(sql, params = []) {
      calls.push({ sql: String(sql), params });
      assert.match(String(sql), /JOIN repair_orders ro ON ro\.id = p\.ro_id/i);
      assert.match(String(sql), /ro\.shop_id = \$2/i);
      assert.doesNotMatch(String(sql), /FROM ro_photos\s+WHERE/i);
      if (params[0] === 'ro-shop-1' && params[1] === 'shop-1') {
        return [{ id: 'photo-1', ro_id: 'ro-shop-1', photo_url: '/uploads/photos/photo-1.jpg' }];
      }
      return [];
    },
  });

  const own = await inject(app, {
    method: 'GET',
    url: '/api/photos/ro-shop-1',
    headers: { 'x-shop-id': 'shop-1' },
  });

  assert.equal(own.status, 200);
  assert.deepEqual(own.json.photos, [{ id: 'photo-1', ro_id: 'ro-shop-1', photo_url: '/uploads/photos/photo-1.jpg' }]);

  const foreign = await inject(app, {
    method: 'GET',
    url: '/api/photos/ro-shop-2',
    headers: { 'x-shop-id': 'shop-1' },
  });

  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.json.photos, []);
  assert.equal(calls.length, 2);
});

test('predropoff read does not expose another shop RO photos', async () => {
  const calls = [];
  const app = buildApp({
    async dbGet(sql, params = []) {
      calls.push({ kind: 'dbGet', sql: String(sql), params });
      if (/FROM repair_orders/i.test(String(sql)) && params[0] === 'ro-shop-1' && params[1] === 'shop-1') {
        return { id: 'ro-shop-1' };
      }
      return null;
    },
    async dbRun() { return { rowCount: 1 }; },
    async dbAll(sql, params = []) {
      calls.push({ kind: 'dbAll', sql: String(sql), params });
      assert.match(String(sql), /JOIN repair_orders ro ON ro\.id = p\.ro_id/i);
      assert.match(String(sql), /ro\.shop_id = \$2/i);
      if (params[0] === 'ro-shop-1' && params[1] === 'shop-1') {
        return [{ id: 'pre-1', ro_id: 'ro-shop-1', photo_type: 'predropoff' }];
      }
      return [];
    },
  });

  const own = await inject(app, {
    method: 'GET',
    url: '/api/photos/ro/ro-shop-1/predropoff',
    headers: { 'x-shop-id': 'shop-1' },
  });
  assert.equal(own.status, 200);
  assert.deepEqual(own.json.photos, [{ id: 'pre-1', ro_id: 'ro-shop-1', photo_type: 'predropoff' }]);

  const foreign = await inject(app, {
    method: 'GET',
    url: '/api/photos/ro/ro-shop-2/predropoff',
    headers: { 'x-shop-id': 'shop-1' },
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.json.error, 'Repair order not found');
});

test('route files do not keep bare ro_photos read queries', () => {
  const files = [
    path.join(__dirname, '../routes/photos.js'),
    path.join(__dirname, '../routes/export.js'),
    path.join(__dirname, '../routes/portal.js'),
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /SELECT\s+\*\s+FROM\s+ro_photos\s+WHERE/i, file);
    assert.doesNotMatch(source, /FROM\s+ro_photos\s*\n\s*WHERE\s+ro_id\s*=/i, file);
  }
});
