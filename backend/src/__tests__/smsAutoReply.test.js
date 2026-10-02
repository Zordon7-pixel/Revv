const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const twilio = require('twilio');
// Never initialize the application DB or dotenv in these isolated tests.
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  dbGet: async () => { throw new Error('Unexpected application DB access'); },
  dbRun: async () => { throw new Error('Unexpected application DB access'); },
} };

const {
  INBOUND_AUTO_REPLY_TEMPLATE,
  autoReplyBodyForShop,
  maybeSendInboundAutoReply,
} = require('../services/smsAutoReply');

const SHOP = {
  id: 'shop-1',
  name: 'Miles Collision',
  plan: 'pro',
  twilio_account_sid: `AC${'a'.repeat(32)}`,
  twilio_auth_token: 'token',
  twilio_phone_number: '+18668259523',
};
const FROM = '+15551234567';
const NOW = new Date('2026-06-23T12:00:00.000Z');

function makeMockDb(seed = {}) {
  const state = {
    optOuts: new Set(seed.optOuts || []),
    messages: [...(seed.messages || [])],
    runs: [],
  };

  return {
    state,
    async get(sql, params) {
      if (/FROM sms_opt_outs/.test(sql)) {
        const key = `${params[0]}:${params[1]}`;
        return state.optOuts.has(key) ? { exists: 1 } : null;
      }
      if (/status = 'auto_reply'/.test(sql)) {
        return state.messages.find((message) => (
          message.shop_id === params[0] &&
          message.to_phone === params[1] &&
          message.direction === 'outbound' &&
          message.status === 'auto_reply'
        )) || null;
      }
      if (/status, ''\) != 'auto_reply'/.test(sql)) {
        return state.messages.find((message) => (
          message.shop_id === params[0] &&
          message.to_phone === params[1] &&
          message.direction === 'outbound' &&
          message.status !== 'auto_reply'
        )) || null;
      }
      return null;
    },
    async run(sql, params) {
      state.runs.push({ sql, params });
      if (/INSERT INTO sms_opt_outs/.test(sql)) {
        state.optOuts.add(`${params[0]}:${params[1]}`);
      }
      if (/DELETE FROM sms_opt_outs/.test(sql)) {
        state.optOuts.delete(`${params[0]}:${params[1]}`);
      }
      if (/INSERT INTO sms_messages/.test(sql)) {
        state.messages.push({
          id: params[0],
          shop_id: params[1],
          direction: 'outbound',
          from_phone: params[2],
          to_phone: params[3],
          body: params[4],
          twilio_sid: params[5],
          status: 'auto_reply',
        });
      }
      return { rowCount: 1 };
    },
  };
}

test('auto-reply template resolves shop name and falls back to our shop', () => {
  assert.equal(
    INBOUND_AUTO_REPLY_TEMPLATE,
    'Thanks — ${shopName} received your message. A team member will review it and follow up during business hours.'
  );
  assert.equal(
    autoReplyBodyForShop(SHOP),
    'Thanks — Miles Collision received your message. A team member will review it and follow up during business hours.'
  );
  assert.equal(
    autoReplyBodyForShop({ ...SHOP, name: null }),
    'Thanks — our shop received your message. A team member will review it and follow up during business hours.'
  );
});

test('first inbound from a fresh number sends one auto-reply and records status auto_reply', async () => {
  const db = makeMockDb();
  const sendCalls = [];
  const expectedBase = autoReplyBodyForShop(SHOP);

  const result = await maybeSendInboundAutoReply({
    shop: SHOP,
    from: FROM,
    to: SHOP.twilio_phone_number,
    body: 'Hello',
    db,
    now: NOW,
    send: async (...args) => {
      sendCalls.push(args);
      return { ok: true, sid: 'SM123', body: `${expectedBase}\n\nReply STOP to opt out, HELP for help.` };
    },
  });

  assert.equal(result.action, 'auto_reply');
  assert.deepEqual(sendCalls, [[FROM, expectedBase, { shopId: SHOP.id, customerFacing: true }]]);
  const autoReply = db.state.messages.find((message) => message.status === 'auto_reply');
  assert.equal(autoReply.to_phone, FROM);
  assert.equal(autoReply.from_phone, SHOP.twilio_phone_number);
  assert.match(autoReply.body, /^Thanks — Miles Collision received your message\./);
});

