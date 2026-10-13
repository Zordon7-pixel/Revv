'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { processJob, enabled, entitled, runConfig, reasonFor, tick } = require('../src/services/smsProvisioningQueue');
const { providerFromClient, validMapping, fail } = require('../src/services/smsProvisioningProvider');
const env = () => ({ APP_URL: 'https://synthetic.invalid', REVV_SMS_AUTOPROVISION: 'true', REVV_SMS_AUTOPROVISION_RUN_ID: 'synthetic-run-001', REVV_SMS_AUTOPROVISION_PURCHASE_CAP: '1' });
const sid = prefix => prefix + 'a'.repeat(32);
const mapping = { event_campaign_sid: sid('CM'), event_callback_url: 'https://synthetic.invalid/api/sms/provisioning-events', account_sid: sid('AC'), service_sid: sid('MG'), campaign_sid: sid('QE'), brand_sid: sid('BN'), authorization_ref: 'synthetic-approval' };
const callback = 'https://synthetic.invalid/api/sms/webhook';
function fixture() {
  const f = { env: env(), shop: { plan: 'pro' }, purchased: 0, consumed: 0, attached: false,
    registered: 'UNAVAILABLE', saved: [], publications: 0, clock: 0,
    job: { shop_id: 'opaque-shop', state: 'pending', reason: 'DISCOVERED', attempts: 0, admin_attention: false },
    number: { sid: sid('PN'), phoneNumber: '+12025550100', smsUrl: callback, smsMethod: 'POST' } };
  f.s = {
    mapping: async () => mapping,
    guard: async (job, fn) => { if (!enabled(f.env)) fail('OFF'); if (!entitled(f.shop)) fail('INELIGIBLE'); return fn(f.shop); },
    save: async job => { f.saved.push(structuredClone(job)); },
    reserve: async job => { if (f.consumed >= Number(f.env.REVV_SMS_AUTOPROVISION_PURCHASE_CAP)) fail('CAP_DEFERRED'); f.consumed++; job.run_id = f.env.REVV_SMS_AUTOPROVISION_RUN_ID; await f.s.save(job); },
    publish: async job => { f.publications++; f.shop.twilio_phone_number = job.phone_number; await f.s.save(job); },
  };
  f.p = {
    prerequisite: async () => {}, candidate: async () => f.number.phoneNumber,
    purchase: async () => { assert.equal(f.saved.at(-1).reason, 'PURCHASE_INTENT'); assert.equal(f.consumed, 1); f.purchased++; return f.number; },
    inventory: async (candidate, intent) => { assert.equal(candidate, f.number.phoneNumber); assert.ok(intent); if (!f.purchased) fail('PURCHASE_UNCERTAIN'); return f.number; },
    number: async () => f.number,
    attached: async () => f.attached, attach: async () => { f.attached = true; },
    callback: async () => { f.number.smsUrl = callback; f.number.smsMethod = 'POST'; },
    registration: async () => ({ status: f.registered, source: 'synthetic-only', phone_sid: f.number.sid, binding: { ...mapping, callback } }),
  };
  f.run = () => processJob(f.s, f.job, { env: f.env, provider: async () => f.p, callback: () => callback, now: () => f.clock });
  return f;
}

test('exact flag, entitlement modes and explicit bounded run configuration', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', true]) assert.equal(enabled({ REVV_SMS_AUTOPROVISION: value }), false);
  assert.equal(enabled(env()), true);
  for (const shop of [{ plan: 'pro' }, { plan: 'agency' }, { sms_comp: true }]) assert.equal(entitled(shop), true);
  for (const shop of [null, {}, { plan: 'free' }, { sms_comp: 'true' }, { sms_comp: 1 }]) assert.equal(entitled(shop), false);
  for (const extra of [{ REVV_SMS_AUTOPROVISION_RUN_ID: '' }, { REVV_SMS_AUTOPROVISION_PURCHASE_CAP: '-1' }, { REVV_SMS_AUTOPROVISION_PURCHASE_CAP: '1001' }, { REVV_SMS_AUTOPROVISION_PURCHASE_CAP: '1.2' }]) assert.throws(() => runConfig({ ...env(), ...extra }));
  assert.deepEqual(runConfig(env()), { id: 'synthetic-run-001', cap: 1 });
});

