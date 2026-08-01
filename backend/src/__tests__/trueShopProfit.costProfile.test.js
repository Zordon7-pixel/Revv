const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function installMock(relativePath, exportsValue) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
}

const calls = [];

installMock('../db', {
  async dbGet(sql, params) {
    const query = String(sql);
    calls.push({ kind: 'get', sql: query, params });
    const settings = {
      sms_notifications_enabled: true,
      email_notifications_enabled: true,
    };
    if (query.includes('parts_margin_pct')) {
      Object.assign(settings, {
        parts_margin_pct: 0.25,
        materials_margin_pct: 0.45,
        sublet_margin_pct: 0.05,
        blended_labor_cost_per_hr: null,
      });
    }
    return settings;
  },
  async dbRun(sql, params) {
    calls.push({ kind: 'run', sql: String(sql), params });
    return { rowCount: 1 };
  },
});
installMock('../middleware/auth', (_req, _res, next) => next());

const settingsRouter = require('../routes/settings');

function routeHandler(method) {
  const layer = settingsRouter.stack.find((entry) => (
    entry.route?.path === '/' && entry.route.methods[method]
  ));
  assert.ok(layer, `Expected ${method.toUpperCase()} / settings route`);
  return layer.route.stack.at(-1).handle;
}

async function invoke(method, { body = {}, role = 'owner', shopId = 'shop-owner' } = {}) {
  const req = { body, user: { id: 'user-1', role, shop_id: shopId } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await routeHandler(method)(req, res);
  return res;
}

test('shop schemas and migration define nullable cost-profile storage with percentage defaults', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '../db/index.js'), 'utf8');
  const migrationSource = fs.readFileSync(path.join(__dirname, '../db/migrate.js'), 'utf8');
  const schemaSource = fs.readFileSync(path.join(__dirname, '../db/schema.pg.sql'), 'utf8');

  assert.match(indexSource, /^\s*parts_margin_pct REAL DEFAULT 0\.25,/m);
  assert.match(indexSource, /^\s*materials_margin_pct REAL DEFAULT 0\.45,/m);
  assert.match(indexSource, /^\s*sublet_margin_pct REAL DEFAULT 0\.05,/m);
  assert.match(indexSource, /^\s*blended_labor_cost_per_hr REAL,/m);
  assert.doesNotMatch(indexSource, /blended_labor_cost_per_hr REAL DEFAULT/);
  assert.match(indexSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS parts_margin_pct REAL DEFAULT 0\.25/);
  assert.match(indexSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS materials_margin_pct REAL DEFAULT 0\.45/);
  assert.match(indexSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS sublet_margin_pct REAL DEFAULT 0\.05/);
  assert.match(indexSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS blended_labor_cost_per_hr REAL`/);

  assert.match(schemaSource, /^\s*parts_margin_pct NUMERIC\(8,4\) DEFAULT 0\.25,/m);
  assert.match(schemaSource, /^\s*materials_margin_pct NUMERIC\(8,4\) DEFAULT 0\.45,/m);
  assert.match(schemaSource, /^\s*sublet_margin_pct NUMERIC\(8,4\) DEFAULT 0\.05,/m);
  assert.match(schemaSource, /^\s*blended_labor_cost_per_hr NUMERIC\(10,2\),/m);
  assert.doesNotMatch(schemaSource, /blended_labor_cost_per_hr NUMERIC\(10,2\) DEFAULT/);

  assert.match(migrationSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS parts_margin_pct NUMERIC\(8,4\) DEFAULT 0\.25/);
  assert.match(migrationSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS materials_margin_pct NUMERIC\(8,4\) DEFAULT 0\.45/);
  assert.match(migrationSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS sublet_margin_pct NUMERIC\(8,4\) DEFAULT 0\.05/);
  assert.match(migrationSource, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS blended_labor_cost_per_hr NUMERIC\(10,2\)`/);
  assert.doesNotMatch(migrationSource, /blended_labor_cost_per_hr NUMERIC\(10,2\) DEFAULT/);
});

