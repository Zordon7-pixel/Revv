const twilio = require('twilio');
const { dbGet, dbAll } = require('../db');
const { hasConfirmedSmsConsent } = require('./customerConsent');

// Only the staff wrapper can supply this capability; JSON options cannot.
const STAFF_NOTIFICATION = Symbol('staff notification');
function phoneKey(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}
// Normalize punctuation and the optional US country prefix, without matching
// suffixes of unrelated international numbers. Column names are server constants.
function phoneMatchSql(column, parameter = '$2') {
  const digits = `regexp_replace(COALESCE(${column}, ''), '[^0-9]', '', 'g')`;
  return `(CASE WHEN length(${digits}) = 10 THEN '1' || ${digits} ELSE ${digits} END) = ${parameter}`;
}

async function sendStaffSMS(staffId, message, { shopId } = {}) {
  if (!shopId || !staffId) return { ok: false, reason: 'missing_staff', provider_attempted: false };
  const staff = await dbGet(
    "SELECT phone FROM users WHERE id = $1 AND shop_id = $2 AND role IN ('admin', 'owner', 'manager', 'technician')",
    [staffId, shopId]
  );
  if (!staff?.phone) return { ok: false, reason: 'missing_staff', provider_attempted: false };
  return sendSMS(staff.phone, message, { shopId }, STAFF_NOTIFICATION);
}

const SMS_OPT_OUT_FOOTER = 'Reply STOP to opt out, HELP for help.';
const OPT_OUT_PATTERN = /\b(reply|text)\s+stop\b|\bstop\s+to\s+(opt\s*-?\s*out|unsubscribe|cancel)\b|\bopt\s*-?\s*out\b|\bunsubscribe\b/i;

function messageWithComplianceFooter(message, options = {}) {
  const body = String(message || '').trim();
  if (!body) return body;
  if (options.customerFacing === false) return body;
  if (OPT_OUT_PATTERN.test(body)) return body;
  return `${body}\n\n${SMS_OPT_OUT_FOOTER}`;
}

function getEnvTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !phoneNumber) return null;

  // Prefer API Key + Secret if provided (more secure, scoped credentials)
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  if (apiKey && apiSecret) {
    return { accountSid, apiKey, apiSecret, phoneNumber };
  }

  // Fall back to Auth Token
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return null;
  return { accountSid, authToken, phoneNumber };
}

function getTwilioConfig() {
  return getEnvTwilioConfig();
}

function smsEntitled(shop) {
  return Boolean(shop && (
    shop.plan === 'pro' ||
    shop.plan === 'agency' ||
    shop.sms_comp === true
  ));
}

async function getSmsShop(shopId) {
  if (!shopId) return null;
  return dbGet(
    `SELECT twilio_account_sid, twilio_auth_token, twilio_phone_number, twilio_api_key, twilio_api_secret,
            plan, sms_comp
     FROM shops
     WHERE id = $1`,
    [shopId]
  );
}

function twilioConfigFromShop(shop, shopId) {
  const hasApiKeyCreds = !!(shop?.twilio_account_sid && shop?.twilio_api_key && shop?.twilio_api_secret && shop?.twilio_phone_number);
  const hasAuthTokenCreds = !!(shop?.twilio_account_sid && shop?.twilio_auth_token && shop?.twilio_phone_number);

  if (shopId) {
    console.log('[SMS] Resolving shop configuration');
  }

  if (hasApiKeyCreds) {
    return {
      accountSid: shop.twilio_account_sid,
      apiKey: shop.twilio_api_key,
      apiSecret: shop.twilio_api_secret,
      phoneNumber: shop.twilio_phone_number,
      plan: shop.plan,
      sms_comp: shop.sms_comp,
      _source: 'db',
    };
  }
  if (hasAuthTokenCreds) {
    return {
      accountSid: shop.twilio_account_sid,
      authToken: shop.twilio_auth_token,
      phoneNumber: shop.twilio_phone_number,
      plan: shop.plan,
      sms_comp: shop.sms_comp,
      _source: 'db',
    };
  }

  const envConfig = getEnvTwilioConfig();
  if (envConfig) {
    console.log('[SMS] Using environment configuration');
  } else {
    console.warn('[SMS] No Twilio configuration found');
  }
  return envConfig ? { ...envConfig, plan: shop?.plan, sms_comp: shop?.sms_comp, _source: 'env' } : null;
}

async function getTwilioConfigForShop(shopId) {
  if (shopId) {
    const shop = await getSmsShop(shopId);
    return twilioConfigFromShop(shop, shopId);
  }
  const envConfig = getEnvTwilioConfig();
  if (envConfig) {
    console.log('[SMS] Using environment configuration');
  } else {
    console.warn('[SMS] No Twilio configuration found');
  }
  return envConfig ? { ...envConfig, _source: 'env' } : null;
}