test('OFF including queued work does not touch DB or provider', async () => {
  const f = fixture(); f.env.REVV_SMS_AUTOPROVISION = 'false';
  f.s.mapping = () => assert.fail('OFF touched DB');
  await f.run();
  await tick({ env: f.env, store: new Proxy({}, { get: () => assert.fail('OFF touched queue') }) });
  assert.equal(f.purchased, 0);
});
for (const shop of [{ plan: 'pro' }, { plan: 'agency' }, { plan: 'free', sms_comp: true }]) {
  test(`entitled ${JSON.stringify(shop)} purchases once; repeats retain pending shared fallback`, async () => {
    const f = fixture(); f.shop = shop;
    await f.run(); await f.run();
    assert.equal(f.purchased, 1); assert.equal(f.consumed, 1);
    assert.equal(f.job.reason, 'REGISTRATION_SOURCE_REQUIRED');
    assert.equal(f.job.attempts, 0); assert.equal(f.publications, 0);
    assert.equal(f.shop.twilio_phone_number, undefined);
  });
}
test('ineligible, downgrade and existing assignment retain history without release', async () => {
  const f = fixture(); f.shop.plan = 'free'; await f.run(); assert.equal(f.purchased, 0);
  f.shop.plan = 'pro'; f.shop.twilio_phone_sid = f.number.sid; f.shop.twilio_phone_number = f.number.phoneNumber;
  await f.run(); assert.equal(f.purchased, 0); assert.equal(f.job.phone_sid, f.number.sid);
  f.shop.plan = 'free'; await f.run(); assert.equal(f.job.reason, 'INELIGIBLE');
  assert.equal(f.job.phone_sid, f.number.sid); assert.equal(f.shop.twilio_phone_number, f.number.phoneNumber);
  assert.equal(f.job.admin_attention, true);
});
test('cap deferred consumes no attempt and does not leave a false intent', async () => {
  const f = fixture(); f.env.REVV_SMS_AUTOPROVISION_PURCHASE_CAP = '0'; await f.run();
  assert.equal(f.job.reason, 'CAP_DEFERRED'); assert.equal(f.job.state, 'pending'); assert.equal(f.job.attempts, 0);
  assert.equal(f.job.intent_id, null); assert.equal(f.purchased, 0);
});
test('timeout reconciles inventory on restart; never repeats create or cap charge', async () => {
  const f = fixture(); f.p.purchase = async () => { f.purchased++; throw new Error('secret phone provider body'); };
  await f.run(); assert.equal(f.job.reason, 'PROVIDER_TRANSIENT');
  f.job = structuredClone(f.saved.at(-1));
  await f.run(); assert.equal(f.purchased, 1); assert.equal(f.consumed, 1);
  assert.equal(f.job.phone_sid, f.number.sid); assert.equal(f.job.reason, 'REGISTRATION_SOURCE_REQUIRED');
});
test('crash before request and ambiguous absent inventory fail closed', async () => {
  const f = fixture(); f.job.intent_id = 'persisted-intent'; f.job.candidate = f.number.phoneNumber;
  await f.run(); assert.equal(f.job.reason, 'PURCHASE_UNCERTAIN'); assert.equal(f.job.state, 'failed'); assert.equal(f.purchased, 0);
});
test('provider success then failed DB write reconciles acquired SID', async () => {
  const f = fixture(); const save = f.s.save;
  let failOnce = true;
  f.s.save = async job => { if (job.reason === 'ACQUIRED' && failOnce) { failOnce = false; throw new Error('database unavailable'); } return save(job); };
  await f.run(); await f.run(); assert.equal(f.purchased, 1); assert.equal(f.job.phone_sid, f.number.sid);
});
test('attachment error retries acquired number, callback verifies before publish', async () => {
  const f = fixture(); let attempts = 0;
  f.p.attach = async () => { if (++attempts === 1) throw { status: 503, message: 'secret' }; f.attached = true; };
  await f.run(); assert.equal(f.job.reason, 'PROVIDER_TRANSIENT');
  assert.equal(+f.job.next_at, 120000);
  f.number.smsUrl = 'wrong'; f.registered = 'REGISTERED'; await f.run();
  assert.equal(f.purchased, 1); assert.equal(f.publications, 1); assert.equal(f.job.state, 'active');
});
test('registration pending and failure never publish; exhausted is distinct', async () => {
  for (const status of ['PENDING_REGISTRATION', 'FAILURE']) {
    const f = fixture(); f.registered = status; await f.run();
    assert.equal(f.publications, 0); assert.equal(f.job.reason, status === 'FAILURE' ? 'REGISTRATION_FAILED' : 'REGISTRATION_PENDING');
    assert.equal(f.job.state, status === 'FAILURE' ? 'failed' : 'pending');
  }
  const f = fixture(); f.p.prerequisite = async () => { throw { status: 503, message: 'secret' }; };
  for (let i = 0; i < 5; i++) await f.run();
  assert.equal(f.job.state, 'failed'); assert.equal(f.job.reason, 'RETRIES_EXHAUSTED');
  assert.equal(JSON.stringify(f.saved).includes('secret'), false);
  assert.equal(reasonFor({ status: 401, message: 'secret' }), 'PROVIDER_PERMANENT');
});
test('mapping drift, missing mapping and campaign block before acquisition', async () => {
  for (const reason of ['CAMPAIGN_PENDING', 'CAMPAIGN_FAILED', 'CALLBACK_MISMATCH']) {
    const f = fixture(); f.p.prerequisite = async () => fail(reason); await f.run(); assert.equal(f.purchased, 0); assert.equal(f.job.reason, reason);
  }
  const f = fixture(); f.job.binding = { ...mapping, account_sid: sid('ZZ'), callback }; await f.run();
  assert.equal(f.job.reason, 'CONFIG_DRIFT'); assert.equal(f.purchased, 0);
  const missing = fixture(); missing.s.mapping = async () => null; await missing.run(); assert.equal(missing.job.reason, 'MAPPING_REQUIRED');
});
test('flag or entitlement changes after intent prevent purchase', async () => {
  for (const off of [true, false]) {
    const f = fixture(); const reserve = f.s.reserve;
    f.s.reserve = async job => { await reserve(job); if (off) f.env.REVV_SMS_AUTOPROVISION = 'false'; else f.shop.plan = 'free'; };
    await f.run(); assert.equal(f.purchased, 0); assert.ok(f.job.intent_id); assert.equal(f.consumed, 1);
  }
});
test('tick alerts contain only enum and opaque shop id, use automatic entry', async () => {
  const f = fixture(); const alerts = [];
  const store = { configure: async () => {}, discover: async () => {}, attention: async () => [], due: async () => [{ shop_id: 'opaque-shop' }],
    claim: async (_, fn) => fn(f.s, f.job), alert: async (reason, id, notify) => notify('high', reason, { shop_id: id }) };
  await tick({ store, env: f.env, notify: async (...args) => alerts.push(args), entry: async args => {
    assert.equal(args.mode, 'automatic'); return { reason: 'PROVIDER_PERMANENT', admin_attention: true };
  } });
  assert.deepEqual(alerts, [['high', 'PROVIDER_PERMANENT', { shop_id: 'opaque-shop' }]]);
});

