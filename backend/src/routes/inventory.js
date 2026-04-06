const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');
const { getDeliveryFeeSettings, calculateDeliveryFeeBreakdown, toMoney } = require('../services/deliveryFees');

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

async function ensureRentalInventoryTables() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS rental_inventory_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      available_qty INTEGER NOT NULL DEFAULT 0,
      daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_rental_inventory_items_shop ON rental_inventory_items(shop_id)`).catch(() => {});

  await dbRun(`
    CREATE TABLE IF NOT EXISTS ro_inventory_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      ro_id TEXT NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
      inventory_item_id UUID NOT NULL REFERENCES rental_inventory_items(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL DEFAULT 1,
      rental_days INTEGER NOT NULL DEFAULT 1,
      daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (ro_id, inventory_item_id)
    )
  `);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_ro_inventory_items_shop ON ro_inventory_items(shop_id)`).catch(() => {});
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_ro_inventory_items_ro ON ro_inventory_items(ro_id)`).catch(() => {});
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_ro_inventory_items_item ON ro_inventory_items(inventory_item_id)`).catch(() => {});

  await dbRun(`
    CREATE TABLE IF NOT EXISTS delivery_fee_settings (
      shop_id TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
      fee_type TEXT NOT NULL DEFAULT 'flat',
      flat_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
      per_mile_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
      default_zone_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
      zone_fees JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await dbRun(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS delivery_required BOOLEAN DEFAULT FALSE`).catch(() => {});
  await dbRun(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS pickup_required BOOLEAN DEFAULT FALSE`).catch(() => {});
  await dbRun(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS delivery_miles NUMERIC(10,2)`).catch(() => {});
  await dbRun(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS pickup_miles NUMERIC(10,2)`).catch(() => {});
  await dbRun(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS delivery_zone TEXT`).catch(() => {});
  await dbRun(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS pickup_zone TEXT`).catch(() => {});
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toCents(value, fallback = 0) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : fallback;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function parseZoneFees(rawValue) {
  const parsed = typeof rawValue === 'string'
    ? (() => {
        try {
          return JSON.parse(rawValue);
        } catch {
          return null;
        }
      })()
    : rawValue;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out = {};
  for (const [zone, fee] of Object.entries(parsed)) {
    const key = String(zone || '').trim();
    if (!key) continue;
    const normalizedFee = Math.max(0, toMoney(fee));
    out[key] = normalizedFee;
  }
  return out;
}

async function getRoForShop(roId, shopId) {
  return dbGet(
    `SELECT
       id, shop_id, ro_number, status,
       delivery_required, pickup_required,
       delivery_miles, pickup_miles,
       delivery_zone, pickup_zone
     FROM repair_orders
     WHERE id = $1 AND shop_id = $2`,
    [roId, shopId]
  );
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

    const item = await dbGet('SELECT * FROM parts_inventory WHERE id = $1 AND shop_id = $2', [itemId, req.user.shop_id]);
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

    const item = await dbGet('SELECT * FROM parts_inventory WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
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

router.get('/rental-items', auth, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const items = await dbAll(
      `SELECT *
       FROM rental_inventory_items
       WHERE shop_id = $1
       ORDER BY LOWER(name) ASC, created_at DESC`,
      [req.user.shop_id]
    );
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/rental-items', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const name = String(req.body?.name || '').trim();
    const notes = String(req.body?.notes || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const quantity = Math.max(0, toInt(req.body?.quantity, 0));
    const available_qty = req.body?.available_qty === undefined
      ? quantity
      : Math.max(0, toInt(req.body?.available_qty, 0));
    if (available_qty > quantity) {
      return res.status(400).json({ error: 'available_qty cannot be greater than quantity' });
    }

    const daily_rate = Math.max(0, toMoney(toFloat(req.body?.daily_rate, 0)));
    const id = uuidv4();

    await dbRun(
      `INSERT INTO rental_inventory_items
         (id, shop_id, name, quantity, available_qty, daily_rate, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, req.user.shop_id, name, quantity, available_qty, daily_rate, notes || null]
    );

    const item = await dbGet('SELECT * FROM rental_inventory_items WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]);
    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/rental-items/:id', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const existing = await dbGet(
      'SELECT * FROM rental_inventory_items WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Inventory item not found' });

    const hasQuantity = Object.prototype.hasOwnProperty.call(req.body || {}, 'quantity');
    const hasAvailable = Object.prototype.hasOwnProperty.call(req.body || {}, 'available_qty');
    const currentQuantity = Math.max(0, toInt(existing.quantity, 0));
    const currentAvailable = Math.max(0, toInt(existing.available_qty, 0));
    const currentlyReserved = Math.max(0, currentQuantity - currentAvailable);
    const nextQuantity = hasQuantity ? Math.max(0, toInt(req.body.quantity, currentQuantity)) : currentQuantity;

    if (nextQuantity < currentlyReserved) {
      return res.status(400).json({
        error: `Quantity cannot be set below reserved amount (${currentlyReserved})`,
      });
    }

    let nextAvailable;
    if (hasAvailable) {
      nextAvailable = Math.max(0, toInt(req.body.available_qty, currentAvailable));
    } else if (hasQuantity) {
      nextAvailable = nextQuantity - currentlyReserved;
    } else {
      nextAvailable = currentAvailable;
    }

    if (nextAvailable > nextQuantity) {
      return res.status(400).json({ error: 'available_qty cannot be greater than quantity' });
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      updates.name = name;
    }
    if (hasQuantity) updates.quantity = nextQuantity;
    if (hasAvailable || hasQuantity) updates.available_qty = nextAvailable;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'daily_rate')) {
      updates.daily_rate = Math.max(0, toMoney(toFloat(req.body.daily_rate, existing.daily_rate || 0)));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')) {
      updates.notes = String(req.body.notes || '').trim() || null;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    updates.updated_at = new Date().toISOString();
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(', ');
    await dbRun(
      `UPDATE rental_inventory_items
       SET ${setClause}
       WHERE id = $${keys.length + 1} AND shop_id = $${keys.length + 2}`,
      [...values, req.params.id, req.user.shop_id]
    );

    const item = await dbGet('SELECT * FROM rental_inventory_items WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/rental-items/:id', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const existing = await dbGet(
      'SELECT id FROM rental_inventory_items WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Inventory item not found' });

    const assignment = await dbGet(
      'SELECT id FROM ro_inventory_items WHERE inventory_item_id = $1 AND shop_id = $2 LIMIT 1',
      [req.params.id, req.user.shop_id]
    );
    if (assignment) {
      return res.status(409).json({ error: 'Cannot delete an item that is assigned to a job' });
    }

    await dbRun('DELETE FROM rental_inventory_items WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/delivery-fee-settings', auth, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const settings = await getDeliveryFeeSettings(req.user.shop_id);
    return res.json({ settings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/delivery-fee-settings', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const fee_type = String(req.body?.fee_type || 'flat').trim().toLowerCase();
    if (!['flat', 'per_mile', 'zone'].includes(fee_type)) {
      return res.status(400).json({ error: 'fee_type must be flat, per_mile, or zone' });
    }
    const flat_fee = Math.max(0, toMoney(toFloat(req.body?.flat_fee, 0)));
    const per_mile_rate = Math.max(0, toMoney(toFloat(req.body?.per_mile_rate, 0)));
    const default_zone_fee = Math.max(0, toMoney(toFloat(req.body?.default_zone_fee, 0)));
    const zone_fees = parseZoneFees(req.body?.zone_fees);

    await dbRun(
      `INSERT INTO delivery_fee_settings
         (shop_id, fee_type, flat_fee, per_mile_rate, default_zone_fee, zone_fees, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT (shop_id) DO UPDATE
       SET fee_type = EXCLUDED.fee_type,
           flat_fee = EXCLUDED.flat_fee,
           per_mile_rate = EXCLUDED.per_mile_rate,
           default_zone_fee = EXCLUDED.default_zone_fee,
           zone_fees = EXCLUDED.zone_fees,
           updated_at = NOW()`,
      [req.user.shop_id, fee_type, flat_fee, per_mile_rate, default_zone_fee, JSON.stringify(zone_fees)]
    );

    const settings = await getDeliveryFeeSettings(req.user.shop_id);
    return res.json({ settings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/jobs', auth, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const jobs = await dbAll(
      `SELECT
         ro.id,
         ro.ro_number,
         ro.status,
         ro.created_at,
         c.name AS customer_name,
         CONCAT_WS(' ', v.year::text, v.make, v.model) AS vehicle
       FROM repair_orders ro
       LEFT JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       WHERE ro.shop_id = $1
       ORDER BY ro.created_at DESC
       LIMIT 200`,
      [req.user.shop_id]
    );
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:roId/rental', auth, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const ro = await getRoForShop(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Job not found' });

    const assignments = await dbAll(
      `SELECT
         a.*,
         i.name AS inventory_name
       FROM ro_inventory_items a
       JOIN rental_inventory_items i
         ON i.id = a.inventory_item_id
        AND i.shop_id = a.shop_id
       WHERE a.ro_id = $1
         AND a.shop_id = $2
       ORDER BY a.created_at DESC`,
      [req.params.roId, req.user.shop_id]
    );
    const deliveryFeeBreakdown = await calculateDeliveryFeeBreakdown(ro);
    return res.json({
      ro,
      assignments,
      delivery_fee_breakdown: deliveryFeeBreakdown,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/jobs/:roId/delivery', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const ro = await getRoForShop(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Job not found' });

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'delivery_required')) {
      updates.delivery_required = toBool(req.body.delivery_required);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'pickup_required')) {
      updates.pickup_required = toBool(req.body.pickup_required);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'delivery_miles')) {
      const value = req.body.delivery_miles;
      updates.delivery_miles = value === '' || value === null ? null : Math.max(0, toMoney(toFloat(value, 0)));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'pickup_miles')) {
      const value = req.body.pickup_miles;
      updates.pickup_miles = value === '' || value === null ? null : Math.max(0, toMoney(toFloat(value, 0)));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'delivery_zone')) {
      updates.delivery_zone = String(req.body.delivery_zone || '').trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'pickup_zone')) {
      updates.pickup_zone = String(req.body.pickup_zone || '').trim() || null;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No delivery fields provided' });
    }

    updates.updated_at = new Date().toISOString();
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(', ');
    await dbRun(
      `UPDATE repair_orders
       SET ${setClause}
       WHERE id = $${keys.length + 1}
         AND shop_id = $${keys.length + 2}`,
      [...values, req.params.roId, req.user.shop_id]
    );

    const refreshed = await getRoForShop(req.params.roId, req.user.shop_id);
    const deliveryFeeBreakdown = await calculateDeliveryFeeBreakdown(refreshed);
    return res.json({ ro: refreshed, delivery_fee_breakdown: deliveryFeeBreakdown });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:roId/rental-items', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const ro = await getRoForShop(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Job not found' });

    const inventory_item_id = String(req.body?.inventory_item_id || '').trim();
    if (!inventory_item_id) return res.status(400).json({ error: 'inventory_item_id is required' });

    const quantity = Math.max(1, toInt(req.body?.quantity, 1));
    const rental_days = Math.max(1, toInt(req.body?.rental_days, 1));
    const notes = String(req.body?.notes || '').trim();

    const item = await dbGet(
      'SELECT * FROM rental_inventory_items WHERE id = $1 AND shop_id = $2',
      [inventory_item_id, req.user.shop_id]
    );
    if (!item) return res.status(404).json({ error: 'Inventory item not found' });

    const existing = await dbGet(
      'SELECT id FROM ro_inventory_items WHERE ro_id = $1 AND shop_id = $2 AND inventory_item_id = $3',
      [req.params.roId, req.user.shop_id, inventory_item_id]
    );
    if (existing) {
      return res.status(409).json({ error: 'This item is already associated with the selected job' });
    }

    const daily_rate = Object.prototype.hasOwnProperty.call(req.body || {}, 'daily_rate')
      ? Math.max(0, toMoney(toFloat(req.body.daily_rate, item.daily_rate || 0)))
      : Math.max(0, toMoney(toFloat(item.daily_rate, 0)));

    const reservedStock = await dbGet(
      `UPDATE rental_inventory_items
       SET available_qty = available_qty - $1, updated_at = NOW()
       WHERE id = $2
         AND shop_id = $3
         AND available_qty >= $1
       RETURNING id, quantity, available_qty`,
      [quantity, inventory_item_id, req.user.shop_id]
    );
    if (!reservedStock) {
      return res.status(409).json({ error: 'Not enough available quantity for this item' });
    }

    const assignmentId = uuidv4();
    try {
      await dbRun(
        `INSERT INTO ro_inventory_items
           (id, shop_id, ro_id, inventory_item_id, quantity, rental_days, daily_rate, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          assignmentId,
          req.user.shop_id,
          req.params.roId,
          inventory_item_id,
          quantity,
          rental_days,
          daily_rate,
          notes || null,
        ]
      );
    } catch (err) {
      await dbRun(
        `UPDATE rental_inventory_items
         SET available_qty = LEAST(quantity, available_qty + $1), updated_at = NOW()
         WHERE id = $2 AND shop_id = $3`,
        [quantity, inventory_item_id, req.user.shop_id]
      ).catch(() => {});
      throw err;
    }

    const assignment = await dbGet(
      `SELECT
         a.*,
         i.name AS inventory_name
       FROM ro_inventory_items a
       JOIN rental_inventory_items i
         ON i.id = a.inventory_item_id
        AND i.shop_id = a.shop_id
       WHERE a.id = $1
         AND a.shop_id = $2`,
      [assignmentId, req.user.shop_id]
    );

    return res.status(201).json({ assignment, stock: reservedStock });
  } catch (err) {
    if (String(err.message || '').includes('ro_inventory_items_ro_id_inventory_item_id_key')) {
      return res.status(409).json({ error: 'This item is already associated with the selected job' });
    }
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/jobs/:roId/rental-items/:assignmentId', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRentalInventoryTables();
    const assignment = await dbGet(
      `SELECT id, inventory_item_id, quantity
       FROM ro_inventory_items
       WHERE id = $1
         AND ro_id = $2
         AND shop_id = $3`,
      [req.params.assignmentId, req.params.roId, req.user.shop_id]
    );
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    await dbRun('DELETE FROM ro_inventory_items WHERE id = $1 AND shop_id = $2', [req.params.assignmentId, req.user.shop_id]);
    await dbRun(
      `UPDATE rental_inventory_items
       SET available_qty = LEAST(quantity, available_qty + $1),
           updated_at = NOW()
       WHERE id = $2
         AND shop_id = $3`,
      [Math.max(1, toInt(assignment.quantity, 1)), assignment.inventory_item_id, req.user.shop_id]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
