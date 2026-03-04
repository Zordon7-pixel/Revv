const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAssistant, requireTechnician } = require('../middleware/roles');

router.use(auth, requireAssistant);

router.get('/summary', async (req, res) => {
  try {
    const summary = await dbGet(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(12,2) AS unpaid_total
       FROM storage_charges
       WHERE shop_id = $1 AND COALESCE(paid, FALSE) = FALSE`,
      [req.user.shop_id]
    );
    return res.json({ unpaid_total: Number(summary?.unpaid_total || 0) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT
         ro.*,
         c.name AS customer_name,
         v.year,
         v.make,
         v.model,
         lc.id AS latest_charge_id,
         lc.total_amount AS latest_charge_total,
         lc.paid AS latest_charge_paid,
         lc.billed_date AS latest_charge_billed_date,
         COALESCE(unpaid.unpaid_total, 0)::numeric(12,2) AS unpaid_total
       FROM repair_orders ro
       LEFT JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       LEFT JOIN LATERAL (
         SELECT sc.*
         FROM storage_charges sc
         WHERE sc.ro_id = ro.id AND sc.shop_id = $1
         ORDER BY sc.created_at DESC
         LIMIT 1
       ) lc ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(sc.total_amount), 0)::numeric(12,2) AS unpaid_total
         FROM storage_charges sc
         WHERE sc.ro_id = ro.id
           AND sc.shop_id = $1
           AND COALESCE(sc.paid, FALSE) = FALSE
       ) unpaid ON TRUE
       WHERE ro.shop_id = $1
         AND COALESCE(ro.storage_hold, FALSE) = TRUE
       ORDER BY ro.created_at DESC`,
      [req.user.shop_id]
    );
    return res.json({ ros: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:roId/charges', async (req, res) => {
  try {
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const charges = await dbAll(
      `SELECT *
       FROM storage_charges
       WHERE ro_id = $1 AND shop_id = $2
       ORDER BY created_at DESC`,
      [req.params.roId, req.user.shop_id]
    );
    return res.json({ charges });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:roId/charges', requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const days = Number(req.body?.days);
    const ratePerDay = Number(req.body?.rate_per_day);
    if (!Number.isFinite(days) || days <= 0) return res.status(400).json({ error: 'days must be greater than 0' });
    if (!Number.isFinite(ratePerDay) || ratePerDay < 0) return res.status(400).json({ error: 'rate_per_day must be 0 or greater' });

    const totalAmount = Number((days * ratePerDay).toFixed(2));
    const charge = await dbGet(
      `INSERT INTO storage_charges (
         shop_id, ro_id, days, rate_per_day, total_amount, billed_to, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.shop_id,
        req.params.roId,
        Math.floor(days),
        ratePerDay.toFixed(2),
        totalAmount.toFixed(2),
        req.body?.billed_to || null,
        req.body?.notes || null,
      ]
    );

    return res.status(201).json({ charge });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/:roId/charges/:chargeId', requireTechnician, async (req, res) => {
  try {
    const updated = await dbGet(
      `UPDATE storage_charges
       SET paid = TRUE
       WHERE id = $1 AND ro_id = $2 AND shop_id = $3
       RETURNING *`,
      [req.params.chargeId, req.params.roId, req.user.shop_id]
    );
    if (!updated) return res.status(404).json({ error: 'Charge not found' });
    return res.json({ charge: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/:roId', requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const updatableFields = [
      'storage_hold',
      'storage_rate_per_day',
      'storage_start_date',
      'storage_company',
      'storage_contact',
      'storage_notes',
    ];
    const entries = Object.entries(req.body || {}).filter(([key]) => updatableFields.includes(key));
    if (!entries.length) return res.status(400).json({ error: 'No valid fields provided' });

    const values = [];
    const sets = entries.map(([key, value], i) => {
      let nextValue = value;
      if (key === 'storage_hold') nextValue = !!value;
      if (key === 'storage_rate_per_day') nextValue = value === '' || value === null ? null : Number(value);
      if (typeof nextValue === 'string') nextValue = nextValue.trim() || null;
      values.push(nextValue);
      return `${key} = $${i + 1}`;
    });

    values.push(req.params.roId, req.user.shop_id);
    const updated = await dbGet(
      `UPDATE repair_orders
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND shop_id = $${values.length}
       RETURNING *`,
      values
    );

    return res.json({ ro: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