test('second inbound within 12h is suppressed by auto-reply dedup', async () => {
  const db = makeMockDb({
    messages: [{ shop_id: SHOP.id, to_phone: FROM, direction: 'outbound', status: 'auto_reply' }],
  });
  const sendCalls = [];

  const result = await maybeSendInboundAutoReply({
    shop: SHOP,
    from: FROM,
    to: SHOP.twilio_phone_number,
    body: 'Again',
    db,
    now: NOW,
    send: async (...args) => sendCalls.push(args),
  });

  assert.deepEqual(result, { action: 'suppressed', reason: 'dedup_12h' });
  assert.equal(sendCalls.length, 0);
});

test('STOP-class inbound records opt-out and sends no REVV reply', async () => {
  const db = makeMockDb();
  const sendCalls = [];

  const result = await maybeSendInboundAutoReply({
    shop: SHOP,
    from: FROM,
    to: SHOP.twilio_phone_number,
    body: ' unsubscribe ',
    db,
    send: async (...args) => sendCalls.push(args),
  });

  assert.deepEqual(result, { action: 'opt_out', reason: 'stop_keyword' });
  assert.equal(db.state.optOuts.has(`${SHOP.id}:${FROM}`), true);
  assert.equal(sendCalls.length, 0);
});

test('normal inbound after STOP is suppressed as opted out', async () => {
  const db = makeMockDb({ optOuts: [`${SHOP.id}:${FROM}`] });
  const sendCalls = [];

  const result = await maybeSendInboundAutoReply({
    shop: SHOP,
    from: FROM,
    to: SHOP.twilio_phone_number,
    body: 'Can you call me?',
    db,
    send: async (...args) => sendCalls.push(args),
  });

  assert.deepEqual(result, { action: 'suppressed', reason: 'opted_out' });
  assert.equal(sendCalls.length, 0);
});

test('START-class inbound removes opt-out and sends no REVV reply', async () => {
  const db = makeMockDb({ optOuts: [`${SHOP.id}:${FROM}`] });
  const sendCalls = [];

  const result = await maybeSendInboundAutoReply({
    shop: SHOP,
    from: FROM,
    to: SHOP.twilio_phone_number,
    body: 'start',
    db,
    send: async (...args) => sendCalls.push(args),
  });

  assert.deepEqual(result, { action: 'resubscribe', reason: 'start_keyword' });
  assert.equal(db.state.optOuts.has(`${SHOP.id}:${FROM}`), false);
  assert.equal(sendCalls.length, 0);
});

test('HELP-class inbound sends no REVV reply', async () => {
  const db = makeMockDb();
  const sendCalls = [];

  const result = await maybeSendInboundAutoReply({
    shop: SHOP,
    from: FROM,
    to: SHOP.twilio_phone_number,
    body: 'INFO',
    db,
    send: async (...args) => sendCalls.push(args),
  });

  assert.deepEqual(result, { action: 'help', reason: 'help_keyword' });
  assert.equal(sendCalls.length, 0);
});

test("shop's own Twilio number is suppressed by loop guard", async () => {
  const db = makeMockDb();
  const sendCalls = [];

  const result = await maybeSendInboundAutoReply({
    shop: SHOP,
    from: SHOP.twilio_phone_number,
    to: SHOP.twilio_phone_number,
    body: 'Loop',
    db,
    send: async (...args) => sendCalls.push(args),
  });

  assert.deepEqual(result, { action: 'suppressed', reason: 'self_loop' });
  assert.equal(sendCalls.length, 0);
});

test("recent manual staff outbound under 30m suppresses auto-reply", async () => {
  const db = makeMockDb({
    messages: [{ shop_id: SHOP.id, to_phone: FROM, direction: 'outbound', status: 'sent' }],
  });
  const sendCalls = [];

  const result = await maybeSendInboundAutoReply({
    shop: SHOP,
    from: FROM,
    to: SHOP.twilio_phone_number,
    body: 'Question',
    db,
    now: NOW,
    send: async (...args) => sendCalls.push(args),
  });

  assert.deepEqual(result, { action: 'suppressed', reason: 'recent_manual_outbound' });
  assert.equal(sendCalls.length, 0);
});

