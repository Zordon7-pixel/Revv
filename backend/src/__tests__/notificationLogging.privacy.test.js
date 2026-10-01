const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');

const privateValues = {
  phone: '+15559876543', fromPhone: '+15557654321', email: 'private-recipient@example.test',
  fromEmail: 'private-sender@example.test', subject: 'PRIVATE_SUBJECT_7829',
  body: 'PRIVATE_BODY_7829', token: 'sk_PRIVATE_TOKEN_7829', shop: 'PRIVATE_SHOP_7829',
};
const sensitive = Object.values(privateValues).join(' ');
const sid = `SM${'a'.repeat(32)}`;
const mailId = '12345678-1234-1234-1234-123456789abc';
const footer = '\n\nReply STOP to opt out, HELP for help.';

// Each test owns/restores module mocks, environment and every console method.
// The DB is replaced before loading SMS, so these tests never read .env or connect.
async function harness(run) {
  const paths = ['../services/mailer', '../services/sms', '../db', 'twilio'].map(require.resolve);
  const cached = paths.map(p => require.cache[p]);
  const envKeys = ['RESEND_API_KEY', 'RESEND_FROM', 'TWILIO_ACCOUNT_SID', 'TWILIO_PHONE_NUMBER',
    'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_AUTH_TOKEN'];
  const env = envKeys.map(k => process.env[k]);
  const originalFetch = global.fetch;
  const consoleMethods = Object.keys(console).filter(k => typeof console[k] === 'function' && k !== 'Console');
  const originals = consoleMethods.map(k => console[k]);
  const logs = [];
  const state = { fetchCalls: [], authCalls: [], sends: [], dbCalls: [], optedOut: false, shop: null };
  state.fetch = async () => { throw new Error('Unexpected fetch'); };
  state.send = async () => ({ sid });
  try {
    for (const p of paths) delete require.cache[p];
    for (const k of envKeys) delete process.env[k];
    consoleMethods.forEach(k => { console[k] = (...args) => logs.push([k, ...args]); });
    global.fetch = async (...args) => { state.fetchCalls.push(args); return state.fetch(...args); };
    require.cache[paths[2]] = { id: paths[2], filename: paths[2], loaded: true, exports: {
      dbGet: async (sql, params) => {
        state.dbCalls.push({ sql, params });
        return /sms_opt_outs/.test(sql) ? (state.optedOut ? { exists: 1 } : null) : state.shop;
      },
    } };
    require.cache[paths[3]] = { id: paths[3], filename: paths[3], loaded: true, exports: (...args) => {
      state.authCalls.push(args);
      return { messages: { create: async payload => { state.sends.push(payload); return state.send(payload); } } };
    } };
    await run(state, logs);
    const output = inspect(logs, { depth: null });
    for (const value of Object.values(privateValues)) assert.equal(output.includes(value), false, `Console leaked ${value}`);
    assert.ok(logs.length, 'Outcomes must still be logged');
  } finally {
    consoleMethods.forEach((k, i) => { console[k] = originals[i]; });
    global.fetch = originalFetch;
    envKeys.forEach((k, i) => { if (env[i] === undefined) delete process.env[k]; else process.env[k] = env[i]; });
    paths.forEach((p, i) => { if (cached[i]) require.cache[p] = cached[i]; else delete require.cache[p]; });
  }
}
function configureMail() {
  process.env.RESEND_API_KEY = privateValues.token;
  process.env.RESEND_FROM = privateValues.fromEmail;
  return require('../services/mailer').sendMail;
}
const mailArgs = [privateValues.email, privateValues.subject, privateValues.body];
const config = { accountSid: privateValues.token, authToken: privateValues.token,
  phoneNumber: privateValues.fromPhone, plan: 'pro', _source: sensitive };
const smsOptions = { shopId: privateValues.shop, twilioConfig: config };

test('mailer unconfigured returns null without logging recipient or subject or calling fetch', () => harness(async (s, logs) => {
  const result = await require('../services/mailer').sendMail(...mailArgs);
  assert.equal(result, null);
  assert.equal(s.fetchCalls.length, 0);
  assert.ok(logs.some(row => row.includes('[Mailer] No-op: Resend not configured')));
}));

test('mailer success preserves payload/result and logs only a validated reference', () => harness(async (s, logs) => {
  const send = configureMail();
  for (const id of [mailId, sensitive, { private: sensitive }, `${mailId}\n`, 'a'.repeat(1000)]) {
    const data = { id, private: sensitive };
    s.fetch = async () => ({ ok: true, json: async () => data });
    assert.equal(await send(...mailArgs), data);
    assert.deepEqual(logs.at(-1), ['log', '[Mailer] Sent via Resend; reference:', id === mailId ? mailId : 'unavailable']);
    const [url, request] = s.fetchCalls.at(-1);
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, `Bearer ${privateValues.token}`);
    assert.deepEqual(JSON.parse(request.body), { from: privateValues.fromEmail, to: [privateValues.email], subject: privateValues.subject, html: privateValues.body });
  }
  s.fetch = async () => ({ ok: true, json: async () => ({ id: mailId }) });
  await send([privateValues.email], ...mailArgs.slice(1));
  assert.deepEqual(JSON.parse(s.fetchCalls.at(-1)[1].body).to, [privateValues.email]);
}));