test('Twilio SDK adapter uses documented campaign/attachment fields, never derives registration', async () => {
  const n = { accountSid: mapping.account_sid, sid: sid('PN'), phoneNumber: '+12025550100', capabilities: { sms: true }, friendlyName: 'REVV-AUTO:intent' };
  let campaignStatus = 'VERIFIED'; let attached = false; const calls = [];
  const service = { fetch: async () => ({ sid: mapping.service_sid, accountSid: mapping.account_sid, inboundRequestUrl: callback, inboundMethod: 'POST', useInboundWebhookOnNumber: false }),
    usAppToPerson: campaign => { assert.equal(campaign, mapping.campaign_sid); return { fetch: async () => ({ sid: campaign, accountSid: mapping.account_sid, messagingServiceSid: mapping.service_sid, brandRegistrationSid: mapping.brand_sid, mock: false, campaignStatus }) }; },
    phoneNumbers: Object.assign(phone => ({ fetch: async () => { if (!attached) throw { status: 404, code: 20404 }; return { sid: phone, accountSid: mapping.account_sid, serviceSid: mapping.service_sid }; } }), { create: async args => { calls.push(args); attached = true; } }) };
  const incoming = Object.assign(() => ({ fetch: async () => n, update: async args => calls.push(args) }), { list: async () => [n], create: async args => { calls.push(args); return n; } });
  const p = providerFromClient({ messaging: { v1: { services: () => service } }, incomingPhoneNumbers: incoming }, mapping);
  assert.equal(validMapping(mapping), true); await p.prerequisite(callback);
  campaignStatus = 'IN_PROGRESS'; await assert.rejects(p.prerequisite(callback), /CAMPAIGN_PENDING/);
  assert.equal(await p.attached(n.sid), false); await p.attach(n.sid); assert.equal(await p.attached(n.sid), true);
  assert.equal((await p.registration(n.sid)).status, 'UNAVAILABLE');
  assert.equal((await p.inventory(n.phoneNumber, 'intent')).sid, n.sid);
  await assert.rejects(p.inventory(n.phoneNumber, 'another-intent'), /PURCHASE_UNCERTAIN/);
  await p.purchase(n.phoneNumber, 'intent', callback);
  assert.deepEqual(calls.at(-1), { phoneNumber: n.phoneNumber, friendlyName: 'REVV-AUTO:intent', smsUrl: callback, smsMethod: 'POST' });
});

