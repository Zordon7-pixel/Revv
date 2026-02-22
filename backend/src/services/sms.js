const twilio = require('twilio');

function isConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

async function sendSMS(to, message) {
  if (!isConfigured()) {
    console.log('[SMS] Twilio not configured; skipping send');
    return { ok: false, skipped: true, reason: 'not_configured' };
  }

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const result = await client.messages.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      body: message,
    });
    console.log(`[SMS] Sent to ${to} (sid=${result.sid})`);
    return { ok: true, sid: result.sid };
  } catch (error) {
    console.error(`[SMS] Failed to send to ${to}:`, error.message);
    return { ok: false, error: error.message };
  }
}

module.exports = { sendSMS, isConfigured };
