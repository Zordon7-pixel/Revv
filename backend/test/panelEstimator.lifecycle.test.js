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
const { createPanelEstimatorApproval } = require('../src/services/panelEstimatorApproval');

const DATABASE = 'postgresql://revv_panel@127.0.0.1:55459/revv_panel_test';
function databaseConfig(value) {
  assert.equal(value, DATABASE, 'Only the dedicated local disposable PostgreSQL database is allowed');
  return { host: '127.0.0.1', port: 55459, user: 'revv_panel', database: 'revv_panel_test',
    password: async () => '', ssl: false, connectionTimeoutMillis: 3000, statement_timeout: 10000 };
}
const draft = () => ({ assessments: [{ panel_id: 'hood', body_style: 'sedan', severity: 'light',
  damage_type: 'dent', area: 'center', operation: 'repair', refinish: true, body_hours: 2,
  refinish_hours: 1, body_rate_cents: 10000, refinish_rate_cents: 10000, parts_sell_cents: 10000,
  materials_sell_cents: 5000, sublet_sell_cents: 0, reviewed: true,
  taxable: { body: true, refinish: true, parts: true, materials: true, sublet: true } }],
  scenario: { payer: 'cash', provenance: 'shop_prepared' }, adjustments: {} });
const binding = revision => ({ revision_id: revision.revision_id, quote_hash: revision.quote_hash });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('lifecycle fixture refuses ambient, remote and non-dedicated databases', () => {
  for (const value of [undefined, 'postgresql://remote/revv_panel_test', `${DATABASE}?host=remote`,
    DATABASE.replace('55459', '5432'), DATABASE.replace('revv_panel_test', 'revv')])
    assert.throws(() => databaseConfig(value));
});