test('settings GET selects cost-profile fields only for owner/admin roles', async () => {
  for (const role of ['technician', 'employee', 'staff', 'assistant', 'customer', 'superadmin']) {
    calls.length = 0;
    const response = await invoke('get', { role });
    const query = calls.find((call) => call.kind === 'get');
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(query.sql, /parts_margin_pct|materials_margin_pct|sublet_margin_pct|blended_labor_cost_per_hr/);
    assert.equal(Object.hasOwn(response.body, 'parts_margin_pct'), false);
  }

  for (const role of ['owner', 'admin']) {
    calls.length = 0;
    const response = await invoke('get', { role });
    const query = calls.find((call) => call.kind === 'get');
    assert.equal(response.statusCode, 200);
    assert.match(query.sql, /parts_margin_pct/);
    assert.equal(response.body.parts_margin_pct, 0.25);
    assert.equal(response.body.blended_labor_cost_per_hr, null);
  }
});

test('settings PATCH rejects every percentage outside the inclusive zero-to-one range', async () => {
  for (const field of ['parts_margin_pct', 'materials_margin_pct', 'sublet_margin_pct']) {
    for (const value of [-0.01, 1.01]) {
      calls.length = 0;
      const response = await invoke('patch', { body: { [field]: value } });
      assert.equal(response.statusCode, 400);
      assert.match(response.body.error, new RegExp(`${field}.*between 0 and 1`));
      assert.equal(calls.some((call) => call.kind === 'run'), false);
    }
  }

  calls.length = 0;
  const nonNumericResponse = await invoke('patch', { body: { parts_margin_pct: '0.25' } });
  assert.equal(nonNumericResponse.statusCode, 400);
  assert.match(nonNumericResponse.body.error, /parts_margin_pct.*number between 0 and 1/);
  assert.equal(calls.some((call) => call.kind === 'run'), false);
});

test('settings PATCH rejects zero and negative blended labor cost', async () => {
  for (const value of [0, -25]) {
    calls.length = 0;
    const response = await invoke('patch', { body: { blended_labor_cost_per_hr: value } });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /greater than 0/);
    assert.equal(calls.some((call) => call.kind === 'run'), false);
  }
});

test('settings PATCH accepts null or empty labor cost and clears only the caller shop profile', async () => {
  for (const value of [null, '']) {
    calls.length = 0;
    const response = await invoke('patch', {
      body: { blended_labor_cost_per_hr: value },
      shopId: 'shop-a',
    });
    const update = calls.find((call) => call.kind === 'run');
    assert.equal(response.statusCode, 200);
    assert.match(update.sql, /blended_labor_cost_per_hr = \$1/);
    assert.match(update.sql, /WHERE id = \$2/);
    assert.deepEqual(update.params, [null, 'shop-a']);
  }
});

test('settings PATCH accepts a valid cost profile and scopes the write to the caller shop', async () => {
  calls.length = 0;
  const response = await invoke('patch', {
    body: {
      parts_margin_pct: 0.2,
      materials_margin_pct: 0.4,
      sublet_margin_pct: 0.1,
      blended_labor_cost_per_hr: 48.75,
    },
    shopId: 'shop-valid',
  });
  const update = calls.find((call) => call.kind === 'run');

  assert.equal(response.statusCode, 200);
  assert.match(update.sql, /parts_margin_pct = \$1/);
  assert.match(update.sql, /materials_margin_pct = \$2/);
  assert.match(update.sql, /sublet_margin_pct = \$3/);
  assert.match(update.sql, /blended_labor_cost_per_hr = \$4/);
  assert.match(update.sql, /WHERE id = \$5/);
  assert.deepEqual(update.params, [0.2, 0.4, 0.1, 48.75, 'shop-valid']);
});

test('settings PATCH blocks non-owner/admin roles before any write', async () => {
  calls.length = 0;
  const response = await invoke('patch', {
    role: 'technician',
    body: { parts_margin_pct: 0.2 },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(calls.some((call) => call.kind === 'run'), false);
});
