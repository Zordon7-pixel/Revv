const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');

// POST /api/parts-requests — create request
router.post('/', auth, (req, res) => {
  const { ro_id, part_name, part_number, quantity, notes } = req.body;
  if (!ro_id || !part_name) return res.status(400).json({ error: 'ro_id and part_name required' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO parts_requests (id, ro_id, requested_by, part_name, part_number, quantity, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))
  `).run(id, ro_id, req.user.id, part_name, part_number || null, quantity || 1, notes || null);
  res.status(201).json(db.prepare('SELECT * FROM parts_requests WHERE id = ?').get(id));
});

// GET /api/parts-requests/:ro_id — get requests for RO
router.get('/:ro_id', auth, (req, res) => {
  const requests = db.prepare('SELECT * FROM parts_requests WHERE ro_id = ? ORDER BY created_at ASC').all(req.params.ro_id);
  res.json({ requests });
});

// PATCH /api/parts-requests/:id — update status (admin/owner only)
router.patch('/:id', auth, requireAdmin, (req, res) => {
  const { status } = req.body;
  const ALLOWED = ['pending', 'ordered', 'received', 'cancelled'];
  if (!ALLOWED.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const request = db.prepare('SELECT * FROM parts_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE parts_requests SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json(db.prepare('SELECT * FROM parts_requests WHERE id = ?').get(req.params.id));
});

module.exports = router;
