'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const policy = require('../src/services/smsTestRecipient');
const consent = require('../src/services/customerConsent');

// Synthetic reserved fictional NANP fixtures; never put values in test titles,
// assertion diffs or console output. No inherited environment reaches the SUT.
const recipient = '+1' + '202' + '555' + '0101';
const other = '+1' + '202' + '555' + '0102';
const sender = '+1' + '202' + '555' + '0100';
const recipientEnv = value => ({ [policy.SETTING]: value });
const activeEnv = () => recipientEnv(recipient);
const smsFile = path.resolve(__dirname, '../src/services/sms.js');
const scriptFile = path.resolve(__dirname, '../scripts/inspect-sms-test-recipient.js');
const policyFile = path.resolve(__dirname, '../src/services/smsTestRecipient.js');

function harness(env = {}) {
  const state = {
    env, constructions: 0, calls: [], logs: [], queries: [], stopped: false,
    staffPhone: recipient,
    customers: [consent.consentMutation({ sms_consent: true, sms_consent_method: 'written' }, 'synthetic-staff')],
    shop: { plan: 'pro', twilio_account_sid: 'synthetic-account',
      twilio_auth_token: 'synthetic-token', twilio_phone_number: sender },
  };
  async function beforeQuery(kind, sql, params) {
    state.queries.push(kind);
    assert.ok(sql.includes('shop_id = $1') || sql.includes('shop_id = $2') || sql.includes('WHERE id = $1'));
    if (kind === 'staff') {
      assert.ok(params[1] === 'synthetic-shop');
    } else {
      assert.ok(params[0] === 'synthetic-shop');
    }
    await state.onQuery?.(kind);
    if (state.failQuery === kind) throw new Error('Synthetic lookup failure');
  }
  const db = {
    dbGet: async (sql, params) => {
      if (sql.includes('FROM sms_opt_outs')) {
        await beforeQuery('stop', sql, params);
        return state.stopped ? { exists: 1 } : null;
      }
      if (sql.includes('FROM shops')) {
        await beforeQuery('shop', sql, params);
        return state.shop;
      }
      if (sql.includes('FROM users')) {
        await beforeQuery('staff', sql, params);
        return params[0] === 'synthetic-staff' ? { phone: state.staffPhone } : null;
      }
      throw new Error('Unexpected mock query');
    },
    dbAll: async (sql, params) => {
      assert.ok(sql.includes('FROM customers'));
      await beforeQuery('consent', sql, params);
      return state.customers;
    },
  };
  const mocks = {
    '../db': db,
    './customerConsent': consent,
    './smsTestRecipient': policy,
    twilio: () => {
      state.constructions++;
      return { messages: { create: async payload => {
        state.calls.push(payload);
        return { sid: `SM${'a'.repeat(32)}` };
      } } };
    },
  };
  const module = { exports: {} };
  const log = (...args) => state.logs.push(args.join(' '));
  const sandbox = {
    module, exports: module.exports, process: { env },
    console: { log, warn: log, error: log },
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error('Unexpected dependency; real DB/provider/network prohibited');
    },
  };
  vm.runInNewContext(fs.readFileSync(smsFile, 'utf8'), sandbox, { filename: smsFile });
  return { state, sms: module.exports, send: (target = recipient, options = 'synthetic-shop') =>
    module.exports.sendSMS(target, 'Synthetic message', options) };
}

function assertPrivate(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!/\+[0-9]{8,15}/.test(text), 'No full E.164 values may appear in output');
  assert.ok(!text.includes('synthetic-token'), 'No configuration secrets may appear in output');
}

function denied(h, result, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.provider_attempted, false);
  if (reason) assert.equal(result.reason, reason);
  assert.equal(h.state.constructions, 0);
  assert.equal(h.state.calls.length, 0);
  assertPrivate(result.reason);
  assertPrivate(h.state.logs);
}

