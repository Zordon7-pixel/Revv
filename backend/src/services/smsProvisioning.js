const { dbGet, dbRun } = require('../db');
const { getTwilioConfigForShop, createTwilioClient } = require('./sms');

const STATE_AREA_CODES = {
  AL: ['205', '251', '334', '938'],
  AK: ['907'],
  AZ: ['480', '520', '602', '623', '928'],
  AR: ['479', '501', '870'],
  CA: ['209', '213', '310', '323', '408', '415', '424', '510', '530', '559', '562', '619', '626', '650', '657', '661', '669', '707', '714', '747', '760', '805', '818', '831', '858', '909', '916', '925', '949', '951'],
  CO: ['303', '719', '720', '970'],
  CT: ['203', '475', '860', '959'],
  DC: ['202'],
  DE: ['302'],
  FL: ['239', '305', '321', '352', '386', '407', '561', '727', '754', '772', '786', '813', '850', '863', '904', '941', '954'],
  GA: ['229', '404', '470', '478', '678', '706', '762', '770', '912'],
  HI: ['808'],
  IA: ['319', '515', '563', '641', '712'],
  ID: ['208', '986'],
  IL: ['217', '224', '309', '312', '331', '447', '464', '618', '630', '708', '773', '779', '815', '847', '872'],
  IN: ['219', '260', '317', '463', '574', '765', '812', '930'],
  KS: ['316', '620', '785', '913'],
  KY: ['270', '364', '502', '606', '859'],
  LA: ['225', '318', '337', '504', '985'],
  MA: ['339', '351', '413', '508', '617', '774', '781', '857', '978'],
  MD: ['240', '301', '410', '443', '667'],
  ME: ['207'],
  MI: ['231', '248', '269', '313', '517', '586', '616', '734', '810', '906', '947', '989'],
  MN: ['218', '320', '507', '612', '651', '763', '952'],
  MO: ['314', '417', '557', '573', '636', '660', '816', '975'],
  MS: ['228', '601', '662', '769'],
  MT: ['406'],
  NC: ['252', '336', '704', '743', '828', '910', '919', '980', '984'],
  ND: ['701'],
  NE: ['308', '402', '531'],
  NH: ['603'],
  NJ: ['201', '551', '609', '640', '732', '848', '856', '862', '908', '973'],
  NM: ['505', '575'],
  NV: ['702', '725', '775'],
  NY: ['212', '315', '332', '347', '516', '518', '585', '607', '631', '646', '680', '716', '718', '838', '845', '914', '917', '929', '934'],
  OH: ['216', '220', '234', '283', '330', '380', '419', '440', '513', '567', '614', '740', '937'],
  OK: ['405', '539', '580', '918'],
  OR: ['458', '503', '541', '971'],
  PA: ['215', '223', '267', '272', '412', '445', '484', '570', '582', '610', '717', '724', '814', '878'],
  RI: ['401'],
  SC: ['803', '839', '843', '854', '864'],
  SD: ['605'],
  TN: ['423', '615', '629', '731', '865', '901', '931'],
  TX: ['210', '214', '254', '281', '325', '346', '361', '409', '430', '432', '469', '512', '682', '713', '726', '737', '806', '817', '830', '832', '903', '915', '936', '940', '945', '956', '972', '979'],
  UT: ['385', '435', '801'],
  VA: ['276', '434', '540', '571', '703', '757', '804'],
  VT: ['802'],
  WA: ['206', '253', '360', '425', '509', '564'],
  WI: ['262', '274', '414', '534', '608', '715', '920'],
  WV: ['304', '681'],
  WY: ['307'],
};

function cleanDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function areaCodeFromPhone(value) {
  const digits = cleanDigits(value);
  if (digits.length === 10) return digits.slice(0, 3);
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1, 4);
  return null;
}

function appBaseUrl() {
  return (process.env.APP_URL || 'https://revvshop.app').replace(/\/+$/, '');
}

function inboundWebhookUrl() {
  return (process.env.TWILIO_INBOUND_WEBHOOK_URL || `${appBaseUrl()}/api/sms/inbound`).trim();
}

async function ensureMessagingService(client, shop, requestedWebhookUrl) {
  const existingSid = String(shop?.twilio_messaging_service_sid || '').trim() || null;
  const desiredWebhook = requestedWebhookUrl || inboundWebhookUrl();

  if (existingSid) {
    try {
      const existing = await client.messaging.v1.services(existingSid).fetch();
      if (desiredWebhook && existing.inboundRequestUrl !== desiredWebhook) {
        await client.messaging.v1.services(existingSid).update({ inboundRequestUrl: desiredWebhook });
      }
      return existing.sid;
    } catch (_) {
      // Existing SID may be invalid/deleted; create a new service below.
    }
  }

  const service = await client.messaging.v1.services.create({
    friendlyName: `REVV ${shop?.name || shop?.id || 'Shop'} SMS`,
    inboundRequestUrl: desiredWebhook,
    fallbackToLongCode: true,
  });
  return service.sid;
}

