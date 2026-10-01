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
  const app = express(); app.set('trust proxy', 1); app.use(express.json({ limit: '1mb' })); app.use('/api/agreements', createAgreementsRouter(database));
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/agreements`;
  const admin = jwt.sign({ id: 'admin-a', shop_id: 'shop-a', role: 'admin' }, process.env.JWT_SECRET);
  const other = jwt.sign({ id: 'admin-b', shop_id: 'shop-b', role: 'admin' }, process.env.JWT_SECRET);
  const staff = jwt.sign({ id: 'staff-a', shop_id: 'shop-a', role: 'employee' }, process.env.JWT_SECRET);
  const technician = jwt.sign({ id: 'tech-a', shop_id: 'shop-a', role: 'technician' }, process.env.JWT_SECRET);
  const customer = jwt.sign({ id: 'customer-a', shop_id: 'shop-a', role: 'customer' }, process.env.JWT_SECRET);
  let clientNumber = 1;
  const isolateClient = () => { clientNumber++; };
  async function api(path, { method = 'GET', body, token = admin } = {}) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    // Separate synthetic clients keep the real per-IP limiter enabled throughout the lifecycle.
    headers['X-Forwarded-For'] = `192.0.2.${clientNumber}`;
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { method, headers,
      body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, headers: response.headers };
  }
  async function writeState() {
    const counts = (await database.query(`SELECT
      (SELECT COUNT(*)::int FROM agreement_requests) AS requests,
      (SELECT COUNT(*)::int FROM agreement_events) AS events,
      (SELECT COUNT(token_hash)::int FROM agreement_requests) AS tokens`)).rows[0];
    const requests = (await database.query('SELECT id,status,token_hash,document_sha256,customer_signature,shop_signature FROM agreement_requests ORDER BY id')).rows;
    return { counts, requests };
  }
  async function noWrite(path, options, status, message) {
    const before = await writeState();
    const result = await api(path, options);
    assert.equal(result.status, status, `${path}: ${JSON.stringify(result.data?.error)}`);
    if (message) assert.match(result.data.error, message);
    assert.deepEqual(await writeState(), before, `${path} must leave requests, events and tokens unchanged`);
    return result;
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
    await database.query('INSERT INTO repair_orders(id,shop_id,customer_id,ro_number) VALUES ($1,$2,$3,$4)', [roId, 'shop-a', 'customer-a', 'RO-QA-1']);
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
    isolateClient();
    assert.equal((await api('/templates', { token: null })).status, 401);
    assert.equal((await api('/templates', { token: customer })).status, 403);
    assert.equal((await upload({ token: staff })).status, 403);
    const uploaded = await upload(); assert.equal(uploaded.status, 201); templateId = uploaded.data.id;
    assert.equal((await api('/templates', { token: other })).data.templates.length, 0);
    assert.equal((await api(`/templates/${templateId}/document`, { token: other })).status, 404);
    assert.equal((await upload({ content: Buffer.from('not a pdf') })).status, 400);
  });
  await t.test('request binds to one shop/RO and stores only a hash of its secret', async () => {
    isolateClient();
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
    isolateClient();
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
  await t.test('static uploads accept omitted or current revisions, but never ignore supplied invalid revisions', async () => {
    isolateClient();
    const roId = randomUUID();
    await database.query('INSERT INTO repair_orders(id,shop_id,customer_id,ro_number) VALUES ($1,$2,$3,$4)', [roId, 'shop-a', 'customer-a', 'STATIC-QA']);
    const context = (await api(`/ro/${roId}/preparation`)).data;
    for (const revision of [null, '', ' ', 'malformed', 42, {}, [], 'f'.repeat(64)]) {
      await noWrite(`/ro/${roId}`, { method: 'POST', body: { template_id: templateId, source_revision: revision } }, 409, /Reload RO details/);
    }
    const fresh = (await api(`/ro/${roId}/preparation`)).data;
    assert.equal(fresh.revision, context.revision);
    assert.equal((await api(`/ro/${roId}`, { method: 'POST', body: { template_id: templateId, source_revision: fresh.revision } })).status, 201);
    const manual = await create(templateId);
    assert.equal(manual.status, 201);
    const row = (await database.query('SELECT * FROM agreement_requests WHERE id=$1', [manual.data.id])).rows[0];
    assert.equal(row.prepared_pdf, null); assert.equal(row.preparation_details, null);
    assert.deepEqual((await api(`/${manual.data.id}/document`)).data, original);
  });
  await t.test('concurrent and repeated submissions produce one immutable signature', async () => {
    isolateClient();
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
    isolateClient();
    const template = await upload({ countersign: true }); const request = await create(template.data.id);
    await api('/public/session/document', { token: request.token });
    const signed = await sign(request); assert.equal(signed.data.agreement.status, 'awaiting_shop');
    const frozen = (await database.query('SELECT * FROM agreement_requests WHERE id=$1', [request.data.id])).rows[0];
    await noWrite(`/${request.data.id}/void`, { method: 'POST' }, 409, /Only a pending agreement/);
    await noWrite(`/ro/${request.roId}`, { method: 'POST', body: { template_id: template.data.id } }, 409, /Only pending requests can be voided/);
    await noWrite('/public/session/sign', { method: 'POST', token: request.token, body: {} }, 409, /already been signed/);
    assert.deepEqual((await database.query('SELECT * FROM agreement_requests WHERE id=$1', [request.data.id])).rows[0], frozen);
    assert.deepEqual((await api(`/${request.data.id}/document`)).data, original);
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
    isolateClient();
    const request = await create(templateId); const replacement = await api(`/${request.data.id}/link`, { method: 'POST' });
    assert.equal((await api('/public/session', { token: request.token })).status, 404);
    request.token = replacement.data.signing_path.split('#')[1];
    assert.equal((await api('/public/session', { token: request.token })).status, 200);
    await database.query("UPDATE agreement_requests SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1", [request.data.id]);
    assert.equal((await api('/public/session/document', { token: request.token })).status, 410);
    assert.equal((await sign(request)).status, 410);
  });
  await t.test('voiding requests invalidates signing; archived templates preserve existing originals', async () => {
    isolateClient();
    const request = await create(templateId);
    for (const token of [staff, technician]) {
      await noWrite(`/${request.data.id}/void`, { method: 'POST', token }, 403, /Owner or admin/);
    }
    await noWrite(`/${request.data.id}/void`, { method: 'POST', token: other }, 409);
    assert.equal((await api(`/${request.data.id}/void`, { method: 'POST' })).status, 200);
    const audit = await api(`/${request.data.id}/audit`);
    assert.equal(audit.data.events.filter((event) => event.event_type === 'voided').length, 1);
    assert.equal((await api('/public/session', { token: request.token })).status, 410);
    assert.equal((await api(`/templates/${templateId}/archive`, { method: 'POST' })).status, 200);
    assert.equal((await create(templateId)).status, 400);
    assert.deepEqual((await api(`/${request.data.id}/document`)).data, original);
  });
  await t.test('retained agreements remain discoverable after their RO is removed', async () => {
    isolateClient();
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
    isolateClient();
    const template = await upload(); const request = await create(template.data.id);
    await api('/public/session/document', { token: request.token });
    await database.query('UPDATE agreement_templates SET original_pdf=$2 WHERE id=$1', [template.data.id, Buffer.from('corrupted')]);
    assert.equal((await sign(request)).status, 409);
    assert.equal((await api(`/${request.data.id}/document`)).status, 409);
  });
  await t.test('Miles profiles are tenant restricted, require details, and freeze staged documents', async () => {
    isolateClient();
    const { MILES_SHOP_ID, profiles } = require('../src/services/milesAgreements');
    const priorHash = profiles.miles_cash_v1.hash;
    profiles.miles_cash_v1.hash = hash(original); // synthetic source only, isolated test process
    try {
      await database.query(`ALTER TABLE customers ADD COLUMN phone TEXT;
        ALTER TABLE repair_orders ADD COLUMN vehicle_id TEXT;
        ALTER TABLE repair_orders ADD COLUMN claim_number TEXT;
        CREATE TABLE vehicles(id TEXT,shop_id TEXT,year INTEGER,make TEXT,model TEXT,vin TEXT);`);
      await database.query('INSERT INTO shops VALUES ($1,$2)', [MILES_SHOP_ID, 'Miles Automotive']);
      await database.query('INSERT INTO customers(id,shop_id,name,email) VALUES ($1,$2,$3,$4)', ['miles-customer',MILES_SHOP_ID,'José Rivera','qa@example.test']);
      await database.query('INSERT INTO vehicles VALUES ($1,$2,2024,$3,$4,$5)', ['miles-vehicle',MILES_SHOP_ID,'Toyota','Camry','1HGBH41JXMN109186']);
      await database.query('INSERT INTO repair_orders(id,shop_id,customer_id,ro_number,vehicle_id) VALUES ($1,$2,$3,$4,$5)', ['miles-ro',MILES_SHOP_ID,'miles-customer','QA-RO','miles-vehicle']);
      const miles = jwt.sign({ id:'miles-owner',shop_id:MILES_SHOP_ID,role:'owner' }, process.env.JWT_SECRET);
      const uploaded = await upload({ token:miles });
      const staged = { intake:{pdf:original.toString('base64'),sha256:hash(original)},completion:{pdf:original.toString('base64'),sha256:hash(original)} };
      await database.query('UPDATE agreement_templates SET preparation_kind=$2,stage_documents=$3::jsonb WHERE id=$1', [uploaded.data.id,'miles_cash_v1',JSON.stringify(staged)]);
      assert.equal((await api('/templates',{token:miles})).data.templates.length,1);
      assert.equal((await api('/templates',{token:other})).data.templates.some(x=>x.id===uploaded.data.id),false);
      assert.equal((await api(`/templates/${uploaded.data.id}/document`,{token:other})).status,404);
      await database.query(`ALTER TABLE repair_orders ADD COLUMN total NUMERIC; ALTER TABLE repair_orders ADD COLUMN deductible NUMERIC; ALTER TABLE repair_orders ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
        UPDATE repair_orders SET total=4250.50,deductible=500 WHERE id='miles-ro';`);
      assert.equal((await api('/ro/miles-ro/preparation',{token:other})).status,404);
      assert.equal((await api('/ro/miles-ro/preparation',{token:null})).status,401);
      const context=(await api('/ro/miles-ro/preparation',{token:miles})).data;
      assert.equal(context.defaults.amount,'4250.50');assert.equal(context.defaults.deductible,'500.00');
      assert.equal(context.identity.name,'José Rivera');assert.equal(context.identity.vin,'1HGBH41JXMN109186');
      const previewBody={template_id:uploaded.data.id,source_revision:context.revision,preparation:{stage:'intake',...context.defaults,reviewed:true}};
      const preview = await noWrite('/ro/miles-ro/preview', { method:'POST', token:miles, body:previewBody }, 200);
      assert.equal((await PDFDocument.load(preview.data)).getPageCount(), 2);
      // Both endpoints reject every bad revision before any request, audit event or token write.
      for (const revision of [undefined, null, '', ' ', 'malformed', 123, {}, [], 'a'.repeat(63), 'g'.repeat(64)]) {
        isolateClient();
        for (const endpoint of ['/ro/miles-ro/preview', '/ro/miles-ro']) {
          await noWrite(endpoint, { method:'POST', token:miles, body:{...previewBody, source_revision:revision} }, 409, /Reload RO details/);
        }
      }
      isolateClient();
      for (const endpoint of ['/ro/miles-ro/preview', '/ro/miles-ro']) {
        await noWrite(endpoint, { method:'POST', token:other, body:previewBody }, 404);
      }
      await database.query("UPDATE repair_orders SET total=4300 WHERE id='miles-ro'");
      for (const endpoint of ['/ro/miles-ro/preview', '/ro/miles-ro']) {
        await noWrite(endpoint, { method:'POST', token:miles, body:previewBody }, 409, /Reload RO details/);
      }
      const body = { template_id:uploaded.data.id, preparation:{stage:'intake', estimate:'QA-v1', amount:'1234.56', reviewed:true} };
      // Every positive case and non-revision rejection obtains a fresh context. A stale
      // revision must not accidentally satisfy an unrelated expected 409 assertion.
      async function reviewedBody(input = body) {
        const fresh = await api('/ro/miles-ro/preparation', { token:miles });
        assert.equal(fresh.status, 200);
        return {...input, source_revision:fresh.data.revision};
      }
      const createMiles = async (input = body) => api('/ro/miles-ro', { method:'POST', token:miles, body:await reviewedBody(input) });
      await noWrite('/ro/miles-ro', { method:'POST', token:miles, body:await reviewedBody({...body, preparation:{...body.preparation, reviewed:false}}) }, 400, /Review the authorization/);
      const completion = {...body, preparation:{stage:'completion', invoice:'QA-invoice', repairs_complete:true, reviewed:true}};
      for (const endpoint of ['/ro/miles-ro/preview', '/ro/miles-ro']) {
        await noWrite(endpoint, { method:'POST', token:miles, body:await reviewedBody(completion) }, 409, /intake/i);
      }
      for (const email of ['invalid', 'x'.repeat(250) + '@example.test']) {
        for (const endpoint of ['/ro/miles-ro/preview', '/ro/miles-ro']) {
          await noWrite(endpoint, { method:'POST', token:miles, body:await reviewedBody({...body, recipient_email:email}) }, 400, /valid customer email/);
        }
      }
      // A saved email must not become valid merely because autofill truncates it.
      await database.query('UPDATE customers SET email=$1 WHERE id=$2', ['x'.repeat(240) + '@example.test-extra', 'miles-customer']);
      for (const endpoint of ['/ro/miles-ro/preview', '/ro/miles-ro']) {
        await noWrite(endpoint, { method:'POST', token:miles, body:await reviewedBody() }, 400, /valid customer email/);
      }
      isolateClient();
      const validEmailBody = {...body, recipient_email:'  reviewed@example.test  '};
      const validEmailPreview = await noWrite('/ro/miles-ro/preview', { method:'POST', token:miles, body:await reviewedBody(validEmailBody) }, 200);
      assert.equal((await PDFDocument.load(validEmailPreview.data)).getPageCount(), 2);
      const validEmailRequest = await createMiles(validEmailBody); assert.equal(validEmailRequest.status, 201);
      const emailRow = (await database.query('SELECT recipient_email,preparation_details FROM agreement_requests WHERE id=$1', [validEmailRequest.data.id])).rows[0];
      assert.equal(emailRow.recipient_email, 'reviewed@example.test'); assert.equal(emailRow.preparation_details.email, 'reviewed@example.test');
      assert.equal((await api(`/${validEmailRequest.data.id}/void`, { method:'POST', token:miles })).status, 200);
      // Absent email remains blank in the frozen details and renders as Not provided.
      await database.query("UPDATE customers SET email=NULL WHERE id='miles-customer'");
      const pdfText = require('pdf-parse/lib/pdf-parse');
      const absentEmail = await noWrite('/ro/miles-ro/preview', { method:'POST', token:miles, body:await reviewedBody({...body, recipient_email:null}) }, 200);
      const absentText = (await pdfText(absentEmail.data)).text;
      assert.match(absentText, /Not provided/); assert.doesNotMatch(absentText, /\bnull\b/);

      // Run the signed intake/completion lifecycle for both legacy blank and real claims.
      for (const claim of ['', 'CLAIM-A']) {
        isolateClient();
        await database.query('UPDATE repair_orders SET claim_number=$1 WHERE id=$2', [claim, 'miles-ro']);
        const intake = await createMiles(); assert.equal(intake.status, 201);
        await noWrite('/ro/miles-ro', { method:'POST', token:miles, body:await reviewedBody() }, 409, /Only pending requests/);
        const link = intake.data.signing_path.split('#')[1];
        const meta = (await api('/public/session', {token:link})).data.agreement;
        assert.equal(meta.preparation_details.stage, 'intake');
        assert.equal(meta.preparation_details.email, '');
        assert.equal(meta.preparation_details.claim, claim);
        const prepared = await api('/public/session/document', {token:link}); assert.equal(prepared.status, 200);
        assert.equal(hash(prepared.data), meta.document_sha256); assert.notEqual(meta.document_sha256, hash(original));
        assert.doesNotMatch((await pdfText(prepared.data)).text, /\bnull\b/);
        assert.equal((await api('/public/session/sign', {method:'POST', token:link, body:{name:'José Rivera', consent:true, consent_version:CONSENT_VERSION, document_sha256:meta.document_sha256}})).status, 200);
        const frozen = (await database.query('SELECT * FROM agreement_requests WHERE id=$1', [intake.data.id])).rows[0];

        for (const mismatch of ['claim', 'vin', 'name']) {
          isolateClient();
          if (mismatch === 'claim') await database.query("UPDATE repair_orders SET claim_number='CLAIM-B' WHERE id='miles-ro'");
          if (mismatch === 'vin') await database.query("UPDATE vehicles SET vin='CHANGED' WHERE id='miles-vehicle'");
          const mismatched = mismatch === 'name' ? {...completion, recipient_name:'Different customer'} : completion;
          for (const endpoint of ['/ro/miles-ro/preview', '/ro/miles-ro']) {
            await noWrite(endpoint, {method:'POST', token:miles, body:await reviewedBody(mismatched)}, 409, /intake/i);
          }
          assert.deepEqual((await api('/public/session/document', {token:link})).data, prepared.data);
          assert.deepEqual((await database.query('SELECT * FROM agreement_requests WHERE id=$1', [intake.data.id])).rows[0], frozen);
          await database.query('UPDATE repair_orders SET claim_number=$1 WHERE id=$2', [claim, 'miles-ro']);
          await database.query("UPDATE vehicles SET vin='1HGBH41JXMN109186' WHERE id='miles-vehicle'");
        }
        isolateClient();
        const completionPreview = await noWrite('/ro/miles-ro/preview', {method:'POST', token:miles, body:await reviewedBody(completion)}, 200);
        assert.equal((await PDFDocument.load(completionPreview.data)).getPageCount(), 2);
        const before = await writeState();
        const finish = await createMiles(completion); assert.equal(finish.status, 201);
        const after = await writeState();
        assert.equal(after.counts.requests, before.counts.requests + 1);
        assert.equal(after.counts.events, before.counts.events + 1);
        assert.equal(after.counts.tokens, before.counts.tokens + 1);
        const finishMeta = (await api('/public/session', {token:finish.data.signing_path.split('#')[1]})).data.agreement;
        assert.equal(finishMeta.parent_request_id, intake.data.id); assert.equal(finishMeta.preparation_details.stage, 'completion');
        assert.equal((await api(`/${finish.data.id}/void`, {method:'POST', token:miles})).status, 200);
      }
      const copied=await upload({token:other});
      await database.query('UPDATE agreement_templates SET preparation_kind=$2 WHERE id=$1',[copied.data.id,'miles_cash_v1']);
      assert.equal((await api('/templates',{token:other})).data.templates.some(x=>x.id===copied.data.id),false);
      for (const endpoint of ['/ro/miles-ro/preview', '/ro/miles-ro']) {
        await noWrite(endpoint, {method:'POST', token:miles, body:await reviewedBody({...body, template_id:copied.data.id})}, 400);
      }
    } finally { profiles.miles_cash_v1.hash=priorHash; }
  });
  await t.test('the real creation limiter still rejects the 31st request for one client', async () => {
    isolateClient();
    const options = { method:'POST', body:{template_id:templateId} };
    for (let attempt = 0; attempt < 30; attempt++) await noWrite('/ro/missing-ro', options, 404);
    await noWrite('/ro/missing-ro', options, 429, /Too many agreement changes/);
    isolateClient();
    await noWrite('/ro/missing-ro', options, 404);
  });

});