function isConfigured() {
  return Boolean(getTwilioConfig());
}

async function isConfiguredForShop(shopId) {
  return Boolean(await getTwilioConfigForShop(shopId));
}

async function sendSMS(phone, message, options = {}, audienceToken) {
  const shopId = typeof options === 'string' ? options : options?.shopId;
  const providedConfig = typeof options === 'object' ? options?.twilioConfig : null;
  const internal = audienceToken === STAFF_NOTIFICATION;
  const finalMessage = messageWithComplianceFooter(message, { customerFacing: !internal });
  const suppress = reason => {
    console.warn('[SMS] Suppressed send:', reason);
    // Only local pre-provider exits establish that no send was attempted.
    return { ok: false, reason, body: finalMessage, provider_attempted: false };
  };
  const key = phoneKey(phone);
  if (!shopId || !key) return suppress('missing_recipient_scope');
  try {
    // STOP applies even to reconfirmed customers and internal notifications.
    // skipOptOutCheck/customerFacing from callers are deliberately ignored.
    const optedOut = await dbGet(
      `SELECT 1 FROM sms_opt_outs WHERE shop_id = $1 AND ${phoneMatchSql('phone')} LIMIT 1`,
      [shopId, key]
    );
    if (optedOut) return suppress('opted_out');
    if (!internal) {
      const customers = await dbAll(
        `SELECT sms_consent, sms_consent_at, sms_consent_method, sms_consent_by
         FROM customers WHERE shop_id = $1 AND ${phoneMatchSql('phone')}`,
        [shopId, key]
      );
      // Ambiguous shared numbers fail closed if any matching record lacks consent.
      if (!customers.length || !customers.every(hasConfirmedSmsConsent)) return suppress('no_confirmed_consent');
    }
  } catch {
    return suppress('consent_lookup_failed');
  }

  let shop = null;
  let config = providedConfig;
  if (shopId) {
    const configIncludesEntitlement = providedConfig && (
      Object.prototype.hasOwnProperty.call(providedConfig, 'plan') ||
      Object.prototype.hasOwnProperty.call(providedConfig, 'sms_comp')
    );
    if (configIncludesEntitlement) {
      shop = providedConfig;
    } else {
      shop = await getSmsShop(shopId);
      if (!config) config = twilioConfigFromShop(shop, shopId);
    }

    if (!smsEntitled(shop)) {
      console.warn('[SMS] Suppressed send: sms_not_entitled');
      return { ok: false, reason: 'sms_not_entitled', body: finalMessage, provider_attempted: false };
    }
  }

  if (!config) config = await getTwilioConfigForShop(shopId);
  if (!config) {
    console.warn('[SMS] Twilio is not configured. Skipping SMS send.');
    return { ok: false, reason: 'not configured', body: finalMessage, provider_attempted: false };
  }

  try {
    // API Key auth: twilio(apiKeySid, apiKeySecret, { accountSid })
    // Auth Token auth: twilio(accountSid, authToken)
    console.log('[SMS] Sending');
    const client = config.apiKey
      ? twilio(config.apiKey, config.apiSecret, { accountSid: config.accountSid })
      : twilio(config.accountSid, config.authToken);

    const result = await client.messages.create({
      to: phone,
      from: config.phoneNumber,
      body: finalMessage,
    });
    // Twilio message SIDs have a fixed prefix and 32 hex digits.
    const reference = typeof result.sid === 'string' && result.sid.length === 34
      && /^SM[a-f0-9]{32}$/i.test(result.sid) ? result.sid : 'unavailable';
    console.log('[SMS] Sent successfully; reference:', reference);
    return { ok: true, sid: result.sid, body: finalMessage };
  } catch (error) {
    // Bound provider codes; never log messages, objects, or coerced values.
    const code = (typeof error.code === 'number' && Number.isInteger(error.code)
      && error.code >= 10000 && error.code <= 99999)
      || (typeof error.code === 'string' && error.code.length === 5 && /^[1-9][0-9]{4}$/.test(error.code))
      ? error.code : 'unknown';
    console.error('[SMS] Send failed; provider code:', code);
    return { ok: false, reason: error.message, body: finalMessage };
  }
}

module.exports = {
  sendSMS,
  sendStaffSMS,
  phoneKey,
  phoneMatchSql,
  smsEntitled,
  messageWithComplianceFooter,
  isConfigured,
  isConfiguredForShop,
  getTwilioConfig,
  getTwilioConfigForShop,
};
