const twilio = require('twilio');
const { dbGet } = require('../db');

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

async function getTwilioConfigForShop(shopId) {
  if (shopId) {
    const shop = await dbGet(
      `SELECT twilio_account_sid, twilio_auth_token, twilio_phone_number
       FROM shops
       WHERE id = $1`,
      [shopId]
    );
    if (shop?.twilio_account_sid && shop?.twilio_auth_token && shop?.twilio_phone_number) {
      return {
        accountSid: shop.twilio_account_sid,
        authToken: shop.twilio_auth_token,
        phoneNumber: shop.twilio_phone_number,
      };
    }
  }
  return getEnvTwilioConfig();
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
  const config = providedConfig || await getTwilioConfigForShop(shopId);
  if (!config) {
    console.warn(`[SMS] Twilio is not configured${shopId ? ` for shop ${shopId}` : ''}. Skipping SMS send.`);
    return { ok: false, reason: 'not configured' };
  }

  try {
    // API Key auth: twilio(apiKeySid, apiKeySecret, { accountSid })
    // Auth Token auth: twilio(accountSid, authToken)
    const client = config.apiKey
      ? twilio(config.apiKey, config.apiSecret, { accountSid: config.accountSid })
      : twilio(config.accountSid, config.authToken);

    const result = await client.messages.create({
      to: phone,
      from: config.phoneNumber,
      body: message,
    });
    return { ok: true, sid: result.sid };
  } catch (error) {
    console.error(`[SMS] Failed to send to ${phone}:`, error.message);
    return { ok: false, reason: error.message };
  }
}

module.exports = {
  sendSMS,
  isConfigured,
  isConfiguredForShop,
  getTwilioConfig,
  getTwilioConfigForShop,
};
