'use strict';

// Pure policy: no process, database, provider, startup or network dependencies.
const SETTING = 'REVV_SMS_TEST_RECIPIENT';
const MODE_SETTING = 'REVV_SMS_TEST_MODE';
const GUARD = 'sms_test_recipient';

function canonicalE164(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\+[1-9][0-9]{7,14}$/.test(trimmed) ? trimmed : null;
}

function policy(env) {
  const configured = Object.prototype.hasOwnProperty.call(env, SETTING);
  const mode = env[MODE_SETTING];
  // Only these exact mode values are understood. Empty mode alone is inactive.
  const modeValid = mode === undefined || mode === '' || mode === 'false' || mode === 'true';
  const enabled = configured || mode === 'true' || !modeValid;
  const recipient = configured ? canonicalE164(env[SETTING]) : null;
  return { configured, enabled, valid: modeValid && recipient !== null, recipient };
}

function inspectSmsTestRecipient(env) {
  const state = policy(env);
  return {
    setting: SETTING,
    enabled: state.enabled,
    configured: state.configured,
    valid: state.valid,
    recipient_count: state.valid ? 1 : 0,
    last4: state.valid ? state.recipient.slice(-4) : null,
    guard: GUARD,
  };
}

// previouslyEnabled is a server-local latch, never a caller/request option.
function checkSmsTestRecipient(target, env, previouslyEnabled = false) {
  const state = policy(env);
  const enabled = previouslyEnabled || state.enabled;
  if (!enabled) return { enabled: false, allowed: true, target };
  if (!state.valid) return { enabled: true, allowed: false, reason: 'sms_test_recipient_config_invalid' };
  const canonical = canonicalE164(target);
  if (canonical === null || canonical !== state.recipient) {
    return { enabled: true, allowed: false, reason: 'sms_test_recipient_denied' };
  }
  return { enabled: true, allowed: true, target: canonical };
}

module.exports = { SETTING, MODE_SETTING, GUARD, inspectSmsTestRecipient, checkSmsTestRecipient };
