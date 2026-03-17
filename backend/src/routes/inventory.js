const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');

async function ensurePartsInventoryTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS parts_inventory (
      id UUID PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      part_number TEXT NOT NULL,
      name TEXT NOT NULL,
      qty_on_hand INTEGER NOT NULL DEFAULT 0,
      reorder_point INTEGER NOT NULL DEFAULT 0,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      supplier TEXT,
      location TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await dbRun(`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS cost_cents INTEGER`).catch(() => {});
  await dbRun(`UPDATE parts_inventory SET cost_cents = COALESCE(cost_cents, ROUND(cost * 100)::INTEGER, 0)`).catch(() => {});
  await dbRun(`ALTER TABLE parts_inventory ALTER COLUMN cost_cents SET DEFAULT 0`).catch(() => {});
  await dbRun(`UPDATE parts_inventory SET updated_at = NOW() WHERE updated_at IS NULL`).catch(() => {});
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_parts_inventory_shop ON parts_inventory(shop_id)`).catch(() => {});
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_parts_inventory_low_stock ON parts_inventory(shop_id, qty_on_hand, reorder_point)`).catch(() => {});
  await dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_inventory_shop_part_number ON parts_inventory(shop_id, part_number)`).catch(() => {});
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toCents(value, fallback = 0) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : fallback;
}

router.get('/', auth, async (req, res) => {
  try {
    await ensurePartsInventoryTable();
    const items = await dbAll(
      `SELECT *
       FROM parts_inventory
       WHERE shop_id = $1
       ORDER BY LOWER(name) ASC, created_at DESC`,
      [req.user.shop_id]
    );
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/low-stock', auth, async (req, res) => {
  try {
    await ensurePartsInventoryTable();
    const items = await dbAll(
      `SELECT *
       FROM parts_inventory
       WHERE shop_id = $1
         AND qty_on_hand <= reorder_point
       ORDER BY (reorder_point - qty_on_hand) DESC, LOWER(name) ASC`,
      [req.user.shop_id]
    );
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, requireTechnician, async (req, res) => {
  try {
    await ensurePartsInventoryTable();

    const part_number = String(req.body?.part_number || '').trim();
    const name = String(req.body?.name || '').trim();
    const supplier = String(req.body?.supplier || '').trim();
    const location = String(req.body?.location || '').trim();

    if (!part_number) return res.status(400).json({ error: 'part_number is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });

    const itemId = uuidv4();
    const qty_on_hand = Math.max(0, toInt(req.body?.qty_on_hand, 0));
    const reorder_point = Math.max(0, toInt(req.body?.reorder_point, 0));
    const cost_cents = Math.max(0, toInt(req.body?.cost_cents, toCents(req.body?.cost, 0)));

    await dbRun(
      `INSERT INTO parts_inventory
         (id, shop_id, part_number, name, qty_on_hand, reorder_point, cost_cents, supplier, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        itemId,
        req.user.shop_id,
        part_number,
        name,
        qty_on_hand,
        reorder_point,
        cost_cents,
        supplier || null,
        location || null,
      ]
    );

    const item = await dbGet('SELECT * FROM parts_inventory WHERE id = $1', [itemId]);
    return res.status(201).json({ item });
  } catch (err) {
    if (String(err.message || '').includes('idx_parts_inventory_shop_part_number')) {
      return res.status(409).json({ error: 'Part number already exists in inventory' });
    }
    return res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, requireTechnician, async (req, res) => {
  try {
    await ensurePartsInventoryTable();

    const existing = await dbGet(
      'SELECT * FROM parts_inventory WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Part not found' });

    const updates = {};
    if (req.body?.part_number !== undefined) updates.part_number = String(req.body.part_number || '').trim();
    if (req.body?.name !== undefined) updates.name = String(req.body.name || '').trim();
    if (req.body?.qty_on_hand !== undefined) updates.qty_on_hand = Math.max(0, toInt(req.body.qty_on_hand, 0));
    if (req.body?.reorder_point !== undefined) updates.reorder_point = Math.max(0, toInt(req.body.reorder_point, 0));
    if (req.body?.cost_cents !== undefined) updates.cost_cents = Math.max(0, toInt(req.body.cost_cents, 0));
    if (req.body?.cost !== undefined) updates.cost_cents = toCents(req.body.cost, 0);
    if (req.body?.supplier !== undefined) updates.supplier = String(req.body.supplier || '').trim() || null;
    if (req.body?.location !== undefined) updates.location = String(req.body.location || '').trim() || null;

    if (updates.part_number !== undefined && !updates.part_number) {
      return res.status(400).json({ error: 'part_number cannot be empty' });
    }
    if (updates.name !== undefined && !updates.name) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    updates.updated_at = new Date().toISOString();
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(', ');

    await dbRun(
      `UPDATE parts_inventory SET ${setClause} WHERE id = $${keys.length + 1} AND shop_id = $${keys.length + 2}`,
      [...values, req.params.id, req.user.shop_id]
    );

    const item = await dbGet('SELECT * FROM parts_inventory WHERE id = $1', [req.params.id]);
    return res.json({ item });
  } catch (err) {
    if (String(err.message || '').includes('idx_parts_inventory_shop_part_number')) {
      return res.status(409).json({ error: 'Part number already exists in inventory' });
    }
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, requireTechnician, async (req, res) => {
  try {
    await ensurePartsInventoryTable();
    const existing = await dbGet(
      'SELECT id FROM parts_inventory WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Part not found' });

    await dbRun('DELETE FROM parts_inventory WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
