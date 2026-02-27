const router = require('express').Router();
const express = require('express');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { sendSMS, isConfigured, getTwilioConfig } = require('../services/sms');

router.get('/status', auth, requireAdmin, (req, res) => {
  const creds = getTwilioConfig ? getTwilioConfig() : null;
  res.json({
    configured: isConfigured(),
    phone: creds ? creds.phoneNumber : null,
  });
});

router.post('/test', auth, requireAdmin, async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error: 'phone and message are required' });

  const result = await sendSMS(phone, message);
  res.json({ ok: !!result.ok, result });
});

router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const from = req.body?.From || null;
    const body = req.body?.Body || '';
    console.log(`[SMS Webhook] Inbound from ${from || 'unknown'}: ${body}`);
  } catch (err) {
    console.error('[SMS Webhook] Failed to log inbound SMS:', err.message);
  }

  res.type('text/xml');
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

module.exports = router;
