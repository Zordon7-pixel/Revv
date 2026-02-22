const router = require('express').Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// Create feedback table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    app TEXT DEFAULT 'shopcommand',
    tester_name TEXT,
    category TEXT,
    message TEXT NOT NULL,
    page TEXT,
    status TEXT DEFAULT 'new',
    routed_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Public endpoint — no auth required (testers aren't logged in)
router.post('/', (req, res) => {
  const { tester_name, category, message, page } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const id = uuidv4();
  db.prepare(`INSERT INTO feedback (id, app, tester_name, category, message, page) VALUES (?, 'shopcommand', ?, ?, ?, ?)`)
    .run(id, tester_name || 'Anonymous', category || 'general', message.trim(), page || null);
  res.status(201).json({ ok: true, id });
});

// Protected — read all feedback (for Zordon to review)
router.get('/', (req, res) => {
  const feedback = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
  res.json({ feedback });
});

module.exports = router;
