const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'synthetic-feedback-test-secret';

function installMock(resolvedPath, exportsValue) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsValue,
  };
}

function clearFeedbackCache() {
  const routeSegment = `${require('node:path').sep}backend${require('node:path').sep}src${require('node:path').sep}routes${require('node:path').sep}feedback.js`;
  const authSegment = `${require('node:path').sep}backend${require('node:path').sep}src${require('node:path').sep}middleware${require('node:path').sep}auth.js`;
  const rolesSegment = `${require('node:path').sep}backend${require('node:path').sep}src${require('node:path').sep}middleware${require('node:path').sep}roles.js`;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(routeSegment) || key.includes(authSegment) || key.includes(rolesSegment)) {
      delete require.cache[key];
    }
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

function authHeader({ role = 'admin', shop_id = 'shop-1' } = {}) {
  const token = jwt.sign({ id: `${role}-1`, role, shop_id }, process.env.JWT_SECRET);
  return { authorization: `Bearer ${token}` };
}

function buildApp(db) {
  clearFeedbackCache();
  installMock(require.resolve('../db'), db);
  const app = express();
  app.use(express.json());
  app.use('/api/feedback', require('../routes/feedback'));
  return app;
}

test('feedback list requires authentication', async () => {
  const app = buildApp({
    async dbGet() { return null; },
    async dbAll() { throw new Error('dbAll should not be called without auth'); },
    async dbRun() { return { rowCount: 1 }; },
  });

  const res = await inject(app, { method: 'GET', url: '/api/feedback' });

  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'Unauthorized');

  for (const url of ['/api/feedback', '/api/feedback/all']) {
    const invalid = await inject(app, {
      method: 'GET', url, headers: { authorization: 'Bearer invalid-token' },
    });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.json.error, 'Invalid token');
  }
});

test('feedback list is admin gated and scoped to the current shop', async () => {
  const calls = [];
  const policyCalls = [];
  const app = buildApp({
    async dbGet() { return null; },
    async dbAll(sql, params = []) {
      // Exercise the real policy resolver with persisted shop rows, not feedback.
      if (sql === 'SELECT id::text AS id, is_internal_test_shop FROM shops WHERE id::text = $1') {
        policyCalls.push(params);
        return [{ id: 'shop-1', is_internal_test_shop: false }];
      }
      calls.push({ sql: String(sql), params });
      return [{ id: 'fb-1', shop_id: 'shop-1', message: 'Scoped feedback' }];
    },
    async dbRun() { return { rowCount: 1 }; },
  });

  const res = await inject(app, {
    method: 'GET',
    url: '/api/feedback?limit=25',
    headers: authHeader({ role: 'admin', shop_id: 'shop-1' }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.feedback.length, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE shop_id::text = \$1::text/i);
  assert.doesNotMatch(calls[0].sql, /SELECT\s+\*/i);
  assert.deepEqual(calls[0].params, ['shop-1', 25, 0]);
  assert.deepEqual(policyCalls, [['shop-1'], ['shop-1']]);
});

test('non-admin feedback list access is rejected', async () => {
  const app = buildApp({
    async dbGet() { return null; },
    async dbAll() { throw new Error('dbAll should not be called for technician'); },
    async dbRun() { return { rowCount: 1 }; },
  });

  const res = await inject(app, {
    method: 'GET',
    url: '/api/feedback',
    headers: authHeader({ role: 'technician', shop_id: 'shop-1' }),
  });

  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'admin access required');
});

test('feedback all-shops list rejects non-superadmin users', async () => {
  const app = buildApp({
    async dbGet() { return null; },
    async dbAll() { throw new Error('dbAll should not be called for non-superadmin all-shops read'); },
    async dbRun() { return { rowCount: 1 }; },
  });

  const res = await inject(app, {
    method: 'GET',
    url: '/api/feedback/all',
    headers: authHeader({ role: 'admin', shop_id: 'shop-1' }),
  });

  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'Superadmin access required');
});

test('superadmin cross-shop feedback list uses the gated all-shops path', async () => {
  const calls = [];
  const app = buildApp({
    async dbGet() { return null; },
    async dbAll(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return [{ id: 'fb-2', shop_id: 'shop-2', message: 'All feedback' }];
    },
    async dbRun() { return { rowCount: 1 }; },
  });

  const res = await inject(app, {
    method: 'GET',
    url: '/api/feedback/all?limit=10&offset=5',
    headers: authHeader({ role: 'superadmin', shop_id: null }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.feedback.length, 1);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /WHERE shop_id/i);
  assert.doesNotMatch(calls[0].sql, /SELECT\s+\*/i);
  assert.deepEqual(calls[0].params, [10, 5]);
});

test('superadmin without shop context cannot use the shop-scoped list path', async () => {
  const app = buildApp({
    async dbGet() { return null; },
    async dbAll() { throw new Error('dbAll should not be called without shop context'); },
    async dbRun() { return { rowCount: 1 }; },
  });

  const res = await inject(app, {
    method: 'GET',
    url: '/api/feedback',
    headers: authHeader({ role: 'superadmin', shop_id: null }),
  });

  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'Shop context required');
});

