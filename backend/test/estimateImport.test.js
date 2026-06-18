const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name));
}

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
    if (
      key.includes(`${path.sep}backend${path.sep}src${path.sep}routes${path.sep}estimateImport.js`)
      || key.includes(`${path.sep}backend${path.sep}src${path.sep}routes${path.sep}ros.js`)
      || key.includes(`${path.sep}backend${path.sep}src${path.sep}routes${path.sep}insuranceOcr.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function createDbMock() {
  const calls = [];
  let roId = null;
  let roNumber = null;
  const client = {
    async query(sql, params = []) {
      calls.push({ source: 'client', sql: String(sql), params });
      if (/INSERT INTO repair_orders/i.test(sql)) {
        roId = params[0];
        roNumber = params[2];
      }
      if (/SELECT \* FROM repair_orders WHERE id = \$1 AND shop_id = \$2/i.test(sql)) {
        return {
          rows: [{
            id: roId,
            shop_id: params[1],
            ro_number: roNumber,
            customer_id: params[2] || null,
            vehicle_id: null,
            deductible_waived: 0,
            referral_fee: 0,
            goodwill_repair_cost: 0,
          }],
        };
      }
      if (/SELECT id, deductible_waived, referral_fee, goodwill_repair_cost/i.test(sql)) {
        return {
          rows: [{
            id: params[0],
            deductible_waived: 0,
            referral_fee: 0,
            goodwill_repair_cost: 0,
          }],
        };
      }
      if (/COALESCE\(SUM\(total\)/i.test(sql)) {
        return {
          rows: [{
            subtotal: 892.95,
            labor_total: 276.7,
            parts_total: 435.25,
            sublet_total: 200,
            taxable_subtotal: 435.25,
            line_count: 5,
          }],
        };
      }
      if (/SELECT COALESCE\(tax_rate/i.test(sql)) {
        return { rows: [{ tax_rate: 0 }] };
      }
      return { rows: [] };
    },
    release() {
      calls.push({ source: 'client', sql: 'release', params: [] });
    },
  };

  const db = {
    calls,
    pool: {
      async connect() {
        calls.push({ source: 'pool', sql: 'connect', params: [] });
        return client;
      },
    },
    async dbGet(sql, params = []) {
      calls.push({ source: 'dbGet', sql: String(sql), params });
      if (/revoked_tokens/i.test(sql)) return null;
      if (/revoke_all_before/i.test(sql)) return null;
      if (/SELECT plan, trial_ends_at FROM shops/i.test(sql)) return { plan: 'paid', trial_ends_at: null };
      if (/SELECT id FROM shops WHERE id = \$1/i.test(sql)) return { id: params[0] };
      if (/MAX\(/i.test(sql) && /FROM repair_orders/i.test(sql)) return { n: 0 };
      if (/row_to_json\(v\)/i.test(sql)) {
        return {
          vehicle: { id: 'vehicle-1' },
          customer: { id: 'customer-1' },
          log: [],
          parts: [],
          assigned_tech: null,
          has_portal_access: false,
        };
      }
      return null;
    },
    async dbAll(sql, params = []) {
      calls.push({ source: 'dbAll', sql: String(sql), params });
      return [];
    },
    async dbRun(sql, params = []) {
      calls.push({ source: 'dbRun', sql: String(sql), params });
      return { rowCount: 1 };
    },
  };
  return db;
}

function multipartBody(fieldName, filename, contentType, buffer) {
  const boundary = `----revv-test-${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`
    + `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, Buffer.from(buffer), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
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
        headers: res.headers,
        text,
        json: text ? JSON.parse(text) : null,
      });
    });
    res.on('error', reject);
    app.handle(req, res, reject);
  });
}

