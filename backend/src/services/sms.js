const twilio = require('twilio');
const db = require('../db');

function getShopCreds() {
  try {
    const shop = db.prepare(
      'SELECT twilio_account_sid, twilio_auth_token, twilio_phone_number FROM shops LIMIT 1'
    ).get();
    if (shop && shop.twilio_account_sid && shop.twilio_auth_token && shop.twilio_phone_number) {
      return {
        accountSid: shop.twilio_account_sid,
        authToken: shop.twilio_auth_token,
        phoneNumber: shop.twilio_phone_number,
        source: 'db',
      };
    }
  } catch (e) {
    // columns may not exist yet during migration
  }
  // fall back to env vars (BYOC / Railway env)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    return {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      source: 'env',
    };
  }
  return null;
}

function isConfigured() {
  return Boolean(getShopCreds());
}

async function sendSMS(to, message) {
  const creds = getShopCreds();
  if (!creds) {
    console.log('[SMS] Twilio not configured; skipping send');
    return { ok: false, skipped: true, reason: 'not_configured' };
  }

  try {
    const client = twilio(creds.accountSid, creds.authToken);
    const result = await client.messages.create({
      to,
      from: creds.phoneNumber,
      body: message,
    });
    console.log(`[SMS] Sent to ${to} via ${creds.source} (sid=${result.sid})`);
    return { ok: true, sid: result.sid };
  } catch (error) {
    console.error(`[SMS] Failed to send to ${to}:`, error.message);
    return { ok: false, error: error.message };
  }
}

module.exports = { sendSMS, isConfigured, getShopCreds };