test('sendSMS returns opted_out without calling Twilio for an opted-out number', async () => {
  const smsPath = require.resolve('../services/sms');
  const dbPath = require.resolve('../db');
  const twilioPath = require.resolve('twilio');
  const originals = {
    sms: require.cache[smsPath],
    db: require.cache[dbPath],
    twilio: require.cache[twilioPath],
  };
  let twilioCalled = false;

  try {
    delete require.cache[smsPath];
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        dbGet: async (sql) => {
          if (/FROM sms_opt_outs/.test(sql)) return { exists: 1 };
          return null;
        },
      },
    };
    require.cache[twilioPath] = {
      id: twilioPath,
      filename: twilioPath,
      loaded: true,
      exports: () => {
        twilioCalled = true;
        return { messages: { create: async () => ({ sid: 'SM999' }) } };
      },
    };

    const { sendSMS } = require('../services/sms');
    const result = await sendSMS(FROM, 'Hello', {
      shopId: SHOP.id,
      twilioConfig: {
        accountSid: 'AC123',
        authToken: 'token',
        phoneNumber: SHOP.twilio_phone_number,
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'opted_out');
    assert.equal(twilioCalled, false);
  } finally {
    delete require.cache[smsPath];
    if (originals.sms) require.cache[smsPath] = originals.sms;
    if (originals.db) require.cache[dbPath] = originals.db;
    if (originals.twilio) require.cache[twilioPath] = originals.twilio;
  }
});

test('decision never throws on missing shop/from/body', async () => {
  await assert.doesNotReject(async () => {
    assert.deepEqual(await maybeSendInboundAutoReply(), { action: 'suppressed', reason: 'missing_shop' });
    assert.deepEqual(
      await maybeSendInboundAutoReply({ shop: SHOP, from: '', body: 'Hi', db: makeMockDb() }),
      { action: 'suppressed', reason: 'invalid_from' }
    );
    assert.deepEqual(
      await maybeSendInboundAutoReply({ shop: SHOP, from: FROM, body: '', db: makeMockDb() }),
      { action: 'suppressed', reason: 'empty_body' }
    );
  });
});

const PUBLIC_BASE = 'https://sms.example.test';
const WEBHOOK_URL = `${PUBLIC_BASE}/api/sms/webhook`;
const PRIVATE_BODY = 'private customer body marker';
const LEAK = `${FROM} ${SHOP.twilio_phone_number} ${PRIVATE_BODY}`;

function webhookHarness(options = {}) {
  const state = { writes: [], reads: [], sends: [], autoCalls: 0, optedOut: Boolean(options.optedOut),
    customer: { sms_consent: true, sms_consent_method: 'written', sms_consent_by: 'staff', sms_consent_at: NOW } };
  const db = {
    async dbAll(sql, params) {
      state.reads.push({ sql, params });
      assert.match(sql, /FROM shops WHERE twilio_phone_number = \$1/);
      assert.equal(params.length, 1);
      assert.match(params[0], /^\+[1-9]\d{1,14}$/);
      if (options.lookupError) throw new Error(LEAK);
      return (options.shops || [SHOP]).filter(shop => shop.twilio_phone_number === params[0]);
    },
    async dbGet(sql, params) {
      if (options.roError) throw new Error(LEAK);
      if (/FROM repair_orders/.test(sql)) return { id: 'ro-1' };
      if (/FROM sms_opt_outs/.test(sql)) return state.optedOut ? { exists: 1 } : null;
      return null;
    },
    async dbRun(sql, params) {
      if (options.writeError) throw new Error(LEAK);
      state.writes.push({ sql, params });
      if (/INSERT INTO sms_opt_outs/.test(sql)) state.optedOut = true;
      if (/DELETE FROM sms_opt_outs/.test(sql)) state.optedOut = false;
      if (/UPDATE customers/.test(sql)) Object.assign(state.customer,
        { sms_consent: false, sms_consent_at: null, sms_consent_method: null, sms_consent_by: null });
    },
  };
  const mocks = {
    '../db': db,
    '../middleware/auth': (_req, _res, next) => next(),
    '../middleware/roles': { requireAdmin: (_req, _res, next) => next() },
    '../services/sms': {},
    '../services/smsAutoReply': { maybeSendInboundAutoReply: async args => {
      state.autoCalls++;
      if (options.autoError) throw new Error(LEAK);
      return maybeSendInboundAutoReply({ ...args, send: async (...sendArgs) => {
        state.sends.push(sendArgs);
        if (options.sendError) throw new Error(LEAK);
        return { ok: true, sid: `SM${'b'.repeat(32)}` };
      } });
    } },
  };
  const filename = require.resolve('../routes/sms');
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express', 'uuid', 'twilio'].includes(name)) return require(name);
    if (name === '../services/smsWebhookConfig') return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  const handler = module.exports.stack.find(l => l.route?.path === '/webhook').route.stack.at(-1).handle;
  async function call({ body = PRIVATE_BODY, signature, signedUrl = WEBHOOK_URL, originalUrl = '/api/sms/webhook',
    params = {}, token = SHOP.twilio_auth_token, base = PUBLIC_BASE, headers = {} } = {}) {
    const oldBase = process.env.APP_URL;
    process.env.APP_URL = base;
    const form = { From: FROM, To: SHOP.twilio_phone_number, Body: body, AccountSid: SHOP.twilio_account_sid, ...params };
    const signed = signature === undefined ? twilio.getExpectedTwilioSignature(token, signedUrl, form) : signature;
    const req = { body: form, originalUrl, protocol: 'http', get: name =>
      name.toLowerCase() === 'x-twilio-signature' ? signed : headers[name.toLowerCase()] };
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; },
      type(v) { this.contentType = v; return this; }, send(v) { this.sent = v; return this; } };
    try { await handler(req, res); } finally {
      if (oldBase === undefined) delete process.env.APP_URL; else process.env.APP_URL = oldBase;
    }
    return res;
  }
  return { state, call };
}

