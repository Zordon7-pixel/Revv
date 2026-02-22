const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const STATUSES = ['ordered', 'backordered', 'received', 'cancelled'];

// GET all parts for an RO
router.get('/ro/:roId', auth, (req, res) => {
  const ro = db.prepare('SELECT id FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.roId, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'RO not found' });
  const parts = db.prepare('SELECT * FROM parts_orders WHERE ro_id = ? ORDER BY created_at ASC').all(req.params.roId);
  res.json({ parts });
});

// POST add a part to an RO
router.post('/ro/:roId', auth, (req, res) => {
  const ro = db.prepare('SELECT id FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.roId, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'RO not found' });

  const { part_name, part_number, vendor, quantity, unit_cost, expected_date, notes } = req.body;
  if (!part_name?.trim()) return res.status(400).json({ error: 'Part name required' });

  const id = uuidv4();
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO parts_orders (id, shop_id, ro_id, part_name, part_number, vendor, quantity, unit_cost, status, ordered_date, expected_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ordered', ?, ?, ?)
  `).run(id, req.user.shop_id, req.params.roId, part_name.trim(), part_number||null, vendor||null,
    parseInt(quantity)||1, parseFloat(unit_cost)||0, today, expected_date||null, notes||null);

  res.status(201).json(db.prepare('SELECT * FROM parts_orders WHERE id = ?').get(id));
});

// PUT update a part (status, received date, ETA change)
router.put('/:id', auth, (req, res) => {
  const part = db.prepare('SELECT * FROM parts_orders WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!part) return res.status(404).json({ error: 'Not found' });

  const fields = ['part_name','part_number','vendor','quantity','unit_cost','status','expected_date','received_date','notes'];
  const updates = {}; const vals = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { updates[f] = req.body[f]; } });

  // Auto-set received_date when status flips to received
  if (req.body.status === 'received' && !part.received_date && !req.body.received_date) {
    updates.received_date = new Date().toISOString().split('T')[0];
  }

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
  updates.updated_at = new Date().toISOString();

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE parts_orders SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);

  // If all parts are received, optionally notify (just return updated)
  res.json(db.prepare('SELECT * FROM parts_orders WHERE id = ?').get(req.params.id));
});

// DELETE a part
router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM parts_orders WHERE id = ? AND shop_id = ?').run(req.params.id, req.user.shop_id);
  res.json({ ok: true });
});

module.exports = router;
