const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');

async function ensureTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS appointment_requests (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      vehicle_info TEXT,
      service TEXT NOT NULL,
      preferred_date TEXT,
      preferred_time TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

router.post('/request', async (req, res) => {
  try {
    await ensureTable();
    const {
      name,
      phone,
      email,
      vehicle_year,
      vehicle_make,
      vehicle_model,
      service,
      preferred_date,
      preferred_time,
      notes,
    } = req.body || {};

    if (!name?.trim() || !phone?.trim() || !service?.trim()) {
      return res.status(400).json({ error: 'name, phone, and service are required' });
    }

    let shopId = req.query?.shop || null;
    if (!shopId) {
      const firstShop = await dbGet('SELECT id FROM shops ORDER BY created_at ASC LIMIT 1');
      if (!firstShop?.id) return res.status(400).json({ error: 'No shop configured' });
      shopId = firstShop.id;
    }

    const vehicleInfo = [vehicle_year, vehicle_make, vehicle_model].filter(Boolean).join(' ').trim();
    const id = uuidv4();
    await dbRun(
      `INSERT INTO appointment_requests
        (id, shop_id, name, phone, email, vehicle_info, service, preferred_date, preferred_time, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
      [id, shopId, name.trim(), phone.trim(), email?.trim() || null, vehicleInfo || null, service.trim(), preferred_date || null, preferred_time || null, notes?.trim() || null]
    );
    return res.status(201).json({ ok: true, id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    await ensureTable();
    const requests = await dbAll(
      `SELECT * FROM appointment_requests
       WHERE shop_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [req.user.shop_id]
    );
    return res.json({ requests });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    await ensureTable();
    const { status } = req.body || {};
    if (!['pending', 'confirmed', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const found = await dbGet(
      'SELECT id FROM appointment_requests WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!found) return res.status(404).json({ error: 'Not found' });

    await dbRun('UPDATE appointment_requests SET status = $1 WHERE id = $2', [status, req.params.id]);
    const updated = await dbGet('SELECT * FROM appointment_requests WHERE id = $1', [req.params.id]);
    return res.json({ request: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
