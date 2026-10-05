const router = require('express').Router();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { sendSMS, getTwilioConfigForShop, smsEntitled } = require('../services/sms');
const { maybeSendInboundAutoReply } = require('../services/smsAutoReply');
const { dbAll, dbGet, dbRun } = require('../db');
const { WEBHOOK_PATH, inboundWebhookUrl } = require('../services/smsWebhookConfig');

// ── Status / test ────────────────────────────────────────────────────────────
router.get('/status', auth, requireAdmin, async (req, res) => {
  try {
    // Also check raw DB state for diagnostics
    const shopRow = await dbGet(
      `SELECT twilio_account_sid, twilio_auth_token, twilio_phone_number, plan, sms_comp FROM shops WHERE id = $1`,
      [req.user.shop_id]
    );
    const creds = await getTwilioConfigForShop(req.user.shop_id);
    res.json({
      configured: !!creds,
      entitled: smsEntitled(shopRow),
      plan: shopRow?.plan || 'free',
      phone: creds?.phoneNumber || null,
      auth_method: creds?.apiKey ? 'api_key' : creds?.authToken ? 'auth_token' : null,
      config_source: creds?._source || null,
      db_has: {
        account_sid: !!shopRow?.twilio_account_sid,
        auth_token: !!shopRow?.twilio_auth_token,
        phone: !!shopRow?.twilio_phone_number,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/test', auth, requireAdmin, async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error: 'phone and message are required' });
  const shop = await dbGet('SELECT plan, sms_comp FROM shops WHERE id = $1', [req.user.shop_id]);
  if (!smsEntitled(shop)) {
    return res.status(403).json({ error: 'SMS requires the Pro or Agency plan.' });
  }
  const result = await sendSMS(phone, message, { shopId: req.user.shop_id });
  if (!result.ok) {
    const reason = result.reason === 'not configured'
      ? 'SMS not configured. Add your Twilio credentials in Shop Settings.'
      : result.reason || 'Failed to send SMS';
    return res.status(502).json({ error: reason });
  }
  res.json({ ok: true, sid: result.sid });
});

// ── GET /api/sms/thread/:roId — fetch full SMS thread for an RO ───────────────
router.get('/thread/:roId', auth, async (req, res) => {
  try {
    const { roId } = req.params;
    // Verify RO belongs to this shop
    const ro = await dbGet(
      `SELECT ro.id, c.phone AS customer_phone, c.name AS customer_name
       FROM repair_orders ro
       LEFT JOIN customers c ON c.id = ro.customer_id
       WHERE ro.id = $1 AND ro.shop_id = $2`,
      [roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'RO not found' });

    const messages = await dbAll(
      `SELECT id, direction, from_phone, to_phone, body, status, created_at
       FROM sms_messages
       WHERE ro_id = $1 AND shop_id = $2
       ORDER BY created_at ASC`,
      [roId, req.user.shop_id]
    );

    return res.json({
      success: true,
      customer_phone: ro.customer_phone || null,
      customer_name: ro.customer_name || null,
      messages,
    });
  } catch (err) {
    console.error('[SMS/thread] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sms/send — send a message from shop to customer ────────────────
router.post('/send', auth, async (req, res) => {
  try {
    const { ro_id, to_phone, message } = req.body || {};
    if (!to_phone || !message) {
      return res.status(400).json({ error: 'to_phone and message are required' });
    }

    const config = await getTwilioConfigForShop(req.user.shop_id);
    if (!config) {
      return res.status(503).json({ error: 'SMS not configured. Add Twilio credentials in Shop Settings.' });
    }

    // Send via Twilio
    const result = await sendSMS(to_phone, message, { shopId: req.user.shop_id, twilioConfig: config });
    if (!result.ok) {
      return res.status(502).json({ error: result.reason || 'Failed to send SMS' });
    }

    // Save to thread
    const msgId = uuidv4();
    await dbRun(
      `INSERT INTO sms_messages (id, shop_id, ro_id, direction, from_phone, to_phone, body, twilio_sid, status)
       VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, 'sent')`,
      [msgId, req.user.shop_id, ro_id || null, config.phoneNumber, to_phone, result.body || message, result.sid || null]
    );

    // Keep customer phone populated for this RO if customer has no phone yet.
    if (ro_id) {
      await dbRun(
        `UPDATE customers c
         SET phone = $1
         FROM repair_orders ro
         WHERE ro.id = $2
           AND ro.shop_id = $3
           AND c.id = ro.customer_id
           AND (c.phone IS NULL OR c.phone = '')`,
        [to_phone, ro_id, req.user.shop_id]
      );
    }

    const saved = await dbGet('SELECT * FROM sms_messages WHERE id = $1', [msgId]);
    return res.json({ success: true, message: saved });
  } catch (err) {
    console.error('[SMS/send] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sms/send-status — convenience: send a status update text ───────
router.post('/send-status', auth, async (req, res) => {
  try {
    const { ro_id, status, customer_name, customer_phone, portal_url } = req.body || {};
    if (!ro_id || !customer_phone || !status) {
      return res.status(400).json({ error: 'ro_id, customer_phone, and status are required' });
    }

    const name = customer_name ? customer_name.split(' ')[0] : 'there';
    // No approval SMS — customers sign off in person at intake
    const statusMessages = {
      'In Progress':       `Hi ${name}, your vehicle is now in progress at our shop. We'll keep you posted!${portal_url ? `\nTrack it here: ${portal_url}` : ''}`,
      'Waiting for Parts': `Hi ${name}, we're waiting on a part for your vehicle. We'll reach out as soon as it arrives. Questions? Just reply to this text.`,
      'Quality Check':     `Hi ${name}, your vehicle is in final quality check — almost done!`,
      'Ready':             `Hi ${name}, great news — your vehicle is ready for pickup! Come on in whenever you're ready. 🎉${portal_url ? `\nDetails: ${portal_url}` : ''}`,
      'Delivered':         `Hi ${name}, thanks for trusting us with your vehicle! If anything comes up, just reply to this text.`,
    };

    const body = statusMessages[status] || `Hi ${name}, your vehicle status has been updated to: ${status}. ${portal_url ? `Track it here: ${portal_url}` : ''}`;

    const config = await getTwilioConfigForShop(req.user.shop_id);
    if (!config) {
      return res.status(503).json({ error: 'SMS not configured. Add Twilio credentials in Shop Settings.' });
    }

    const result = await sendSMS(customer_phone, body, { shopId: req.user.shop_id, twilioConfig: config });
    if (!result.ok) {
      return res.status(502).json({ error: result.reason || 'Failed to send SMS' });
    }

    const msgId = uuidv4();
    await dbRun(
      `INSERT INTO sms_messages (id, shop_id, ro_id, direction, from_phone, to_phone, body, twilio_sid, status)
       VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, 'sent')`,
      [msgId, req.user.shop_id, ro_id, config.phoneNumber, customer_phone, result.body || body, result.sid || null]
    );

    return res.json({ success: true, sid: result.sid, body: result.body || body });
  } catch (err) {
    console.error('[SMS/send-status] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Authenticate the complete form against the recipient's server-held auth token.
// API-key secrets cannot validate Twilio webhooks. Never derive the public URL
// from Host, forwarded headers, or the request's protocol.
async function authenticatedInboundShop(req) {
  const { validateRequest } = require('twilio');
  const signature = req.get('X-Twilio-Signature');
  const params = req.body;
  if (typeof signature !== 'string' || !signature || !params
      || Object.values(params).some(value => typeof value !== 'string')
      || !/^\+[1-9]\d{1,14}$/.test(params.To || '')
      || !/^AC[0-9a-f]{32}$/i.test(params.AccountSid || '')) return null;
  const webhookUrl = inboundWebhookUrl();
  if (!webhookUrl) return null;
  const originalUrl = req.originalUrl;
  if (typeof originalUrl !== 'string' || originalUrl.split('?')[0] !== WEBHOOK_PATH) return null;
  const queryIndex = originalUrl.indexOf('?');
  const url = `${webhookUrl}${queryIndex < 0 ? '' : originalUrl.slice(queryIndex)}`;
  const shops = await dbAll(
    `SELECT id, name, twilio_account_sid, twilio_auth_token, twilio_phone_number,
            twilio_api_key, twilio_api_secret, plan, sms_comp
     FROM shops WHERE twilio_phone_number = $1`, [params.To]
  );
  // Do not choose a tenant using attacker-supplied AccountSid to break a tie.
  if (shops.length !== 1) return null;
  const shop = shops[0];
  if (!shop.id || shop.twilio_phone_number !== params.To) return null;
  // The unique persisted destination owns the tenant. A platform account can
  // provision multiple shop numbers; AccountSid alone never selects a shop.
  const accountSid = shop.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid || accountSid !== params.AccountSid) return null;
  const token = shop.twilio_account_sid && shop.twilio_auth_token
    ? shop.twilio_auth_token
    : accountSid === process.env.TWILIO_ACCOUNT_SID ? process.env.TWILIO_AUTH_TOKEN : null;
  if (typeof token !== 'string' || !token.trim() || !validateRequest(token, signature, url, params)) return null;
  return shop;
}

// POST /api/sms/webhook — verified Twilio signature replaces staff authentication.
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  let shop;
  try {
    shop = await authenticatedInboundShop(req);
  } catch {
    // Lookup/configuration/validation failures must fail closed without PII.
  }
  if (!shop) {
    console.warn('[SMS Webhook] Authentication rejected');
    return res.status(403).send('Forbidden');
  }
  try {
    const { From: from, To: to, Body: body } = req.body;
    console.log('[SMS Webhook] Authenticated inbound');
    if (from && body) {
      const ro = await dbGet(
        `SELECT ro.id
         FROM repair_orders ro
         LEFT JOIN customers c ON c.id = ro.customer_id
         WHERE ro.shop_id = $1
           AND regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')
         ORDER BY ro.created_at DESC LIMIT 1`,
        [shop.id, from]
      );
      await dbRun(
        `INSERT INTO sms_messages (id, shop_id, ro_id, direction, from_phone, to_phone, body, status)
         VALUES ($1, $2, $3, 'inbound', $4, $5, $6, 'received')`,
        [uuidv4(), shop.id, ro?.id || null, from, to, body]
      );
      console.log('[SMS Webhook] Inbound saved');
      try {
        await maybeSendInboundAutoReply({ shop, from, to, body, db: { dbGet, dbRun } });
      } catch {
        console.error('[SMS Webhook] Auto-reply failed');
      }
    }
  } catch {
    console.error('[SMS Webhook] Processing failed');
  }
  // Preserve empty TwiML acknowledgement only for authenticated requests.
  res.type('text/xml');
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// ── GET /api/sms/inbox — all unmatched/recent inbound messages for shop ───────
router.get('/inbox', auth, async (req, res) => {
  try {
    const messages = await dbAll(
      `SELECT m.id, m.direction, m.from_phone, m.to_phone, m.body, m.status, m.created_at, m.ro_id,
              c.name AS customer_name
       FROM sms_messages m
       LEFT JOIN repair_orders ro ON ro.id = m.ro_id
       LEFT JOIN customers c ON c.id = ro.customer_id
       WHERE m.shop_id = $1
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [req.user.shop_id]
    );
    return res.json({ success: true, messages });
  } catch (err) {
    console.error('[SMS/inbox] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
