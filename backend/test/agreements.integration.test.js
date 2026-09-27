const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PDFDocument } = require('pdf-lib');
const { schemaSql, hash, CONSENT_VERSION } = require('../src/services/agreements');

const connectionString = process.env.AGREEMENTS_TEST_DATABASE_URL;
test('agreement lifecycle against disposable PostgreSQL', { skip: !connectionString }, async (t) => {
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/revv_esign_test', 'Only the dedicated local test database is permitted');
  const root = new Pool({ connectionString, ssl: false });
  const schema = `esign_${randomUUID().replaceAll('-', '')}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  const database = new Pool({ connectionString, ssl: false, options: `-c search_path=${schema}` });
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await database.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  });
  await database.query(`
    CREATE TABLE shops(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE customers(id TEXT PRIMARY KEY,shop_id TEXT,name TEXT,email TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY,revoke_all_before TIMESTAMPTZ);
    CREATE TABLE revoked_tokens(id TEXT,token_jti TEXT);
    CREATE TABLE repair_orders(id TEXT PRIMARY KEY,shop_id TEXT,customer_id TEXT,ro_number TEXT);
    INSERT INTO shops VALUES ('shop-a','Example Collision'),('shop-b','Other Shop');
    INSERT INTO customers VALUES ('customer-a','shop-a','José Rivera','jose@example.test');
  `);
  await database.query(schemaSql); await database.query(schemaSql); // idempotent schema
  process.env.JWT_SECRET = 'agreements-disposable-test-only';
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    pool: database, dbGet: async (sql, params) => (await database.query(sql, params)).rows[0],
  } };
  const { createAgreementsRouter } = require('../src/routes/agreements');
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api/agreements', createAgreementsRouter(database));
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/agreements`;
  const admin = jwt.sign({ id: 'admin-a', shop_id: 'shop-a', role: 'admin' }, process.env.JWT_SECRET);
  const other = jwt.sign({ id: 'admin-b', shop_id: 'shop-b', role: 'admin' }, process.env.JWT_SECRET);
  const staff = jwt.sign({ id: 'staff-a', shop_id: 'shop-a', role: 'employee' }, process.env.JWT_SECRET);
  const customer = jwt.sign({ id: 'customer-a', shop_id: 'shop-a', role: 'customer' }, process.env.JWT_SECRET);
  async function api(path, { method = 'GET', body, token = admin } = {}) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { method, headers,
      body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, headers: response.headers };
  }
  const pdf = await PDFDocument.create();
  pdf.addPage([612,792]).drawText('SYNTHETIC QA AGREEMENT - NOT A CUSTOMER CONTRACT', { x: 40, y: 730, size: 12 });
  const original = Buffer.from(await pdf.save());
  async function upload({ countersign = false, sections = [], token = admin, content = original } = {}) {
    const body = new FormData(); body.append('title', 'Shop liability agreement');
    body.append('agreement', new Blob([content], { type: 'application/pdf' }), 'agreement.pdf');
    body.append('requires_shop_signature', String(countersign)); body.append('initial_sections', JSON.stringify(sections));
    return api('/templates', { method: 'POST', body, token });
  }
  async function create(templateId, token = admin) {
    const roId = randomUUID();
    await database.query('INSERT INTO repair_orders VALUES ($1,$2,$3,$4)', [roId, 'shop-a', 'customer-a', 'RO-QA-1']);
    const result = await api(`/ro/${roId}`, { method: 'POST', token, body: { template_id: templateId } });
    return { ...result, roId, token: result.data.signing_path?.split('#')[1] };
  }
  async function sign(request, overrides = {}) {
    return api('/public/session/sign', { method: 'POST', token: request.token, body: {
      name: 'José Rivera', consent: true, consent_version: CONSENT_VERSION, document_sha256: hash(original), initials: {}, ...overrides,
    } });
  }
  let templateId;
  await t.test('authenticated managers upload static PDFs and sensitive endpoints are private', async () => {
    assert.equal((await api('/templates', { token: null })).status, 401);
    assert.equal((await api('/templates', { token: customer })).status, 403);
    assert.equal((await upload({ token: staff })).status, 403);
    const uploaded = await upload(); assert.equal(uploaded.status, 201); templateId = uploaded.data.id;
    assert.equal((await api('/templates', { token: other })).data.templates.length, 0);
    assert.equal((await api(`/templates/${templateId}/document`, { token: other })).status, 404);
    assert.equal((await upload({ content: Buffer.from('not a pdf') })).status, 400);
  });
  await t.test('request binds to one shop/RO and stores only a hash of its secret', async () => {
    const request = await create(templateId, staff); assert.equal(request.status, 201);
    assert.match(request.data.signing_path, /^\/sign#[a-f0-9]{64}$/);
    const row = (await database.query('SELECT * FROM agreement_requests WHERE id=$1', [request.data.id])).rows[0];
    assert.notEqual(row.token_hash, request.token); assert.equal(row.token_hash, hash(request.token));
    assert.equal((await api(`/ro/${request.roId}`, { token: other })).data.agreements.length, 0);
    assert.equal((await api(`/ro/${request.roId}`, { method: 'POST', token: other, body: { template_id: templateId } })).status, 404);
    assert.equal((await api(`/ro/${request.roId}`, { method: 'POST', body: { template_id: templateId } })).status, 409);
    for (const suffix of ['document', 'signed', 'audit']) assert.equal((await api(`/${request.data.id}/${suffix}`, { token: other })).status, 404);
    assert.equal((await api(`/${request.data.id}/link`, { method: 'POST', token: other })).status, 404);
    const publicData = await api('/public/session', { token: request.token });
    assert.equal(publicData.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.stringify(publicData.data).includes('token_hash'), false);
  });
  await t.test('review, explicit consent, matching document and required initials gate signing', async () => {
    const template = await upload({ sections: ['Page 1 - Storage fees'] });
    const request = await create(template.data.id);
    assert.equal((await sign(request)).status, 409);
    assert.equal((await api('/public/session/document', { token: request.token })).status, 200);
    assert.equal((await sign(request, { consent: false })).status, 400);
    assert.equal((await sign(request, { document_sha256: 'wrong' })).status, 409);
    assert.equal((await sign(request)).status, 400);
    assert.equal((await sign(request, { initials: { 'Page 1 - Storage fees': 'JR' } })).status, 200);
    const signed = await api('/public/session/signed', { token: request.token });
    assert.equal(signed.status, 200);
    const finalPdf = await PDFDocument.load(signed.data); assert.ok(finalPdf.getPageCount() >= 2);
    const row = (await database.query('SELECT * FROM agreement_requests WHERE id=$1', [request.data.id])).rows[0];
    assert.equal(row.signed_sha256, hash(signed.data)); assert.equal(row.customer_signature.name, 'José Rivera');
    assert.equal(row.customer_signature.initials['Page 1 - Storage fees'], 'JR');
    const source = await api(`/${request.data.id}/document`); assert.deepEqual(source.data, original);
    const audit = await api(`/${request.data.id}/audit`);
    assert.deepEqual(audit.data.events.map((e) => e.event_type).sort(), ['created','customer_signed','document_opened']);
    if (process.env.AGREEMENTS_QA_OUTPUT) require('node:fs').writeFileSync(process.env.AGREEMENTS_QA_OUTPUT, signed.data);
  });
  await t.test('concurrent and repeated submissions produce one immutable signature', async () => {
    const request = await create(templateId); await api('/public/session/document', { token: request.token });
    const results = await Promise.all([sign(request), sign(request, { name: 'Different Name' })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200,409]);
    const first = await api(`/${request.data.id}/signed`);
    assert.equal((await sign(request)).status, 409);
    assert.equal((await api(`/${request.data.id}/void`, { method: 'POST' })).status, 409);
    assert.deepEqual((await api(`/${request.data.id}/signed`)).data, first.data);
    assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM agreement_events WHERE request_id=$1 AND event_type='customer_signed'", [request.data.id])).rows[0].count, 1);
  });
  await t.test('optional shop countersignature gates the final PDF and is manager-only', async () => {
    const template = await upload({ countersign: true }); const request = await create(template.data.id);
    await api('/public/session/document', { token: request.token });
    const signed = await sign(request); assert.equal(signed.data.agreement.status, 'awaiting_shop');
    assert.equal((await api(`/${request.data.id}/signed`)).status, 409);
    const body = { name: 'Ana López', consent: true, consent_version: CONSENT_VERSION, document_sha256: hash(original) };
    assert.equal((await api(`/${request.data.id}/countersign`, { method: 'POST', token: staff, body })).status, 403);
    assert.equal((await api(`/${request.data.id}/countersign`, { method: 'POST', token: other, body })).status, 404);
    const completed = await api(`/${request.data.id}/countersign`, { method: 'POST', body });
    assert.equal(completed.status, 200); assert.equal(completed.data.agreement.status, 'signed');
    assert.equal((await api(`/${request.data.id}/countersign`, { method: 'POST', body })).status, 409);
    assert.equal((await api('/public/session/signed', { token: request.token })).status, 200);
  });
  await t.test('replacing a link revokes the old link and expiry blocks signing', async () => {
    const request = await create(templateId); const replacement = await api(`/${request.data.id}/link`, { method: 'POST' });
    assert.equal((await api('/public/session', { token: request.token })).status, 404);
    request.token = replacement.data.signing_path.split('#')[1];
    assert.equal((await api('/public/session', { token: request.token })).status, 200);
    await database.query("UPDATE agreement_requests SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1", [request.data.id]);
    assert.equal((await api('/public/session/document', { token: request.token })).status, 410);
    assert.equal((await sign(request)).status, 410);
  });
  await t.test('voiding requests invalidates signing; archived templates preserve existing originals', async () => {
    const request = await create(templateId);
    assert.equal((await api(`/${request.data.id}/void`, { method: 'POST' })).status, 200);
    assert.equal((await api('/public/session', { token: request.token })).status, 410);
    assert.equal((await api(`/templates/${templateId}/archive`, { method: 'POST' })).status, 200);
    assert.equal((await create(templateId)).status, 400);
    assert.deepEqual((await api(`/${request.data.id}/document`)).data, original);
  });
  await t.test('retained agreements remain discoverable after their RO is removed', async () => {
    const template = await upload(); const request = await create(template.data.id);
    await api('/public/session/document', { token: request.token }); await sign(request);
    await database.query('DELETE FROM repair_orders WHERE id=$1', [request.roId]);
    const archive = await api('/archive?q=RO-QA-1');
    assert.equal(archive.status, 200);
    assert.ok(archive.data.agreements.some((item) => item.id === request.data.id));
    assert.equal((await api('/archive', { token: staff })).status, 403);
    assert.equal((await api('/archive', { token: other })).data.agreements.length, 0);
    assert.equal((await api(`/${request.data.id}/signed`)).status, 200);
    assert.equal((await api(`/ro/${request.roId}`)).data.agreements[0].id, request.data.id);
  });
  await t.test('template corruption is detected before signing or original download', async () => {
    const template = await upload(); const request = await create(template.data.id);
    await api('/public/session/document', { token: request.token });
    await database.query('UPDATE agreement_templates SET original_pdf=$2 WHERE id=$1', [template.data.id, Buffer.from('corrupted')]);
    assert.equal((await sign(request)).status, 409);
    assert.equal((await api(`/${request.data.id}/document`)).status, 409);
  });
});
