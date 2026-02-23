const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth   = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const STATUSES = ['ordered', 'backordered', 'received', 'cancelled'];
const { detectCarrier } = require('./tracking');

router.get('/ro/:roId', auth, async (req, res) => {
  try {
    const ro = await dbGet('SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.roId, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'RO not found' });
    const parts = await dbAll('SELECT * FROM parts_orders WHERE ro_id = $1 ORDER BY created_at ASC', [req.params.roId]);
    res.json({ parts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ro/:roId', auth, async (req, res) => {
  try {
    const ro = await dbGet('SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.roId, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'RO not found' });

    const { part_name, part_number, vendor, quantity, unit_cost, expected_date, notes, tracking_number } = req.body;
    if (!part_name?.trim()) return res.status(400).json({ error: 'Part name required' });

    const carrier = tracking_number ? (detectCarrier(tracking_number) || 'unknown') : null;
    const id = uuidv4();
    const today = new Date().toISOString().split('T')[0];
    await dbRun(`
      INSERT INTO parts_orders (id, shop_id, ro_id, part_name, part_number, vendor, quantity, unit_cost, status, ordered_date, expected_date, notes, tracking_number, carrier)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ordered', $9, $10, $11, $12, $13)
    `, [id, req.user.shop_id, req.params.roId, part_name.trim(), part_number||null, vendor||null,
        parseInt(quantity)||1, parseFloat(unit_cost)||0, today, expected_date||null, notes||null,
        tracking_number||null, carrier]);

    res.status(201).json(await dbGet('SELECT * FROM parts_orders WHERE id = $1', [id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const part = await dbGet('SELECT * FROM parts_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!part) return res.status(404).json({ error: 'Not found' });

    if (req.body.tracking_number !== undefined && req.body.tracking_number) {
      req.body.carrier = detectCarrier(req.body.tracking_number) || 'unknown';
      req.body.tracking_status = null;
      req.body.tracking_detail = null;
      req.body.tracking_updated_at = null;
    }

    const ALLOWED_PARTS_FIELDS = ['status','carrier','tracking_number','expected_date','received_date','notes','name','part_number','cost','quantity','part_name','vendor','unit_cost','tracking_status','tracking_detail','tracking_updated_at'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_PARTS_FIELDS.includes(k)));
    if (updates.name !== undefined && updates.part_name === undefined) updates.part_name = updates.name;
    if (updates.cost !== undefined && updates.unit_cost === undefined) updates.unit_cost = updates.cost;
    delete updates.name;
    delete updates.cost;

    if (req.body.status === 'received' && !part.received_date && !req.body.received_date) {
      updates.received_date = new Date().toISOString().split('T')[0];
    }

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
    updates.updated_at = new Date().toISOString();

    const updateKeys = Object.keys(updates);
    const updateVals = Object.values(updates);
    const setClauses = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await dbRun(`UPDATE parts_orders SET ${setClauses} WHERE id = $${updateKeys.length + 1}`, [...updateVals, req.params.id]);

    res.json(await dbGet('SELECT * FROM parts_orders WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await dbRun('DELETE FROM parts_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