async function captureLogs(fn) {
  const messages = [];
  const originals = {};
  for (const key of ['log', 'warn', 'error', 'info', 'debug']) {
    originals[key] = console[key]; console[key] = (...args) => messages.push(args);
  }
  try { await fn(); } finally { Object.assign(console, originals); }
  const text = JSON.stringify(messages);
  for (const value of [FROM, FROM.slice(1), SHOP.twilio_phone_number, SHOP.twilio_phone_number.slice(1), PRIVATE_BODY, SHOP.twilio_auth_token]) {
    assert.ok(!text.includes(value), 'Captured logs must exclude private input and tokens');
  }
  return text;
}

test('genuine Twilio signature accepts form and safely logs inbound and auto-reply', async () => {
  const h = webhookHarness();
  const logs = await captureLogs(async () => {
    const res = await h.call();
    assert.equal(res.statusCode, 200);
    assert.equal(res.contentType, 'text/xml');
    assert.equal(res.sent, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
  assert.match(logs, /Inbound saved/);
  assert.equal(h.state.writes.length, 2);
  assert.equal(h.state.sends.length, 1);
});

for (const body of ['STOP', 'START']) {
  test(`forged ${body} cannot change consent, opt-out history, messages or replies`, async () => {
    const h = webhookHarness({ optedOut: body === 'START' });
    const before = structuredClone(h.state);
    await captureLogs(async () => assert.equal((await h.call({ body, token: 'forged-token' })).statusCode, 403));
    assert.deepEqual(h.state.customer, before.customer);
    assert.equal(h.state.optedOut, before.optedOut);
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.autoCalls, 0);
    assert.equal(h.state.sends.length, 0);
  });
}

for (const [label, options, request] of [
  ['missing signature', {}, { signature: '' }],
  ['tampered body after signing', {}, { signature: twilio.getExpectedTwilioSignature(SHOP.twilio_auth_token, WEBHOOK_URL, { From: FROM, To: SHOP.twilio_phone_number, AccountSid: SHOP.twilio_account_sid, Body: 'different message' }) }],
  ['unresolved recipient', { shops: [] }, {}],
  ['ambiguous recipient even across accounts', { shops: [SHOP, { ...SHOP, id: 'shop-2', twilio_account_sid: `AC${'c'.repeat(32)}` }] }, {}],
  ['missing token despite API credentials', { shops: [{ ...SHOP, twilio_auth_token: null, twilio_api_key: 'key', twilio_api_secret: 'secret' }] }, {}],
  ['account mismatch even with valid signature', {}, { params: { AccountSid: `AC${'c'.repeat(32)}` } }],
  ['missing account', {}, { params: { AccountSid: '' } }],
  ['ambiguous form value', {}, { params: { From: [FROM, FROM] } }],
  ['lookup exception', { lookupError: true }, {}],
  ['missing public base', {}, { base: '' }],
  ['invalid public base', {}, { base: 'invalid' }],
  ['public base includes credentials', {}, { base: 'https://user:pass@sms.example.test' }],
  ['spoofed host URL', {}, { signedUrl: 'https://attacker.test/api/sms/webhook', headers: { host: 'attacker.test', 'x-forwarded-host': 'attacker.test', 'x-forwarded-proto': 'https' } }],
  ['wrong path', {}, { signedUrl: `${PUBLIC_BASE}/api/sms/inbound` }],
  ['unsigned query alteration', {}, { originalUrl: '/api/sms/webhook?route=changed' }],
]) {
  test(`webhook rejects ${label} before writes or replies without log leaks`, async () => {
    const h = webhookHarness(options);
    await captureLogs(async () => assert.equal((await h.call(request)).statusCode, 403));
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.autoCalls, 0);
    assert.equal(h.state.sends.length, 0);
    assert.equal(h.state.customer.sms_consent, true);
  });
}

test('trusted URL ignores hostile host/protocol and includes signed query and base prefix', async () => {
  const h = webhookHarness();
  await captureLogs(async () => {
    assert.equal((await h.call({ headers: { host: 'evil.test', 'x-forwarded-host': 'evil.test' } })).statusCode, 200);
    assert.equal((await h.call({ base: `${PUBLIC_BASE}/prefix/`, signedUrl: `${PUBLIC_BASE}/prefix/api/sms/webhook?x=1`, originalUrl: '/api/sms/webhook?x=1' })).statusCode, 200);
  });
});

test('environment token fallback uses the unique owned destination and matching account', async () => {
  const keys = ['TWILIO_ACCOUNT_SID', 'TWILIO_PHONE_NUMBER', 'TWILIO_AUTH_TOKEN'];
  const previous = keys.map(k => process.env[k]);
  Object.assign(process.env, { TWILIO_ACCOUNT_SID: SHOP.twilio_account_sid, TWILIO_PHONE_NUMBER: SHOP.twilio_phone_number, TWILIO_AUTH_TOKEN: SHOP.twilio_auth_token });
  try {
    await captureLogs(async () => {
      const options = { shops: [{ ...SHOP, twilio_auth_token: null }] };
      assert.equal((await webhookHarness(options).call()).statusCode, 200);
      process.env.TWILIO_ACCOUNT_SID = `AC${'c'.repeat(32)}`;
      assert.equal((await webhookHarness(options).call()).statusCode, 403);
      process.env.TWILIO_ACCOUNT_SID = SHOP.twilio_account_sid;
      process.env.TWILIO_PHONE_NUMBER = FROM;
      // Managed shop numbers can differ from the platform's default sender.
      assert.equal((await webhookHarness(options).call()).statusCode, 200);
      assert.equal((await webhookHarness(options).call({ params: { To: FROM } })).statusCode, 403);
    });
  } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
});

test('signed STOP clears evidence; signed START leaves consent unconfirmed', async () => {
  const h = webhookHarness();
  await captureLogs(async () => {
    assert.equal((await h.call({ body: 'STOP' })).statusCode, 200);
    assert.equal(h.state.optedOut, true);
    assert.deepEqual(h.state.customer, { sms_consent: false, sms_consent_at: null, sms_consent_method: null, sms_consent_by: null });
    assert.equal((await h.call({ body: 'START' })).statusCode, 200);
    assert.equal(h.state.optedOut, false);
    assert.equal(h.state.customer.sms_consent, false);
  });
  assert.equal(h.state.sends.length, 0);
});

for (const fault of ['roError', 'writeError', 'autoError', 'sendError']) {
  test(`authenticated ${fault} keeps raw exceptions out of webhook/auto-reply logs`, async () => {
    const h = webhookHarness({ [fault]: true });
    const logs = await captureLogs(async () => assert.equal((await h.call()).statusCode, 200));
    assert.match(logs, /failed/);
    if (fault === 'autoError') assert.equal(h.state.writes.length, 1);
  });
}

async function withEnv(values, fn) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  try { await fn(); } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }
}

