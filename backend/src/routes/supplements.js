const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { dollarsToCents } = require('../services/roMoney');

const VALID_STATUSES = ['Pending', 'Approved', 'Denied', 'Withdrawn'];

async function recomputeSupplementLedgerTotals(roId, shopId) {
  const totals = await dbGet(
    `SELECT
       COALESCE(ro.insurance_approved_amount, 0)::bigint AS insurance_approved_amount,
       COALESCE(SUM(
         CASE
           WHEN LOWER(COALESCE(s.status, '')) IN ('requested', 'pending', 'approved')
           THEN COALESCE(s.amount_cents, ROUND(COALESCE(s.amount, 0) * 100)::int, 0)
           ELSE 0
         END
       ), 0)::bigint AS supplement_total_cents
     FROM repair_orders ro
     LEFT JOIN ro_supplements s
       ON s.ro_id::text = ro.id::text
      AND s.shop_id::text = ro.shop_id::text
     WHERE ro.id::text = $1::text
       AND ro.shop_id::text = $2::text
     GROUP BY ro.insurance_approved_amount`,
    [roId, shopId]
  );
  if (!totals) return null;

  const latest = await dbGet(
    `SELECT id, amount_cents, amount, status, notes
     FROM ro_supplements
     WHERE ro_id::text = $1::text
       AND shop_id::text = $2::text
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [roId, shopId]
  );

  const latestAmount = latest
    ? Number(latest.amount_cents ?? Math.round(Number(latest.amount || 0) * 100))
    : null;
  const latestStatus = latest ? String(latest.status || 'requested').trim().toLowerCase() : 'none';
  const totalInsurerOwed = Number(totals.insurance_approved_amount || 0) + Number(totals.supplement_total_cents || 0);

  await dbRun(
    `UPDATE repair_orders
     SET supplement_status = $1,
         supplement_amount = $2,
         supplement_notes = $3,
         total_insurer_owed = $4,
         updated_at = $5
     WHERE id::text = $6::text
       AND shop_id::text = $7::text`,
    [latestStatus, latestAmount, latest?.notes || null, totalInsurerOwed, new Date().toISOString(), roId, shopId]
  );

  return totalInsurerOwed;
}

async function ensureSupplementsTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ro_supplements (
      id UUID PRIMARY KEY,
      ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending',
      submitted_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await dbRun(`ALTER TABLE ro_supplements ADD COLUMN IF NOT EXISTS amount_cents INTEGER DEFAULT 0`).catch(() => {});
  await dbRun(`ALTER TABLE ro_supplements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`).catch(() => {});
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
      .filter(s => String(s.status || '').toLowerCase() === 'approved')
      .reduce((sum, s) => sum + (Number(s.amount_cents ?? 0) / 100 || parseFloat(s.amount || 0)), 0);

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
    const amountCents = dollarsToCents(amount);
    if (!Number.isFinite(amt) || amt < 0 || amountCents === null || amountCents < 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const stat = status && VALID_STATUSES.includes(status) ? status : 'Pending';
    const date = submitted_date || new Date().toISOString().split('T')[0];
    const id = uuidv4();

    await dbRun(
      `INSERT INTO ro_supplements (id, ro_id, shop_id, description, amount, amount_cents, status, submitted_date, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [id, req.params.id, req.user.shop_id, description.trim(), amt, amountCents, stat, date, notes?.trim() || null]
    );
    await recomputeSupplementLedgerTotals(req.params.id, req.user.shop_id);

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
      const amountCents = dollarsToCents(updates.amount);
      if (!Number.isFinite(amt) || amt < 0 || amountCents === null || amountCents < 0) {
        return res.status(400).json({ error: 'Valid amount is required' });
      }
      updates.amount = amt;
      updates.amount_cents = amountCents;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'description') &&
        !updates.description?.trim()) {
      return res.status(400).json({ error: 'Description cannot be empty' });
    }

    updates.updated_at = new Date().toISOString();
    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await dbRun(
      `UPDATE ro_supplements SET ${setClauses} WHERE id = $${keys.length + 1}`,
      [...vals, req.params.suppId]
    );
    await recomputeSupplementLedgerTotals(req.params.id, req.user.shop_id);

    const updated = await dbGet('SELECT * FROM ro_supplements WHERE id = $1', [req.params.suppId]);
    return res.json({ supplement: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
