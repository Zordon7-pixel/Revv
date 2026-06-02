const assert = require('node:assert/strict');
const test = require('node:test');

const calls = [];

function mockModule(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

mockModule('../db', {
  dbGet: async (sql, params) => {
    calls.push({ method: 'dbGet', sql, params });
    if (sql.includes('this_week')) {
      return {
        this_week: 0,
        last_week: 0,
        week_start: '2026-06-01T00:00:00.000Z',
        week_end: '2026-06-08T00:00:00.000Z',
      };
    }
    if (sql.includes('ro_payments')) return { amount_cents: 0 };
    if (sql.includes('supplement_ro_count')) {
      return {
        supplement_ro_count: 0,
        requested_cents: 0,
        captured_cents: 0,
      };
    }
    if (sql.includes('pending_parts_count')) return { pending_parts_count: 0 };
    return null;
  },
  dbAll: async (sql, params) => {
    calls.push({ method: 'dbAll', sql, params });
    return [];
  },
});

mockModule('../middleware/auth', (req, res, next) => next());

const dashboardRouter = require('../routes/dashboard');

function routeHandlers(path) {
  const layer = dashboardRouter.stack.find((candidate) => (
    candidate.route?.path === path && candidate.route?.methods?.get
  ));
  assert.ok(layer, `Expected GET ${path} route to exist`);
  return layer.route.stack;
}

function runRoute(path, role = 'owner') {
  const req = {
    headers: {},
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      role,
      shop_id: '00000000-0000-0000-0000-000000000002',
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const handlers = routeHandlers(path);

  return new Promise((resolve, reject) => {
    let index = 0;
    const next = (err) => {
      if (err) return reject(err);
      const layer = handlers[index++];
      if (!layer) return resolve(res);
      try {
        const result = layer.handle(req, res, next);
        if (result?.then) {
          result.then(() => {
            if (index >= handlers.length) resolve(res);
          }, reject);
        }
      } catch (error) {
        reject(error);
      }
    };
    next();
  });
}

test('GET /dashboard/weekly uses timestamp-compatible delivery fallback and returns empty-shop JSON', async () => {
  calls.length = 0;

  const res = await runRoute('/weekly', 'technician');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ro_opened.this_week, 0);
  assert.equal(res.body.top_techs.length, 0);

  const topTechQuery = calls.find((call) => call.sql.includes('COALESCE(NULLIF(ro.actual_delivery::text'));
  assert.ok(topTechQuery, 'Expected weekly top-tech query to cast actual_delivery before COALESCE');
  assert.match(topTechQuery.sql, /JOIN users u ON u\.id::text = ro\.assigned_to::text/);
  assert.match(topTechQuery.sql, /COALESCE\(NULLIF\(ro\.actual_delivery::text, ''\)::timestamptz, ro\.updated_at\)/);
  assert.deepEqual(topTechQuery.params, ['00000000-0000-0000-0000-000000000002']);
});

test('GET /dashboard/owner-kpis casts legacy timestamps and avoids uuid-vs-text user joins', async () => {
  calls.length = 0;

  const res = await runRoute('/owner-kpis', 'owner');

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.cycle_time_by_stage, []);
  assert.deepEqual(res.body.tech_efficiency, []);
  assert.equal(res.body.supplement_capture.capture_rate, 0);

  const cycleQuery = calls.find((call) => call.sql.includes('WITH ordered_logs'));
  assert.ok(cycleQuery, 'Expected cycle-time query to run');
  assert.match(cycleQuery.sql, /NULLIF\(l\.created_at::text, ''\)::timestamptz AS stage_started_at/);
  assert.match(cycleQuery.sql, /NULLIF\(ro\.updated_at::text, ''\)::timestamptz AS updated_at/);

  const techQuery = calls.find((call) => call.sql.includes('status_advances'));
  assert.ok(techQuery, 'Expected tech-efficiency query to run');
  assert.match(techQuery.sql, /JOIN users u ON u\.id::text = CASE/);
  assert.doesNotMatch(techQuery.sql, /l\.changed_by::uuid/);
  assert.match(techQuery.sql, /NULLIF\(l\.created_at::text, ''\)::timestamptz >= DATE_TRUNC\('month', NOW\(\)\)/);
  assert.match(techQuery.sql, /NULLIF\(l\.created_at::text, ''\)::timestamptz < DATE_TRUNC\('month', NOW\(\)\) \+ INTERVAL '1 month'/);

  const ownerKpiSql = calls.map((call) => call.sql).join('\n');
  const rawCreatedAtComparisons = ownerKpiSql.match(/\bl\.created_at\s*(?:[<>]=?|=)/g) || [];
  assert.deepEqual(rawCreatedAtComparisons, [], 'Expected every owner-kpis l.created_at comparison to cast through timestamptz');
});