const ENV_TOKEN = 'synthetic-platform-auth-token';
const ENV_SHOP = { ...SHOP, twilio_account_sid: null, twilio_auth_token: null };
const OTHER_SHOP = { ...ENV_SHOP, id: 'other-shop', twilio_phone_number: '+15550000002' };
const ENV_CONFIG = { TWILIO_ACCOUNT_SID: SHOP.twilio_account_sid, TWILIO_AUTH_TOKEN: ENV_TOKEN,
  TWILIO_PHONE_NUMBER: '+15550000003', PUBLIC_URL: undefined };

test('real env-token signature without stored SID accepts STOP only for destination owner', async () => {
  await withEnv(ENV_CONFIG, async () => {
    const h = webhookHarness({ shops: [ENV_SHOP, OTHER_SHOP] });
    const logs = await captureLogs(async () => {
      assert.equal((await h.call({ body: 'STOP', token: ENV_TOKEN,
        params: { shop_id: OTHER_SHOP.id } })).statusCode, 200);
    });
    assert.ok(!logs.includes(ENV_TOKEN));
    assert.equal(h.state.optedOut, true);
    assert.equal(h.state.customer.sms_consent, false);
    assert.equal(h.state.autoCalls, 1);
    assert.equal(h.state.sends.length, 0);
    assert.ok(h.state.writes.every(write => !write.params.includes(OTHER_SHOP.id)));
    assert.ok(h.state.writes.some(write => /INSERT INTO sms_opt_outs/.test(write.sql) && write.params[0] === SHOP.id));
  });
});

