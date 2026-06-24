const twilio = require('twilio');
const { dbGet } = require('../db');

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
  const hasDbCreds = hasApiKeyCreds || hasAuthTokenCreds;

  if (shopId) {
    console.log(`[SMS] getTwilioConfigForShop(${shopId}): DB has account_sid=${!!shop?.twilio_account_sid}, api_key=${!!shop?.twilio_api_key}, auth_token=${!!shop?.twilio_auth_token}, phone=${!!shop?.twilio_phone_number} → using ${hasDbCreds ? 'DB creds' : 'env vars'}`);
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
    console.log(`[SMS] Using env var config: account_sid=${!!envConfig.accountSid}, api_key=${!!envConfig.apiKey}, auth_token=${!!envConfig.authToken}, phone=${!!envConfig.phoneNumber}`);
  } else {
    console.warn(`[SMS] No Twilio config found in DB or env vars for shop ${shopId}`);
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
    console.log(`[SMS] Using env var config: account_sid=${!!envConfig.accountSid}, api_key=${!!envConfig.apiKey}, auth_token=${!!envConfig.authToken}, phone=${!!envConfig.phoneNumber}`);
  } else {
    console.warn(`[SMS] No Twilio config found in DB or env vars for shop ${shopId}`);
  }
  return envConfig ? { ...envConfig, _source: 'env' } : null;
}

function isConfigured() {
  return Boolean(getTwilioConfig());
}

async function isConfiguredForShop(shopId) {
  return Boolean(await getTwilioConfigForShop(shopId));
}

async function sendSMS(phone, message, options = {}) {
  const shopId = typeof options === 'string' ? options : options.shopId;
  const providedConfig = typeof options === 'object' ? options.twilioConfig : null;
  const skipOptOutCheck = typeof options === 'object' && options.skipOptOutCheck === true;
  const finalMessage = messageWithComplianceFooter(message, typeof options === 'object' ? options : {});
  if (shopId && !skipOptOutCheck) {
    const optedOut = await dbGet(
      `SELECT 1 FROM sms_opt_outs WHERE shop_id = $1 AND phone = $2 LIMIT 1`,
      [shopId, phone]
    );
    if (optedOut) {
      console.warn(`[SMS] Suppressed send to opted-out number for shop ${shopId}.`);
      return { ok: false, reason: 'opted_out', body: finalMessage };
    }
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
      console.warn(`[SMS] Suppressed send for non-entitled shop ${shopId}.`);
      return { ok: false, reason: 'sms_not_entitled', body: finalMessage };
    }
  }

  if (!config) config = await getTwilioConfigForShop(shopId);
  if (!config) {
    console.warn(`[SMS] Twilio is not configured${shopId ? ` for shop ${shopId}` : ''}. Skipping SMS send.`);
    return { ok: false, reason: 'not configured', body: finalMessage };
  }

  try {
    // API Key auth: twilio(apiKeySid, apiKeySecret, { accountSid })
    // Auth Token auth: twilio(accountSid, authToken)
    const authMethod = config.apiKey ? 'api_key' : 'auth_token';
    console.log(`[SMS] Sending to ${phone} from ${config.phoneNumber} via ${authMethod} (source: ${config._source || 'unknown'})`);
    const client = config.apiKey
      ? twilio(config.apiKey, config.apiSecret, { accountSid: config.accountSid })
      : twilio(config.accountSid, config.authToken);

    const result = await client.messages.create({
      to: phone,
      from: config.phoneNumber,
      body: finalMessage,
    });
    console.log(`[SMS] Sent successfully. SID: ${result.sid}`);
    return { ok: true, sid: result.sid, body: finalMessage };
  } catch (error) {
    console.error(`[SMS] Failed to send to ${phone}:`, error.message);
    return { ok: false, reason: error.message, body: finalMessage };
  }
}

module.exports = {
  sendSMS,
  smsEntitled,
  messageWithComplianceFooter,
  isConfigured,
  isConfiguredForShop,
  getTwilioConfig,
  getTwilioConfigForShop,
};
