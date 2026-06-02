const { sendSMS } = require('./sms');

const SMS_OPT_IN_CONFIRMATION_MESSAGE = "REVV: You're subscribed to repair status updates. Msg freq varies (2-8/repair). Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

function hasPhone(phone) {
  return String(phone || '').trim().length > 0;
}

async function sendCustomerOptInConfirmation({ phone, smsConsent, shopId, send = sendSMS, logger = console }) {
  if (smsConsent !== true || !hasPhone(phone)) {
    return { attempted: false };
  }

  try {
    const result = await send(String(phone).trim(), SMS_OPT_IN_CONFIRMATION_MESSAGE, { shopId });
    if (result?.ok === false) {
      logger.error(`[SMS Opt-In Confirmation] Send failed for shop ${shopId}: ${result.reason || 'unknown error'}`);
    }
    return { attempted: true, result };
  } catch (err) {
    logger.error(`[SMS Opt-In Confirmation] Send failed for shop ${shopId}:`, err?.message || err);
    return { attempted: true, error: err };
  }
}

module.exports = {
  SMS_OPT_IN_CONFIRMATION_MESSAGE,
  sendCustomerOptInConfirmation,
};
