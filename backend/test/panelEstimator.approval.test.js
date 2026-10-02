'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ensurePanelEstimator } = require('../src/db/panelEstimator');
const { createPanelEstimatorDraft } = require('../src/services/panelEstimatorDraft');
const { createPanelEstimatorStore } = require('../src/services/panelEstimatorStore');
const { createPanelEstimatorRevisions } = require('../src/services/panelEstimatorRevisions');
const { panelPublicHandler, publicError, publicRequestError, approvalTelemetry } = require('../src/services/panelEstimatorApproval');

const DATABASE = 'postgresql://revv_panel@127.0.0.1:55459/revv_panel_test';
function databaseConfig(value) {
  assert.equal(value, DATABASE, 'Only the explicitly dedicated PANEL_ESTIMATOR_TEST_DATABASE_URL is allowed');
  return { host: '127.0.0.1', port: 55459, user: 'revv_panel', database: 'revv_panel_test',
    password: async () => '', ssl: false, connectionTimeoutMillis: 3000, statement_timeout: 10000 };
}
const draft = () => ({ assessments: [{ panel_id: 'hood', body_style: 'sedan', severity: 'light',
  damage_type: 'dent', area: 'center', operation: 'repair', refinish: true, body_hours: 2,
  refinish_hours: 1, body_rate_cents: 10000, refinish_rate_cents: 10000, parts_sell_cents: 10000,
  materials_sell_cents: 5000, sublet_sell_cents: 0, reviewed: true, customer_notes: 'Repair hood',
  taxable: { body: true, refinish: true, parts: true, materials: true, sublet: true } }],
  scenario: { payer: 'insurance', provenance: 'shop_prepared' }, adjustments: {} });
const binding = revision => ({ revision_id: revision.revision_id, quote_hash: revision.quote_hash });
const response = (revision, patch = {}) => ({ ...binding(revision), disclosure_version: 'panel-quote-v1',
  decision: 'approve', actor_name: 'Synthetic Customer', acknowledged: true, ...patch });
const publicPath = (family, link, suffix = '') => `${family}/${link.link.slice('/approve/'.length)}${suffix}`;
const code = expected => err => err.code === expected;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function safe(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /PRIVATE_SENTINEL|private_notes|cost_rate|cost_cents|target_margin|contribution|reviewed_by|created_by|token_hash|carrier_approved/);
}

test('approval test database guard has no ambient or remote fallback', () => {
  for (const value of [undefined, 'postgresql://remote/revv_panel_test', `${DATABASE}?host=remote`, DATABASE.replace('revv_panel@','other@')])
    assert.throws(() => databaseConfig(value));
  assert.equal(databaseConfig(DATABASE).port, 55459);
});
test('public error handling never exposes SQL, bearer secrets or unknown exception text', () => {
  const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  publicError(res, new Error('PRIVATE_SENTINEL pe_secret SELECT credentials'));
  assert.equal(res.statusCode,500); assert.deepEqual(res.body,{ error: 'APPROVAL_UNAVAILABLE' });
  publicError(res, Object.assign(new Error('private'), { code: '40P01' })); assert.equal(res.statusCode,409);
});
test('pre-router input errors are sanitized, no-store and rate limited without logging', async () => {
  let limited = 0;
  const handler = publicRequestError((req,res,next) => { limited++; next(); });
  const res = { headers: {}, set(key,value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },json(value) { this.body = value; return this; } };
  await handler(Object.assign(new Error('pe_secret raw input'),{ type: 'entity.parse.failed' }),{},res,() => assert.fail());
  assert.equal(limited,1); assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(res.statusCode,400); assert.deepEqual(res.body,{ error: 'INVALID_INPUT' });
});
test('telemetry drops bearer URLs including pre-router parse errors and breadcrumb copies', () => {
  for (const path of ['/api/approval/pe_bad','/api/ros/approval/pe_bad','/api/repair-orders/approval/pe_bad',
    `/approve/pe_${'a'.repeat(64)}`, '/api/approval/%70%65%5fbad']) {
    assert.equal(approvalTelemetry({ request: { url: `http://localhost${path}` } }),null);
    assert.equal(approvalTelemetry({ breadcrumbs: [{ message: path }] }),null);
  }
  const ordinary = { request: { url: '/api/health' } }; assert.equal(approvalTelemetry(ordinary),ordinary);
});
test('pe_ delegation catches failures and excludes bearer requests from telemetry', async () => {
  const sentry = require('@sentry/node');
  const previous = sentry.configureScope;
  let processor;
  // Exercise the handler itself without an app startup, provider or socket.
  sentry.configureScope = fn => fn({ addEventProcessor: p => { processor = p; } });
  try {
    const handler = panelPublicHandler({ connect: async () => { throw new Error('PRIVATE_SENTINEL'); } }, 'get');
    const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
    let next = false;
    await handler({ params: { token: 'ordinary' } },res,() => { next = true; }); assert.equal(next,true);
    await handler({ params: { token: `pe_${'a'.repeat(64)}` } },res,() => assert.fail('Legacy delegation'));
    assert.equal(res.statusCode,500); safe(res.body);
    assert.equal(processor({ request: { url: '/api/approval/pe_secret' } }),null);
  } finally { sentry.configureScope = previous; }
});

