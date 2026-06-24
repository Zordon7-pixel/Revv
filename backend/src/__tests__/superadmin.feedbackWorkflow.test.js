const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function installMock(resolvedPath, exportsValue) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsValue,
  };
}

function clearRouteCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${require('node:path').sep}backend${require('node:path').sep}src${require('node:path').sep}routes${require('node:path').sep}superadmin.js`)) {
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

function authHeader(role = 'superadmin') {
  const token = jwt.sign({ id: 'master-1', role }, process.env.JWT_SECRET);
  return { authorization: `Bearer ${token}` };
}

test('superadmin can assign feedback to an agent and receive an agent prompt', async () => {
  clearRouteCache();
  const calls = [];
  const db = {
    async dbAll() { return []; },
    async dbRun() { return { rowCount: 1 }; },
    async dbGet(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/SELECT\s+f\.id/i.test(sql)) {
        return {
          id: params[0],
          shop_id: 'shop-1',
          shop_name: 'Miles Automotive',
          tester_name: 'Miles',
          category: 'bug',
          priority: 'high',
          status: 'new',
          routed_to: null,
          support_note: null,
          linked_ref: null,
          page: '/ros',
          message: 'Photos do not show',
          expected: 'Uploaded photos should be visible',
          created_at: '2026-06-23T00:00:00.000Z',
        };
      }
      if (/UPDATE feedback/i.test(sql)) {
        assert.equal(params[0], 'assigned');
        assert.equal(params[1], 'Codex');
        return {
          id: params[7],
          shop_id: 'shop-1',
          status: params[0],
          routed_to: params[1],
          support_note: params[2],
          linked_ref: params[3],
          assigned_at: '2026-06-23T00:01:00.000Z',
          resolved_at: null,
          updated_at: '2026-06-23T00:01:00.000Z',
        };
      }
      return null;
    },
  };
  installMock(require.resolve('../db'), db);

  const app = express();
  app.use(express.json());
  app.use('/api/superadmin', require('../routes/superadmin'));

  const res = await inject(app, {
    method: 'PATCH',
    url: '/api/superadmin/feedback/feedback-1',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ status: 'assigned', routed_to: 'Codex', support_note: 'Needs photo URL review' })),
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.issue.status, 'assigned');
  assert.equal(res.json.issue.routed_to, 'Codex');
  assert.match(res.json.agent_prompt, /TASK: REVV feedback issue feedback-1/);
  assert.match(res.json.agent_prompt, /Photos do not show/);
});

test('superadmin feedback workflow rejects invalid agents', async () => {
  clearRouteCache();
  installMock(require.resolve('../db'), {
    async dbAll() { return []; },
    async dbRun() { return { rowCount: 1 }; },
    async dbGet(sql, params = []) {
      if (/SELECT\s+f\.id/i.test(sql)) {
        return { id: params[0], status: 'new', message: 'x' };
      }
      return null;
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/superadmin', require('../routes/superadmin'));

  const res = await inject(app, {
    method: 'PATCH',
    url: '/api/superadmin/feedback/feedback-1',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ routed_to: 'Unknown Agent' })),
  });

  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'Invalid agent');
});

test('superadmin feedback workflow accepts ready_for_qa status', async () => {
  clearRouteCache();
  installMock(require.resolve('../db'), {
    async dbAll() { return []; },
    async dbRun() { return { rowCount: 1 }; },
    async dbGet(sql, params = []) {
      if (/SELECT\s+f\.id/i.test(sql)) {
        return {
          id: params[0],
          shop_id: 'shop-1',
          shop_name: 'Miles Automotive',
          category: 'bug',
          priority: 'high',
          status: 'assigned',
          routed_to: 'Codex',
          message: 'Needs Claude QA',
        };
      }
      if (/UPDATE feedback/i.test(sql)) {
        assert.equal(params[0], 'ready_for_qa');
        return {
          id: params[7],
          shop_id: 'shop-1',
          status: params[0],
          routed_to: params[1],
          support_note: params[2],
          linked_ref: params[3],
          assigned_at: '2026-06-24T00:01:00.000Z',
          resolved_at: null,
          updated_at: '2026-06-24T00:01:00.000Z',
        };
      }
      return null;
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/superadmin', require('../routes/superadmin'));

  const res = await inject(app, {
    method: 'PATCH',
    url: '/api/superadmin/feedback/feedback-qa',
    headers: { ...authHeader(), 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ status: 'ready_for_qa', support_note: 'Claude QA required before ship.' })),
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.issue.status, 'ready_for_qa');
});
