const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable, Writable } = require('node:stream');
const express = require('express');
const jwt = require('jsonwebtoken');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const BODY = { name: 'Synthetic Customer', phone: '2125550100', email: 'synthetic@example.test', year: '2020', make: 'Test', model: 'Fixture', damage_type: 'hail', description: 'Private description', service: 'Private service', notes: 'Private notes' };
const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';
process.env.JWT_SECRET = 'synthetic-public-intake-test-key';

function install(id, exports) {
  const filename = require.resolve(id);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function inject(app, { method, url, headers = {}, body = Buffer.alloc(0), ip = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body.length ? [body] : []);
    req.method = method;
    req.url = url;
    req.headers = {
      host: '127.0.0.1',
      'content-length': String(body.length),
      ...headers,
    };
    req.connection = { remoteAddress: ip };
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


function fixture() {
  const shops = [
    { id: A, name: 'Oldest private shop', logo_url: '/uploads/old.png', public_intake_slug: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { id: B, name: 'Selected private shop', logo_url: '/uploads/selected.png', public_intake_slug: 'bbbbbbbbbbbbbbbbbbbbbbbbbb' },
  ];
  const calls = [], writes = [], embeds = [], estimates = [], appointments = [];
  let fail = false;
  let failWrite = false;
  const db = {
    async dbGet(sql, params = []) {
      calls.push({ sql, params });
      if (fail) throw new Error('Private DB detail synthetic@example.test');
      if (sql.includes('FROM users')) return null;
      if (sql.includes('FROM ro_ratings')) return { avg_rating: null, review_count: 0 };
      if (sql.startsWith('UPDATE shops')) {
        const shop = shops.find(s => s.id === params[1]);
        if (shop) { shop.public_intake_slug = params[0]; writes.push({ sql, params }); }
        return shop || null;
      }
      if (sql.includes('FROM shops')) {
        assert.doesNotMatch(sql, /ORDER BY|LIMIT 1/);
        const shop = shops.find(s => sql.includes('WHERE public_intake_slug') ? s.public_intake_slug === params[0] : s.id === params[0]);
        return shop || null;
      }
      if (sql.includes('FROM estimate_requests')) {
        assert.match(sql, /WHERE id = \$1 AND shop_id = \$2/);
        return estimates.find(row => row.id === params[0] && row.shop_id === params[1]) || null;
      }
      throw new Error(`Unhandled test query: ${sql}`);
    },
    async dbRun(sql, params) {
      if (fail || failWrite) throw new Error('Private DB detail');
      writes.push({ sql, params });
      assert.doesNotMatch(sql, /CREATE|ALTER/);
      if (sql.includes('INSERT INTO estimate_requests')) estimates.push({ id: params[0], shop_id: params[1], photos_json: params[11], status: 'pending' });
      else if (sql.includes('INSERT INTO appointment_requests')) appointments.push({ id: params[0], shop_id: params[1] });
      else if (sql.includes('UPDATE estimate_requests')) {
        assert.match(sql, /WHERE id = \$2 AND shop_id = \$3/);
        const row = estimates.find(row => row.id === params[1] && row.shop_id === params[2]);
        if (row) row.status = params[0];
      } else throw new Error(`Unhandled test write: ${sql}`);
      return { rowCount: 1 };
    },
    async dbAll(sql, params) {
      if (sql.includes('FROM ro_ratings')) return [];
      assert.match(sql, /WHERE shop_id = \$1 AND status = \$2/);
      return estimates.filter(row => row.shop_id === params[0] && row.status === params[1]);
    },
  };
  for (const id of ['../services/publicShop', '../routes/public', '../routes/appointments', '../routes/settings', '../routes/estimateRequests', '../routes/market', '../middleware/auth']) delete require.cache[require.resolve(id)];
  install('../db', db);
  install('../utils/discord', { sendDiscordEmbed: async embed => { embeds.push(embed); } });
  install('../services/sms', { getTwilioConfigForShop: async () => null, isConfiguredForShop: async () => false });
  install('../services/mediaStorage', {});
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use('/api/public', require('../routes/public'));
  app.use('/api/appointments', require('../routes/appointments'));
  app.use('/api/settings', require('../routes/settings'));
  app.use('/api/estimate-requests', require('../routes/estimateRequests'));
  app.use('/api/market', require('../routes/market'));
  let sequence = 1;
  async function request(method, url, body, { role, shop = B, ip } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (role) headers.authorization = `Bearer ${jwt.sign({ id: 'fixture-user', shop_id: shop, role }, process.env.JWT_SECRET)}`;
    const response = await inject(app, { method, url, headers, body: Buffer.from(JSON.stringify(body || {})), ip: ip || `127.0.0.${sequence++}` });
    await new Promise(resolve => setImmediate(resolve));
    return response;
  }
  return { shops, calls, writes, embeds, estimates, appointments, request, setFail: () => { fail = true; }, setWriteFail: () => { failWrite = true; } };
}

for (const path of ['/api/public/estimate-request', '/api/appointments/request']) {
  test(`${path}: missing/malformed/unknown links fail closed before writes`, async () => {
    const f = fixture();
    for (const [query, status, code] of [
      ['', 400, 'SHOP_LINK_REQUIRED'], ['?shop=', 400, 'SHOP_LINK_REQUIRED'],
      ['?shop=garbage', 404, 'SHOP_NOT_FOUND'], ['?shop[]=aaaaaaaaaaaa', 404, 'SHOP_NOT_FOUND'],
      ['?shop=%27%20OR%201=1', 404, 'SHOP_NOT_FOUND'],
      ['?shop=aaaaaaaaaaaa&shop=bbbbbbbbbbbb', 404, 'SHOP_NOT_FOUND'],
      ['?shop=cccccccccccccccccccccccccc', 404, 'SHOP_NOT_FOUND'], [`?shop=${UNKNOWN}`, 404, 'SHOP_NOT_FOUND'],
    ]) {
      const r = await f.request('POST', path + query, { ...BODY, shop_id: A });
      assert.equal(r.status, status, query);
      assert.equal(r.json.code, code);
    }
    assert.equal(f.writes.length, 0);
    assert.equal(f.calls.length, 2, 'only well-formed unknown slug/UUID reach DB');
    assert.equal(f.embeds.length, 0);
  });

  test(`${path}: exact slug and legacy UUID win over body spoof`, async () => {
    const f = fixture();
    for (const link of [f.shops[1].public_intake_slug, B]) {
      const r = await f.request('POST', `${path}?shop=${link}`, { ...BODY, shop_id: A, photos: [PHOTO] });
      assert.equal(r.status, 201);
    }
    assert.equal(f.writes.length, 2);
    assert.ok(f.writes.every(call => call.params[1] === B));
    assert.ok([...f.estimates, ...f.appointments].every(row => row.shop_id === B));
    if (f.estimates.length) assert.deepEqual(JSON.parse(f.estimates[0].photos_json), [PHOTO]);
  });

  test(`${path}: real limiter still returns 429 without extra writes`, async () => {
    const f = fixture();
    const limit = path.includes('estimate') ? 5 : 10;
    for (let i = 0; i < limit; i++) assert.equal((await f.request('POST', `${path}?shop=${B}`, BODY, { ip: '127.0.0.200' })).status, 201);
    const r = await f.request('POST', `${path}?shop=${B}`, BODY, { ip: '127.0.0.200' });
    assert.equal(r.status, 429);
    assert.equal(f.writes.length, limit);
  });

  test(`${path}: insert failure remains generic and never notifies Discord`, async t => {
    const f = fixture();
    t.mock.method(console, 'error', () => {});
    f.setWriteFail();
    const r = await f.request('POST', `${path}?shop=${B}`, BODY);
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'Internal server error' });
    assert.equal(f.embeds.length, 0);
    assert.equal(f.writes.length, 0);
  });

  test(`${path}: unexpected failures have a generic body and safe logs`, async t => {
    const f = fixture();
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args));
    f.setFail();
    const r = await f.request('POST', `${path}?shop=${B}`, BODY);
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'Internal server error' });
    assert.doesNotMatch(JSON.stringify(logs), /synthetic@|Private DB/);
    assert.equal(f.writes.length, 0);
  });
}

