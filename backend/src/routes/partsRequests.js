const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin, requireTechnician } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('../services/notifications');

router.post('/', auth, async (req, res) => {
  try {
    const { ro_id, part_name, part_number, quantity, notes } = req.body;
    if (!ro_id || !part_name) return res.status(400).json({ error: 'ro_id and part_name required' });
    const ro = await dbGet('SELECT id, ro_number, shop_id FROM repair_orders WHERE id = $1 AND shop_id = $2', [ro_id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });
    const id = uuidv4();
    await dbRun(
      `INSERT INTO parts_requests (id, ro_id, requested_by, part_name, part_number, quantity, status, notes) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
      [id, ro_id, req.user.id, part_name, part_number || null, quantity || 1, notes || null]
    );
    if (ro?.shop_id) {
      const owners = await dbAll('SELECT id FROM users WHERE shop_id = $1 AND role = $2', [ro.shop_id, 'owner']);
      await Promise.all(
        owners.map((owner) =>
          createNotification(
            ro.shop_id,
            owner.id,
            'parts_request',
            'New Parts Request',
            `A parts request was submitted for RO #${ro.ro_number || 'N/A'} (${part_name}).`,
            ro.id
          )
        )
      );
    }
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

router.patch('/:id', auth, requireTechnician, async (req, res) => {
  try {
    const { status } = req.body;
    const ALLOWED = ['pending', 'ordered', 'received', 'cancelled'];
    if (!ALLOWED.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const request = await dbGet(
      `SELECT pr.*, ro.shop_id
       FROM parts_requests pr
       LEFT JOIN repair_orders ro ON ro.id = pr.ro_id
       WHERE pr.id = $1`,
      [req.params.id]
    );
    if (!request) return res.status(404).json({ error: 'Not found' });
    if (request.shop_id !== req.user.shop_id) return res.status(403).json({ error: 'Forbidden' });
    await dbRun('UPDATE parts_requests SET status = $1 WHERE id = $2 AND ro_id IN (SELECT id FROM repair_orders WHERE shop_id = $3)', [status, req.params.id, req.user.shop_id]);
    res.json(await dbGet('SELECT * FROM parts_requests WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