for (const type of ['TEXT','UUID']) test(`A1 PostgreSQL ${type}: real JWT HTTP both public families and transactional audit`, async t => {
  // Missing DB configuration FAILS rather than skipping required acceptance tests.
  const config = databaseConfig(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL);
  const schema = `panel_approval_${randomUUID().replaceAll('-','')}`;
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
    const prepare = async scope => {
      const body = draft(), preview = await drafts.preview({ ...scope,body });
      return { ...body,expected_version: preview.version,input_hash: preview.input_hash,reviewed: true,idempotency_key: randomUUID() };
    };
    const commit = async scope => revisions.commit({ ...scope,body: await prepare(scope) });
    const authorPath = scope => `/api/estimate-items/${scope.roId}/panel-estimator`;
    const issue = async (scope,revision) => {
      const result = await request(`${authorPath(scope)}/approval-link`,'POST',binding(revision));
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
    app.use(require('@sentry/node').Handlers.requestHandler()); app.use(express.json());
    app.use('/api/estimate-items',require('../src/routes/panelEstimator').createPanelEstimatorRouter({ database: pool,authenticate }));
    app.use('/api/approval',fresh('../src/routes/approval'));
    app.use('/api/ros',fresh('../src/routes/ros'));
    server = app.listen(0,'127.0.0.1'); await once(server,'listening');
    let ip = 1;
    async function request(path,method = 'GET',body,role = 'owner',shop = shopId,fixedIP) {
      const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': fixedIP ?? `192.0.${Math.floor(ip/250)}.${ip++%250+1}` };
      if (role) headers.Authorization = `Bearer ${jwt.sign({ id: actorId,shop_id: shop,role,jti: randomUUID() },process.env.JWT_SECRET,{ expiresIn: '5m' })}`;
      const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,headers,body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: result.status,body: await result.json(),cache: result.headers.get('cache-control'),rate: result.headers.get('ratelimit-limit') };
    }
    for (const method of ['log','warn','error']) t.mock.method(console,method,(...args) => logs.push(args));
    const families = ['/api/approval','/api/ros/approval'];
    await t.test('JWT author gates, tenant/RO/revision/hash binding, safe immutable public snapshot, no token persistence', async () => {
      const scope = await newScope();
      await store.saveCosts({ ...scope,expectedVersion: 0,lines: [],reason: 'PRIVATE_SENTINEL',private_notes: 'PRIVATE_SENTINEL' });
      const revision = await commit(scope), base = `${authorPath(scope)}/approval-link`;
      assert.equal((await request(base,'POST',binding(revision),null)).status,401);
      for (const role of ['technician','customer']) assert.equal((await request(base,'POST',binding(revision),role)).status,403);
      assert.equal((await request(base,'POST',binding(revision),'owner',otherShop)).status,404);
      const other = await newScope(), otherRevision = await commit(other);
      assert.equal((await request(base,'POST',binding(otherRevision))).status,409);
      assert.equal((await request(base,'POST',{ ...binding(revision),quote_hash: '0'.repeat(64) })).status,409);
      for (const role of ['owner','admin','assistant']) {
        const result = await request(base,'POST',binding(revision),role); assert.equal(result.status,201);
        const link = result.body, token = link.link.slice('/approve/'.length);
        assert.equal(/^pe_[a-f0-9]{64}$/.test(token),true,'Bearer format must contain 256 random bits'); assert.equal(result.cache,'no-store');
        const stored = (await raw.query('SELECT * FROM ro_panel_estimator_approval_links WHERE id=$1',[link.link_id])).rows[0];
        assert.equal(stored.token_hash,createHash('sha256').update(token).digest('hex'));
        assert.equal(stored.expires_at-stored.created_at,7*24*3600*1000);
        for (const family of families) {
          const view = await request(publicPath(family,link)); assert.equal(view.status,200); safe(view.body);
          assert.equal(view.cache,'no-store'); assert.equal(view.rate,'20');
          assert.equal(view.body.kind,'panel_estimator'); assert.deepEqual(view.body.quote,revision.quote);
          assert.equal(view.body.disclosure.version,'panel-quote-v1'); assert.equal(view.body.receipt,null);
          assert.equal(view.body.ro,undefined); assert.equal(view.body.quote.allocation.customer_cents,null);
        }
        for (const table of ['ro_panel_estimator_approval_links','ro_panel_estimator_approval_events']) {
          assert.ok(!JSON.stringify((await raw.query(`SELECT * FROM ${table}`)).rows).includes(token));
        }
        assert.ok(!JSON.stringify(queries).includes(token)); assert.ok(!JSON.stringify(logs).includes(token));
      }
    });
    await t.test('strict decision validation through both families and both POST aliases; immutable replay receipts', async () => {
      for (const family of families) {
        const scope = await newScope(), revision = await commit(scope), link = await issue(scope,revision);
        const path = publicPath(family,link), valid = response(revision);
        const before = await sideEffects(scope);
        for (const key of ['revision_id','quote_hash','disclosure_version','decision','actor_name','acknowledged']) {
          const body = { ...valid }; delete body[key]; assert.ok([400,409].includes((await request(path,'POST',body)).status));
        }
        for (const patch of [{ acknowledged: false },{ acknowledged: 'true' },{ actor_name: '' },{ actor_name: '  ' },
          { actor_name: 42 },{ actor_name: 'a'.repeat(201) },{ actor_name: 'x\ny' },{ decision: 'yes' },
          { decision: 'decline' },{ decision: 'decline',reason: ' ' },{ reason: 'unexpected' },{ private_notes: 'PRIVATE_SENTINEL' }]) {
          assert.equal((await request(`${path}/respond`,'POST',{ ...valid,...patch })).status,400);
        }
        for (const patch of [{ revision_id: randomUUID() },{ quote_hash: '0'.repeat(64) },{ disclosure_version: 'client-version' }])
          assert.equal((await request(path,'POST',{ ...valid,...patch })).status,409);
        assert.deepEqual(await sideEffects(scope),before);
        const accepted = await request(path,'POST',valid); assert.equal(accepted.status,200); safe(accepted.body);
        assert.equal(accepted.body.receipt.decision,'approve'); assert.equal(accepted.body.receipt.acknowledged,true);
        const otherFamily = families.find(f => f !== family);
        assert.deepEqual((await request(publicPath(otherFamily,link,'/respond'),'POST',valid)).body,accepted.body);
        assert.deepEqual((await request(path)).body,accepted.body);
        assert.equal((await request(path,'POST',response(revision,{ decision: 'decline',reason: 'Change scope' }))).status,409);
        assert.equal((await request(path,'POST',response(revision,{ actor_name: 'Different actor' }))).status,409);
        const secondLink = await issue(scope,revision);
        assert.equal((await request(publicPath(family,secondLink),'POST',response(revision,{ decision: 'decline',reason: 'Change' }))).status,409);
        assert.deepEqual((await request(publicPath(family,secondLink),'POST',valid)).body.receipt,accepted.body.receipt);
        assert.deepEqual(await sideEffects(scope),before);
        const declinedScope = await newScope(), declinedRevision = await commit(declinedScope), declinedLink = await issue(declinedScope,declinedRevision);
        const decline = response(declinedRevision,{ decision: 'decline',reason: 'Please revise hood work' });
        const result = await request(publicPath(family,declinedLink),'POST',decline); assert.equal(result.status,200);
        assert.equal(result.body.receipt.reason,decline.reason);
        assert.deepEqual((await request(publicPath(otherFamily,declinedLink),'POST',decline)).body,result.body);
      }
    });
    await t.test('explicit revocation is authorized, scoped, idempotent and enforced even on decided replay', async () => {
      const scope = await newScope(), revision = await commit(scope), link = await issue(scope,revision);
      const accepted = await request(publicPath(families[0],link),'POST',response(revision)); assert.equal(accepted.status,200);
      const revokePath = `${authorPath(scope)}/approval-link/${link.link_id}/revoke`;
      assert.equal((await request(revokePath,'POST',{},'technician')).status,403);
      assert.equal((await request(revokePath,'POST',{},'owner',otherShop)).status,404);
      const other = await newScope();
      assert.equal((await request(`${authorPath(other)}/approval-link/${link.link_id}/revoke`,'POST',{})).status,404);
      const revoked = await request(revokePath,'POST',{},'assistant'); assert.equal(revoked.status,200);
      assert.deepEqual((await request(revokePath,'POST',{},'admin')).body,revoked.body);
      for (const family of families) for (const method of ['GET','POST']) {
        const result = await request(publicPath(family,link),method,method === 'POST' ? response(revision) : undefined);
        assert.equal(result.status,410); assert.equal(result.body.error,'APPROVAL_REVOKED');
      }
      const events = (await raw.query("SELECT * FROM ro_panel_estimator_approval_events WHERE link_id=$1 ORDER BY kind",[link.link_id])).rows;
      assert.deepEqual(events.map(e => e.kind),['decision','issued','revoked']);
      assert.equal(events[0].id,accepted.body.receipt.id);
    });
    await t.test('expiry is checked after locking, including already-decided replay', async () => {
      const scope = await newScope(), revision = await commit(scope);
      for (const decided of [false,true]) {
        const token = `pe_${'b'.repeat(32)}${randomUUID().replaceAll('-','')}`;
        const linkId = randomUUID();
        // Historical fixture inserts obey the immutable schema and exact 168h lifetime.
        await raw.query(`INSERT INTO ro_panel_estimator_approval_links
          (shop_id,ro_id,id,revision_id,quote_hash,token_hash,disclosure_version,created_by,created_at,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,'panel-quote-v1',$7,now()-interval '8 days',now()-interval '1 day')`,
        [shopId,scope.roId,linkId,revision.revision_id,revision.quote_hash,createHash('sha256').update(token).digest('hex'),actorId]);
        if (decided) await raw.query(`INSERT INTO ro_panel_estimator_approval_events
          (shop_id,ro_id,id,link_id,revision_id,quote_hash,disclosure_version,kind,decision,actor_name,acknowledged)
          VALUES ($1,$2,$3,$4,$5,$6,'panel-quote-v1','decision','approve','Synthetic Customer',true)`,
        [shopId,scope.roId,randomUUID(),linkId,revision.revision_id,revision.quote_hash]);
        for (const family of families) for (const method of ['GET','POST']) {
          const result = await request(`${family}/${token}`,method,method === 'POST' ? response(revision) : undefined);
          assert.equal(result.status,410); assert.equal(result.body.error,'APPROVAL_EXPIRED');
        }
      }
    });
    await t.test('new commit revokes pending links atomically and retains decisions; stale receipts cannot replay', async () => {
      for (const decided of [false,true]) {
        const scope = await newScope(), revision = await commit(scope), link = await issue(scope,revision);
        let receipt;
        if (decided) receipt = (await request(publicPath(families[0],link),'POST',response(revision))).body.receipt;
        const next = await commit(scope);
        const row = (await raw.query('SELECT * FROM ro_panel_estimator_approval_links WHERE id=$1',[link.link_id])).rows[0];
        assert.equal(Boolean(row.revoked_at),!decided);
        for (const family of families) for (const method of ['GET','POST']) {
          const result = await request(publicPath(family,link),method,method === 'POST' ? response(revision) : undefined);
          assert.equal(result.status,decided ? 409 : 410);
        }
        assert.equal((await request(`${authorPath(scope)}/approval-link`,'POST',binding(revision))).status,409);
        assert.ok((await issue(scope,next)).link);
        if (decided) assert.equal((await raw.query("SELECT id FROM ro_panel_estimator_approval_events WHERE link_id=$1 AND kind='decision'",[link.link_id])).rows[0].id,receipt.id);
      }
    });
    await t.test('database enforces revision/tenant/hash/link integrity and immutable append-only audit', async () => {
      const scope = await newScope(), revision = await commit(scope), link = await issue(scope,revision);
      const another = await newScope(), anotherRevision = await commit(another), anotherLink = await issue(another,anotherRevision);
      await request(publicPath(families[0],link),'POST',response(revision));
      for (const table of ['ro_panel_estimator_approval_links','ro_panel_estimator_approval_events']) {
        await assert.rejects(raw.query(`UPDATE ${table} SET quote_hash=quote_hash WHERE shop_id=$1 AND ro_id=$2`,[shopId,scope.roId]),code('23514'));
        await assert.rejects(raw.query(`DELETE FROM ${table} WHERE shop_id=$1 AND ro_id=$2`,[shopId,scope.roId]),code('23514'));
        await assert.rejects(raw.query(`TRUNCATE ${table} CASCADE`),code('23514'));
      }
      for (const patch of [{ shop: otherShop },{ ro: another.roId },{ revision: anotherRevision.revision_id },{ hash: '0'.repeat(64) }]) {
        await assert.rejects(raw.query(`INSERT INTO ro_panel_estimator_approval_links
          (shop_id,ro_id,id,revision_id,quote_hash,token_hash,disclosure_version,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,'panel-quote-v1',$7)`,
        [patch.shop ?? shopId,patch.ro ?? scope.roId,randomUUID(),patch.revision ?? revision.revision_id,
          patch.hash ?? revision.quote_hash,createHash('sha256').update(randomUUID()).digest('hex'),actorId]),code('23503'));
      }
      const eventInsert = (values = {}) => raw.query(`INSERT INTO ro_panel_estimator_approval_events
        (shop_id,ro_id,id,link_id,revision_id,quote_hash,disclosure_version,kind,decision,actor_name,acknowledged)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'decision','approve','Synthetic Customer',true)`,
      [values.shop ?? shopId,values.ro ?? scope.roId,randomUUID(),values.link ?? link.link_id,
        values.revision ?? revision.revision_id,values.hash ?? revision.quote_hash,values.disclosure ?? 'panel-quote-v1']);
      // Use another revision without a decision to avoid unique-index checks masking FKs.
      const clean = { ro: another.roId,revision: anotherRevision.revision_id,hash: anotherRevision.quote_hash,link: anotherLink.link_id };
      for (const patch of [{ shop: otherShop },{ ro: scope.roId },{ revision: revision.revision_id },{ hash: '0'.repeat(64) },{ link: link.link_id },{ disclosure: 'client-version' }])
        await assert.rejects(eventInsert({ ...clean,...patch }),code('23503'));
      await assert.rejects(eventInsert(),code('23505'));
      await assert.rejects(raw.query(`INSERT INTO ro_panel_estimator_approval_links
        (shop_id,ro_id,id,revision_id,quote_hash,token_hash,disclosure_version,created_by,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,'panel-quote-v1',$7,now()+interval '8 days')`,
      [shopId,scope.roId,randomUUID(),revision.revision_id,revision.quote_hash,'a'.repeat(64),actorId]),code('23514'));
    });
    await t.test('concurrent identical and contradictory HTTP responses have one immutable decision', async () => {
      const scope = await newScope(), revision = await commit(scope), link = await issue(scope,revision);
      const results = await Promise.all(families.map(f => request(publicPath(f,link),'POST',response(revision))));
      assert.deepEqual(results.map(r => r.status),[200,200]); assert.deepEqual(results[0].body,results[1].body);
      const other = await newScope(), next = await commit(other), otherLink = await issue(other,next);
      const race = await Promise.all([
        request(publicPath(families[0],otherLink),'POST',response(next)),
        request(publicPath(families[1],otherLink),'POST',response(next,{ decision: 'decline',reason: 'Revise' })),
      ]);
      assert.deepEqual(race.map(r => r.status).sort(),[200,409]);
      assert.equal((await raw.query("SELECT count(*)::int AS n FROM ro_panel_estimator_approval_events WHERE revision_id=$1 AND kind='decision'",[next.revision_id])).rows[0].n,1);
    });
    // Barrier at the actual parent lock, not a sleep-based scheduling assumption.
    async function orderedRace(scope, first, second) {
      const locked = deferred(), competing = deferred(), release = deferred();
      let ownerSeen = false;
      hook = async (sql,params,stage) => {
        if (!sql.includes('FROM repair_orders WHERE shop_id=$1 AND id=$2 FOR UPDATE') || params[1] !== scope.roId) return;
        if (stage === 'before') { if (ownerSeen) competing.resolve(); else ownerSeen = true; }
        if (stage === 'after' && !locked.done) { locked.done = true; locked.resolve(); await release.promise; }
      };
      const a = first();
      try {
        await Promise.race([locked.promise,a.then(() => assert.fail('First action failed to take parent lock'))]);
        const b = second();
        try {
          await Promise.race([competing.promise,b.then(() => assert.fail('Second action failed to take parent lock'))]);
        } finally { release.resolve(); }
        return await Promise.all([a,b]);
      } finally { release.resolve(); hook = null; }
    }
    await t.test('response versus commit serializes in both orders on the parent, across both public families', async () => {
      for (const family of families) for (const decisionFirst of [true,false]) {
        const scope = await newScope(), revision = await commit(scope), link = await issue(scope,revision), nextBody = await prepare(scope);
        const decide = () => request(publicPath(family,link),'POST',response(revision));
        const next = () => revisions.commit({ ...scope,body: nextBody });
        const results = await orderedRace(scope,decisionFirst ? decide : next,decisionFirst ? next : decide);
        assert.equal(results[decisionFirst ? 0 : 1].status,decisionFirst ? 200 : 410);
        const count = (await raw.query("SELECT count(*)::int AS n FROM ro_panel_estimator_approval_events WHERE revision_id=$1 AND kind='decision'",[revision.revision_id])).rows[0].n;
        assert.equal(count,decisionFirst ? 1 : 0);
      }
    });
    await t.test('legacy approve AND decline reject selected-panel ROs before every side effect, both families', async () => {
      for (const family of families) for (const decision of ['approve','decline']) {
        const scope = await newScope(), token = await legacyLink(scope); await commit(scope);
        const before = await sideEffects(scope);
        const result = await request(`${family}/${token}/respond`,'POST',{ decision,reason: 'Revise' });
        assert.equal(result.status,409); assert.equal(result.body.error,'PANEL_REVISION_CONFLICT'); assert.equal(result.cache,'no-store');
        assert.deepEqual(await sideEffects(scope),before);
      }
    });
    await t.test('legacy versus first commit races serialize, including communications and notifications', async () => {
      for (const family of families) for (const decision of ['approve','decline']) for (const legacyFirst of [true,false]) {
        const scope = await newScope(), token = await legacyLink(scope), nextBody = await prepare(scope);
        const before = await sideEffects(scope);
        const legacy = () => request(`${family}/${token}/respond`,'POST',{ decision,reason: 'Revise' });
        const next = () => revisions.commit({ ...scope,body: nextBody });
        const results = await orderedRace(scope,legacyFirst ? legacy : next,legacyFirst ? next : legacy);
        assert.equal(results[legacyFirst ? 0 : 1].status,legacyFirst ? 200 : 409);
        const after = await sideEffects(scope);
        if (!legacyFirst) for (const key of ['ro_comms','job_status_log','notifications','estimate_approval_links','ro_payments','providers']) assert.deepEqual(after[key],before[key]);
        else {
          assert.equal(after.job_status_log.length,decision === 'approve' ? 1 : 0);
          assert.equal(after.ro_comms.length,decision === 'decline' ? 1 : 0);
          assert.ok(after.estimate_approval_links[0].responded_at);
          assert.equal(after.notifications.length,family === families[0] || decision === 'approve' ? 1 : 0);
        }
      }
    });
    await t.test('legacy notification failures roll back status/comms/link writes and return sanitized errors', async () => {
      for (const family of families) {
        const scope = await newScope(), token = await legacyLink(scope), before = await sideEffects(scope);
        hook = async (sql,params,stage) => {
          if (stage === 'before' && sql.includes('INSERT INTO notifications')) throw new Error('PRIVATE_SENTINEL database details');
        };
        try {
          const result = await request(`${family}/${token}/respond`,'POST',{ decision: 'approve' });
          assert.equal(result.status,500); assert.deepEqual(result.body,{ error: 'APPROVAL_UNAVAILABLE' });
        } finally { hook = null; }
        assert.deepEqual(await sideEffects(scope),before);
      }
    });
    await t.test('ordinary legacy GET/approve/decline remain usable with transactional notifications', async () => {
      for (const family of families) for (const decision of ['approve','decline']) {
        const scope = await newScope(), token = await legacyLink(scope);
        const view = await request(`${family}/${token}`); assert.equal(view.status,200); assert.equal(view.cache,'no-store');
        assert.equal(view.body.ro.id,scope.roId); assert.equal(view.body.kind,undefined);
        const accepted = await request(`${family}/${token}/respond`,'POST',{ decision,reason: 'Revise' });
        assert.equal(accepted.status,200); assert.deepEqual(accepted.body,{ ok: true,decision });
        const after = await sideEffects(scope);
        assert.equal(after.repair_orders[0].status,decision === 'approve' ? 'approval' : 'estimate');
        assert.equal(after.ro_comms.length,decision === 'decline' ? 1 : 0);
        assert.equal(after.job_status_log.length,decision === 'approve' ? 1 : 0);
        assert.equal(after.notifications.length,family === families[0] || decision === 'approve' ? 1 : 0);
        assert.equal((await request(`${family}/${token}/respond`,'POST',{ decision,reason: 'Revise' })).status,400);
      }
      assert.deepEqual(effects,[]);
    });
    await t.test('public failures and rate limits are no-store and sanitized on both families', async () => {
      for (const family of families) {
        const token = `pe_${'c'.repeat(64)}`, address = family === families[0] ? '198.51.100.1' : '198.51.100.2';
        const malformed = await fetch(`http://127.0.0.1:${server.address().port}${family}/${token}`, {
          method: 'POST',headers: { 'Content-Type': 'application/json','X-Forwarded-For': '203.0.113.5' },
          body: `{ "token": "${token}", `,
        });
        assert.equal(malformed.status,400); assert.equal(malformed.headers.get('cache-control'),'no-store');
        assert.deepEqual(await malformed.json(),{ error: 'INVALID_INPUT' });
        for (let i=0;i<20;i++) {
          const result = await request(`${family}/${token}`,'GET',undefined,null,shopId,address);
          assert.equal(result.status,404); assert.equal(result.cache,'no-store'); safe(result.body);
        }
        const limited = await request(`${family}/${token}`,'POST',{},null,shopId,address);
        assert.equal(limited.status,429); assert.equal(limited.cache,'no-store');
        assert.ok(!JSON.stringify(limited.body).includes(token));
      }
      assert.equal(/pe_[a-f0-9]{64}/.test(JSON.stringify(queries)),false,'Bearer secret reached SQL');
      assert.equal(/pe_[a-f0-9]{64}|PRIVATE_SENTINEL/.test(JSON.stringify(logs)),false,'Private value reached application logs');
    });
  } finally {
    hook = null;
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [path,old] of cached) { if (old) require.cache[path] = old; else delete require.cache[path]; }
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    t.mock.restoreAll();
    if (raw) await raw.end();
    if (owned) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
