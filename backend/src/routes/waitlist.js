const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { prospectIdentity, sendProspectDiscordEmbed } = require('../utils/discord');

const waitlistLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

let pool;
try {
  pool = require('../db/postgres').pool;
} catch {
  console.error('[waitlist] Persistence unavailable');
  pool = null;
}

// Ensure waitlist table exists (idempotent)
async function ensureTable() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        source TEXT DEFAULT 'landing',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
  } catch {
    console.error('[waitlist] Table creation failed');
  }
}
ensureTable();

router.post('/', waitlistLimiter, prospectIdentity, async (req, res) => {
  const { email, source } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanSource = (source || 'landing').slice(0, 50);

  try {
    if (pool) {
      await pool.query(
        `INSERT INTO waitlist (email, source) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
        [cleanEmail, cleanSource]
      );
    }

    // Best-effort alert work cannot turn a saved signup into a failed request.
    void sendProspectDiscordEmbed({
      title: '📬 New Waitlist Signup',
      description: `**${cleanEmail}** joined the waitlist`,
      color: 0x10b981,
      fields: [
        { name: 'Source', value: cleanSource, inline: true },
        { name: 'Time', value: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }), inline: true },
      ],
      footer: 'REVV Lead Tracking',
    }, req.prospectUserId);

    res.json({ ok: true });
  } catch {
    console.error('[waitlist] Submission failed');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
