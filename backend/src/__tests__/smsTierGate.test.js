const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { maybeSendInboundAutoReply } = require('../services/smsAutoReply');
const { smsEntitled } = require('../services/sms');

const SHOP_BASE = {
  id: 'shop-1',
  name: 'Tier Gate Collision',
  twilio_account_sid: 'AC123',
  twilio_auth_token: 'token',
  twilio_phone_number: '+18668259523',
};
const CUSTOMER_PHONE = '+15551234567';

function clearModule(pathname) {
  delete require.cache[pathname];
}

test('smsEntitled allows pro, agency, and complimentary shops only', () => {
  assert.equal(smsEntitled({ plan: 'pro', sms_comp: false }), true);
  assert.equal(smsEntitled({ plan: 'agency', sms_comp: false }), true);
  assert.equal(smsEntitled({ plan: 'free', sms_comp: true }), true);
  assert.equal(smsEntitled({ plan: 'free', sms_comp: false }), false);
  assert.equal(smsEntitled({ sms_comp: false }), false);
  assert.equal(smsEntitled(null), false);
});

test('sendSMS blocks free non-comp shops before Twilio is called', async () => {
  const { sendSMS, calls } = loadSmsWithMocks({ plan: 'free', sms_comp: false });

  const result = await sendSMS(CUSTOMER_PHONE, 'Hello', { shopId: SHOP_BASE.id });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'sms_not_entitled');
  assert.equal(calls.twilio, 0);
  assert.equal(calls.messagesCreate, 0);
});

test('sendSMS sends for pro, agency, and complimentary shops', async () => {
  for (const shopPatch of [
    { plan: 'pro', sms_comp: false },
    { plan: 'agency', sms_comp: false },
    { plan: 'free', sms_comp: true },
  ]) {
    const { sendSMS, calls } = loadSmsWithMocks(shopPatch);

    const result = await sendSMS(CUSTOMER_PHONE, 'Hello', { shopId: SHOP_BASE.id });

    assert.equal(result.ok, true);
    assert.equal(result.sid, 'SM123');
    assert.equal(calls.twilio, 1);
    assert.equal(calls.messagesCreate, 1);
  }
});

test('auto-reply suppresses normal inbound for free non-comp shops before sending', async () => {
  const sendCalls = [];
  const db = makeMockDb();

  const result = await maybeSendInboundAutoReply({
    shop: { ...SHOP_BASE, plan: 'free', sms_comp: false },
    from: CUSTOMER_PHONE,
    to: SHOP_BASE.twilio_phone_number,
    body: 'Can you call me?',
    db,
    send: async (...args) => {
      sendCalls.push(args);
      return { ok: true };
    },
  });

  assert.deepEqual(result, { action: 'suppressed', reason: 'not_entitled' });
  assert.equal(sendCalls.length, 0);
  assert.equal(db.state.runs.length, 0);
});

test('auto-reply records STOP opt-out even when shop is not entitled', async () => {
  const sendCalls = [];
  const db = makeMockDb();

  const result = await maybeSendInboundAutoReply({
    shop: { ...SHOP_BASE, plan: 'free', sms_comp: false },
    from: CUSTOMER_PHONE,
    to: SHOP_BASE.twilio_phone_number,
    body: 'STOP',
    db,
    send: async (...args) => {
      sendCalls.push(args);
      return { ok: true };
    },
  });

  assert.deepEqual(result, { action: 'opt_out', reason: 'stop_keyword' });
  assert.equal(db.state.optOuts.has(`${SHOP_BASE.id}:${CUSTOMER_PHONE}`), true);
  assert.equal(sendCalls.length, 0);
});

test('migration grandfathers Miles by toll-free number', () => {
  const migratePath = path.join(__dirname, '..', 'db', 'migrate.js');
  const source = fs.readFileSync(migratePath, 'utf8');

  assert.match(source, /ALTER TABLE shops ADD COLUMN IF NOT EXISTS sms_comp BOOLEAN DEFAULT FALSE/);
  assert.match(source, /UPDATE shops SET sms_comp = TRUE WHERE twilio_phone_number = '\+18668259523' AND sms_comp IS DISTINCT FROM TRUE/);
});

function loadSmsWithMocks(shopPatch) {
  const smsPath = require.resolve('../services/sms');
  const dbPath = require.resolve('../db');
  const twilioPath = require.resolve('twilio');
  const shop = { ...SHOP_BASE, ...shopPatch };
  const calls = { twilio: 0, messagesCreate: 0 };

  clearModule(smsPath);
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      dbGet: async (sql) => {
        if (/FROM sms_opt_outs/.test(sql)) return null;
        if (/FROM shops/.test(sql)) return shop;
        return null;
      },
    },
  };
  require.cache[twilioPath] = {
    id: twilioPath,
    filename: twilioPath,
    loaded: true,
    exports: () => {
      calls.twilio += 1;
      return {
        messages: {
          create: async () => {
            calls.messagesCreate += 1;
            return { sid: 'SM123' };
          },
        },
      };
    },
  };

  return { sendSMS: require('../services/sms').sendSMS, calls };
}

function makeMockDb() {
  const state = {
    optOuts: new Set(),
    runs: [],
  };

  return {
    state,
    async get() {
      return null;
    },
    async run(sql, params) {
      state.runs.push({ sql, params });
      if (/INSERT INTO sms_opt_outs/.test(sql)) {
        state.optOuts.add(`${params[0]}:${params[1]}`);
      }
      return { rowCount: 1 };
    },
  };
}
