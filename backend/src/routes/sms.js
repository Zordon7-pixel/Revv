const router = require('express').Router();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { sendSMS, isConfiguredForShop, getTwilioConfigForShop } = require('../services/sms');
const { dbAll, dbGet, dbRun } = require('../db');

// ── Status / test ────────────────────────────────────────────────────────────
router.get('/status', auth, requireAdmin, async (req, res) => {
  try {
    const creds = await getTwilioConfigForShop(req.user.shop_id);
    res.json({
      configured: await isConfiguredForShop(req.user.shop_id),
      phone: creds ? creds.phoneNumber : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/test', auth, requireAdmin, async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error: 'phone and message are required' });
  const result = await sendSMS(phone, message, { shopId: req.user.shop_id });
  res.json({ ok: !!result.ok, result });
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
      [msgId, req.user.shop_id, ro_id || null, config.phoneNumber, to_phone, message, result.sid || null]
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
      [msgId, req.user.shop_id, ro_id, config.phoneNumber, customer_phone, body, result.sid || null]
    );

    return res.json({ success: true, sid: result.sid, body });
  } catch (err) {
    console.error('[SMS/send-status] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sms/webhook — Twilio inbound SMS (no auth — Twilio signature) ──
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const from = req.body?.From || null;
    const to   = req.body?.To   || null;
    const body = req.body?.Body || '';

    console.log(`[SMS Webhook] Inbound from ${from || 'unknown'}: ${body}`);

    if (from && body) {
      // Find the shop that owns this Twilio number
      const shop = await dbGet(
        `SELECT id FROM shops WHERE twilio_phone_number = $1`,
        [to]
      );

      if (shop) {
        // Find most recent RO associated with this customer phone number
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
          [uuidv4(), shop.id, ro?.id || null, from, to || '', body]
        );

        console.log(`[SMS Webhook] Saved inbound from ${from} → shop ${shop.id}, ro ${ro?.id || 'unmatched'}`);
      } else {
        console.warn(`[SMS Webhook] No shop found for Twilio number ${to}`);
      }
    }
  } catch (err) {
    console.error('[SMS Webhook] Error:', err.message);
  }

  // Always return empty TwiML so Twilio doesn't retry
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
