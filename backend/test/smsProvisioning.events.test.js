'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Socket } = require('node:net');
const { Writable } = require('node:stream');
const express = require('express');
const twilio = require('twilio');
const { router, PATH, eventUrl, parseEvents, bindingOf, registration } = require('../src/services/smsProvisioningEvents');
const { createProvider, providerFromClient } = require('../src/services/smsProvisioningProvider');
const { processJob } = require('../src/services/smsProvisioningQueue');
const sid = (prefix, n = 'a') => prefix + n.repeat(32);
const token = 'synthetic-auth-token-not-api-secret';
const env = { APP_URL: 'https://synthetic.invalid', REVV_SMS_AUTOPROVISION: 'true',
  REVV_SMS_AUTOPROVISION_RUN_ID: 'synthetic-run-001', REVV_SMS_AUTOPROVISION_PURCHASE_CAP: '1' };
const callback = `${env.APP_URL}/api/sms/webhook`;
const mapping = { shop_id: 'synthetic-shop', account_sid: sid('AC'), service_sid: sid('MG'),
  campaign_sid: sid('QE'), brand_sid: sid('BN'), event_campaign_sid: sid('CM'),
  authorization_ref: 'synthetic-only', event_callback_url: eventUrl(env) };
const specs = {
  'number-registration.successful': ['NumberRegistrationSuccessful','registered'],
  'number-registration.pending': ['NumberRegistrationPending','pending_registration'],
  'number-registration.failed': ['NumberRegistrationFailed','failure'],
  'number-deregistration.successful': ['NumberDeregistrationSuccessful','unregistered'],
  'number-deregistration.pending': ['NumberDeregistrationPending','pending_deregistration'],
  'number-deregistration.failed': ['NumberDeregistrationFailed','failure'],
};
function event(kind = 'number-registration.successful', time = 1791800000000, id = 'CE-synthetic-1', m = mapping, pn = sid('PN')) {
  return { specversion: '1.0', id, type: `com.twilio.messaging.compliance.${kind}`,
    time: new Date(time).toISOString(), dataschema: `https://events-schemas.twilio.com/A2P.${specs[kind][0]}/1`,
    datacontenttype: 'application/json', data: { accountsid: m.account_sid, timestamp: time,
      id: 'synthetic-data-id', ...(kind === 'number-deregistration.successful' ? {} : { campaignsid: m.event_campaign_sid }), externalstatus: specs[kind][1],
      phonenumbersid: pn, updateddate: time, messagingservicesid: m.service_sid,
      phonenumber: '+12025550100', error: 'NEVER-PERSIST-THIS' } };
}

// Real Express/raw-body middleware and Node HTTP request/response objects, with
// an in-memory transport. No listener, DNS, provider or network permission needed.
function request(app, events, options = {}) {
  const raw = options.raw ?? JSON.stringify(events);
  const hash = options.hash ?? twilio.getExpectedBodyHash(raw);
  const query = options.query ?? `?bodySHA256=${hash}`;
  const signature = options.signature ?? twilio.getExpectedTwilioSignature(options.token ?? token,
    `${options.signBase ?? eventUrl(env)}${query}`, {});
  return new Promise((resolve, reject) => {
    const req = new IncomingMessage(new Socket());
    req.method = 'POST'; req.url = PATH + query;
    req.headers = { 'content-type': options.contentType ?? 'application/json',
      'content-length': String(Buffer.byteLength(raw)), 'x-twilio-signature': signature,
      host: options.host ?? 'untrusted-host.invalid', 'x-forwarded-host': 'spoofed.invalid',
      ...options.headers };
    const res = new ServerResponse(req); const output = [];
    res.assignSocket(new Writable({ write(chunk, encoding, done) { output.push(chunk); done(); } }));
    res.on('error', reject); res.on('finish', () => resolve({ status: res.statusCode, raw: Buffer.concat(output).toString() }));
    app(req, res); req.push(Buffer.from(raw)); req.push(null);
  });
}
function appFor(store, config = env, onFailure = () => {}) {
  const app = express(); app.use(PATH, router({ store, env: config, onFailure }));
  app.use(express.json()); return app;
}
function fakeClient(m = mapping) {
  const f = { attached: false, purchases: 0, campaignStatus: 'VERIFIED', mock: false,
    number: { accountSid: m.account_sid, sid: sid('PN'), phoneNumber: '+12025550100',
      capabilities: { sms: true }, smsUrl: callback, smsMethod: 'POST' } };
  const incoming = Object.assign(pn => ({ fetch: async () => { assert.equal(pn, f.number.sid); return f.number; },
    update: async fields => Object.assign(f.number, fields) }), {
    list: async () => f.purchases ? [f.number] : [],
    create: async fields => { f.purchases++; Object.assign(f.number, fields); return f.number; },
  });
  f.service = { fetch: async () => ({ sid: m.service_sid, accountSid: m.account_sid,
    inboundRequestUrl: callback, inboundMethod: 'POST', useInboundWebhookOnNumber: false }),
    usAppToPerson: qe => ({ fetch: async () => { assert.equal(qe, m.campaign_sid); return {
      sid: qe, accountSid: m.account_sid, messagingServiceSid: m.service_sid,
      brandRegistrationSid: m.brand_sid, campaignStatus: f.campaignStatus, mock: f.mock }; } }),
    phoneNumbers: Object.assign(pn => ({ fetch: async () => {
      if (!f.attached) throw { status: 404, code: 20404 };
      return { sid: pn, accountSid: m.account_sid, serviceSid: m.service_sid };
    } }), { create: async () => { f.attached = true; } }),
  };
  f.client = { messaging: { v1: { services: mg => { assert.equal(mg, m.service_sid); return f.service; } } },
    incomingPhoneNumbers: incoming, availablePhoneNumbers: country => {
      assert.equal(country, 'US'); return { local: { list: async () => [{ phoneNumber: f.number.phoneNumber }] } };
    } };
  return f;
}

