const twilio = require('twilio');

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !phoneNumber) return null;
  return { accountSid, authToken, phoneNumber };
}

function isConfigured() {
  return Boolean(getTwilioConfig());
}

async function sendSMS(phone, message) {
  const config = getTwilioConfig();
  if (!config) {
    console.warn('[SMS] TWILIO_* env vars are not configured. Skipping SMS send.');
    return { ok: false, reason: 'not configured' };
  }

  try {
    const client = twilio(config.accountSid, config.authToken);
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

module.exports = { sendSMS, isConfigured, getTwilioConfig };
