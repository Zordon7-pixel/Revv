'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const parsePdf = require('pdf-parse');
const n = require('../src/services/panelEstimatorStore');
const { createPanelEstimatorStore } = require('../src/services/panelEstimatorStore');
const { assembleDraft, createPanelEstimatorDraft, hashInputs } = require('../src/services/panelEstimatorDraft');
const { createPanelEstimatorRevisions, differences } = require('../src/services/panelEstimatorRevisions');
const { renderQuotePdf, historicalQuote, bucketLabel, filename } = require('../src/services/panelEstimatorQuotePdf');
const { ensurePanelEstimator } = require('../src/db/panelEstimator');
const { panelBearerRequest, panelBearerParserError, panelPublicHandler } = require('../src/services/panelEstimatorApproval');
const DATABASE = 'postgresql://revv_panel@127.0.0.1:55459/revv_panel_test';
const panel = patch => ({ panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light',
  operation: 'repair', refinish: true, body_hours: 2, refinish_hours: 1, body_rate_cents: 10000,
  refinish_rate_cents: 10000, parts_sell_cents: 10000, materials_sell_cents: 5000, sublet_sell_cents: 0,
  taxable: { body: true, refinish: true, parts: true, materials: true, sublet: true }, reviewed: true, ...patch });
const draft = patch => ({ assessments: [panel()], scenario: { payer: 'cash', provenance: 'shop_prepared' },
  adjustments: { discount_cents: 5000, minimum_cents: 0 }, ...patch });
function dto(input = draft(), paidCents = 0) {
  const quote = assembleDraft({ draft: n.publicSnapshot(input), costs: n.privateSnapshot({}), taxRateBps: 1000, paidCents }).sell;
  Object.assign(quote, { revision_id: 'synthetic-revision', reviewed: true, reviewed_at: '2026-10-01T12:00:00.000Z', comparisons: [] });
  quote.quote_hash = hashInputs(quote);
  return { revision_id: quote.revision_id, version: 1, quote_hash: quote.quote_hash, quote };
}
const safe = value => assert.doesNotMatch(typeof value === 'string' ? value : JSON.stringify(value),
  /PRIVATE_SENTINEL|private_notes|cost_rate|cost_cents|target_margin|contribution_cents|reviewed_by|created_by|token_hash|carrier_approved/);
const parsed = async value => {
  const bytes = await renderQuotePdf(value);
  assert.equal(bytes.subarray(0,5).toString(), '%PDF-');
  return parsePdf(bytes);
};

