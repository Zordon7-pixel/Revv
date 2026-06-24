const assert = require('node:assert/strict');
const test = require('node:test');

const {
  INBOUND_AUTO_REPLY_TEMPLATE,
  autoReplyBodyForShop,
  maybeSendInboundAutoReply,
} = require('../services/smsAutoReply');

const SHOP = {
  id: 'shop-1',
  name: 'Miles Collision',
  plan: 'pro',
  twilio_account_sid: 'AC123',
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

test('webhook saves inbound and returns empty TwiML 200 when auto-reply throws', async () => {
  const routePath = require.resolve('../routes/sms');
  const dbPath = require.resolve('../db');
  const smsPath = require.resolve('../services/sms');
  const autoReplyPath = require.resolve('../services/smsAutoReply');
  const authPath = require.resolve('../middleware/auth');
  const rolesPath = require.resolve('../middleware/roles');
  const originals = {
    route: require.cache[routePath],
    db: require.cache[dbPath],
    sms: require.cache[smsPath],
    autoReply: require.cache[autoReplyPath],
    auth: require.cache[authPath],
    roles: require.cache[rolesPath],
  };
  const dbRuns = [];

  try {
    delete require.cache[routePath];
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        dbAll: async () => [],
        dbGet: async (sql) => {
          if (/FROM shops/.test(sql)) return SHOP;
          if (/FROM repair_orders/.test(sql)) return { id: 'ro-1' };
          return null;
        },
        dbRun: async (sql, params) => {
          dbRuns.push({ sql, params });
          return { rowCount: 1 };
        },
      },
    };
    require.cache[smsPath] = {
      id: smsPath,
      filename: smsPath,
      loaded: true,
      exports: {
        sendSMS: async () => ({ ok: true }),
        isConfiguredForShop: async () => true,
        getTwilioConfigForShop: async () => ({ phoneNumber: SHOP.twilio_phone_number }),
      },
    };
    require.cache[autoReplyPath] = {
      id: autoReplyPath,
      filename: autoReplyPath,
      loaded: true,
      exports: {
        maybeSendInboundAutoReply: async () => {
          throw new Error('auto reply failed');
        },
      },
    };
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: (req, res, next) => next(),
    };
    require.cache[rolesPath] = {
      id: rolesPath,
      filename: rolesPath,
      loaded: true,
      exports: { requireAdmin: (req, res, next) => next() },
    };

    const router = require('../routes/sms');
    const webhook = router.stack.find((layer) => (
      layer.route?.path === '/webhook' && layer.route?.methods?.post
    )).route.stack.at(-1).handle;
    const req = { body: { From: FROM, To: SHOP.twilio_phone_number, Body: 'Hello' } };
    const res = {
      statusCode: null,
      sent: null,
      contentType: null,
      type(value) {
        this.contentType = value;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(payload) {
        this.sent = payload;
        return this;
      },
    };

    await webhook(req, res);

    assert.equal(dbRuns.length, 1);
    assert.match(dbRuns[0].sql, /INSERT INTO sms_messages/);
    assert.equal(res.contentType, 'text/xml');
    assert.equal(res.statusCode, 200);
    assert.equal(res.sent, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } finally {
    for (const [key, cacheEntry] of Object.entries(originals)) {
      const path = { route: routePath, db: dbPath, sms: smsPath, autoReply: autoReplyPath, auth: authPath, roles: rolesPath }[key];
      delete require.cache[path];
      if (cacheEntry) require.cache[path] = cacheEntry;
    }
  }
});