test('absent settings, false mode and empty mode preserve the ordinary raw target and footer', async () => {
  for (const env of [{}, { REVV_SMS_TEST_MODE: 'false' }, { REVV_SMS_TEST_MODE: '' }]) {
    const h = harness(env);
    const raw = ' ' + other + ' ';
    const result = await h.send(raw);
    assert.equal(result.ok, true);
    assert.equal(h.state.constructions, 1);
    assert.ok(h.state.calls[0].to === raw, 'Inactive policy preserves baseline destination');
    assert.equal(h.state.calls[0].body, 'Synthetic message\n\nReply STOP to opt out, HELP for help.');
    assertPrivate(h.state.logs);
  }
});

const invalidConfigs = [undefined, '', ' ', 'invalid', recipient + ',' + other,
  recipient + ';' + other, recipient + '\n' + other, JSON.stringify([recipient]),
  recipient.slice(1), '+0' + '1234567', '+1' + '234567', '+1' + '2'.repeat(15),
  recipient + 'abc', recipient + ' ext 1', recipient.slice(0, 3) + ' ' + recipient.slice(3)];
for (const [index, value] of invalidConfigs.entries()) {
  test(`test mode fails closed for missing or invalid recipient configuration case ${index}`, async () => {
    const env = { REVV_SMS_TEST_MODE: 'true' };
    if (value !== undefined) env[policy.SETTING] = value;
    const h = harness(env);
    denied(h, await h.send(), 'sms_test_recipient_config_invalid');
    assert.equal(h.state.queries.length, 0);
  });
}

test('recipient presence activates even with false mode; malformed presence fails closed without mode', async () => {
  for (const value of invalidConfigs.slice(1)) {
    for (const mode of [undefined, 'false']) {
      const env = recipientEnv(value);
      if (mode !== undefined) env.REVV_SMS_TEST_MODE = mode;
      const h = harness(env);
      denied(h, await h.send(), 'sms_test_recipient_config_invalid');
    }
  }
  const h = harness({ ...activeEnv(), REVV_SMS_TEST_MODE: 'false' });
  denied(h, await h.send(other), 'sms_test_recipient_denied');
});

test('invalid nonempty modes fail closed even with a valid recipient', async () => {
  for (const mode of ['TRUE', 'False', '0', '1', 'yes', ' true ', ' ', 'invalid']) {
    for (const env of [{ REVV_SMS_TEST_MODE: mode }, { ...activeEnv(), REVV_SMS_TEST_MODE: mode }]) {
      const h = harness(env);
      denied(h, await h.send(), 'sms_test_recipient_config_invalid');
    }
  }
});

test('one exact recipient and trim-only variant reach the mock with existing gates and canonical target', async () => {
  for (const mode of [undefined, 'false', 'true']) {
    for (const plan of ['pro', 'agency', 'comp']) {
      const env = recipientEnv(' \t' + recipient + '\n');
      if (mode !== undefined) env.REVV_SMS_TEST_MODE = mode;
      const h = harness(env);
      h.state.shop.plan = plan;
      h.state.shop.sms_comp = plan === 'comp';
      const result = await h.send(' \t' + recipient + '\n');
      assert.equal(result.ok, true);
      assert.equal(h.state.constructions, 1);
      assert.equal(h.state.calls.length, 1);
      assert.ok(h.state.calls[0].to === recipient, 'Provider must receive exactly the validated target');
      assert.ok(h.state.calls[0].from === sender);
      assert.deepEqual(h.state.queries, ['stop', 'consent', 'shop']);
      assert.equal(result.body, 'Synthetic message\n\nReply STOP to opt out, HELP for help.');
      assertPrivate(h.state.logs);
    }
  }
});

test('strict target validation rejects different numbers, suffixes, letters and international collisions', async () => {
  const targets = [other, '', undefined, null, 123, {}, recipient.slice(1), recipient + 'abc',
    'letters' + recipient, recipient + ' ext 0', recipient + '\n' + other,
    recipient + ',' + other, '+44' + recipient.slice(2), recipient.slice(0, 4) + '-' + recipient.slice(4),
    recipient + '0', '+0' + recipient.slice(2), recipient.replace('5', '５')];
  for (const target of targets) {
    const h = harness(activeEnv());
    denied(h, await h.sms.sendSMS(target, 'Synthetic message', 'synthetic-shop'), 'sms_test_recipient_denied');
    assert.equal(h.state.queries.length, 0);
  }
});

