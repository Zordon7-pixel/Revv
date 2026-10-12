'use strict';

const fail = reason => { throw Object.assign(new Error(reason), { reason }); };
function validMapping(m) {
  return m && [['account_sid', 'AC'], ['service_sid', 'MG'], ['campaign_sid', 'QE'], ['brand_sid', 'BN'], ['event_campaign_sid', 'CM']]
    .every(([key, prefix]) => new RegExp(`^${prefix}[0-9a-fA-F]{32}$`).test(m[key]))
    && typeof m.event_callback_url === 'string' && m.event_callback_url.length > 0
    && typeof m.authorization_ref === 'string' && m.authorization_ref.trim().length > 0;
}

// SDK access is lazy: OFF never loads Twilio, credentials, or the legacy service.
async function createProvider(shopId, binding, { shop, registration, env = process.env, clientFactory } = {}) {
  // Only the locked, persisted shop/account supplies the webhook auth token.
  // An API-key secret and the shared-account fallback cannot authenticate events.
  if (!shop || String(shop.id) !== shopId) fail('ACCOUNT_MISMATCH');
  if (!shop.twilio_account_sid) fail('EVENT_SETUP_REQUIRED');
  if (shop.twilio_account_sid !== binding.account_sid) fail('ACCOUNT_MISMATCH');
  if (typeof shop.twilio_auth_token !== 'string' || !shop.twilio_auth_token.trim()) fail('EVENT_SETUP_REQUIRED');
  const { eventUrl } = require('./smsProvisioningEvents');
  if (!validMapping(binding) || !eventUrl(env) || binding.event_callback_url !== eventUrl(env)) fail('EVENT_SETUP_REQUIRED');
  const twilio = clientFactory || require('twilio');
  const options = { accountSid: binding.account_sid, autoRetry: false, timeout: 10000 };
  const client = shop.twilio_api_key && shop.twilio_api_secret
    ? twilio(shop.twilio_api_key, shop.twilio_api_secret, options)
    : twilio(binding.account_sid, shop.twilio_auth_token, options);
  return providerFromClient(client, binding, registration);
}

function providerFromClient(client, binding, registration) {
  const service = () => client.messaging.v1.services(binding.service_sid);
  const checkNumber = n => {
    if (!n || n.accountSid !== binding.account_sid || !/^PN[0-9a-fA-F]{32}$/.test(n.sid)
        || !/^\+1\d{10}$/.test(n.phoneNumber) || n.capabilities?.sms !== true) fail('NUMBER_MISMATCH');
    return n;
  };
  return {
    async prerequisite(callback) {
      const s = await service().fetch();
      const c = await service().usAppToPerson(binding.campaign_sid).fetch();
      if (s.sid !== binding.service_sid || s.accountSid !== binding.account_sid
          || c.sid !== binding.campaign_sid || c.accountSid !== binding.account_sid
          || c.messagingServiceSid !== binding.service_sid || c.brandRegistrationSid !== binding.brand_sid) fail('BINDING_MISMATCH');
      if (c.mock !== false) fail('CAMPAIGN_FAILED');
      if (c.campaignStatus !== 'VERIFIED') fail(c.campaignStatus === 'FAILED' ? 'CAMPAIGN_FAILED' : 'CAMPAIGN_PENDING');
      // Require an already correctly configured service; never change shared settings.
      if (s.inboundRequestUrl !== callback || s.inboundMethod !== 'POST' || s.useInboundWebhookOnNumber !== false) fail('CALLBACK_MISMATCH');
    },
    async candidate() {
      const numbers = await client.availablePhoneNumbers('US').local.list({ smsEnabled: true, limit: 1 });
      if (!/^\+1\d{10}$/.test(numbers[0]?.phoneNumber)) fail('NO_NUMBER');
      return numbers[0].phoneNumber;
    },
    async inventory(candidate, intentId) {
      const matches = await client.incomingPhoneNumbers.list({ phoneNumber: candidate, limit: 20 });
      const exact = matches.filter(n => n.phoneNumber === candidate && n.friendlyName === `REVV-AUTO:${intentId}`);
      if (exact.length !== 1) fail('PURCHASE_UNCERTAIN');
      return checkNumber(exact[0]);
    },
    async purchase(candidate, intentId, callback) {
      return checkNumber(await client.incomingPhoneNumbers.create({ phoneNumber: candidate,
        friendlyName: `REVV-AUTO:${intentId}`, smsUrl: callback, smsMethod: 'POST' }));
    },
    async number(sid) {
      const n = checkNumber(await client.incomingPhoneNumbers(sid).fetch());
      if (n.sid !== sid) fail('NUMBER_MISMATCH');
      return n;
    },
    async attached(sid) {
      try {
        const n = await service().phoneNumbers(sid).fetch();
        if (n.sid !== sid || n.accountSid !== binding.account_sid || n.serviceSid !== binding.service_sid) fail('ATTACHMENT_MISMATCH');
        return true;
      } catch (e) {
        if (e.status === 404 && e.code === 20404) return false;
        throw e;
      }
    },
    async attach(sid) { await service().phoneNumbers.create({ phoneNumberSid: sid }); },
    async callback(sid, callback) {
      await client.incomingPhoneNumbers(sid).update({ smsUrl: callback, smsMethod: 'POST' });
    },
    // Only the durable authenticated receiver supplies number-level status.
    async registration(sid) {
      return registration ? registration(sid, binding) : { status: 'UNAVAILABLE', source: null };
    },
  };
}
module.exports = { createProvider, providerFromClient, validMapping, fail };
