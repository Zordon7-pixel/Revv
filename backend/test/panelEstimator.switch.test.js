'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPanelEstimatorRouter } = require('../src/routes/panelEstimator');

function fixture(value) {
  const previous = process.env.PANEL_ESTIMATOR_ENABLED;
  if (value === undefined) delete process.env.PANEL_ESTIMATOR_ENABLED;
  else process.env.PANEL_ESTIMATOR_ENABLED = value;
  let queries = 0;
  const router = createPanelEstimatorRouter({
    database: { query: async () => { queries++; return { rows: [], rowCount: 0 }; } },
    authenticate: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'UNAUTHORIZED' }),
  });
  if (previous === undefined) delete process.env.PANEL_ESTIMATOR_ENABLED;
  else process.env.PANEL_ESTIMATOR_ENABLED = previous;
  return { router, queries: () => queries };
}
// Execute the actual Express route and middleware chain without opening sockets.
async function invoke(layer, user = { id: 'staff', shop_id: 'shop', role: 'owner' }, body = {}) {
  const req = { user, body, params: { roId: 'ro', id: 'preset', linkId: 'link' }, query: {} };
  const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let index = 0;
  const pending = [];
  const next = () => {
    const result = layer.route.stack[index++]?.handle(req, res, next);
    if (result?.then) pending.push(result);
    return result;
  };
  next();
  await Promise.all(pending);
  return res;
}
for (const flag of ['false', '0', 'off', ' OFF ']) test(`flag ${flag} refuses every estimator route before DB work`, async () => {
  const f = fixture(flag);
  const routes = f.router.stack.filter(l => l.route);
  assert.equal(routes.length, 16);
  for (const route of routes) {
    const res = await invoke(route);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    if (route.route.path === '/panel-estimator/availability') {
      assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { enabled: false });
    } else {
      assert.equal(res.statusCode, 503, route.route.path);
      assert.deepEqual(res.body, { error: 'PANEL_ESTIMATOR_DISABLED', code: 'PANEL_ESTIMATOR_DISABLED' });
    }
    assert.equal((await invoke(route, null)).statusCode, 401);
  }
  assert.equal(f.queries(), 0);
});
for (const flag of [undefined, 'true', '1', 'on']) test(`flag ${flag} preserves catalog and validation`, async () => {
  const f = fixture(flag);
  const route = path => f.router.stack.find(l => l.route?.path === path);
  assert.deepEqual((await invoke(route('/panel-estimator/availability'))).body, { enabled: true });
  assert.deepEqual((await invoke(route('/panel-presets'))).body, { presets: [] });
  assert.ok(f.queries() > 0);
  assert.equal((await invoke(route('/:roId/panel-estimator/preview'))).statusCode, 400);
  assert.equal((await invoke(route('/panel-presets'), { role: 'tech' })).statusCode, 403);
});
