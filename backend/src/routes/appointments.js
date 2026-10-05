const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');
const { resolvePublicShop, sendPublicIntakeError } = require('../services/publicShop');
const appointmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' },
});

router.post('/request', appointmentLimiter, async (req, res) => {
  try {
    const shopId = await resolvePublicShop(req);
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
    if (notes && notes.trim().length > 1000) {
      return res.status(400).json({ error: 'Notes must be 1000 characters or less' });
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
    return sendPublicIntakeError(res, err);
  }
});

router.get('/', auth, requireTechnician, async (req, res) => {
  try {
    const requests = await dbAll(
      `SELECT * FROM appointment_requests
       WHERE shop_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [req.user.shop_id]
    );
    return res.json({ requests });
  } catch (err) {
    return sendPublicIntakeError(res, err);
  }
});

router.put('/:id', auth, requireTechnician, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['pending', 'confirmed', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const found = await dbGet(
      'SELECT id FROM appointment_requests WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!found) return res.status(404).json({ error: 'Not found' });

    await dbRun('UPDATE appointment_requests SET status = $1 WHERE id = $2 AND shop_id = $3', [status, req.params.id, req.user.shop_id]);
    const updated = await dbGet('SELECT * FROM appointment_requests WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    return res.json({ request: updated });
  } catch (err) {
    return sendPublicIntakeError(res, err);
  }
});

module.exports = router;