async function withTestApp(dbMock, fn) {
  clearRouteCache();
  installMock(require.resolve('../src/db'), dbMock);
  installMock(require.resolve('../src/services/notifications'), {
    createNotification: async () => {},
  });
  installMock(require.resolve('../src/services/customerOptInConfirmation'), {
    sendCustomerOptInConfirmation: async () => {},
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/estimate-import', require('../src/routes/estimateImport'));
  return fn(app);
}

function authHeader(role = 'technician') {
  const token = jwt.sign({ id: 'user-1', shop_id: 'shop-1', role }, process.env.JWT_SECRET);
  return { authorization: `Bearer ${token}` };
}

test('parse-bms returns OCR-compatible parsed contract with BMS enrichment fields', async () => {
  const dbMock = createDbMock();
  await withTestApp(dbMock, async (app) => {
    const multipart = multipartBody('bms_file', 'cieca-sample.xml', 'application/xml', fixture('cieca-sample.xml'));
    const res = await inject(app, {
      method: 'POST',
      url: '/api/estimate-import/parse-bms',
      headers: { ...authHeader(), 'content-type': multipart.contentType },
      body: multipart.body,
    });
    const body = res.json;

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.parsed.customer_name, 'Casey Rivera');
    assert.equal(body.parsed.vehicle_make, 'Toyota');
    assert.deepEqual(body.parsed.line_items[1], {
      description: 'REPL rear bumper cover',
      type: 'parts',
      quantity: 1,
      unit_price: 435.25,
      operation_code: 'REPL',
      labor_units: null,
      part_type: 'OEM',
      part_number: '52159-06999',
    });
  });
});

test('create reuses import-estimate path and writes shop-scoped RO, customer, vehicle, parts requests, and operations', async () => {
  const dbMock = createDbMock();
  await withTestApp(dbMock, async (app) => {
    const parsed = require('../src/lib/bmsParser').parseBms(fixture('cieca-sample.xml'));
    const bodyBuffer = Buffer.from(JSON.stringify({ parsed }));
    const res = await inject(app, {
      method: 'POST',
      url: '/api/estimate-import/create',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: bodyBuffer,
    });
    const body = res.json;

    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.imported_line_count, 5);

    const inserts = dbMock.calls.filter((call) => /^INSERT INTO/i.test(call.sql.trim()));
    assert.ok(inserts.some((call) => /INSERT INTO customers/i.test(call.sql) && call.params[1] === 'shop-1'));
    assert.ok(inserts.some((call) => /INSERT INTO vehicles/i.test(call.sql) && call.params[1] === 'shop-1'));
    assert.ok(inserts.some((call) => /INSERT INTO repair_orders/i.test(call.sql) && call.params[1] === 'shop-1'));

    const partRequest = inserts.find((call) => /INSERT INTO parts_requests/i.test(call.sql));
    assert.ok(partRequest);
    assert.equal(partRequest.params[3], 'REPL rear bumper cover');
    assert.equal(partRequest.params[4], '52159-06999');
    assert.match(partRequest.params[6], /Part type: OEM/);
    assert.match(partRequest.params[6], /Operation: REPL/);

    const operations = inserts.filter((call) => /INSERT INTO ro_operations/i.test(call.sql));
    assert.equal(operations.length, 4);
    assert.ok(operations.some((call) => call.params[3] === 'RPR left quarter panel' && call.params[6] === 2.5 && call.params[7] === 65));
    assert.ok(operations.some((call) => call.params[3] === 'RNI tail lamp assembly for access' && call.params[6] === 0.3));
  });
});

test('malformed or XXE upload is rejected safely and performs no DB writes', async () => {
  const dbMock = createDbMock();
  await withTestApp(dbMock, async (app) => {
    const xxe = Buffer.from(`<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<Estimate><InsuranceCompanyName>&xxe;</InsuranceCompanyName></Estimate>`);
    const multipart = multipartBody('bms_file', 'attack.xml', 'application/xml', xxe);
    const res = await inject(app, {
      method: 'POST',
      url: '/api/estimate-import/parse-bms',
      headers: { ...authHeader(), 'content-type': multipart.contentType },
      body: multipart.body,
    });
    const body = res.json;

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.match(body.error, /Invalid|Could not parse/);
    assert.equal(dbMock.calls.some((call) => /INSERT|UPDATE|DELETE|BEGIN|COMMIT/i.test(call.sql)), false);
  });
});