test('caller config, JSON flags and customerFacing cannot disable restriction or consent', async () => {
  const options = JSON.parse(JSON.stringify({ shopId: 'synthetic-shop', customerFacing: false,
    skipOptOutCheck: true, test: false, testMode: false, smsTestMode: false,
    REVV_SMS_TEST_MODE: false, REVV_SMS_TEST_RECIPIENT: other,
    twilioConfig: { plan: 'pro', accountSid: 'synthetic-account', authToken: 'synthetic-token',
      phoneNumber: sender, REVV_SMS_TEST_MODE: 'false', REVV_SMS_TEST_RECIPIENT: other } }));
  const h = harness(activeEnv());
  denied(h, await h.send(other, options), 'sms_test_recipient_denied');
  h.state.customers = [];
  denied(h, await h.send(recipient, options), 'no_confirmed_consent');
});

test('allowlisted customer still needs scope, confirmed consent, STOP clearance and entitlement', async () => {
  const cases = [
    ['missing_recipient_scope', () => {}, { shopId: '' }],
    ['opted_out', s => { s.stopped = true; }],
    ['no_confirmed_consent', s => { s.customers = []; }],
    ['no_confirmed_consent', s => { s.customers[0].sms_consent = false; }],
    ['no_confirmed_consent', s => { s.customers[0].sms_consent_at = null; }],
    ['no_confirmed_consent', s => { s.customers[0].sms_consent_method = 'ocr'; }],
    ['no_confirmed_consent', s => { s.customers[0].sms_consent_by = ''; }],
    ['no_confirmed_consent', s => { s.customers.push({ sms_consent: true }); }],
    ['consent_lookup_failed', s => { s.failQuery = 'stop'; }],
    ['consent_lookup_failed', s => { s.failQuery = 'consent'; }],
    ['sms_not_entitled', s => { s.shop.plan = 'starter'; }],
    ['sms_not_entitled', s => { s.shop = null; }, { shopId: 'synthetic-shop', twilioConfig: { accountSid: 'synthetic' } }],
    ['sms_not_entitled', () => {}, { shopId: 'synthetic-shop', twilioConfig: { plan: 'starter' } }],
    ['not configured', s => { s.shop.twilio_auth_token = null; }],
  ];
  for (const [reason, setup, options] of cases) {
    for (const env of [{}, activeEnv()]) {
      const h = harness(env);
      setup(h.state);
      denied(h, await h.send(recipient, options), reason);
    }
  }
});

test('staff path uses the same restriction and retains staff lookup, STOP, plan and footer semantics', async () => {
  for (const env of [{ REVV_SMS_TEST_MODE: 'true' }, recipientEnv('')]) {
    const h = harness(env);
    denied(h, await h.sms.sendStaffSMS('synthetic-staff', 'Staff message', { shopId: 'synthetic-shop' }), 'sms_test_recipient_config_invalid');
  }
  for (const target of [other, recipient + 'suffix']) {
    const h = harness(activeEnv());
    h.state.staffPhone = target;
    denied(h, await h.sms.sendStaffSMS('synthetic-staff', 'Staff message', { shopId: 'synthetic-shop' }), 'sms_test_recipient_denied');
  }
  for (const [reason, setup] of [
    ['opted_out', s => { s.stopped = true; }],
    ['sms_not_entitled', s => { s.shop.plan = 'starter'; }],
  ]) {
    const h = harness(activeEnv());
    setup(h.state);
    denied(h, await h.sms.sendStaffSMS('synthetic-staff', 'Staff message', { shopId: 'synthetic-shop' }), reason);
  }
  const h = harness(activeEnv());
  h.state.customers = []; // Existing private staff capability, never a new consent bypass.
  const result = await h.sms.sendStaffSMS('synthetic-staff', 'Staff message', { shopId: 'synthetic-shop' });
  assert.equal(result.ok, true);
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.calls[0].body, 'Staff message');
  assert.ok(h.state.calls[0].to === recipient);
  assert.deepEqual(h.state.queries, ['staff', 'stop', 'shop']);
});