test('PDF pure F1 parsed money, immutable inputs, no private/mutable fields or false approval', async () => {
  const value = dto();
  value.quote.costs = { private_notes: 'PRIVATE_SENTINEL' }; value.ro = { total: 999999, delivery: 999999 };
  value.quote.private_notes = 'PRIVATE_SENTINEL'; value.logo_url = 'https://not-fetched.invalid/logo';
  const original = JSON.stringify(value);
  const pdf = await parsed(value); safe(pdf.text); assert.equal(JSON.stringify(value), original);
  for (const text of ['Subtotal before discounts: $450.00', 'Discount: $50.00', 'Net repair amount: $400.00',
    'Tax: $40.00', 'Repair total: $440.00', 'Posted payments: $0.00', 'Customer approval: not established',
    'Revision: synthetic-revision', 'Version: 1', 'Hood - Repair']) assert.ok(pdf.text.includes(text), text);
  assert.doesNotMatch(pdf.text, /999999/);
});
test('PDF pure mixed package scoped discounts and minimum buckets are charged once and human labelled', async () => {
  const value = dto(draft({ assessments: [panel({ taxable: { body: false, refinish: true, parts: true, materials: true, sublet: true },
    package: { name: 'Body and paint package', price_cents: 15000, taxable: null,
      included_operations: ['body','refinish'], sell_allocation_cents: { body: 10000, refinish: 5000 } } })],
    adjustments: { discount_cents: 0, minimum_cents: 0, discounts: [{ id: 'Package discount', amount_cents: 3000, package_ids: ['hood:package'] }] } }));
  const pdf = await parsed(value);
  assert.equal(value.quote.buckets.filter(b => b.kind === 'package_allocation').length, 2);
  assert.ok(!value.quote.buckets.some(b => ['hood:body','hood:refinish'].includes(b.id)));
  assert.equal((pdf.text.match(/Hood - Repair/g) || []).length, 2); // Scope and inclusion only, no separate charge.
  assert.match(pdf.text, /Included in Body and paint package \(no additional charge\)/);
  assert.match(pdf.text, /Scoped discount Package discount: \$30.00/);
  assert.match(pdf.text, /Body and paint package - Body labor/);
  const minimum = await parsed(dto(draft({ adjustments: { discount_cents: 0, minimum_cents: 50000 } })));
  assert.match(minimum.text, /Minimum charge adjustment: \$50.00/);
  assert.ok(pdf.text.includes(`Repair total: $${(value.quote.totals.total_cents/100).toFixed(2)}`));
  assert.equal(bucketLabel(value.quote, { kind: 'panel_minimum', panel_id: 'hood' }), 'Hood - Minimum charge adjustment');
});
test('PDF pure unknown allocation/provenance, posted payments and retained deferral acknowledgements', async () => {
  const input = draft({ adjustments: {}, scenario: { payer: 'insurance', provenance: 'imported_carrier' }, assessments: [panel({
    operation: 'paint-only', body_hours: 0, parts_sell_cents: 0, optional_cosmetic: true,
    deferral: { reason: 'Paint postponed', estimator_acknowledged: true, customer_acknowledged: true,
      customer_acknowledgement_reference: 'Conversation on work order' } })] });
  const value = dto(input, 0);
  const pdf = await parsed(value); safe(pdf.text);
  for (const text of ['Estimated customer responsibility: Unknown', 'Estimated carrier contribution: Unknown',
    'Posted payments: $0.00', 'Remaining repair balance: $0.00', 'Imported carrier estimate', 'approval status not implied',
    'DEFERRED', 'Paint postponed', 'Customer acknowledged: Yes', 'Conversation on work order']) assert.ok(pdf.text.includes(text), text);
  assert.match(pdf.text, /Repair total: \$0.00/);
  assert.throws(() => dto(input, 2000), { name: 'RangeError', message: 'Insurance allocation does not reconcile' });
  assert.match((await parsed(dto(draft(), 2000))).text, /Posted payments: \$20.00/);
});
test('PDF pure billed insurance with absent coverage preserves posted payments and exact remaining balance', async () => {
  const value = dto(draft({ scenario: { payer: 'insurance', provenance: 'imported_carrier' } }), 2000);
  assert.equal(value.quote.totals.total_cents, 44000);
  assert.equal(value.quote.allocation.balance_cents, value.quote.totals.total_cents - 2000);
  const pdf = await parsed(value); safe(pdf.text);
  for (const text of ['Repair total: $440.00', 'Posted payments: $20.00', 'Remaining repair balance: $420.00',
    'Estimated customer responsibility: Unknown', 'Estimated carrier contribution: Unknown',
    'Imported carrier estimate', 'approval status not implied']) assert.ok(pdf.text.includes(text), text);
  assert.doesNotMatch(pdf.text, /Estimated (?:customer responsibility|carrier contribution): \$/);
});
test('PDF pure comparison projection is nonrecursive and private safe; all differences are specific scalars', async () => {
  const old = dto(), next = dto(draft({ assessments: [panel({ body_rate_cents: 12000, parts_sell_cents: 15000 })],
    scenario: { payer: 'insurance', provenance: 'shop_prepared' } }));
  Object.assign(old.quote, { costs: { private_notes: 'PRIVATE_SENTINEL' }, comparisons: [{ private_notes: 'PRIVATE_SENTINEL' }] });
  old.quote.lines[0].cost_unit_cents = 'PRIVATE_SENTINEL'; old.quote.scope.assessments[0].private_notes = 'PRIVATE_SENTINEL';
  const historical = historicalQuote({ id: old.revision_id, version: old.version, quote_hash: old.quote_hash, public_snapshot: old.quote });
  historical.differences = differences({ scope: historical.scope, scenario: historical.scenario },
    { scope: next.quote.scope, scenario: next.quote.scenario });
  safe(historical); assert.equal(historical.comparisons, undefined);
  assert.deepEqual(historical.totals, old.quote.totals); assert.deepEqual(historical.allocation, old.quote.allocation);
  assert.ok(historical.differences.some(d => d.label.endsWith('Parts price') && d.before === '$100.00' && d.after === '$150.00'));
  next.quote.comparisons = [historical];
  const pdf = await parsed(next); safe(pdf.text);
  for (const text of ['Historical alternatives', 'not current executable work', 'Historical repair total: $440.00',
    'Parts price: $100.00 -> $150.00', 'Body labor rate: $100.00 -> $120.00']) assert.ok(pdf.text.includes(text), text);
  // Old snapshots retain their legacy array comparison without being rewritten or dumped to text.
  const legacy = dto(); legacy.quote.comparisons = [{ revision_id: 'old', differences: [
    { path: 'scope.assessments', before: [{ private_notes: 'PRIVATE_SENTINEL' }], after: [] }] }];
  const frozen = JSON.stringify(legacy); safe((await parsed(legacy)).text); assert.equal(JSON.stringify(legacy), frozen);
});
test('PDF pure long unicode text wraps over pages without losing end markers, and input/layout are bounded', async () => {
  const notes = `${'Café résumé customer repair notes '.repeat(110)}END-NOTES`;
  const value = dto(draft({ assessments: [panel({ customer_notes: notes })] }));
  const pdf = await parsed(value); assert.ok(pdf.numpages >= 3); assert.match(pdf.text, /END-NOTES/);
  assert.match(pdf.text, /Café résumé/); assert.match(pdf.text, /Remaining repair balance: \$440.00/);
  const compact = pdf.text.replace(/REVV \| Reviewed repair quote \| Page \d+/g, '').replace(/\s+/g, ''); assert.ok(compact.includes(notes.replace(/\s+/g, '')));
  const unbroken = `${'X'.repeat(3980)}END-UNBROKEN`;
  const wrapped = await parsed(dto(draft({ assessments: [panel({ customer_notes: unbroken })] })));
  assert.ok(wrapped.text.replace(/REVV \| Reviewed repair quote \| Page \d+/g, '').replace(/\s+/g, '').includes(unbroken));
  value.quote.scope.assessments[0].customer_notes = 'x'.repeat(20001);
  await assert.rejects(renderQuotePdf(value), RangeError);
  assert.match(filename('\r\n"/\\unsafe'), /^panel-quote-[a-zA-Z0-9_-]+\.pdf$/);
  assert.ok(filename('x'.repeat(1000)).length < 100);
});
test('PDF pure customer approval needs matching immutable receipt and never implies carrier approval', async () => {
  const value = dto(); value.receipt = { revision_id: value.revision_id, quote_hash: value.quote_hash,
    decision: 'approve', actor_name: 'Synthetic customer', responded_at: '2026-10-01' };
  assert.match((await parsed(value)).text, /Customer decision: Approved/);
  value.receipt.revision_id = 'different';
  assert.match((await parsed(value)).text, /Customer approval: not established/);
});
test('PDF pure public handler shares transaction guards and suppresses private errors', async () => {
  const queries = [], token = `pe_${'a'.repeat(64)}`;
  const value = dto();
  let expired = false, revoked = false, stale = false, corrupt = false;
  const database = { connect: async () => ({ release() {}, query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith('SELECT shop_id')) return { rows: [{ shop_id: 'shop', ro_id: 'ro' }] };
    if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'ro' }] };
    if (sql.includes('expires_at<=')) return { rows: [{ expired, revoked_at: revoked ? 'today' : null,
      shop_id: 'shop', ro_id: 'ro', revision_id: value.revision_id, quote_hash: value.quote_hash }] };
    if (sql.includes('JOIN ro_panel_estimator_revisions')) return { rows: [{ id: stale ? 'other' : value.revision_id,
      version: 1, quote_hash: value.quote_hash, public_snapshot: corrupt ? { ...value.quote, reviewed: false } : value.quote }] };
    return { rows: [] };
  } }) };
  const handler = panelPublicHandler(database, 'pdf');
  const run = async () => {
    const res = { headers: {}, set(k,v) { this.headers[k] = v; return this; }, type(v) { return this.set('Content-Type',v); },
      status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; }, send(v) { this.body = v; } };
    await handler({ params: { token } }, res, () => assert.fail('Legacy fallback')); return res;
  };
  let res = await run(); assert.equal(res.headers['Content-Type'], 'application/pdf'); assert.equal(res.headers['Cache-Control'],'no-store');
  assert.match((await parsePdf(res.body)).text, /Repair total: \$440.00/);
  assert.ok(queries.findIndex(q => q.sql.includes('FOR UPDATE')) < queries.findIndex(q => q.sql.includes('expires_at<=')));
  assert.equal(queries.at(-1).sql, 'COMMIT'); assert.ok(!JSON.stringify(queries).includes(token));
  expired = true; res = await run(); assert.equal(res.statusCode,410); assert.equal(res.body.error,'APPROVAL_EXPIRED');
  expired = false; revoked = true; res = await run(); assert.equal(res.statusCode,410); assert.equal(res.body.error,'APPROVAL_REVOKED');
  revoked = false; stale = true; res = await run(); assert.equal(res.statusCode,409);
  stale = false; corrupt = true; res = await run(); assert.equal(res.statusCode,409);
  assert.equal(queries.at(-1).sql,'ROLLBACK');
});