for (const [label, options, request, env] of [
  ['forged', {}, { token: 'forged' }],
  ['missing signature', {}, { signature: '' }],
  ['wrong account signed with platform token', {}, { params: { AccountSid: `AC${'c'.repeat(32)}` } }],
  ['unowned destination and attacker tenant', {}, { params: { To: '+15550000004', shop_id: SHOP.id } }],
  ['tampered destination after signing', {}, { params: { To: OTHER_SHOP.twilio_phone_number }, signature:
    twilio.getExpectedTwilioSignature(ENV_TOKEN, WEBHOOK_URL, { From: FROM, To: SHOP.twilio_phone_number, Body: 'STOP', AccountSid: SHOP.twilio_account_sid }) }],
  ['duplicate owned number', { shops: [ENV_SHOP, { ...ENV_SHOP, id: 'duplicate' }] }, {}],
  ['stored foreign account', { shops: [{ ...ENV_SHOP, twilio_account_sid: `AC${'d'.repeat(32)}` }] }, {}],
  ['missing public URL', {}, { base: '' }],
  ['missing env SID', {}, {}, { TWILIO_ACCOUNT_SID: undefined }],
  ['missing auth token with API key', {}, {}, { TWILIO_AUTH_TOKEN: undefined, TWILIO_API_KEY: 'synthetic-key', TWILIO_API_SECRET: 'synthetic-secret' }],
]) {
  test(`env webhook rejects ${label} before any writes/replies`, async () => {
    await withEnv({ ...ENV_CONFIG, ...env }, async () => {
      const h = webhookHarness({ shops: [ENV_SHOP, OTHER_SHOP], ...options });
      const logs = await captureLogs(async () => assert.equal((await h.call({ body: 'STOP', token: ENV_TOKEN, ...request })).statusCode, 403));
      assert.ok(!logs.includes(ENV_TOKEN));
      assert.equal(h.state.writes.length, 0);
      assert.equal(h.state.autoCalls, 0);
      assert.equal(h.state.sends.length, 0);
      assert.equal(h.state.customer.sms_consent, true);
    });
  });
}