test('mailer rejection preserves thrown provider message but logs only bounded HTTP status', () => harness(async (s, logs) => {
  const send = configureMail();
  for (const status of [401, sensitive, { private: sensitive }, 999999, NaN]) {
    s.fetch = async () => ({ ok: false, status, json: async () => ({ message: sensitive, private: sensitive }) });
    await assert.rejects(send(...mailArgs), err => err.message === sensitive);
    assert.deepEqual(logs.at(-2), ['error', '[Mailer] Resend rejected send; HTTP status:', status === 401 ? 401 : 'unknown']);
    assert.deepEqual(logs.at(-1), ['error', '[Mailer] Send failed']);
  }
  s.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(send(...mailArgs), /Resend API error/);
}));

test('mailer transport and JSON failures rethrow the same error without logging it', () => harness(async s => {
  const send = configureMail();
  const error = Object.assign(new Error(sensitive), { code: sensitive });
  for (const jsonFailure of [false, true]) {
    s.fetch = async () => {
      if (!jsonFailure) throw error;
      return { ok: true, json: async () => { throw error; } };
    };
    await assert.rejects(send(...mailArgs), e => e === error);
  }
}));

test('SMS unconfigured and STOP/entitlement suppression preserve outcomes without provider calls', () => harness(async (s, logs) => {
  const { sendSMS, getTwilioConfigForShop } = require('../services/sms');
  assert.equal(await getTwilioConfigForShop(privateValues.shop), null);
  assert.deepEqual(await sendSMS(privateValues.phone, privateValues.body), { ok: false, reason: 'not configured', body: privateValues.body + footer });
  s.optedOut = true;
  assert.deepEqual(await sendSMS(privateValues.phone, privateValues.body, smsOptions), { ok: false, reason: 'opted_out', body: privateValues.body + footer });
  assert.deepEqual(s.dbCalls.at(-1).params, [privateValues.shop, privateValues.phone]);
  s.optedOut = false;
  assert.deepEqual(await sendSMS(privateValues.phone, privateValues.body, { ...smsOptions, twilioConfig: { ...config, plan: 'free' } }), { ok: false, reason: 'sms_not_entitled', body: privateValues.body + footer });
  assert.equal(s.authCalls.length, 0);
  assert.equal(s.sends.length, 0);
  assert.ok(logs.some(row => row.includes('[SMS] Suppressed send: opted_out')));
  assert.ok(logs.some(row => row.includes('[SMS] Suppressed send: sms_not_entitled')));
}));

test('SMS success preserves calls/body/SID for both auth modes and validates logged references', () => harness(async (s, logs) => {
  const { sendSMS } = require('../services/sms');
  for (const reference of [sid, sensitive, { private: sensitive }, `${sid}\n`, 'a'.repeat(1000)]) {
    s.send = async () => ({ sid: reference });
    assert.deepEqual(await sendSMS(privateValues.phone, privateValues.body, smsOptions), { ok: true, sid: reference, body: privateValues.body + footer });
    assert.deepEqual(s.sends.at(-1), { to: privateValues.phone, from: privateValues.fromPhone, body: privateValues.body + footer });
    assert.deepEqual(s.authCalls.at(-1), [config.accountSid, config.authToken]);
    assert.deepEqual(logs.at(-1), ['log', '[SMS] Sent successfully; reference:', reference === sid ? sid : 'unavailable']);
  }
  const apiConfig = { ...config, apiKey: privateValues.token, apiSecret: privateValues.token };
  s.send = async () => ({ sid });
  assert.deepEqual(await sendSMS(privateValues.phone, privateValues.body, { ...smsOptions, twilioConfig: apiConfig, customerFacing: false }), { ok: true, sid, body: privateValues.body });
  assert.deepEqual(s.authCalls.at(-1), [apiConfig.apiKey, apiConfig.apiSecret, { accountSid: apiConfig.accountSid }]);
}));

test('SMS failure preserves reason/body and logs only bounded numeric provider codes', () => harness(async (s, logs) => {
  const { sendSMS } = require('../services/sms');
  for (const code of [21610, '21610', sensitive, { private: sensitive }, '21610\n', 1234567890, NaN, undefined]) {
    s.send = async () => { throw Object.assign(new Error(sensitive), { code }); };
    assert.deepEqual(await sendSMS(privateValues.phone, privateValues.body, smsOptions), { ok: false, reason: sensitive, body: privateValues.body + footer });
    assert.deepEqual(logs.at(-1), ['error', '[SMS] Send failed; provider code:', code === 21610 || code === '21610' ? code : 'unknown']);
  }
}));

test('SMS DB/environment configuration logs no identity/auth values and preserves configuration', () => harness(async s => {
  const { getTwilioConfigForShop } = require('../services/sms');
  process.env.TWILIO_ACCOUNT_SID = privateValues.token;
  process.env.TWILIO_AUTH_TOKEN = privateValues.token;
  process.env.TWILIO_PHONE_NUMBER = privateValues.fromPhone;
  assert.equal((await getTwilioConfigForShop()).authToken, privateValues.token);
  assert.equal((await getTwilioConfigForShop(privateValues.shop))._source, 'env');
  s.shop = { plan: 'pro', twilio_account_sid: privateValues.token, twilio_phone_number: privateValues.fromPhone,
    twilio_api_key: privateValues.token, twilio_api_secret: privateValues.token, twilio_auth_token: privateValues.token };
  assert.equal((await getTwilioConfigForShop(privateValues.shop)).apiSecret, privateValues.token);
  delete s.shop.twilio_api_key;
  assert.equal((await getTwilioConfigForShop(privateValues.shop)).authToken, privateValues.token);
}));
