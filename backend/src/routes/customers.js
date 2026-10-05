const router = require('express').Router();
const { pool, dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');
const { sendCustomerOptInConfirmation } = require('../services/customerOptInConfirmation');
const { v4: uuidv4 } = require('uuid');

const { hasConfirmedSmsConsent, consentMutation, normalizePreferredContactMethod } = require('../services/customerConsent');

router.get('/', auth, async (req, res) => {
  try {
    const customers = await dbAll(
      `SELECT
         c.id,
         c.shop_id,
         c.name,
         c.phone,
         c.sms_consent,
         c.sms_consent_at,
         c.sms_consent_method,
         c.sms_consent_by,
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
      'SELECT id, name, phone, sms_consent, sms_consent_at, sms_consent_method, sms_consent_by, email, email_consent, preferred_contact_method, insurance_company, policy_number FROM customers WHERE id = $1 AND shop_id = $2',
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
    const { name, phone, email, address, insurance_company, policy_number, email_consent, preferred_contact_method } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Customer name is required.' });
    const nextEmailConsent = email_consent === true;
    const normalizedEmail = String(email || '').trim() || null;
    if (nextEmailConsent && !normalizedEmail) {
      return res.status(400).json({ error: 'Customer email is required for email status updates.' });
    }
    const consent = consentMutation(req.body, req.user.id);
    const nextSmsConsent = hasConfirmedSmsConsent(consent);
    const nextPreferredMethod = normalizePreferredContactMethod(preferred_contact_method, nextSmsConsent, nextEmailConsent);
    const shop = await dbGet('SELECT id FROM shops WHERE id = $1', [req.user.shop_id]);
    if (!shop) return res.status(401).json({ error: 'Session expired. Please log out and back in.' });
    const id = uuidv4();
    await dbRun(
      `INSERT INTO customers
        (id, shop_id, name, phone, sms_consent, email, email_consent, preferred_contact_method, address, insurance_company, policy_number, sms_consent_at, sms_consent_method, sms_consent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, req.user.shop_id, name.trim(), phone || null, nextSmsConsent, normalizedEmail, nextEmailConsent, nextPreferredMethod, address || null, insurance_company || null, policy_number || null, consent?.sms_consent_at || null, consent?.sms_consent_method || null, consent?.sms_consent_by || null]
    );
    await sendCustomerOptInConfirmation({
      phone,
      smsConsent: nextSmsConsent,
      shopId: req.user.shop_id,
    });
    res.status(201).json(await dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Customer save error:', err.message);
    res.status(500).json({ error: 'Error saving customer. Please try again.' });
  }
});

// Same punctuation/US-country-prefix normalization as the SMS recipient guard.
function normalizedPhone(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}
function maskedPhone(phone) {
  const digits = normalizedPhone(phone);
  return digits.length >= 7 ? `***${digits.slice(-4)}` : '***';
}

router.put('/:id', auth, requireTechnician, async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const existing = (await client.query('SELECT * FROM customers WHERE id=$1 AND shop_id=$2 FOR UPDATE',
      [req.params.id, req.user.shop_id])).rows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const phoneChanged = Object.hasOwn(req.body, 'phone')
      && normalizedPhone(req.body.phone) !== normalizedPhone(existing.phone);
    // A phone edit cannot also attest to the new number, even with TRUE in the
    // same payload. A later explicit submission must supply fresh evidence.
    const mutation = consentMutation(phoneChanged ? { sms_consent: false } : req.body, req.user.id);
    const changes = {};
    for (const field of ['name', 'phone', 'email', 'address', 'insurance_company', 'policy_number']) {
      if (Object.hasOwn(req.body, field)) changes[field] = req.body[field];
    }
    if (typeof req.body.email_consent === 'boolean') changes.email_consent = req.body.email_consent;
    Object.assign(changes, mutation);
    const next = { ...existing, ...changes };
    if (next.email_consent === true && !String(next.email || '').trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Customer email is required for email status updates.' });
    }
    changes.preferred_contact_method = normalizePreferredContactMethod(
      req.body.preferred_contact_method ?? existing.preferred_contact_method,
      hasConfirmedSmsConsent(next), next.email_consent);
    // Only actual consent mutations name consent columns: unrelated edits must
    // not advance the trigger revision or overwrite a concurrent STOP.
    const fields = Object.keys(changes);
    const result = await client.query(`UPDATE customers SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(', ')}
      WHERE id=$${fields.length + 1} AND shop_id=$${fields.length + 2} RETURNING *`,
    [...Object.values(changes), req.params.id, req.user.shop_id]);
    if (phoneChanged) {
      await client.query(`INSERT INTO customer_consent_phone_changes
        (customer_id, shop_id, old_phone_masked, new_phone_masked, staff_id, reason)
        VALUES ($1, $2, $3, $4, $5, 'phone_changed')`,
      [existing.id, req.user.shop_id, maskedPhone(existing.phone), maskedPhone(next.phone), req.user.id]);
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('[Customer consent] Rollback failed:', rollbackError.message);
      }
    }
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error saving customer. Please try again.' });
  } finally {
    if (client) client.release();
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
