const router = require('express').Router();
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { sendSMS, isConfigured } = require('../services/sms');

router.get('/status', auth, requireAdmin, (req, res) => {
  res.json({
    configured: isConfigured(),
    phone: process.env.TWILIO_PHONE_NUMBER || null,
  });
});

router.post('/test', auth, requireAdmin, async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error: 'phone and message are required' });

  const result = await sendSMS(phone, message);
  res.json({ ok: !!result.ok, result });
});

module.exports = router;