test('public feedback submission remains available but rate limited', async () => {
  const calls = [];
  const app = buildApp({
    async dbGet() { return null; },
    async dbAll() { throw new Error('Anonymous storage must not resolve shop policy'); },
    async dbRun(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return { rowCount: 1 };
    },
  });

  const res = await inject(app, {
    method: 'POST',
    url: '/api/feedback',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ message: 'Button does not work', app: 'revv',
      shop_id: 'forged-shop', is_internal_test_shop: false, routed_to: 'Codex' })),
  });

  assert.equal(res.status, 201);
  assert.equal(res.json.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[8], null);
  assert.equal(calls[0].params[9], null);

  for (let i = 0; i < 9; i += 1) {
    const allowed = await inject(app, {
      method: 'POST',
      url: '/api/feedback',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ message: `Button does not work ${i}`, app: 'revv' })),
    });
    assert.equal(allowed.status, 201);
  }

  const limited = await inject(app, {
    method: 'POST',
    url: '/api/feedback',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ message: 'Too many reports', app: 'revv' })),
  });
  assert.equal(limited.status, 429);
  assert.equal(calls.length, 10, 'Rate-limited submissions never reach storage');
});

test('anonymous feedback ignores unverified identity and routing even with invalid optional tokens', async () => {
  const calls = [];
  let policyReads = 0;
  const app = buildApp({
    async dbGet() { throw new Error('Anonymous intake must not query identity'); },
    async dbAll() { policyReads += 1; throw new Error('Anonymous intake has no shop policy'); },
    async dbRun(sql, params) { calls.push({ sql, params }); return { rowCount: 1 }; },
  });
  const tokens = [
    'invalid-token',
    jwt.sign({ shop_id: 'forged-shop' }, 'synthetic-wrong-key'),
    jwt.sign({ shop_id: 'shop-1', exp: 1 }, process.env.JWT_SECRET),
    jwt.sign({ role: 'superadmin' }, process.env.JWT_SECRET),
  ];
  for (const token of tokens) {
    const res = await inject(app, {
      method: 'POST', url: '/api/feedback?shop_id=forged-shop&routed_to=Codex',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ message: 'Synthetic report', shop_id: 'forged-shop',
        is_internal_test_shop: false, email: 'synthetic@example.invalid', routed_to: 'Codex' })),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(calls.at(-1).params.slice(8), [null, null]);
  }
  assert.equal(calls.length, tokens.length);
  assert.equal(policyReads, 0);
});

test('shop-linked feedback uses real persisted policy and fails closed at both boundaries', async t => {
  const ordinary = [{ id: 'shop-1', is_internal_test_shop: false }];
  const cases = [
    ['ordinary', [ordinary, ordinary], 200],
    ['internal', [[{ id: 'shop-1', is_internal_test_shop: true }]], 409],
    ['missing', [[]], 503],
    ['wrong rows from incomplete mock', [[{ id: 'fb-1', shop_id: 'shop-1' }]], 503],
    ['unavailable', [new Error('Synthetic policy unavailable')], 503],
    ['late internal', [ordinary, [{ id: 'shop-1', is_internal_test_shop: true }]], 409],
    ['late unavailable', [ordinary, new Error('Synthetic policy unavailable')], 503],
  ];
  for (const method of ['GET', 'POST']) {
    for (const [name, sequence, status] of cases) {
      await t.test(`${method}: ${name}`, async () => {
        const reads = [], writes = [], policyCalls = [];
        const app = buildApp({
          async dbGet() { return null; },
          async dbAll(sql, params) {
            if (sql === 'SELECT id::text AS id, is_internal_test_shop FROM shops WHERE id::text = $1') {
              const rows = sequence[Math.min(policyCalls.length, sequence.length - 1)];
              policyCalls.push(params);
              if (rows instanceof Error) throw rows;
              return rows;
            }
            reads.push({ sql, params });
            return [{ id: 'fb-1', shop_id: 'shop-1' }];
          },
          async dbRun(sql, params) { writes.push({ sql, params }); return { rowCount: 1 }; },
        });
        const res = await inject(app, {
          method, url: '/api/feedback',
          headers: { ...authHeader(), 'content-type': 'application/json' },
          body: method === 'POST' ? Buffer.from(JSON.stringify({ message: 'Synthetic report',
            routed_to: 'Codex', shop_id: 'forged-shop', is_internal_test_shop: false })) : Buffer.alloc(0),
        });
        assert.equal(res.status, method === 'POST' && status === 200 ? 201 : status);
        assert.deepEqual(policyCalls, Array.from({ length: sequence.length }, () => ['shop-1']));
        if (status === 200) {
          if (method === 'POST') assert.deepEqual(writes[0].params.slice(8), ['Codex', 'shop-1']);
          else assert.deepEqual(reads[0].params, ['shop-1', 100, 0]);
        } else {
          assert.deepEqual(res.json, { error: status === 409 ? 'INTERNAL_TEST_SHOP' : 'SHOP_POLICY_UNAVAILABLE', excluded: true });
          assert.deepEqual(writes, []);
          assert.equal(reads.length, method === 'GET' && name.startsWith('late ') ? 1 : 0);
        }
      });
    }
  }
});

test('anonymous feedback still validates input and reports storage failure', async () => {
  let writes = 0;
  const app = buildApp({
    async dbAll() { throw new Error('No anonymous policy query'); },
    async dbRun() { writes += 1; throw new Error('Synthetic insert failure'); },
  });
  for (const [message, status] of [[' ', 400], ['Synthetic report', 500]]) {
    const res = await inject(app, {
      method: 'POST', url: '/api/feedback', headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ message })),
    });
    assert.equal(res.status, status);
    assert.equal(res.json.error, status === 400 ? 'Message required' : 'Synthetic insert failure');
  }
  assert.equal(writes, 1);
});