test('L1 real PostgreSQL and mounted production lifecycle/payment handlers', { timeout: 60000 }, async t => {
  // No skip or fallback: host gates must actually execute these regressions.
  const config = databaseConfig(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL);
  const schema = `panel_lifecycle_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool(config), cached = new Map(), pending = new Set(), providerCalls = [];
  let raw, server, owned = false, hook;
  const previousSecret = process.env.JWT_SECRET;
  const stub = (path, exports) => {
    const resolved = require.resolve(path);
    if (!cached.has(resolved)) cached.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  const fresh = path => {
    const resolved = require.resolve(path);
    if (!cached.has(resolved)) cached.set(resolved, require.cache[resolved]);
    delete require.cache[resolved]; return require(path);
  };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); owned = true;
    raw = new Pool({ ...config, options: `-c search_path=${schema}`, max: 12 });
    await raw.query(`CREATE TABLE shops(id TEXT PRIMARY KEY, tax_rate NUMERIC DEFAULT 0.1, name TEXT,
        email_notifications_enabled BOOLEAN DEFAULT FALSE, quickbooks_sync_enabled BOOLEAN DEFAULT FALSE,
        quickbooks_realm_id TEXT, quickbooks_refresh_token TEXT);
      CREATE TABLE users(id TEXT PRIMARY KEY, shop_id TEXT, role TEXT, name TEXT, customer_id TEXT,
        revoke_all_before TIMESTAMPTZ);
      CREATE TABLE revoked_tokens(id TEXT PRIMARY KEY, token_jti TEXT);
      CREATE TABLE customers(id TEXT PRIMARY KEY, name TEXT, email TEXT, email_consent BOOLEAN,
        preferred_contact_method TEXT);
      CREATE TABLE vehicles(id TEXT PRIMARY KEY, year INTEGER, make TEXT, model TEXT);
      CREATE TABLE repair_orders(id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id),
        customer_id TEXT, vehicle_id TEXT, assigned_to TEXT, ro_number TEXT DEFAULT 'SYNTHETIC',
        parts_cost NUMERIC DEFAULT 0, labor_cost NUMERIC DEFAULT 0, sublet_cost NUMERIC DEFAULT 0,
        tax NUMERIC DEFAULT 0, total NUMERIC DEFAULT 0, estimate_amount NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'estimate', estimate_status TEXT, estimate_approved_at TEXT,
        estimate_approved_by TEXT, estimate_token TEXT, insurance_approved_amount NUMERIC,
        payment_status TEXT DEFAULT 'unpaid', payment_received INTEGER DEFAULT 0,
        payment_received_at TEXT, payment_method TEXT, stripe_payment_intent_id TEXT,
        paid_at TEXT, paid_amount INTEGER, amount_paid_cents INTEGER DEFAULT 0,
        amount_owed_cents INTEGER DEFAULT 0, invoice_emailed_at TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE ro_payments(id TEXT PRIMARY KEY, shop_id TEXT, ro_id TEXT,
        stripe_payment_intent_id TEXT UNIQUE, amount_cents INTEGER NOT NULL, currency TEXT DEFAULT 'usd',
        status TEXT, payment_method TEXT, receipt_email TEXT, paid_at TEXT, failure_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE estimate_line_items(id TEXT PRIMARY KEY, ro_id TEXT NOT NULL, shop_id TEXT NOT NULL,
        type TEXT NOT NULL, description TEXT NOT NULL, quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
        unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        total NUMERIC(10,2) GENERATED ALWAYS AS (quantity*unit_price) STORED,
        taxable BOOLEAN NOT NULL DEFAULT FALSE, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE job_status_log(id TEXT PRIMARY KEY, ro_id TEXT REFERENCES repair_orders(id),
        from_status TEXT, to_status TEXT, changed_by TEXT, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE ro_photos(id TEXT PRIMARY KEY, ro_id TEXT REFERENCES repair_orders(id), url TEXT);
      CREATE TABLE parts_orders(id TEXT PRIMARY KEY, shop_id TEXT, ro_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE portal_tokens(id TEXT PRIMARY KEY, shop_id TEXT, ro_id TEXT, token TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE owner_activity_events(id TEXT PRIMARY KEY, shop_id TEXT, ro_id TEXT, actor_user_id TEXT,
        actor_name TEXT, actor_role TEXT, event_type TEXT, severity TEXT, summary TEXT, before_json JSONB, after_json JSONB);
      CREATE TABLE notifications(id TEXT PRIMARY KEY, shop_id TEXT, user_id TEXT, type TEXT, title TEXT,
        body TEXT, message TEXT, ro_id TEXT, read BOOLEAN)`);
    await ensurePanelEstimator(raw);
    const observed = (client, sql, params) => {
      const task = (async () => {
        if (hook) await hook(sql, params, 'before');
        const result = await client.query(sql, params);
        if (hook) await hook(sql, params, 'after');
        return result;
      })();
      pending.add(task); task.then(() => pending.delete(task), () => pending.delete(task)); return task;
    };
    const pool = { query: (sql, params) => observed(raw, sql, params), connect: async () => {
      const client = await raw.connect();
      return { query: (sql, params) => observed(client, sql, params), release: () => client.release() };
    } };
    const drain = async () => {
      await new Promise(resolve => setImmediate(resolve));
      while (pending.size) { await Promise.allSettled([...pending]); await new Promise(resolve => setImmediate(resolve)); }
    };
    stub('../src/db', { pool, dbGet: async (sql, params) => (await pool.query(sql, params)).rows[0],
      dbAll: async (sql, params) => (await pool.query(sql, params)).rows, dbRun: (sql, params) => pool.query(sql, params) });
    const unexpectedProviders = [];
    const forbidden = async () => { unexpectedProviders.push('unexpected'); assert.fail('Unexpected external provider call'); };
    stub('../src/services/sms', { sendSMS: forbidden, isConfiguredForShop: async () => false });
    stub('../src/services/mailer', { sendMail: forbidden });
    stub('../src/services/email', { sendEmail: forbidden });
    stub('../src/services/quickbooks', { syncInvoiceForRo: forbidden });
    stub('../src/services/customerOptInConfirmation', { sendCustomerOptInConfirmation: forbidden });
    stub('../src/routes/insuranceOcr', { insuranceOcrLimiter: (req, res, next) => next() });
    stub('../src/services/stripe', {
      createPaymentIntent: async (amount, currency, metadata) => {
        const call = { id: `pi_test_${randomUUID()}`, amount, currency, metadata };
        providerCalls.push(call);
        return { ...call, client_secret: 'synthetic-client-secret', status: 'requires_payment_method' };
      },
      constructWebhookEvent: (body, signature) => { assert.equal(signature, 'synthetic-signature'); return body; },
      getStripeClient: () => ({ checkout: { sessions: { create: async body => {
        providerCalls.push({ checkout: body }); return { url: 'https://example.invalid/checkout', expires_at: 2000000000 };
      } } } }),
    });
    // Real financial summaries, billing sibling, auth, role gates and all route SQL.
    fresh('../src/services/customerBilling'); fresh('../src/services/notifications'); fresh('../src/services/ownerActivity');
    process.env.JWT_SECRET = 'synthetic-panel-lifecycle-only';
    fresh('../src/middleware/auth');
    const app = express(); app.use(express.json());
    app.use('/api/ros', fresh('../src/routes/ros'));
    app.use('/api/payments', fresh('../src/routes/payments'));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const shopId = randomUUID(), otherShop = randomUUID(), actorId = randomUUID();
    await raw.query('INSERT INTO shops(id) VALUES ($1),($2)', [shopId, otherShop]);
    await raw.query("INSERT INTO users(id,shop_id,role) VALUES ($1,$2,'owner')", [actorId, shopId]);
    const request = async (path, method = 'GET', body, shop = shopId, role = 'owner') => {
      const headers = { 'Content-Type': 'application/json', 'stripe-signature': 'synthetic-signature' };
      if (role) headers.Authorization = `Bearer ${jwt.sign({ id: actorId, shop_id: shop, role, jti: randomUUID() },
        process.env.JWT_SECRET, { expiresIn: '5m' })}`;
      const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: result.status, body: await result.json() };
    };
    const roPath = scope => `/api/ros/${scope.roId}`;
    const newScope = async (shop = shopId) => {
      const roId = randomUUID(); await raw.query('INSERT INTO repair_orders(id,shop_id) VALUES ($1,$2)', [roId, shop]);
      return { shopId: shop, roId, actorId, role: 'owner' };
    };
    const drafts = createPanelEstimatorDraft(pool), revisions = createPanelEstimatorRevisions(pool);
    const store = createPanelEstimatorStore(pool), approvals = createPanelEstimatorApproval(pool);
    const prepare = async (scope, body = draft()) => {
      const preview = await drafts.preview({ ...scope, body });
      return { ...body, expected_version: preview.version, input_hash: preview.input_hash,
        reviewed: true, idempotency_key: randomUUID() };
    };
    const commit = async (scope, body) => revisions.commit({ ...scope, body: await prepare(scope, body) });
    const approve = async (scope, revision) => {
      const link = await approvals.issue({ ...scope, body: binding(revision) });
      await approvals.respond(link.link.slice('/approve/'.length), { ...binding(revision),
        disclosure_version: 'panel-quote-v1', decision: 'approve', acknowledged: true, actor_name: 'Synthetic Customer' });
    };
    const ro = async scope => (await raw.query('SELECT * FROM repair_orders WHERE id=$1 AND shop_id=$2', [scope.roId, scope.shopId])).rows[0];
    const evidence = async (scope, revisionId) => {
      const result = {};
      for (const table of ['ro_panel_estimator_revisions', 'ro_panel_estimator_revision_costs',
        'ro_panel_estimator_approval_links', 'ro_panel_estimator_approval_events']) {
        result[table] = (await raw.query(`SELECT to_jsonb(t)::text AS bytes FROM ${table} t
          WHERE ro_id=$1 AND shop_id=$2
          ${revisionId ? `AND ${table === 'ro_panel_estimator_revisions' ? 'id' : 'revision_id'}=$3` : ''}
          ORDER BY to_jsonb(t)::text`, [scope.roId, scope.shopId, ...(revisionId ? [revisionId] : [])])).rows;
      }
      return hash(result);
    };
    const state = async scope => {
      const result = { ro: await ro(scope), evidence: await evidence(scope) };
      for (const table of ['job_status_log', 'ro_photos', 'ro_payments', 'estimate_line_items', 'ro_panel_estimator_drafts']) {
        result[table] = (await raw.query(`SELECT to_jsonb(t)::text AS bytes FROM ${table} t WHERE ro_id=$1 ORDER BY to_jsonb(t)::text`, [scope.roId])).rows;
      }
      return hash(result);
    };
    const children = async scope => {
      await raw.query("INSERT INTO job_status_log(id,ro_id,note) VALUES ($1,$2,'Retain history')", [randomUUID(), scope.roId]);
      await raw.query("INSERT INTO ro_photos VALUES ($1,$2,'synthetic-photo')", [randomUUID(), scope.roId]);
      await raw.query("INSERT INTO ro_payments(id,shop_id,ro_id,amount_cents,status) VALUES ($1,$2,$3,100,'paid')", [randomUUID(), scope.shopId, scope.roId]);
    };

    await t.test('DELETE preserves draft and accepted history byte-for-byte, and isolates tenants/auth', async () => {
      for (const accepted of [false, true]) {
        const scope = await newScope(); await children(scope);
        if (accepted) { const revision = await commit(scope); await approve(scope, revision); }
        else await store.saveDraft({ ...scope, ...draft(), expectedVersion: 0 });
        const before = await state(scope);
        assert.equal((await request(roPath(scope), 'DELETE', undefined, otherShop)).status, 404);
        assert.equal((await request(roPath(scope), 'DELETE', undefined, shopId, null)).status, 401);
        assert.equal((await request(roPath(scope), 'DELETE')).status, 409);
        assert.equal(await state(scope), before);
      }
    });

    await t.test('legacy DELETE succeeds with optional tables absent; late parent failure rolls back every child', async () => {
      const scope = await newScope(), foreign = await newScope(otherShop);
      await children(scope); await children(foreign);
      const foreignBefore = await state(foreign);
      assert.equal((await request(roPath(scope), 'DELETE')).status, 200);
      assert.equal(await ro(scope), undefined);
      for (const table of ['job_status_log', 'ro_payments', 'ro_photos'])
        assert.equal((await raw.query(`SELECT 1 FROM ${table} WHERE ro_id=$1`, [scope.roId])).rowCount, 0);
      assert.equal(await state(foreign), foreignBefore);
      const blocked = await newScope(); await children(blocked); const before = await state(blocked);
      await raw.query(`CREATE FUNCTION reject_late_delete() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'TEST_LATE_DELETE'; END $$;
        CREATE TRIGGER z_late_delete BEFORE DELETE ON repair_orders FOR EACH ROW EXECUTE FUNCTION reject_late_delete()`);
      try {
        assert.equal((await request(roPath(blocked), 'DELETE')).status, 500);
        assert.equal(await state(blocked), before);
      } finally { await raw.query('DROP TRIGGER z_late_delete ON repair_orders'); }
    });

    await t.test('DELETE and first draft serialize under the parent lock in both orders', async () => {
      for (const deleteFirst of [true, false]) {
        const scope = await newScope(); await children(scope);
        const locked = deferred(), release = deferred(), waiting = deferred(); let held = false;
        hook = async (sql, params, phase) => {
          if (!/SELECT id FROM repair_orders.*FOR UPDATE/s.test(sql) || !params.includes(scope.roId)) return;
          if (phase === 'after' && !held) { held = true; locked.resolve(); await release.promise; }
          else if (phase === 'before' && held) waiting.resolve();
        };
        const save = () => store.saveDraft({ ...scope, ...draft(), expectedVersion: 0 });
        const deletion = () => request(roPath(scope), 'DELETE');
        const first = deleteFirst ? deletion() : save();
        await locked.promise;
        const second = deleteFirst ? save() : deletion();
        // Attach handlers before release so an expected rejection is never unhandled.
        const outcomes = Promise.allSettled([first, second]);
        try { await waiting.promise; } finally { hook = null; release.resolve(); }
        const [a, b] = await outcomes;
        if (deleteFirst) {
          assert.equal(a.value.status, 200); assert.equal(b.status, 'rejected'); assert.equal(b.reason.code, 'NOT_FOUND');
          assert.equal(await ro(scope), undefined);
        } else {
          assert.equal(a.status, 'fulfilled'); assert.equal(b.value.status, 409);
          assert.equal((await raw.query('SELECT 1 FROM ro_photos WHERE ro_id=$1', [scope.roId])).rowCount, 1);
        }
      }
    });

    await t.test('authorized status updates before/after customer approval preserve quote and approval bytes', async () => {
      const scope = await newScope(), revision = await commit(scope);
      let before = await evidence(scope);
      assert.equal((await request(`${roPath(scope)}/status`, 'PUT', { status: 'parts' })).status, 200);
      assert.equal(await evidence(scope), before);
      await approve(scope, revision); before = await evidence(scope);
      assert.equal((await ro(scope)).status, 'parts');
      assert.equal((await ro(scope)).payment_status, 'unpaid');
      assert.equal((await ro(scope)).estimate_approved_at, null);
      assert.equal((await ro(scope)).insurance_approved_amount, null);
      assert.equal((await request(`${roPath(scope)}/status`, 'PUT', { status: 'paint' })).status, 200);
      assert.equal((await request(roPath(scope), 'PATCH', { status: 'qc' })).status, 200);
      assert.equal((await request(`${roPath(scope)}/status`, 'PUT', { status: 'closed' })).status, 400);
      assert.equal((await request(`${roPath(scope)}/status`, 'PUT', { status: 'paint' }, otherShop)).status, 404);
      for (const assignment of ["total=1", "amount_owed_cents=1", "estimate_status='approved'",
        "estimate_approved_at='now'", "estimate_approved_by='bypass'", "estimate_token='bypass'", "insurance_approved_amount=1"]) {
        await assert.rejects(raw.query(`UPDATE repair_orders SET ${assignment} WHERE id=$1 AND shop_id=$2`,
          [scope.roId, shopId]), error => error.code === 'P0001');
      }
      assert.equal(await evidence(scope), before);
      assert.equal((await ro(scope)).status, 'qc');
      await drain();
    });

    await t.test('positive selected total synchronizes owed0; actual mark-paid preserves accepted evidence', async () => {
      const scope = await newScope(); assert.equal((await ro(scope)).amount_owed_cents, 0);
      const revision = await commit(scope); await approve(scope, revision);
      const before = await evidence(scope), total = revision.quote.totals.total_cents;
      assert.ok(total > 0); assert.equal((await ro(scope)).amount_owed_cents, total);
      const result = await request(`${roPath(scope)}/mark-paid`, 'POST', { payment_method: 'cash' });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const paid = await ro(scope);
      assert.equal(paid.amount_paid_cents, total); assert.equal(paid.amount_owed_cents, total);
      assert.equal(paid.payment_status, 'paid'); assert.equal(paid.payment_received, 1);
      assert.equal(paid.status, 'estimate'); assert.equal(await evidence(scope), before);
      await drain();
    });

    await t.test('mounted intent/alias/webhook and checkout sibling use authoritative selected money', async () => {
      const scope = await newScope(), revision = await commit(scope); await approve(scope, revision);
      const before = await evidence(scope), total = revision.quote.totals.total_cents;
      assert.equal((await request('/api/payments/intent', 'POST', { ro_id: scope.roId }, otherShop)).status, 404);
      // Partial then remaining payment, with webhook replay and no provider network calls.
      for (const [index, amount] of [1000, total - 1000].entries()) {
        const result = await request(index ? '/api/payments/create-intent' : '/api/payments/intent', 'POST',
          { [index ? 'roId' : 'ro_id']: scope.roId, amount, allow_partial: true });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.amountOwedCents, total); assert.equal(result.body.clientSecret, 'synthetic-client-secret');
        const intent = providerCalls.find(call => call.id === result.body.paymentIntentId);
        assert.equal(intent.metadata.amountOwedCents, String(total));
        const event = { type: 'payment_intent.succeeded', data: { object: { ...intent, amount_received: amount } } };
        for (let replay = 0; replay < 2; replay++) {
          const webhook = await request('/api/payments/webhook', 'POST', event, shopId, null);
          assert.equal(webhook.status, 200, JSON.stringify(webhook.body));
        }
        const paid = await ro(scope);
        assert.equal(paid.amount_owed_cents, total);
        assert.equal(paid.amount_paid_cents, index ? total : 1000);
        assert.equal(paid.payment_status, index ? 'paid' : 'partial');
        assert.equal(await evidence(scope), before);
        await drain();
      }
      assert.equal((await raw.query('SELECT 1 FROM ro_payments WHERE ro_id=$1', [scope.roId])).rowCount, 2);
      // A success webhook may arrive without an intent row (checkout sibling).
      const webhookOnly = await newScope(), webhookQuote = await commit(webhookOnly);
      await approve(webhookOnly, webhookQuote);
      const webhookBefore = await evidence(webhookOnly), webhookTotal = webhookQuote.quote.totals.total_cents;
      const received = await request('/api/payments/webhook', 'POST', { type: 'payment_intent.succeeded',
        data: { object: { id: `pi_test_${randomUUID()}`, amount_received: webhookTotal, currency: 'usd',
          metadata: { roId: webhookOnly.roId, shopId } } } }, shopId, null);
      assert.equal(received.status, 200, JSON.stringify(received.body));
      assert.equal((await ro(webhookOnly)).amount_paid_cents, webhookTotal);
      assert.equal((await ro(webhookOnly)).amount_owed_cents, webhookTotal);
      assert.equal(await evidence(webhookOnly), webhookBefore);
      await drain();
      const sibling = await newScope(), selected = await commit(sibling);
      const linked = await request(`/api/payments/link/${sibling.roId}`, 'POST', {});
      assert.equal(linked.status, 200, JSON.stringify(linked.body));
      assert.equal(linked.body.amountCents, selected.quote.totals.total_cents);
      assert.equal(providerCalls.at(-1).checkout.line_items[0].price_data.unit_amount, selected.quote.totals.total_cents);
    });

    await t.test('summary readers observe old or new committed selection; stale owed overwrite remains rejected', async () => {
      const scope = await newScope(), first = await commit(scope); await approve(scope, first);
      const before = await evidence(scope), oldTotal = first.quote.totals.total_cents;
      const changed = draft(); changed.assessments[0].body_rate_cents = 11000;
      const body = await prepare(scope, changed), reached = deferred(), resume = deferred();
      hook = async (sql, params, phase) => {
        if (sql === 'COMMIT' && phase === 'before') { hook = null; reached.resolve(); await resume.promise; }
      };
      const committing = revisions.commit({ ...scope, body });
      await reached.promise;
      const { getRoMoneySummary } = require('../src/services/roMoney');
      try {
        assert.equal((await getRoMoneySummary(scope.roId, shopId)).totalCents, oldTotal);
        assert.equal((await ro(scope)).amount_owed_cents, oldTotal);
        assert.equal(await evidence(scope), before);
      } finally { resume.resolve(); }
      const next = await committing;
      assert.equal((await getRoMoneySummary(scope.roId, shopId)).totalCents, next.quote.totals.total_cents);
      assert.equal((await ro(scope)).amount_owed_cents, next.quote.totals.total_cents);
      await assert.rejects(raw.query('UPDATE repair_orders SET amount_owed_cents=$1 WHERE id=$2 AND shop_id=$3',
        [oldTotal, scope.roId, shopId]), error => error.code === 'P0001');
      assert.deepEqual(await revisions.getQuote({ ...scope, revisionId: first.revision_id }), first);
      assert.equal(await evidence(scope, first.revision_id), before);
    });
    await drain();
    assert.deepEqual(unexpectedProviders, []);
  } finally {
    hook = null;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await Promise.allSettled([...pending]);
    if (raw) await raw.end();
    if (owned) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    for (const [path, old] of cached) { if (old) require.cache[path] = old; else delete require.cache[path]; }
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});
