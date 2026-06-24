const { v4: uuidv4 } = require('uuid');
const { dbGet, dbRun } = require('../db');
const { sendSMS, smsEntitled } = require('./sms');

const INBOUND_AUTO_REPLY_TEMPLATE = 'Thanks — ${shopName} received your message. A team member will review it and follow up during business hours.';

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT']);
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES']);
const HELP_KEYWORDS = new Set(['HELP', 'INFO']);
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

function keywordClass(body) {
  const normalized = String(body || '').trim().toUpperCase();
  if (STOP_KEYWORDS.has(normalized)) return 'stop';
  if (START_KEYWORDS.has(normalized)) return 'start';
  if (HELP_KEYWORDS.has(normalized)) return 'help';
  return null;
}

function hasShopSmsConfig(shop) {
  return Boolean(
    shop?.id &&
    shop?.twilio_phone_number &&
    shop?.twilio_account_sid &&
    (
      (shop.twilio_api_key && shop.twilio_api_secret) ||
      shop.twilio_auth_token
    )
  );
}

function autoReplyBodyForShop(shop) {
  const shopName = String(shop?.name || '').trim() || 'our shop';
  return INBOUND_AUTO_REPLY_TEMPLATE.replace('${shopName}', shopName);
}

function makeDb(db) {
  return {
    get: db?.get || db?.dbGet || dbGet,
    run: db?.run || db?.dbRun || dbRun,
  };
}

async function maybeSendInboundAutoReply({
  shop,
  from,
  to,
  body,
  db,
  send = sendSMS,
  now = new Date(),
} = {}) {
  try {
    const database = makeDb(db);
    const shopId = shop?.id;
    const inboundFrom = String(from || '').trim();
    const inboundTo = String(to || '').trim();
    const inboundBody = String(body || '').trim();

    if (!shopId) return { action: 'suppressed', reason: 'missing_shop' };
    if (!E164_PATTERN.test(inboundFrom)) return { action: 'suppressed', reason: 'invalid_from' };
    if (!inboundBody) return { action: 'suppressed', reason: 'empty_body' };
    if (inboundFrom === String(shop.twilio_phone_number || '').trim()) {
      return { action: 'suppressed', reason: 'self_loop' };
    }

    const classification = keywordClass(inboundBody);
    if (classification === 'stop') {
      await database.run(
        `INSERT INTO sms_opt_outs (shop_id, phone)
         VALUES ($1, $2)
         ON CONFLICT (shop_id, phone) DO UPDATE SET created_at = NOW()`,
        [shopId, inboundFrom]
      );
      return { action: 'opt_out', reason: 'stop_keyword' };
    }
    if (classification === 'start') {
      await database.run(
        `DELETE FROM sms_opt_outs WHERE shop_id = $1 AND phone = $2`,
        [shopId, inboundFrom]
      );
      return { action: 'resubscribe', reason: 'start_keyword' };
    }
    if (classification === 'help') {
      return { action: 'help', reason: 'help_keyword' };
    }

    if (!smsEntitled(shop)) return { action: 'suppressed', reason: 'not_entitled' };

    if (!hasShopSmsConfig(shop)) return { action: 'suppressed', reason: 'sms_unconfigured' };

    const optedOut = await database.get(
      `SELECT 1 FROM sms_opt_outs WHERE shop_id = $1 AND phone = $2 LIMIT 1`,
      [shopId, inboundFrom]
    );
    if (optedOut) return { action: 'suppressed', reason: 'opted_out' };

    const recentManualOutbound = await database.get(
      `SELECT 1
       FROM sms_messages
       WHERE shop_id = $1
         AND to_phone = $2
         AND direction = 'outbound'
         AND COALESCE(status, '') != 'auto_reply'
         AND created_at > $3::timestamptz - INTERVAL '30 minutes'
       LIMIT 1`,
      [shopId, inboundFrom, now]
    );
    if (recentManualOutbound) return { action: 'suppressed', reason: 'recent_manual_outbound' };

    const recentAutoReply = await database.get(
      `SELECT 1
       FROM sms_messages
       WHERE shop_id = $1
         AND to_phone = $2
         AND direction = 'outbound'
         AND status = 'auto_reply'
         AND created_at > $3::timestamptz - INTERVAL '12 hours'
       LIMIT 1`,
      [shopId, inboundFrom, now]
    );
    if (recentAutoReply) return { action: 'suppressed', reason: 'dedup_12h' };

    const message = autoReplyBodyForShop(shop);
    const result = await send(inboundFrom, message, { shopId, customerFacing: true });
    if (result?.ok === false) {
      return { action: 'suppressed', reason: result.reason || 'send_failed', result };
    }

    await database.run(
      `INSERT INTO sms_messages (id, shop_id, ro_id, direction, from_phone, to_phone, body, twilio_sid, status)
       VALUES ($1, $2, NULL, 'outbound', $3, $4, $5, $6, 'auto_reply')`,
      [uuidv4(), shopId, inboundTo || shop.twilio_phone_number, inboundFrom, result?.body || message, result?.sid || null]
    );

    return { action: 'auto_reply', result };
  } catch (error) {
    console.error('[SMS Auto Reply] Error:', error?.message || error);
    return { action: 'suppressed', reason: 'error', error };
  }
}

module.exports = {
  INBOUND_AUTO_REPLY_TEMPLATE,
  autoReplyBodyForShop,
  maybeSendInboundAutoReply,
};