test('environment changes across each async gate are revalidated before provider construction', async () => {
  for (const stage of ['stop', 'consent', 'shop']) {
    for (const change of [
      env => { env[policy.SETTING] = other; },
      env => { env[policy.SETTING] = ''; },
      env => { delete env[policy.SETTING]; },
      env => { env.REVV_SMS_TEST_MODE = 'invalid'; },
    ]) {
      const h = harness(activeEnv());
      h.state.onQuery = async kind => { if (kind === stage) change(h.state.env); };
      denied(h, await h.send());
    }
    for (const change of [
      env => { env[policy.SETTING] = other; },
      env => { env.REVV_SMS_TEST_MODE = 'true'; },
      env => { env.REVV_SMS_TEST_MODE = 'invalid'; },
    ]) {
      const h = harness();
      h.state.onQuery = async kind => { if (kind === stage) change(h.state.env); };
      denied(h, await h.send());
    }
  }
});

test('late activation validates the original raw target and canonicalizes only a valid trim-only target', async () => {
  for (const target of [recipient + 'suffix', ' ' + recipient + ' ']) {
    const h = harness();
    h.state.onQuery = async kind => { if (kind === 'shop') h.state.env[policy.SETTING] = recipient; };
    const result = await h.send(target);
    if (target.endsWith('suffix')) denied(h, result, 'sms_test_recipient_denied');
    else {
      assert.equal(result.ok, true);
      assert.ok(h.state.calls[0].to === recipient);
    }
  }
});

test('inspection enforces E.164 length boundaries and reports no full recipient', () => {
  for (const length of [7, 8, 15, 16]) {
    const value = '+1' + '2'.repeat(length - 1);
    const inspected = policy.inspectSmsTestRecipient(recipientEnv(value));
    const valid = length === 8 || length === 15;
    assert.equal(inspected.valid, valid);
    assert.equal(inspected.recipient_count, valid ? 1 : 0);
    assert.ok(inspected.last4 === (valid ? value.slice(-4) : null));
    assertPrivate(inspected);
  }
});

test('pure helper and dry-run have a closed import boundary and cannot send or mutate', () => {
  const pureModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(policyFile, 'utf8'), {
    module: pureModule,
    require() { throw new Error('Policy must have no imports'); },
  }, { filename: policyFile });
  const env = Object.freeze(activeEnv());
  const runtime = { env };
  const lines = [];
  vm.runInNewContext(fs.readFileSync(scriptFile, 'utf8'), {
    process: runtime,
    console: { log: line => lines.push(line) },
    require(name) {
      assert.equal(name, '../src/services/smsTestRecipient');
      return pureModule.exports;
    },
  }, { filename: scriptFile });
  assert.equal(runtime.exitCode, 0);
  assert.equal(lines.length, 1);
  assertPrivate(lines[0]);
});

test('dry-run JSON is configuration proof only, masked, and exits nonzero for missing or invalid config', () => {
  for (const env of [{}, { REVV_SMS_TEST_MODE: 'true' }, recipientEnv(''),
    recipientEnv(recipient + ',' + other), { ...activeEnv(), REVV_SMS_TEST_MODE: 'invalid' }, activeEnv()]) {
    // Explicit environment, no shell, no installed configuration, no dotenv.
    const result = spawnSync(process.execPath, [scriptFile], { env, encoding: 'utf8' });
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, '');
    assertPrivate(result.stdout);
    const output = JSON.parse(result.stdout);
    const valid = env[policy.SETTING] === recipient && !env.REVV_SMS_TEST_MODE;
    assert.equal(result.status, valid ? 0 : 1);
    assert.deepEqual(Object.keys(output).sort(), ['setting', 'enabled', 'configured', 'valid', 'recipient_count', 'last4', 'guard'].sort());
    assert.equal(output.setting, policy.SETTING);
    assert.equal(output.guard, policy.GUARD);
    assert.equal(output.enabled, Object.hasOwn(env, policy.SETTING) || Boolean(env.REVV_SMS_TEST_MODE));
    assert.equal(output.configured, Object.hasOwn(env, policy.SETTING));
    assert.equal(output.valid, valid);
    assert.equal(output.recipient_count, valid ? 1 : 0);
    assert.ok(output.last4 === (valid ? recipient.slice(-4) : null));
  }
});
