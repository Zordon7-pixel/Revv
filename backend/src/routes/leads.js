const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendDiscordEmbed } = require('../utils/discord');

const leadsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

router.post('/', leadsLimiter, async (req, res) => {
  try {
    const { name, email, phone, businessName, message } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    sendDiscordEmbed({
      title: '🔥 New Lead from revvshop.app!',
      color: 0xff6b35,
      fields: [
        { name: 'Name', value: name, inline: true },
        { name: 'Email', value: email, inline: true },
        { name: 'Phone', value: phone || 'Not provided', inline: true },
        { name: 'Business', value: businessName || 'Not provided', inline: true },
        { name: 'Message', value: message || 'None', inline: false },
      ],
      footer: 'REVV Lead Capture',
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[leads] Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
