const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

// Feedback table is created in db/index.js initDb()

function getShopIdFromAuthHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.shop_id || null;
  } catch {
    return null;
  }
}

router.post('/', async (req, res) => {
  try {
    const { app, tester_name, category, priority, message, expected, page, routed_to } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
    const shopId = getShopIdFromAuthHeader(req.headers.authorization);
    const normalizedApp = ['revv', 'payload', 'forge', 'shopcommand'].includes(String(app || '').toLowerCase())
      ? String(app).toLowerCase()
      : 'revv';
    const id = uuidv4();
    await dbRun(
      `INSERT INTO feedback (id, app, tester_name, category, priority, message, expected, page, routed_to, shop_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, normalizedApp, tester_name || 'Anonymous', category || 'general', priority || 'medium', message.trim(), expected || null, page || null, routed_to || null, shopId]
    );
    res.status(201).json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const feedback = await dbAll('SELECT * FROM feedback ORDER BY created_at DESC', []);
    res.json({ feedback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