async function findLocalNumber(client, state, areaCodes = []) {
  const tried = new Set();
  for (const code of areaCodes) {
    const normalized = String(code || '').trim();
    if (!/^\d{3}$/.test(normalized) || tried.has(normalized)) continue;
    tried.add(normalized);
    try {
      const candidates = await client.availablePhoneNumbers('US').local.list({
        areaCode: Number(normalized),
        smsEnabled: true,
        limit: 1,
      });
      if (candidates[0]) return candidates[0];
    } catch (_) {
      // Keep trying fallbacks.
    }
  }

  if (state && /^[A-Z]{2}$/.test(state)) {
    try {
      const candidates = await client.availablePhoneNumbers('US').local.list({
        inRegion: state,
        smsEnabled: true,
        limit: 1,
      });
      if (candidates[0]) return candidates[0];
    } catch (_) {
      // Keep fallback.
    }
  }

  const generic = await client.availablePhoneNumbers('US').local.list({ smsEnabled: true, limit: 1 });
  return generic[0] || null;
}

async function attachNumberToMessagingService(client, messagingServiceSid, phoneSid) {
  try {
    await client.messaging.v1.services(messagingServiceSid).phoneNumbers.create({
      phoneNumberSid: phoneSid,
    });
    return true;
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('duplicate')) return true;
    throw err;
  }
}

async function provisionSmsSenderForShop({ shopId, force = false, webhookUrl } = {}) {
  if (!shopId) throw new Error('shopId is required');

  const shop = await dbGet(
    `SELECT
       id, name, state, zip, phone,
       twilio_phone_number, twilio_phone_sid, twilio_messaging_service_sid
     FROM shops
     WHERE id = $1`,
    [shopId]
  );
  if (!shop) throw new Error('Shop not found');

  const config = await getTwilioConfigForShop(shopId);
  if (!config?.accountSid || !(config?.apiKey || config?.authToken)) {
    throw new Error('Twilio credentials are not configured on REVV server');
  }
  const client = createTwilioClient(config);
  const desiredWebhook = webhookUrl || inboundWebhookUrl();

  let messagingServiceSid = await ensureMessagingService(client, shop, desiredWebhook);
  let phoneNumber = shop.twilio_phone_number || null;
  let phoneSid = shop.twilio_phone_sid || null;

  if (!force && phoneNumber && phoneSid) {
    await attachNumberToMessagingService(client, messagingServiceSid, phoneSid);
  } else {
    const preferredAreaCode = areaCodeFromPhone(shop.phone);
    const stateCodes = STATE_AREA_CODES[String(shop.state || '').toUpperCase()] || [];
    const areaCodes = [preferredAreaCode, ...stateCodes].filter(Boolean);
    const candidate = await findLocalNumber(client, String(shop.state || '').toUpperCase(), areaCodes);
    if (!candidate?.phoneNumber) {
      throw new Error('No Twilio SMS-capable local number is currently available');
    }

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: candidate.phoneNumber,
      smsUrl: desiredWebhook,
      smsMethod: 'POST',
      friendlyName: `REVV ${shop.name || shop.id}`,
    });
    phoneNumber = purchased.phoneNumber || candidate.phoneNumber;
    phoneSid = purchased.sid;

    await attachNumberToMessagingService(client, messagingServiceSid, phoneSid);
  }

  await dbRun(
    `UPDATE shops
     SET twilio_phone_number = $1,
         twilio_phone_sid = $2,
         twilio_messaging_service_sid = $3,
         twilio_sender_mode = 'managed',
         twilio_sender_updated_at = NOW()
     WHERE id = $4`,
    [phoneNumber, phoneSid, messagingServiceSid, shopId]
  );

  return {
    ok: true,
    shop_id: shopId,
    phone_number: phoneNumber,
    phone_sid: phoneSid,
    messaging_service_sid: messagingServiceSid,
    inbound_webhook_url: desiredWebhook,
    reused_existing_number: !force && !!shop.twilio_phone_number && !!shop.twilio_phone_sid,
  };
}

module.exports = {
  provisionSmsSenderForShop,
  inboundWebhookUrl,
};

