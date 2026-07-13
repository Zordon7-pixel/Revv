const router = require('express').Router();
const { pool, dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');
const { sendCustomerOptInConfirmation } = require('../services/customerOptInConfirmation');
const { v4: uuidv4 } = require('uuid');

const CONTACT_METHODS = new Set(['none', 'sms', 'email', 'both']);

function normalizePreferredContactMethod(value, smsConsent, emailConsent) {
  const method = String(value || '').trim().toLowerCase();
  if (CONTACT_METHODS.has(method)) return method;
  if (smsConsent && emailConsent) return 'both';
  if (emailConsent) return 'email';
  if (smsConsent) return 'sms';
  return 'none';
}

router.get('/', auth, async (req, res) => {
  try {
    const customers = await dbAll(
      `SELECT
         c.id,
         c.shop_id,
         c.name,
         c.phone,
         c.sms_consent,
         c.email,
         c.email_consent,
         c.preferred_contact_method,
         c.address,
         c.insurance_company,
         c.policy_number,
         c.created_at,
         (SELECT COUNT(*)::int
            FROM vehicles v
           WHERE v.customer_id::text = c.id::text
             AND v.shop_id::text = c.shop_id::text) AS vehicle_count,
         (SELECT COUNT(*)::int
            FROM repair_orders ro
           WHERE ro.customer_id::text = c.id::text
             AND ro.shop_id::text = c.shop_id::text) AS ro_count,
         (SELECT COUNT(*)::int
            FROM repair_orders ro
           WHERE ro.customer_id::text = c.id::text
             AND ro.shop_id::text = c.shop_id::text
             AND LOWER(COALESCE(ro.status, '')) NOT IN ('closed', 'total_loss')) AS active_ro_count
       FROM customers c
       WHERE c.shop_id::text = $1::text
       ORDER BY LOWER(c.name) ASC`,
      [req.user.shop_id]
    );
    res.json({ customers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/full', auth, async (req, res) => {
  try {
    const customer = await dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    const vehicles = await dbAll(
      'SELECT * FROM vehicles WHERE customer_id::text = $1::text AND shop_id::text = $2::text ORDER BY created_at DESC',
      [customer.id, req.user.shop_id]
    );
    const ros = await dbAll(
      'SELECT ro_number, id, status, job_type, created_at, updated_at, total, notes FROM repair_orders WHERE customer_id::text = $1::text AND shop_id::text = $2::text ORDER BY created_at DESC',
      [customer.id, req.user.shop_id]
    );
    res.json({ customer, vehicles, ros });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/history', auth, async (req, res) => {
  try {
    const customer = await dbGet('SELECT id, name FROM customers WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!customer) return res.status(404).json({ error: 'Not found' });

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 10;
    const excludeRoId = req.query.exclude_ro_id ? String(req.query.exclude_ro_id) : null;

    const history = await dbAll(
      `
        SELECT
          ro.id,
          ro.ro_number,
          ro.status,
          ro.job_type,
          ro.created_at,
          ro.updated_at,
          ro.intake_date,
          ro.estimated_delivery,
          ro.actual_delivery,
          ro.total,
          v.id AS vehicle_id,
          v.year,
          v.make,
          v.model,
          v.vin
        FROM repair_orders ro
        LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        WHERE ro.shop_id = $1
          AND ro.customer_id = $2
          AND ($3::text IS NULL OR ro.id <> $3)
        ORDER BY ro.created_at DESC
        LIMIT $4
      `,
      [req.user.shop_id, req.params.id, excludeRoId, limit]
    );

    return res.json({
      customer,
      history,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id/autofill', auth, async (req, res) => {
  try {
    const customer = await dbGet(
      'SELECT id, name, phone, sms_consent, email, email_consent, preferred_contact_method, insurance_company, policy_number FROM customers WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!customer) return res.status(404).json({ error: 'Not found' });

    const vehicles = await dbAll(
      'SELECT * FROM vehicles WHERE customer_id = $1 AND shop_id = $2 ORDER BY created_at DESC',
      [customer.id, req.user.shop_id]
    );

    const latestInsurance = await dbGet(
      `
        SELECT
          payment_type,
          insurer,
          insurance_company,
          claim_number,
          insurance_claim_number,
          adjuster_name,
          adjuster_phone,
          adjuster_email,
          deductible,
          policy_number,
          created_at
        FROM repair_orders
        WHERE customer_id = $1
          AND shop_id = $2
          AND (
            payment_type = 'insurance'
            OR COALESCE(insurance_company, insurer, adjuster_name, adjuster_phone, adjuster_email, insurance_claim_number, claim_number) IS NOT NULL
          )
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [customer.id, req.user.shop_id]
    );

    return res.json({
      customer,
      vehicles,
      latest_vehicle: vehicles[0] || null,
      latest_insurance: latestInsurance || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const customer = await dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    const vehicles = await dbAll(
      'SELECT * FROM vehicles WHERE customer_id::text = $1::text AND shop_id::text = $2::text',
      [customer.id, req.user.shop_id]
    );
    const ros = await dbAll(
      'SELECT ro_number, status, job_type, created_at FROM repair_orders WHERE customer_id::text = $1::text AND shop_id::text = $2::text ORDER BY created_at DESC',
      [customer.id, req.user.shop_id]
    );
    res.json({ ...customer, vehicles, ros });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, requireTechnician, async (req, res) => {
  try {
    const { name, phone, email, address, insurance_company, policy_number, sms_consent, email_consent, preferred_contact_method } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Customer name is required.' });
    const nextEmailConsent = email_consent === true;
    const normalizedEmail = String(email || '').trim() || null;
    if (nextEmailConsent && !normalizedEmail) {
      return res.status(400).json({ error: 'Customer email is required for email status updates.' });
    }
    const nextSmsConsent = sms_consent !== false;
    const nextPreferredMethod = normalizePreferredContactMethod(preferred_contact_method, nextSmsConsent, nextEmailConsent);
    const shop = await dbGet('SELECT id FROM shops WHERE id = $1', [req.user.shop_id]);
    if (!shop) return res.status(401).json({ error: 'Session expired. Please log out and back in.' });
    const id = uuidv4();
    await dbRun(
      `INSERT INTO customers
        (id, shop_id, name, phone, sms_consent, email, email_consent, preferred_contact_method, address, insurance_company, policy_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, req.user.shop_id, name.trim(), phone || null, nextSmsConsent, normalizedEmail, nextEmailConsent, nextPreferredMethod, address || null, insurance_company || null, policy_number || null]
    );
    await sendCustomerOptInConfirmation({
      phone,
      smsConsent: sms_consent !== false,
      shopId: req.user.shop_id,
    });
    res.status(201).json(await dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]));
  } catch (err) {
    console.error('Customer save error:', err.message);
    res.status(500).json({ error: 'Error saving customer. Please try again.' });
  }
});

router.put('/:id', auth, requireTechnician, async (req, res) => {
  try {
    const { name, phone, email, address, insurance_company, policy_number, sms_consent, email_consent, preferred_contact_method } = req.body;
    const nextSmsConsent = typeof sms_consent === 'boolean' ? sms_consent : null;
    const nextEmailConsent = typeof email_consent === 'boolean' ? email_consent : null;
    const normalizedEmail = String(email || '').trim() || null;
    if (nextEmailConsent === true && !normalizedEmail) {
      return res.status(400).json({ error: 'Customer email is required for email status updates.' });
    }
    const nextPreferredMethod = Object.prototype.hasOwnProperty.call(req.body || {}, 'preferred_contact_method')
      ? normalizePreferredContactMethod(preferred_contact_method, nextSmsConsent !== false, nextEmailConsent === true)
      : null;
    await dbRun(
      `UPDATE customers SET
         name=$1,
         phone=$2,
         sms_consent=COALESCE($3, sms_consent),
         email=$4,
         email_consent=COALESCE($5, email_consent),
         preferred_contact_method=COALESCE($6, preferred_contact_method),
         address=$7,
         insurance_company=$8,
         policy_number=$9
       WHERE id=$10 AND shop_id=$11`,
      [name, phone, nextSmsConsent, normalizedEmail, nextEmailConsent, nextPreferredMethod, address, insurance_company, policy_number, req.params.id, req.user.shop_id]
    );
    res.json(await dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, requireTechnician, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const roCount = await client.query(
      'SELECT COUNT(*)::int AS count FROM repair_orders WHERE customer_id::text = $1::text AND shop_id::text = $2::text',
      [req.params.id, req.user.shop_id]
    );
    const count = Number(roCount.rows?.[0]?.count || 0);
    if (count > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cannot delete: customer has ${count} repair order(s). Archive instead.`,
        code: 'HAS_REPAIR_ORDERS',
        count,
      });
    }

    await client.query('DELETE FROM vehicles WHERE customer_id::text = $1::text AND shop_id::text = $2::text', [req.params.id, req.user.shop_id]);
    await client.query('UPDATE users SET customer_id = NULL WHERE customer_id::text = $1::text AND shop_id::text = $2::text', [req.params.id, req.user.shop_id]);
    await client.query('DELETE FROM customers WHERE id::text = $1::text AND shop_id::text = $2::text', [req.params.id, req.user.shop_id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[Customer Delete] Rollback error:', rollbackErr?.message || rollbackErr, {
          customerId: req.params.id,
          shopId: req.user.shop_id,
        });
      }
    }
    console.error('[Customer Delete] Error:', err?.message || err, {
      customerId: req.params.id,
      shopId: req.user.shop_id,
    });
    res.status(500).json({ error: 'Failed to delete customer. Please try again.' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
