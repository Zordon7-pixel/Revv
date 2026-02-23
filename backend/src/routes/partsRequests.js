const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');

router.post('/', auth, async (req, res) => {
  try {
    const { ro_id, part_name, part_number, quantity, notes } = req.body;
    if (!ro_id || !part_name) return res.status(400).json({ error: 'ro_id and part_name required' });
    const id = uuidv4();
    await dbRun(
      `INSERT INTO parts_requests (id, ro_id, requested_by, part_name, part_number, quantity, status, notes) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
      [id, ro_id, req.user.id, part_name, part_number || null, quantity || 1, notes || null]
    );
    res.status(201).json(await dbGet('SELECT * FROM parts_requests WHERE id = $1', [id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:ro_id', auth, async (req, res) => {
  try {
    const requests = await dbAll('SELECT * FROM parts_requests WHERE ro_id = $1 ORDER BY created_at ASC', [req.params.ro_id]);
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const ALLOWED = ['pending', 'ordered', 'received', 'cancelled'];
    if (!ALLOWED.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const request = await dbGet('SELECT * FROM parts_requests WHERE id = $1', [req.params.id]);
    if (!request) return res.status(404).json({ error: 'Not found' });
    await dbRun('UPDATE parts_requests SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json(await dbGet('SELECT * FROM parts_requests WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
