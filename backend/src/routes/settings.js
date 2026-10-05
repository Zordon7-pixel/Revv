const router = require('express').Router();
const { dbGet, dbRun } = require('../db');
const { withLockedShopDeletion, PaymentError } = require('../services/paymentReservations');
const auth = require('../middleware/auth');
const { requireAdmin, requireTechnician, disallowAssistant } = require('../middleware/roles');

const { newPublicIntakeSlug } = require('../services/publicShop');

function intakeOwner(req, res, next) {
  if (!isOwnerOrAdmin(req.user) || !req.user.shop_id) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

router.get('/public-intake', auth, intakeOwner, async (req, res) => {
  try {
    const shop = await dbGet('SELECT public_intake_slug FROM shops WHERE id = $1', [req.user.shop_id]);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    return res.json({ public_intake_slug: shop.public_intake_slug });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/public-intake/rotate', auth, intakeOwner, async (req, res) => {
  try {
    const shop = await dbGet(
      'UPDATE shops SET public_intake_slug = $1 WHERE id = $2 RETURNING public_intake_slug',
      [newPublicIntakeSlug(), req.user.shop_id]
    );
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    return res.json({ public_intake_slug: shop.public_intake_slug });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const SECTIONS = new Set(['ros', 'customers', 'vehicles', 'timeclock', 'all']);
const COST_PROFILE_PERCENT_FIELDS = [
  'parts_margin_pct',
  'materials_margin_pct',
  'sublet_margin_pct',
];

function isOwnerOrAdmin(user) {
  return ['owner', 'admin'].includes(user?.role);
}

async function resetRos(shopId, run) {
  await run(
    `DELETE FROM ro_photos
     WHERE ro_id::text IN (SELECT id::text FROM repair_orders WHERE shop_id = $1)`,
    [shopId]
  );
  await run(
    `DELETE FROM parts_orders
     WHERE ro_id::text IN (SELECT id::text FROM repair_orders WHERE shop_id = $1)`,
    [shopId]
  );
  await run(
    `DELETE FROM job_status_log
     WHERE ro_id::text IN (SELECT id::text FROM repair_orders WHERE shop_id = $1)`,
    [shopId]
  );
  await run(
    `DELETE FROM parts_requests
     WHERE ro_id::text IN (SELECT id::text FROM repair_orders WHERE shop_id = $1)`,
    [shopId]
  );
  const roResult = await run('DELETE FROM repair_orders WHERE shop_id = $1', [shopId]);
  return roResult.rowCount || 0;
}

async function resetCustomers(shopId, run) {
  await run('UPDATE users SET customer_id = NULL WHERE shop_id = $1', [shopId]);
  const result = await run('DELETE FROM customers WHERE shop_id = $1', [shopId]);
  return result.rowCount || 0;
}

async function resetVehicles(shopId, run) {
  const result = await run('DELETE FROM vehicles WHERE shop_id = $1', [shopId]);
  return result.rowCount || 0;
}

async function resetTimeclock(shopId, run) {
  await run('DELETE FROM lunch_breaks WHERE shop_id = $1', [shopId]);
  const entries = await run('DELETE FROM time_entries WHERE shop_id = $1', [shopId]);
  return entries.rowCount || 0;
}

router.get('/', auth, requireTechnician, async (req, res) => {
  try {
    const costProfileColumns = isOwnerOrAdmin(req.user)
      ? `,
         parts_margin_pct,
         materials_margin_pct,
         sublet_margin_pct,
         blended_labor_cost_per_hr`
      : '';
    const settings = await dbGet(
      `SELECT
         COALESCE(sms_notifications_enabled, TRUE) AS sms_notifications_enabled,
         COALESCE(email_notifications_enabled, TRUE) AS email_notifications_enabled${costProfileColumns}
       FROM shops
       WHERE id = $1`,
      [req.user.shop_id]
    );
    if (!settings) return res.status(404).json({ error: 'Shop not found' });
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/', auth, requireTechnician, async (req, res) => {
  try {
    if (!isOwnerOrAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const updates = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'sms_notifications_enabled')) {
      updates.sms_notifications_enabled = !!req.body.sms_notifications_enabled;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'email_notifications_enabled')) {
      updates.email_notifications_enabled = !!req.body.email_notifications_enabled;
    }
    for (const field of COST_PROFILE_PERCENT_FIELDS) {
      if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, field)) continue;
      const value = req.body[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        return res.status(400).json({ error: `${field} must be a number between 0 and 1` });
      }
      updates[field] = value;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'blended_labor_cost_per_hr')) {
      const value = req.body.blended_labor_cost_per_hr;
      const clearsProfile = value === null || (typeof value === 'string' && value.trim() === '');
      if (!clearsProfile && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
        return res.status(400).json({ error: 'blended_labor_cost_per_hr must be null/empty or a number greater than 0' });
      }
      updates.blended_labor_cost_per_hr = clearsProfile ? null : value;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid settings provided' });
    }

    const setClauses = [];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(updates, 'sms_notifications_enabled')) {
      values.push(updates.sms_notifications_enabled);
      setClauses.push(`sms_notifications_enabled = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'email_notifications_enabled')) {
      values.push(updates.email_notifications_enabled);
      setClauses.push(`email_notifications_enabled = $${values.length}`);
    }
    for (const field of COST_PROFILE_PERCENT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(updates, field)) continue;
      values.push(updates[field]);
      setClauses.push(`${field} = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'blended_labor_cost_per_hr')) {
      values.push(updates.blended_labor_cost_per_hr);
      setClauses.push(`blended_labor_cost_per_hr = $${values.length}`);
    }
    values.push(req.user.shop_id);
    await dbRun(`UPDATE shops SET ${setClauses.join(', ')} WHERE id = $${values.length}`, values);

    const updated = await dbGet(
      `SELECT
         COALESCE(sms_notifications_enabled, TRUE) AS sms_notifications_enabled,
         COALESCE(email_notifications_enabled, TRUE) AS email_notifications_enabled,
         parts_margin_pct,
         materials_margin_pct,
         sublet_margin_pct,
         blended_labor_cost_per_hr
       FROM shops
       WHERE id = $1`,
      [req.user.shop_id]
    );
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/reset/:section', auth, requireAdmin, disallowAssistant, async (req, res) => {
  try {
    const { section } = req.params;
    if (!SECTIONS.has(section)) {
      return res.status(400).json({ error: 'Invalid section' });
    }

    const shopId = req.user.shop_id;
    const deleted = await withLockedShopDeletion(shopId, async client => {
      const deleted = {};
      const run = (sql, params) => client.query(sql, params);

      if (section === 'ros') {
        deleted.ros = await resetRos(shopId, run);
      }

      if (section === 'customers') {
        deleted.customers = await resetCustomers(shopId, run);
      }

      if (section === 'vehicles') {
        deleted.vehicles = await resetVehicles(shopId, run);
      }

      if (section === 'timeclock') {
        deleted.timeclock = await resetTimeclock(shopId, run);
      }

      if (section === 'all') {
        deleted.ros = await resetRos(shopId, run);
        deleted.vehicles = await resetVehicles(shopId, run);
        deleted.customers = await resetCustomers(shopId, run);
        deleted.timeclock = await resetTimeclock(shopId, run);
      }

      return deleted;
    });

    return res.json({ ok: true, deleted });
  } catch (err) {
    return res.status(err instanceof PaymentError ? err.status : 500).json({
      error: err instanceof PaymentError ? err.message : 'Could not reset data',
    });
  }
});

module.exports = router;