if (require.main === module) {
  test('app mounts the receiver before the generic JSON parser', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/app.js'), 'utf8');
    const mount = source.indexOf("app.use('/api/sms/provisioning-events'");
    assert.ok(mount > 0 && mount < source.indexOf('app.use(express.json('));
  });
  test('signed JSON reaches raw receiver; canonical URL ignores Host; only minimal receipts passed', async () => {
    const writes = [];
    const app = appFor({ accept: async (events, auth) => { assert.ok(auth(token)); writes.push(...events); } });
    assert.equal((await request(app, [event()])).status, 204);
    assert.equal(writes.length, 1);
    assert.equal(JSON.stringify(writes).includes('+12025550100'), false);
    assert.equal(JSON.stringify(writes).includes('NEVER-PERSIST'), false);
    assert.equal(writes[0].occurred_at, event().data.updateddate);
  });
  test('official campaignless deregistration shape reaches signed HTTP; other missing campaigns are rejected', async () => {
    const writes = [];
    const app = appFor({ accept: async (events, auth) => {
      if (!auth(token)) throw { reason: 'EVENT_UNAUTHORIZED' };
      writes.push(...events);
    } });
    // Official sample timestamps/shape, with synthetic valid SIDs instead of X placeholders.
    const negative = event('number-deregistration.successful', 1710345070552);
    negative.data.updateddate = 1710345070476;
    negative.source = 'CA000000000000000000000000000000';
    assert.equal(Object.hasOwn(negative.data, 'campaignsid'), false);
    assert.equal((await request(app, [negative])).status, 204);
    assert.equal(writes[0].event_campaign_sid, undefined);
    assert.equal(writes[0].status, 'unregistered');
    for (const kind of Object.keys(specs).filter(k => k !== 'number-deregistration.successful')) {
      const missing = event(kind); delete missing.data.campaignsid;
      assert.equal((await request(app, [missing])).status, 403);
    }
    for (const campaign of [null, '', sid('QE')]) {
      assert.equal((await request(app, [{ ...negative, data: { ...negative.data, campaignsid: campaign } }])).status, 403);
    }
    assert.equal((await request(app, [negative], { token: 'wrong-account-token' })).status, 403);
    const raw = JSON.stringify([negative]);
    assert.equal((await request(app, [negative], {
      raw: raw.replace('unregistered', 'registered'), hash: twilio.getExpectedBodyHash(raw),
    })).status, 403);
    assert.equal(writes.length, 1);
  });
  test('invalid signature, hash, query, Host signing, token, encoding and mixed batch cannot write', async () => {
    let writes = 0;
    const app = appFor({ accept: async (events, auth) => {
      if (!auth(token)) throw { reason: 'EVENT_UNAUTHORIZED' }; writes++;
    } });
    for (const options of [{ signature: 'wrong' }, { token: 'api-key-secret' }, { hash: '0'.repeat(64) },
      { signBase: 'https://untrusted-host.invalid' }, { query: '' },
      { query: '?bodySHA256=' + '0'.repeat(64) + '&bodySHA256=' + '0'.repeat(64) },
      { query: '?bodySHA256=' + '0'.repeat(64) + '&shop_id=other' },
      { contentType: 'application/x-www-form-urlencoded' }, { raw: '{}' }, { raw: '[invalid' },
      { headers: { 'content-encoding': 'gzip' } }]) {
      assert.ok((await request(app, [event()], options)).status >= 400, JSON.stringify(options));
    }
    assert.equal((await request(app, [event(), { ...event(), type: 'evil-string-secret' }])).status, 403);
    assert.equal(writes, 0);
  });
  test('OFF never accesses store, and receiver bounds body bytes and event count', async () => {
    const store = { accept: () => assert.fail('unexpected write') };
    assert.equal((await request(appFor(store, {}), [event()])).status, 204);
    assert.equal((await request(appFor(store), Array(101).fill(event()))).status, 403);
    assert.equal((await request(appFor(store), [], { raw: 'x'.repeat(128 * 1024 + 1) })).status, 413);
  });
  test('six official types whitelist statuses; inconsistent or malformed identities/times fail closed', () => {
    for (const kind of Object.keys(specs)) assert.equal(parseEvents(JSON.stringify([event(kind)]))[0].kind, kind);
    for (const mutate of [e => { e.data.campaignsid = sid('QE'); }, e => { e.data.phonenumbersid = 'PNx'; },
      e => { e.data.externalstatus = 'REGISTERED'; }, e => { e.data.updateddate++; },
      e => { e.data.timestamp = '1791800000000'; }, e => { e.time = 'bad'; },
      e => { e.id = 123; }, e => { e.type = '__proto__'; },
      e => { e.dataschema = 'https://evil.invalid'; }, e => { e.specversion = '2.0'; }]) {
      const e = event(); mutate(e); assert.throws(() => parseEvents(JSON.stringify([e])), /EVENT_INVALID/);
    }
    for (const APP_URL of ['', 'http://synthetic.invalid', 'https://x.invalid/path', 'https://x.invalid/?x=y',
      'https://user:secret@x.invalid', 'https://x.invalid/#hash']) assert.equal(eventUrl({ APP_URL }), null);
  });
  test('production credential adapter blocks missing mapping/token/account/callback before SDK construction', async () => {
    const shop = { id: mapping.shop_id, twilio_account_sid: mapping.account_sid, twilio_auth_token: token };
    for (const options of [ { shop: { ...shop, twilio_auth_token: '' } },
      { shop: { ...shop, twilio_account_sid: null } },
      { shop: { ...shop, twilio_account_sid: sid('AC', 'b') } }, { env: {} },
      { binding: { ...mapping, event_campaign_sid: null } },
      { binding: { ...mapping, event_callback_url: 'https://wrong.invalid' } } ]) {
      await assert.rejects(createProvider(mapping.shop_id, options.binding || mapping, {
        shop, env, ...options, clientFactory: () => assert.fail('constructed client before setup') }));
    }
  });
  test('approved mock campaign, wrong serviceSid/number/capability cannot pass provider verification', async () => {
    const f = fakeClient(); const p = providerFromClient(f.client, mapping);
    f.mock = true; await assert.rejects(p.prerequisite(callback), /CAMPAIGN_FAILED/);
    f.mock = undefined; await assert.rejects(p.prerequisite(callback), /CAMPAIGN_FAILED/);
    f.mock = false; await p.prerequisite(callback);
    f.service.phoneNumbers = () => ({ fetch: async () => ({ sid: sid('PN'), accountSid: mapping.account_sid,
      serviceSid: sid('MG', 'b') }) });
    await assert.rejects(p.attached(sid('PN')), /ATTACHMENT_MISMATCH/);
    f.number.phoneNumber = 'not-e164'; await assert.rejects(p.number(sid('PN')), /NUMBER_MISMATCH/);
    f.number.phoneNumber = '+12025550100'; f.number.capabilities.sms = false;
    await assert.rejects(p.number(sid('PN')), /NUMBER_MISMATCH/);
  });
  test('signed receiver -> production adapter -> active; final registration recheck prevents stale activation', async () => {
    const binding = bindingOf(mapping, callback); const receipts = [];
    const db = { query: async (_sql, args) => ({ rows: receipts.filter(e => e.phone_sid === args[1]) }) };
    const app = appFor({ accept: async (events, auth) => {
      assert.ok(auth(token)); receipts.push(...events);
    } });
    const shop = { id: mapping.shop_id, plan: 'pro', twilio_account_sid: mapping.account_sid, twilio_auth_token: token };
    const f = fakeClient(); let publications = 0; let calls = 0;
    const session = { mapping: async () => mapping, save: async () => {}, reserve: async () => {},
      guard: async (_, fn) => fn(shop), publish: async () => { publications++; },
      registration: async (_, pn, b) => { calls++; return registration(db, shop.id, pn, b); } };
    const job = { shop_id: shop.id, attempts: 0 };
    const provider = (id, b, context) => createProvider(id, b, { ...context, clientFactory: () => f.client });
    await processJob(session, job, { env, callback: () => callback, provider });
    assert.equal(job.reason, 'REGISTRATION_SOURCE_REQUIRED'); assert.equal(publications, 0);
    assert.equal((await request(app, [event()])).status, 204);
    await processJob(session, job, { env, callback: () => callback, provider });
    assert.equal(job.state, 'active'); assert.equal(publications, 1); assert.equal(f.purchases, 1);
    calls = 0;
    session.registration = async (_, pn, b) => ++calls === 1 ? registration(db, shop.id, pn, b) : { status: 'FAILURE' };
    await processJob(session, job, { env, callback: () => callback, provider });
    assert.equal(publications, 1); assert.equal(job.reason, 'REGISTRATION_PENDING');
    assert.deepEqual(binding, job.binding);
  });
}

module.exports = { request, appFor, fakeClient, event, env, mapping, callback, token, sid };