function loadProvisioning(calls) {
  const filename = require.resolve('../services/smsProvisioning');
  const module = { exports: {} };
  const services = () => ({ phoneNumbers: { create: async data => { calls.push(['attach', data]); } } });
  services.create = async data => { calls.push(['service', data]); return { sid: 'MG_fixture' }; };
  const client = { messaging: { v1: { services } },
    availablePhoneNumbers: () => ({ local: { list: async () => [{ phoneNumber: SHOP.twilio_phone_number }] } }),
    incomingPhoneNumbers: { create: async data => { calls.push(['number', data]); return { phoneNumber: data.phoneNumber, sid: 'PN_fixture' }; } } };
  const mocks = {
    '../db': { dbGet: async () => ({ id: SHOP.id, name: 'Fixture' }), dbRun: async () => {} },
    './sms': { getTwilioConfigForShop: async () => ({ accountSid: SHOP.twilio_account_sid, authToken: ENV_TOKEN }), createTwilioClient: () => client },
    './smsWebhookConfig': require('../services/smsWebhookConfig'),
  };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected provisioning dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

for (const config of [{ APP_URL: PUBLIC_BASE }, { APP_URL: `${PUBLIC_BASE}/prefix/` }, { PUBLIC_URL: PUBLIC_BASE }]) {
  test(`provisioning callback equals actual mounted route for ${JSON.stringify(config)}`, async () => {
    await withEnv({ APP_URL: undefined, PUBLIC_URL: undefined, TWILIO_INBOUND_WEBHOOK_URL: undefined, ...config }, async () => {
      const calls = [];
      const provisioning = loadProvisioning(calls);
      const output = await provisioning.provisionSmsSenderForShop({ shopId: SHOP.id });
      const mount = fs.readFileSync(require.resolve('../app'), 'utf8').match(/app.use\('([^']+)', require\('\.\/routes\/sms'\)\)/)[1];
      const route = fs.readFileSync(require.resolve('../routes/sms'), 'utf8').match(/router.post\('([^']+)', express.urlencoded/)[1];
      const expected = `${(config.APP_URL || config.PUBLIC_URL).replace(/\/+$/, '')}${mount}${route}`;
      assert.equal(output.inbound_webhook_url, expected);
      assert.equal(calls.find(([kind]) => kind === 'service')[1].inboundRequestUrl, expected);
      assert.equal(calls.find(([kind]) => kind === 'number')[1].smsUrl, expected);
    });
  });
}

test('missing/invalid public base logs sanitized configuration error at module load without throwing', async () => {
  const filename = require.resolve('../services/smsWebhookConfig');
  for (const base of ['', `https://user:${ENV_TOKEN}@example.test`, `invalid-${PRIVATE_BODY}`]) {
    await withEnv({ APP_URL: base, PUBLIC_URL: undefined }, async () => {
      const module = { exports: {} };
      const logs = await captureLogs(async () => {
        assert.doesNotThrow(() => vm.runInThisContext(`(function(module){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(module));
        assert.equal(module.exports.inboundWebhookUrl(), null);
        assert.equal((await webhookHarness().call({ base })).statusCode, 403);
        const calls = [];
        await assert.rejects(loadProvisioning(calls).provisionSmsSenderForShop({ shopId: SHOP.id }), /configure APP_URL or PUBLIC_URL/);
        assert.deepEqual(calls, []);
      });
      assert.match(logs, /Inbound SMS disabled: configure APP_URL or PUBLIC_URL/);
      assert.ok(!logs.includes(ENV_TOKEN));
      assert.ok(!logs.includes('example.test'));
    });
  }
});

test('PUBLIC_URL alone authenticates a signed environment webhook', async () => {
  await withEnv({ ...ENV_CONFIG, PUBLIC_URL: PUBLIC_BASE }, async () => {
    const h = webhookHarness({ shops: [ENV_SHOP] });
    await captureLogs(async () => assert.equal((await h.call({ base: '', token: ENV_TOKEN, body: 'STOP' })).statusCode, 200));
    assert.equal(h.state.customer.sms_consent, false);
  });
});

test('provisioning rejects mismatched explicit callbacks before provider calls without exposing URLs', async () => {
  for (const useEnv of [false, true]) {
    const badUrl = `https://private.example.test/${ENV_TOKEN}`;
    await withEnv({ APP_URL: PUBLIC_BASE, TWILIO_INBOUND_WEBHOOK_URL: useEnv ? badUrl : undefined }, async () => {
      const calls = [];
      await assert.rejects(loadProvisioning(calls).provisionSmsSenderForShop({ shopId: SHOP.id, webhookUrl: useEnv ? undefined : badUrl }), error => {
        assert.match(error.message, /must match APP_URL\/PUBLIC_URL/);
        assert.ok(!error.message.includes(badUrl));
        assert.ok(!error.message.includes(ENV_TOKEN));
        return true;
      });
      assert.deepEqual(calls, []);
    });
  }
});
