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
      assert.deepEqual(params, [SHOP.twilio_phone_number]);
      if (options.lookupError) throw new Error(LEAK);
      return options.shops || [SHOP];
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

test('environment token fallback is restricted to the resolved account AND recipient', async () => {
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
      assert.equal((await webhookHarness(options).call()).statusCode, 403);
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
