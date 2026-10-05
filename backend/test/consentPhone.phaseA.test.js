const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const consent = require('../src/services/customerConsent');

function harness({ auditError = false } = {}) {
  let customer = { id: 'customer-a', shop_id: 'shop-a', phone: '+15551234567',
    ...consent.consentMutation({ sms_consent: true, sms_consent_method: 'written' }, 'prior-staff'),
    preferred_contact_method: 'sms', email_consent: false };
  const state = { queries: [], audit: [], released: 0, stopHistory: ['existing STOP'], resetHistory: ['legacy reset'] };
  let snapshot;
  const client = { release() { state.released++; }, async query(sql, params = []) {
    state.queries.push({ sql, params });
    if (sql === 'BEGIN') snapshot = structuredClone({ customer, audit: state.audit });
    if (sql === 'ROLLBACK') { customer = snapshot.customer; state.audit = snapshot.audit; }
    if (/SELECT \*/.test(sql)) {
      assert.match(sql, /WHERE id=\$1 AND shop_id=\$2 FOR UPDATE/);
      return { rows: params[0] === customer.id && params[1] === customer.shop_id ? [structuredClone(customer)] : [] };
    }
    if (/UPDATE customers SET/.test(sql)) {
      assert.match(sql, /WHERE id=\$\d+ AND shop_id=\$\d+ RETURNING \*/);
      const assignments = sql.split('SET ')[1].split('WHERE')[0].trim().split(', ');
      for (const [i, assignment] of assignments.entries()) customer[assignment.split('=')[0]] = params[i];
      return { rows: [structuredClone(customer)] };
    }
    if (/INSERT INTO customer_consent_phone_changes/.test(sql)) {
      if (auditError) throw new Error('audit unavailable');
      state.audit.push(params);
      assert.match(sql, /'phone_changed'/);
      assert.ok(!sql.includes('changed_at'), 'audit timestamp is the database default');
    }
    return { rows: [] };
  } };
  const mocks = {
    '../db': { pool: { connect: async () => client } },
    '../middleware/auth': (_req, _res, next) => next(),
    '../middleware/roles': { requireTechnician: (_req, _res, next) => next() },
    '../services/customerOptInConfirmation': { sendCustomerOptInConfirmation: async () => assert.fail('No confirmation send on PUT') },
    '../services/customerConsent': consent,
  };
  const filename = require.resolve('../src/routes/customers');
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express', 'uuid'].includes(name)) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  const handler = module.exports.stack.find(l => l.route?.methods.put).route.stack.at(-1).handle;
  async function call(body, shop_id = 'shop-a') {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
    await handler({ body, params: { id: 'customer-a' }, user: { id: 'authenticated-staff', shop_id } }, res);
    return res;
  }
  return { call, state, customer: () => structuredClone(customer) };
}

for (const extra of [{}, { sms_consent: true, sms_consent_method: 'verbal' }, { sms_consent: true }, { sms_consent: false }]) {
  test(`phone change clears all evidence even with concurrent attestation ${JSON.stringify(extra)}`, async () => {
    const h = harness();
    const res = await h.call({ phone: '+15557654321', ...extra, sms_consent_by: 'spoof', sms_consent_at: '1900-01-01' });
    assert.equal(res.statusCode, 200);
    for (const [key, value] of Object.entries(consent.consentMutation({ sms_consent: false }))) assert.equal(res.body[key], value);
    assert.equal(res.body.preferred_contact_method, 'none');
    assert.deepEqual(h.state.audit, [['customer-a', 'shop-a', '***4567', '***4321', 'authenticated-staff']]);
    const sql = h.state.queries.map(q => q.sql);
    assert.ok(sql.findIndex(s => /FOR UPDATE/.test(s)) < sql.findIndex(s => /UPDATE customers SET/.test(s)));
    assert.ok(sql.findIndex(s => /INSERT INTO customer_consent_phone_changes/.test(s)) < sql.indexOf('COMMIT'));
    assert.equal(h.state.released, 1);
    assert.deepEqual(h.state.stopHistory, ['existing STOP']);
    assert.deepEqual(h.state.resetHistory, ['legacy reset']);
  });
}

for (const phone of ['(555) 123-4567', '1-555-123-4567', '+1 (555) 123-4567']) {
  test(`normalized unchanged phone preserves evidence and omits consent UPDATE columns: ${phone}`, async () => {
    const h = harness();
    const before = h.customer();
    const res = await h.call({ phone });
    for (const key of ['sms_consent', 'sms_consent_at', 'sms_consent_method', 'sms_consent_by']) assert.deepEqual(res.body[key], before[key]);
    assert.equal(h.state.audit.length, 0);
    assert.ok(!h.state.queries.find(q => /UPDATE customers SET/.test(q.sql)).sql.includes('sms_consent'));
  });
}

test('new number requires a subsequent explicit attestation; unrelated saves preserve revoked state', async () => {
  const h = harness();
  await h.call({ phone: '+15557654321', sms_consent: true, sms_consent_method: 'written' });
  assert.equal((await h.call({ address: 'New address' })).body.sms_consent, false);
  const result = await h.call({ phone: '(555) 765-4321', sms_consent: true, sms_consent_method: 'verbal', sms_consent_by: 'spoof', sms_consent_at: '1900-01-01' });
  assert.ok(consent.hasConfirmedSmsConsent(result.body));
  assert.equal(result.body.sms_consent_by, 'authenticated-staff');
  assert.ok(result.body.sms_consent_at.getFullYear() >= 2026);
  assert.equal(h.state.audit.length, 1);
  assert.ok(!h.state.queries.some(q => /sms_opt_outs|customer_consent_resets/.test(q.sql)));
});

for (const phone of [null, '', '123', '+442012345678']) {
  test(`clearing or changing phone (${phone}) always revokes and masks audit`, async () => {
    const h = harness();
    const res = await h.call({ phone });
    assert.equal(res.body.sms_consent, false);
    assert.equal(h.state.audit[0][3], String(phone).length > 7 ? '***5678' : '***');
    assert.ok(!JSON.stringify(h.state.audit).includes('+15551234567'));
  });
}

test('audit insertion failure rolls phone and consent back with no successful response', async () => {
  const h = harness({ auditError: true });
  const before = h.customer();
  const result = await h.call({ phone: '+15557654321' });
  assert.equal(result.statusCode, 500);
  assert.deepEqual(h.customer(), before);
  assert.equal(h.state.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(h.state.audit.length, 0);
  assert.equal(h.state.released, 1);
});

test('cross-tenant PUT cannot change consent or write audit', async () => {
  const h = harness();
  const before = h.customer();
  assert.equal((await h.call({ phone: '+15557654321' }, 'other-shop')).statusCode, 404);
  assert.deepEqual(h.customer(), before);
  assert.equal(h.state.audit.length, 0);
  assert.ok(!h.state.queries.some(q => /UPDATE|INSERT/.test(q.sql) && !/FOR UPDATE/.test(q.sql)));
});