test('existing public entry delegates only explicit automatic mode; OFF bypasses all work', async () => {
  const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path');
  const filename = path.join(__dirname, '../src/services/smsProvisioning.js');
  const module = { exports: {} }; let automaticCalls = 0;
  const dependencies = {
    '../db': { dbGet: () => assert.fail('automatic entered manual DB path') },
    './sms': {}, './smsWebhookConfig': { inboundWebhookUrl: () => callback },
    './smsProvisioningQueue': { enabled, processJob: async () => { automaticCalls++; return { state: 'pending' }; } },
  };
  vm.runInThisContext(`(function(require,module){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name];
  }, module);
  const provision = module.exports.provisionSmsSenderForShop;
  assert.equal((await provision({ mode: 'automatic', automatic: { env: {} } })).reason, 'OFF');
  assert.equal(automaticCalls, 0);
  const automatic = { env: env(), session: {}, job: { shop_id: 'opaque-shop' } };
  await assert.rejects(provision({ shopId: 'opaque-shop', mode: 'automatic', force: true, automatic }), /Invalid automatic/);
  await provision({ shopId: 'opaque-shop', mode: 'automatic', automatic });
  assert.equal(automaticCalls, 1);
});

test('inventory collision or unavailable reconciliation never becomes a second purchase', async () => {
  const f = fixture(); f.p.purchase = async () => { f.purchased++; throw { status: 400, code: 21422 }; };
  await f.run();
  f.p.inventory = async () => fail('PURCHASE_UNCERTAIN');
  await f.run();
  assert.equal(f.purchased, 1); assert.equal(f.consumed, 1); assert.equal(f.job.state, 'failed');
});

test('REGISTERED evidence must match exact phone and complete binding', async () => {
  const f = fixture();
  f.p.registration = async () => ({ status: 'REGISTERED', source: 'synthetic', phone_sid: 'different', binding: { ...mapping, callback } });
  await f.run(); assert.equal(f.publications, 0); assert.equal(f.job.reason, 'REGISTRATION_SOURCE_REQUIRED');
});

// These mocks exercise processJob's catch behavior; real SQL custody/version
// assertions live in smsProvisioning.pg.test.js and require the host database.
test('active provider failure saves pending/failed while retaining acquisition; first-publish failure stays unrouted', async () => {
  for (const reason of ['CAMPAIGN_FAILED', 'CALLBACK_MISMATCH', 'PROVIDER_TRANSIENT']) {
    const f = fixture(); f.registered = 'REGISTERED'; await f.run();
    assert.equal(f.job.state, 'active');
    const before = structuredClone(f.job);
    f.p.prerequisite = async () => fail(reason);
    await f.run();
    assert.equal(f.saved.at(-1).reason, reason);
    assert.equal(f.saved.at(-1).state, reason === 'PROVIDER_TRANSIENT' ? 'pending' : 'failed');
    for (const field of ['phone_sid', 'phone_number', 'intent_id', 'candidate', 'run_id', 'binding']) {
      assert.deepEqual(f.saved.at(-1)[field], before[field]);
    }
    assert.equal(f.purchased, 1);
    const fresh = fixture(); fresh.p.prerequisite = async () => fail(reason);
    await fresh.run(); assert.equal(fresh.publications, 0); assert.equal(fresh.purchased, 0);
    assert.equal(fresh.shop.twilio_phone_number, undefined);
  }
});
test('stale guard or failure save returns the fresh persisted result without retrying a stale write', async () => {
  for (const phase of ['guard', 'failure-save']) {
    const f = fixture();
    const fresh = { ...f.job, state: 'failed', reason: 'REGISTRATION_REVOKED', version: 'new' };
    f.s.current = async () => fresh;
    let saves = 0;
    if (phase === 'guard') f.s.guard = async () => fail('STALE_JOB');
    else f.s.guard = async () => fail('CAMPAIGN_FAILED');
    f.s.save = async () => { saves++; fail('STALE_JOB'); };
    assert.equal(await f.run(), fresh);
    assert.equal(saves, phase === 'guard' ? 0 : 1); assert.equal(f.purchased, 0);
  }
});
test('OFF at guard and after a provider failure never enters the failure save', async () => {
  for (const disabled of ['control', 'environment']) {
    const f = fixture(); const save = f.s.save;
    f.s.save = async j => { assert.equal(j.reason, 'DISCOVERED'); return save(j); };
    if (disabled === 'control') f.s.guard = async () => fail('OFF');
    else f.p.prerequisite = async () => { f.env.REVV_SMS_AUTOPROVISION = 'false'; fail('PROVIDER_TRANSIENT'); };
    await f.run(); assert.equal(f.purchased, 0);
    assert.ok(f.saved.every(j => j.reason === 'DISCOVERED'));
  }
});
