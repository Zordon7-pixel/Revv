const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const VALID_STATUSES = ['Pending', 'Approved', 'Denied'];

async function ensureSupplementsTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ro_supplements (
      id UUID PRIMARY KEY,
      ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending',
      submitted_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_ro_supplements_ro_id ON ro_supplements(ro_id)`).catch(() => {});
}

// GET /api/ros/:id/supplements
router.get('/:id/supplements', auth, async (req, res) => {
  try {
    await ensureSupplementsTable();
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const supplements = await dbAll(
      'SELECT * FROM ro_supplements WHERE ro_id = $1 AND shop_id = $2 ORDER BY created_at ASC',
      [req.params.id, req.user.shop_id]
    );

    const totalApproved = supplements
      .filter(s => s.status === 'Approved')
      .reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);

    return res.json({ supplements, totalApproved });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/ros/:id/supplements
router.post('/:id/supplements', auth, async (req, res) => {
  try {
    await ensureSupplementsTable();
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const { description, amount, status, submitted_date, notes } = req.body || {};
    if (!description?.trim()) return res.status(400).json({ error: 'Description is required' });

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const stat = status && VALID_STATUSES.includes(status) ? status : 'Pending';
    const date = submitted_date || new Date().toISOString().split('T')[0];
    const id = uuidv4();

    await dbRun(
      `INSERT INTO ro_supplements (id, ro_id, shop_id, description, amount, status, submitted_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, req.params.id, req.user.shop_id, description.trim(), amt, stat, date, notes?.trim() || null]
    );

    const supplement = await dbGet('SELECT * FROM ro_supplements WHERE id = $1', [id]);
    return res.status(201).json({ supplement });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/ros/:id/supplements/:suppId
router.patch('/:id/supplements/:suppId', auth, async (req, res) => {
  try {
    await ensureSupplementsTable();
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const supp = await dbGet(
      'SELECT id FROM ro_supplements WHERE id = $1 AND ro_id = $2 AND shop_id = $3',
      [req.params.suppId, req.params.id, req.user.shop_id]
    );
    if (!supp) return res.status(404).json({ error: 'Supplement not found' });

    const allowed = ['description', 'amount', 'status', 'submitted_date', 'notes'];
    const updates = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        updates[field] = req.body[field];
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'status') &&
        !VALID_STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: 'Invalid status. Must be Pending, Approved, or Denied.' });
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'amount')) {
      const amt = parseFloat(updates.amount);
      if (!Number.isFinite(amt) || amt < 0) {
        return res.status(400).json({ error: 'Valid amount is required' });
      }
      updates.amount = amt;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'description') &&
        !updates.description?.trim()) {
      return res.status(400).json({ error: 'Description cannot be empty' });
    }

    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await dbRun(
      `UPDATE ro_supplements SET ${setClauses} WHERE id = $${keys.length + 1}`,
      [...vals, req.params.suppId]
    );

    const updated = await dbGet('SELECT * FROM ro_supplements WHERE id = $1', [req.params.suppId]);
    return res.json({ supplement: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