function databaseConfig(value) {
  assert.equal(value, DATABASE, 'Only the dedicated loopback PostgreSQL database is allowed');
  return { host: '127.0.0.1', port: 55459, user: 'revv_panel', database: 'revv_panel_test',
    password: async () => '', ssl: false, connectionTimeoutMillis: 3000, statement_timeout: 10000 };
}
const binding = revision => ({ revision_id: revision.revision_id, quote_hash: revision.quote_hash });
const response = revision => ({ ...binding(revision), disclosure_version: 'panel-quote-v1',
  decision: 'approve', actor_name: 'Synthetic customer', acknowledged: true });
const publicPath = (family, link, suffix = '/pdf') => `${family}/${link.link.slice('/approve/'.length)}${suffix}`;
for (const type of ['TEXT','UUID']) test(`A2 PostgreSQL ${type}: real JWT HTTP PDF guards, history and ordinary invoices`, async t => {
  // Missing DB configuration FAILS rather than skipping required acceptance tests.
  const config = databaseConfig(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL);
  const schema = `panel_pdf_${randomUUID().replaceAll('-','')}`;
  const admin = new Pool(config);
  let raw, server, owned = false, hook;
  const cached = new Map(), queries = [], logs = [], effects = [];
  const previousSecret = process.env.JWT_SECRET;
  const stub = (path, exports) => {
    const resolved = require.resolve(path);
    if (!cached.has(resolved)) cached.set(resolved,require.cache[resolved]);
    require.cache[resolved] = { id: resolved,filename: resolved,loaded: true,exports };
  };
  const fresh = path => { const resolved = require.resolve(path); cached.set(resolved,require.cache[resolved]); delete require.cache[resolved]; return require(path); };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); owned = true;
    raw = new Pool({ ...config, options: `-c search_path=${schema}`, max: 12 });
    await raw.query(`CREATE TABLE shops(id ${type} PRIMARY KEY, tax_rate NUMERIC, name TEXT, phone TEXT);
      CREATE TABLE users(id ${type} PRIMARY KEY,shop_id ${type},role TEXT,revoke_all_before TIMESTAMPTZ);
      CREATE TABLE revoked_tokens(id TEXT PRIMARY KEY,token_jti TEXT);
      CREATE TABLE repair_orders(id ${type} PRIMARY KEY,shop_id ${type} NOT NULL REFERENCES shops(id),
        customer_id ${type},vehicle_id ${type},assigned_to ${type},ro_number TEXT DEFAULT 'SYNTHETIC',
        parts_cost NUMERIC DEFAULT 0,labor_cost NUMERIC DEFAULT 0,sublet_cost NUMERIC DEFAULT 0,
        tax NUMERIC DEFAULT 0,total NUMERIC DEFAULT 123.45,estimate_amount NUMERIC DEFAULT 123.45,
        status TEXT DEFAULT 'estimate',estimate_approved_at TEXT,updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE customers(id ${type} PRIMARY KEY,name TEXT,phone TEXT,email TEXT);
      CREATE TABLE vehicles(id ${type} PRIMARY KEY,year INTEGER,make TEXT,model TEXT);
      CREATE TABLE ro_payments(id TEXT PRIMARY KEY,shop_id ${type},ro_id ${type},amount_cents INTEGER,status TEXT);
      CREATE TABLE estimate_line_items(id TEXT PRIMARY KEY,ro_id TEXT NOT NULL,shop_id TEXT NOT NULL,
        type TEXT NOT NULL,description TEXT NOT NULL,quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
        unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,total NUMERIC(10,2) GENERATED ALWAYS AS (quantity*unit_price) STORED,
        taxable BOOLEAN NOT NULL DEFAULT FALSE,sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE estimate_approval_links(id TEXT PRIMARY KEY,ro_id ${type},shop_id ${type},token TEXT UNIQUE,
        created_by TEXT,decline_reason TEXT,responded_at TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE ro_comms(id TEXT PRIMARY KEY,ro_id ${type},shop_id ${type},user_id ${type},channel TEXT,direction TEXT,summary TEXT);
      CREATE TABLE job_status_log(id TEXT PRIMARY KEY,ro_id ${type},from_status TEXT,to_status TEXT,changed_by TEXT,note TEXT);
      CREATE TABLE notifications(id TEXT PRIMARY KEY,shop_id ${type},user_id ${type},type TEXT,title TEXT,body TEXT,message TEXT,ro_id ${type},read BOOLEAN)`);
    await raw.query(`ALTER TABLE users ADD COLUMN name TEXT, ADD COLUMN customer_id ${type};
      ALTER TABLE job_status_log ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
      CREATE TABLE parts_orders(id TEXT PRIMARY KEY, ro_id ${type}, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await ensurePanelEstimator(raw); await ensurePanelEstimator(raw);
    // Wrap only DB calls, never public URLs. Check that pe_ bearer values never
    // enter SQL parameters (including audit JSON) or application console output.
    const observed = async (client,sql,params) => {
      queries.push({ sql,params });
      if (hook) await hook(sql,params,'before');
      const result = await client.query(sql,params);
      if (hook) await hook(sql,params,'after');
      return result;
    };
    const pool = { query: (sql,params) => observed(raw,sql,params), connect: async () => {
      const client = await raw.connect();
      return { query: (sql,params) => observed(client,sql,params), release: () => client.release() };
    } };
    const id = () => type === 'TEXT' ? `text-${randomUUID()}` : randomUUID();
    const shopId = id(), otherShop = id(), actorId = id();
    await raw.query('INSERT INTO shops(id,tax_rate) VALUES ($1,0.1),($2,0.1)', [shopId,otherShop]);
    await raw.query("INSERT INTO users(id,shop_id,role) VALUES ($1,$2,'owner')", [actorId,shopId]);
    const newScope = async (shop = shopId) => {
      const roId = id(); await raw.query('INSERT INTO repair_orders(id,shop_id) VALUES ($1,$2)', [roId,shop]);
      return { shopId: shop,roId,actorId,role: 'owner' };
    };
    const revisions = createPanelEstimatorRevisions(pool), drafts = createPanelEstimatorDraft(pool);
    const store = createPanelEstimatorStore(pool);
    const prepare = async (scope, body = draft()) => {
      const preview = await drafts.preview({ ...scope,body });
      return { ...body,expected_version: preview.version,input_hash: preview.input_hash,reviewed: true,idempotency_key: randomUUID() };
    };
    const commit = async (scope, body) => revisions.commit({ ...scope,body: await prepare(scope,body) });
    const authorPath = scope => `/api/estimate-items/${scope.roId}/panel-estimator`;
    const issue = async (scope,revision) => {
      const result = await request(`${authorPath(scope)}/approval-link`,'POST',binding(revision),'owner',scope.shopId);
      assert.equal(result.status,201); return result.body;
    };
    const legacyLink = async scope => {
      const token = randomUUID(); await raw.query('INSERT INTO estimate_approval_links(id,shop_id,ro_id,token) VALUES ($1,$2,$3,$4)',
        [randomUUID(),scope.shopId,scope.roId,token]); return token;
    };
    const sideEffects = async scope => {
      const result = {};
      for (const table of ['repair_orders','ro_comms','job_status_log','notifications','estimate_approval_links','ro_payments']) {
        result[table] = (await raw.query(`SELECT * FROM ${table} WHERE ${table === 'repair_orders' ? 'id' : 'ro_id'}=$1 ORDER BY id`, [scope.roId])).rows;
      }
      result.providers = [...effects]; return result;
    };
    stub('../src/db', { pool,dbGet: async (sql,params) => (await pool.query(sql,params)).rows[0],
      dbAll: async (sql,params) => (await pool.query(sql,params)).rows,dbRun: (sql,params) => pool.query(sql,params) });
    const forbidden = name => async () => { effects.push(name); throw new Error(`Forbidden provider ${name}`); };
    stub('../src/services/sms',{ sendSMS: forbidden('SMS'),isConfiguredForShop: forbidden('SMS config') });
    stub('../src/services/mailer',{ sendMail: forbidden('email') });
    stub('../src/services/customerBilling',{ createPaymentCheckoutLinkForRo: forbidden('payment'),
      ensureTrackingToken: forbidden('tracking'),sendClosedPaidInvoiceEmail: forbidden('invoice') });
    stub('../src/services/quickbooks',{ syncInvoiceForRo: forbidden('accounting') });
    stub('../src/services/customerOptInConfirmation',{ sendCustomerOptInConfirmation: forbidden('consent') });
    stub('../src/services/ownerActivity',{ recordOwnerActivity: forbidden('activity') });
    stub('../src/services/notifications',{ createNotification: forbidden('nontransactional notification') });
    stub('../src/services/deliveryFees',{ calculateDeliveryFeeBreakdown: async () => ({ total_fee: 0 }),toMoney: Number });
    stub('../src/routes/insuranceOcr',{ insuranceOcrLimiter: (req,res,next) => next() });
    process.env.JWT_SECRET = 'synthetic-panel-approval-test-only';
    const authenticate = fresh('../src/middleware/auth');
    const app = express(); app.set('trust proxy','loopback');
    app.use(require('@sentry/node').Handlers.requestHandler());
    app.use(panelBearerRequest); app.use(express.json()); app.use(panelBearerParserError);
    app.use('/api/estimate-items',require('../src/routes/panelEstimator').createPanelEstimatorRouter({ database: pool,authenticate }));
    app.use('/api/approval',fresh('../src/routes/approval'));
    app.use('/api/ros',fresh('../src/routes/ros'));
    app.use('/api/repair-orders',require('../src/routes/ros'));
    server = app.listen(0,'127.0.0.1'); await once(server,'listening');
    let ip = 1;
    async function request(path,method = 'GET',body,role = 'owner',shop = shopId,fixedIP) {
      const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': fixedIP ?? `192.0.${Math.floor(ip/250)}.${ip++%250+1}` };
      if (role) headers.Authorization = `Bearer ${jwt.sign({ id: actorId,shop_id: shop,role,jti: randomUUID() },process.env.JWT_SECRET,{ expiresIn: '5m' })}`;
      const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,headers,body: body === undefined ? undefined : JSON.stringify(body) });
      const contentType = result.headers.get('content-type');
      return { status: result.status, body: contentType?.startsWith('application/pdf') ? Buffer.from(await result.arrayBuffer()) : await result.json(),
        contentType, disposition: result.headers.get('content-disposition'), cache: result.headers.get('cache-control'),
        referrer: result.headers.get('referrer-policy'), rate: result.headers.get('ratelimit-limit') };
    }
    for (const method of ['log','warn','error']) t.mock.method(console,method,(...args) => logs.push(args));
    const families = ['/api/approval','/api/ros/approval'];
    await t.test('author roles/tenant/revision gates, both bearer PDFs, exact F1 and no private reads/effects', async () => {
      const scope = await newScope();
      await store.saveCosts({ ...scope, expectedVersion: 0, lines: [], reason: 'PRIVATE_SENTINEL', private_notes: 'PRIVATE_SENTINEL' });
      const revision = await commit(scope), link = await issue(scope, revision);
      const path = `${authorPath(scope)}/quote.pdf?revision_id=${revision.revision_id}`;
      assert.equal((await request(path,'GET',undefined,null)).status,401);
      for (const role of ['technician','customer']) assert.equal((await request(path,'GET',undefined,role)).status,403);
      assert.equal((await request(path,'GET',undefined,'owner',otherShop)).status,404);
      const other = await newScope();
      assert.equal((await request(`${authorPath(other)}/quote.pdf?revision_id=${revision.revision_id}`)).status,404);
      assert.equal((await request(`${authorPath(scope)}/quote.pdf?revision_id[]=bad`)).status,400);
      const before = await sideEffects(scope), firstQuery = queries.length;
      for (const target of [path, ...families.map(f => publicPath(f,link))]) {
        const result = await request(target,'GET',undefined,target === path ? 'assistant' : null);
        assert.equal(result.status,200); assert.match(result.contentType,/^application\/pdf/);
        assert.equal(result.body.subarray(0,5).toString(),'%PDF-'); assert.equal(result.cache,'no-store');
        assert.equal(result.referrer,'no-referrer'); assert.match(result.disposition,/^attachment; filename="panel-quote-[a-zA-Z0-9_-]+\.pdf"$/);
        const pdf = await parsePdf(result.body); safe(pdf.text);
        for (const value of ['Repair total: $440.00','Net repair amount: $400.00','Tax: $40.00']) assert.ok(pdf.text.includes(value),value);
      }
      assert.ok(!queries.slice(firstQuery).some(q => /revision_costs|ro_panel_estimator_costs|ro_payments|delivery/i.test(q.sql)));
      assert.deepEqual(await sideEffects(scope),before);
      const accepted = await request(publicPath(families[0],link,''),'POST',response(revision)); assert.equal(accepted.status,200);
      assert.match((await parsePdf((await request(publicPath(families[1],link))).body)).text,/Customer decision: Approved/);
      assert.deepEqual(await revisions.getQuote({ ...scope,revisionId: revision.revision_id }),revision);
    });
    await t.test('both public PDF families enforce expired, revoked and stale approved revision links', async () => {
      const scope = await newScope(), revision = await commit(scope), link = await issue(scope,revision);
      const token = `pe_${randomUUID().replaceAll('-','')}${randomUUID().replaceAll('-','')}`;
      await raw.query(`INSERT INTO ro_panel_estimator_approval_links
        (shop_id,ro_id,id,revision_id,quote_hash,token_hash,disclosure_version,created_by,created_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,'panel-quote-v1',$7,now()-interval '8 days',now()-interval '1 day')`,
      [shopId,scope.roId,randomUUID(),revision.revision_id,revision.quote_hash,createHash('sha256').update(token).digest('hex'),actorId]);
      const expired = { link: `/approve/${token}` };
      assert.equal((await request(`${authorPath(scope)}/approval-link/${link.link_id}/revoke`,'POST',{})).status,200);
      for (const family of families) {
        for (const [candidate,error] of [[expired,'APPROVAL_EXPIRED'],[link,'APPROVAL_REVOKED']]) {
          const result = await request(publicPath(family,candidate),'GET',undefined,null);
          assert.equal(result.status,410); assert.equal(result.body.error,error); assert.equal(result.cache,'no-store');
        }
      }
      const active = await issue(scope,revision), pending = await issue(scope,revision);
      assert.equal((await request(publicPath(families[0],active,''),'POST',response(revision))).status,200);
      await commit(scope, draft({ assessments: [panel({ body_rate_cents: 11000 })] }));
      for (const family of families) {
        // Decisions are revision-scoped; all links to this decided revision are stale, not revoked.
        for (const old of [active,pending]) assert.equal((await request(publicPath(family,old))).body.error,'APPROVAL_REVISION_CONFLICT');
      }
      const clean = await newScope(), initial = await commit(clean), undecided = await issue(clean,initial);
      await commit(clean);
      for (const family of families) assert.equal((await request(publicPath(family,undecided))).body.error,'APPROVAL_REVOKED');
    });
    await t.test('historical JSON/PDF stays frozen after tax/payments; comparisons remain safe and nonrecursive', async () => {
      // Isolate live defaults while proving issued evidence survives paid repricing.
      const historyShop = id();
      await raw.query('INSERT INTO shops(id,tax_rate) VALUES ($1,0.1)', [historyShop]);
      const scope = await newScope(historyShop);
      const authorRequest = url => request(url,'GET',undefined,'owner',historyShop);
      const first = await commit(scope), url = `${authorPath(scope)}/quote.pdf?revision_id=${first.revision_id}`;
      const before = (await parsePdf((await authorRequest(url)).body)).text;
      await raw.query('UPDATE shops SET tax_rate=0.2 WHERE id=$1',[historyShop]);
      assert.equal((await parsePdf((await authorRequest(url)).body)).text,before);
      const next = await commit(scope, draft({ assessments: [panel({ parts_sell_cents: 20000 })] }));
      const old = next.quote.comparisons[0]; safe(next);
      assert.deepEqual(old.totals,first.quote.totals); assert.deepEqual(old.allocation,first.quote.allocation);
      assert.equal(old.version,first.version); assert.equal(old.quote_hash,first.quote_hash);
      assert.equal(old.comparisons,undefined); assert.equal(old.historical,true);
      assert.ok(old.differences.some(d => d.path === 'scope.assessments["hood"].parts_sell_cents' && d.after === '$200.00'));
      assert.ok(old.differences.some(d => d.path === 'totals.tax_rate_bps' && d.before === '10%' && d.after === '20%'));
      const third = await commit(scope);
      assert.ok(third.quote.comparisons.every(c => c.comparisons === undefined));
      const link = await issue(scope,third);
      const json = (await request(publicPath(families[0],link,''))).body; safe(json);
      assert.deepEqual(json.quote,third.quote);
      const pdf = await parsePdf((await request(publicPath(families[0],link))).body); safe(pdf.text);
      assert.match(pdf.text,/Historical repair total: \$440.00/);
      assert.equal((await parsePdf((await authorRequest(url)).body)).text,before);
      assert.deepEqual(await revisions.getQuote({ ...scope,revisionId: first.revision_id }),first);
      await raw.query("INSERT INTO ro_payments VALUES ($1,$2,$3,2000,'paid')",[randomUUID(),historyShop,scope.roId]);
      const heldState = async () => {
        const state = await sideEffects(scope);
        for (const table of ['ro_panel_estimator_drafts','ro_panel_estimator_revisions',
          'ro_panel_estimator_revision_costs','estimate_line_items']) {
          state[table] = (await raw.query(`SELECT to_jsonb(t) AS row FROM ${table} t
            WHERE shop_id=$1 AND ro_id=$2 ORDER BY to_jsonb(t)::text`,[historyShop,scope.roId])).rows;
        }
        return state;
      };
      const held = await heldState();
      const paidPreview = await drafts.preview({ ...scope,body: draft() });
      assert.equal(paidPreview.sell.allocation.paid_cents,2000);
      assert.equal(paidPreview.sell.allocation.balance_cents,third.quote.totals.total_cents-2000);
      assert.equal(third.quote.allocation.paid_cents,0);
      await raw.query('UPDATE shops SET tax_rate=0.1 WHERE id=$1',[historyShop]);
      assert.deepEqual(await heldState(),held);
      assert.deepEqual((await request(publicPath(families[0],link,''))).body.quote,third.quote);
      assert.equal((await parsePdf((await request(publicPath(families[0],link))).body)).text,pdf.text);
      const thirdUrl=`${authorPath(scope)}/quote.pdf?revision_id=${third.revision_id}`;
      const thirdBefore=(await parsePdf((await authorRequest(thirdUrl)).body)).text;
      const fourth=await commit(scope);
      assert.notEqual(fourth.revision_id,third.revision_id);
      assert.equal(fourth.quote.allocation.paid_cents,2000);
      assert.equal(third.quote.allocation.paid_cents,0);
      assert.equal(Number((await raw.query('SELECT tax_rate FROM shops WHERE id=$1',[historyShop])).rows[0].tax_rate),0.1);
      assert.equal((await parsePdf((await authorRequest(url)).body)).text,before);
      assert.deepEqual(await revisions.getQuote({ ...scope,revisionId:first.revision_id }),first);
      assert.deepEqual(await revisions.getQuote({ ...scope,revisionId:third.revision_id }),third);
      // Historical public quote content is immutable; the old bearer retains the
      // existing revocation rule when a newer revision becomes current.
      for(const family of families) assert.equal((await request(publicPath(family,link))).body.error,'APPROVAL_REVOKED');
      const fourthLink=await issue(scope,fourth);
      assert.deepEqual((await request(publicPath(families[0],fourthLink,''))).body.quote,fourth.quote);
      const thirdAuthorPdf=await parsePdf((await authorRequest(`${authorPath(scope)}/quote.pdf?revision_id=${third.revision_id}`)).body);
      assert.match(thirdAuthorPdf.text,/Historical repair total: \$440.00/);
      assert.equal(thirdAuthorPdf.text,thirdBefore);

    });
    await t.test('real HTTP mixed package and long strings preserve parsed net/tax without double charging', async () => {
      const scope = await newScope();
      const notes = `${'Café résumé scope details '.repeat(150)}END-HTTP-NOTES`;
      const revision = await commit(scope,draft({ assessments: [panel({ customer_notes: notes,
        taxable: { body: false, refinish: true, parts: true, materials: true, sublet: true },
        package: { name: 'HTTP Package', price_cents: 15000, taxable: null, included_operations: ['body','refinish'],
          sell_allocation_cents: { body: 10000, refinish: 5000 } } })],
      adjustments: { discount_cents: 0, discounts: [{ id: 'Package rebate', amount_cents: 3000, package_ids: ['hood:package'] }] } }));
      const link = await issue(scope,revision);
      const pdf = await parsePdf((await request(publicPath(families[0],link))).body);
      assert.ok(pdf.numpages >= 3); assert.match(pdf.text,/END-HTTP-NOTES/);
      assert.match(pdf.text,/Net repair amount: \$270.00/); assert.match(pdf.text,/Tax: \$19.00/);
      assert.match(pdf.text,/Repair total: \$289.00/);
      assert.equal((pdf.text.match(/Hood - Repair/g) || []).length,2);
      const lines = (await raw.query('SELECT description FROM estimate_line_items WHERE shop_id=$1 AND ro_id=$2',[shopId,scope.roId])).rows;
      assert.ok(lines.some(l => l.description === 'HTTP Package - Body labor'));
      assert.ok(lines.some(l => l.description === 'HTTP Package - Refinish labor'));
    });
    await t.test('ordinary invoice and legacy approval still work; PDF failures/limits stay private', async () => {
      const scope = await newScope(), legacy = await legacyLink(scope);
      const invoice = await request(`/api/ros/${scope.roId}/invoice`);
      assert.equal(invoice.status,200); assert.equal(invoice.body.invoice_total_with_delivery,123.45);
      for (const family of families) {
        assert.equal((await request(`${family}/${legacy}`)).body.ro.id,scope.roId);
        assert.equal((await request(`${family}/${legacy}/pdf`)).status,404);
        const address = family === families[0] ? '198.51.100.31' : '198.51.100.32';
        for (let i=0;i<21;i++) {
          const result = await request(`${family}/pe_${'c'.repeat(64)}/pdf`,'GET',undefined,null,shopId,address);
          assert.equal(result.status,i<20 ? 404 : 429); assert.equal(result.cache,'no-store'); safe(result.body);
        }
      }
      assert.deepEqual(effects,[]);
      assert.equal(/pe_[a-f0-9]{64}/.test(JSON.stringify(queries)),false,'Bearer secret reached SQL');
      assert.equal(/pe_[a-f0-9]{64}|PRIVATE_SENTINEL/.test(JSON.stringify(logs)),false,'Private value reached logs');
    });
  } finally {
    hook = null;
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [path, original] of cached) { if (original) require.cache[path] = original; else delete require.cache[path]; }
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    if (raw) await raw.end();
    if (owned) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
