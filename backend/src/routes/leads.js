const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

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

    // Public intake has no persisted shop identity (email/source are not tenancy).
    // No global-notification capability is authorized here. Keep external delivery
    // fail-closed for anonymous, authenticated and fixture-associated submissions.
    res.json({ success: true });
  } catch (err) {
    console.error('[leads] Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
