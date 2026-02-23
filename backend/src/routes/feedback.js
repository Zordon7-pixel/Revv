const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const { v4: uuidv4 } = require('uuid');

// Feedback table is created in db/index.js initDb()

router.post('/', async (req, res) => {
  try {
    const { tester_name, category, priority, message, expected, page, routed_to } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
    const id = uuidv4();
    await dbRun(
      `INSERT INTO feedback (id, app, tester_name, category, priority, message, expected, page, routed_to) VALUES ($1, 'shopcommand', $2, $3, $4, $5, $6, $7, $8)`,
      [id, tester_name || 'Anonymous', category || 'general', priority || 'medium', message.trim(), expected || null, page || null, routed_to || null]
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