test('metadata selects only name/logo after resolution; logs contain mode and internal ID only', async t => {
  const f = fixture();
  const logs = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  const slug = f.shops[1].public_intake_slug;
  const r = await f.request('GET', `/api/public/intake/${slug}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { name: f.shops[1].name, logo_url: f.shops[1].logo_url });
  assert.equal(f.calls[1].sql, 'SELECT name, logo_url FROM shops WHERE id = $1');
  assert.deepEqual(logs, [['[Public Intake]', { mode: 'slug', shop_id: B }]]);
  for (const link of ['garbage', 'cccccccccccccccccccccccccc']) {
    const r = await f.request('GET', `/api/public/intake/${link}`);
    assert.equal(r.status, 404);
    assert.equal(r.json.code, 'SHOP_NOT_FOUND');
  }
  assert.equal((await f.request('GET', `/api/public/intake/${B}`)).status, 200);
  assert.deepEqual(logs[1], ['[Public Intake]', { mode: 'legacy_uuid', shop_id: B }]);
});

test('strict image MIME/base64, count and decoded size boundaries', async () => {
  const f = fixture();
  for (const photos of [null, {}, 'bad', [null], Array(6).fill(PHOTO), ['data:image/svg+xml;base64,PHN2Zz4='], ['data:image/gif;base64,R0lG'], ['https://example.test/a.png'], ['data:image/png;base64,abcd!'], ['data:image/png;base64,YQ'], ['data:image/png;base64,YR=='], ['data:image/png;base64,YQ==\n'], ['data:image/png;base64,'], [`data:image/jpeg;base64,${Buffer.alloc(300 * 1024 + 1).toString('base64')}`]]) {
    const r = await f.request('POST', `/api/public/estimate-request?shop=${B}`, { ...BODY, photos });
    assert.equal(r.status, 400, JSON.stringify(photos).slice(0, 80));
  }
  assert.equal(f.writes.length, 0);
  for (const mime of ['jpeg', 'png', 'webp']) {
    const photos = Array(5).fill(`data:image/${mime};base64,${Buffer.alloc(300 * 1024).toString('base64')}`);
    const r = await f.request('POST', `/api/public/estimate-request?shop=${B}`, { ...BODY, photos });
    assert.equal(r.status, 201);
    assert.deepEqual(JSON.parse(f.estimates.at(-1).photos_json), photos);
  }
});

test('Discord contains only shop/request identifiers and fixed type, no submitted free text', async () => {
  const f = fixture();
  assert.equal((await f.request('POST', `/api/public/estimate-request?shop=${B}`, BODY)).status, 201);
  assert.deepEqual(f.embeds, [{ title: 'New intake request', fields: [
    { name: 'Shop ID', value: B }, { name: 'Request ID', value: f.estimates[0].id }, { name: 'Type', value: 'estimate' },
  ] }]);
  for (const text of [BODY.name, BODY.phone, BODY.email, BODY.description, BODY.notes, f.shops[1].name]) assert.ok(!JSON.stringify(f.embeds).includes(text));
});

test('wrong tenant estimate GET/PATCH is 404; own read/update and list remain scoped', async () => {
  const f = fixture();
  await f.request('POST', `/api/public/estimate-request?shop=${B}`, { ...BODY, photos: [PHOTO] });
  const id = f.estimates[0].id;
  for (const [method, path, body] of [['GET', `/api/estimate-requests/${id}`], ['PATCH', `/api/estimate-requests/${id}/status`, { status: 'contacted' }]]) {
    assert.equal((await f.request(method, path, body, { role: 'staff', shop: A })).status, 404);
    assert.equal((await f.request(method, path, body, { role: 'staff' })).status, 200);
  }
  assert.equal(f.estimates[0].status, 'contacted');
  assert.deepEqual((await f.request('GET', '/api/estimate-requests?status=contacted', {}, { role: 'staff', shop: A })).json.requests, []);
  assert.equal((await f.request('GET', '/api/estimate-requests?status=contacted', {}, { role: 'staff' })).json.requests.length, 1);
});

test('settings restrict read/rotate to owner/admin and rotate only authenticated shop', async () => {
  const f = fixture();
  const old = f.shops[1].public_intake_slug;
  for (const role of [undefined, 'staff', 'customer', 'assistant', 'superadmin']) {
    for (const [method, path] of [['GET', '/api/settings/public-intake'], ['POST', '/api/settings/public-intake/rotate']]) {
      assert.equal((await f.request(method, path, { shop_id: A }, { role })).status, role ? 403 : 401);
    }
  }
  assert.equal(f.writes.length, 0);
  for (const role of ['owner', 'admin']) {
    assert.deepEqual((await f.request('GET', '/api/settings/public-intake', {}, { role })).json, { public_intake_slug: f.shops[1].public_intake_slug });
    const r = await f.request('POST', '/api/settings/public-intake/rotate', { shop_id: A }, { role });
    assert.equal(r.status, 200);
    assert.match(r.json.public_intake_slug, /^[a-z2-7]{26}$/);
    assert.notEqual(r.json.public_intake_slug, old);
  }
  assert.equal(f.shops[0].public_intake_slug, 'aaaaaaaaaaaaaaaaaaaaaaaaaa');
  for (const path of ['/api/public/estimate-request', '/api/appointments/request']) assert.equal((await f.request('POST', `${path}?shop=${old}`, BODY)).status, 404);
  assert.equal((await f.request('GET', `/api/public/intake/${old}`)).status, 404);
  assert.equal((await f.request('GET', `/api/public/intake/${f.shops[1].public_intake_slug}`)).status, 200);
  const profile = await f.request('GET', '/api/market/shop', {}, { role: 'owner' });
  assert.equal(profile.json.public_intake_slug, f.shops[1].public_intake_slug);
  assert.ok(f.calls.some(call => /SELECT id, name, phone, logo_url, public_intake_slug/.test(call.sql)));
});


test('actual public profile returns DB slug before/after rotation; malformed IDs never query', async t => {
  const f = fixture();
  for (const id of ['garbage', 'aaaaaaaaaaaaaaaaaaaaaaaaaa', "' OR 1=1"]) {
    const response = await f.request('GET', `/api/public/shop/${encodeURIComponent(id)}`);
    assert.equal(response.status, 404);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('GET', `/api/public/shop/${UNKNOWN}`)).status, 404);
  const before = await f.request('GET', `/api/public/shop/${B}`);
  assert.equal(before.status, 200);
  assert.equal(before.json.shop.public_intake_slug, f.shops[1].public_intake_slug);
  assert.ok(f.calls.some(({ sql }) => /SELECT.*public_intake_slug/.test(sql)));
  await f.request('POST', '/api/settings/public-intake/rotate', {}, { role: 'owner' });
  const after = await f.request('GET', `/api/public/shop/${B}`);
  assert.equal(after.json.shop.public_intake_slug, f.shops[1].public_intake_slug);
  assert.notEqual(after.json.shop.public_intake_slug, before.json.shop.public_intake_slug);
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  f.setFail();
  assert.deepEqual((await f.request('GET', `/api/public/shop/${B}`)).json, { error: 'Internal server error' });
  assert.deepEqual(logs, [['[Public Shop] Internal server error']]);
});

test('SQL base32 final masking matches RFC 4648 known bytes; helper uses all 128 random bits', t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  // Pin the SQL expressions mirrored below, in both startup definitions. No runtime test seam.
  for (const file of ['../db/index.js', '../db/schema.pg.sql']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const expression of ['value := ((value & 255) << 8) | get_byte(bytes, i);',
      'bits := bits + 8;', 'bits := bits - 5;',
      '((value >> bits) & 31) + 1', '((value << (5 - bits)) & 31) + 1']) assert.ok(source.includes(expression));
    assert.ok(source.includes('uuid_send(gen_random_uuid())'));
  }
  // SQL default uses UUIDv4: 122 random bits + six fixed version/variant bits.
  // Backfill, rotation, and app registration use randomBytes(16): 128 random bits.
  const vectors = [
    ['00000000000000000000000000000000', 'aaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['ffffffffffffffffffffffffffffffff', '77777777777777777777777774'],
    ['000102030405060708090a0b0c0d0e0f', 'aaaqeayeaudaocajbifqydiob4'],
  ];
  for (let last = 0; last < 256; last++) vectors.push(['a55a'.repeat(7) + 'ff' + last.toString(16).padStart(2, '0')]);
  for (const [hex, known] of vectors) {
    const bytes = Buffer.from(hex, 'hex');
    // Independent RFC 4648 bit-string grouping (no accumulator/masking).
    const binary = [...bytes].map(byte => byte.toString(2).padStart(8, '0')).join('');
    const expected = binary.match(/.{1,5}/g).map(group => alphabet[parseInt(group.padEnd(5, '0'), 2)]).join('');
    if (known) assert.equal(expected, known);
    let value = 0, bits = 0, result = '';
    for (const byte of bytes) {
      value = ((value & 255) << 8) | byte;
      bits += 8;
      while (bits >= 5) { bits -= 5; result += alphabet[(value >> bits) & 31]; }
    }
    assert.equal(bits, 3);
    result += alphabet[(value << (5 - bits)) & 31];
    assert.equal(result, expected);
    assert.match(result, /^[a-z2-7]{25}[aeimquy4]$/);
    const random = t.mock.method(crypto, 'randomBytes', size => { assert.equal(size, 16); return bytes; });
    delete require.cache[require.resolve('../services/publicShop')];
    assert.equal(require('../services/publicShop').newPublicIntakeSlug(), expected);
    random.mock.restore();
  }
  delete require.cache[require.resolve('../services/publicShop')];
});


test('shop registration explicitly inserts the randomBytes slug instead of relying on UUID default', async t => {
  const writes = [];
  install('../db', {
    dbGet: async () => null,
    dbRun: async (sql, params) => { writes.push({ sql, params }); return { rowCount: 1 }; },
  });
  install('../services/mailer', { sendMail: async () => null });
  install('../utils/discord', { sendDiscordEmbed: async () => null });
  const crypto = require('node:crypto');
  t.mock.method(crypto, 'randomBytes', size => { assert.equal(size, 16); return Buffer.alloc(16, 255); });
  // Keep bcrypt's own randomness separate from the slug entropy witness.
  install('bcryptjs', { hashSync: () => 'synthetic-hash' });
  for (const id of ['../services/publicShop', '../routes/auth']) delete require.cache[require.resolve(id)];
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  const response = await inject(app, { method: 'POST', url: '/api/auth/shop-register',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ name: 'Synthetic Owner', email: 'owner@example.test', password: 'synthetic-only', shop_name: 'Synthetic Shop' })),
  });
  assert.equal(response.status, 201);
  const insert = writes.find(({ sql }) => sql.startsWith('INSERT INTO shops'));
  assert.equal(insert.sql, 'INSERT INTO shops (id, name, public_intake_slug) VALUES ($1, $2, $3)');
  assert.deepEqual(insert.params, [response.json.user.shop_id, 'Synthetic Shop', '77777777777777777777777774']);
  for (const id of ['../services/publicShop', '../routes/auth', 'bcryptjs']) delete require.cache[require.resolve(id)];
});
