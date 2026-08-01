const router = require('express').Router();
const { dbGet, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin, requireTechnician, disallowAssistant } = require('../middleware/roles');

const SECTIONS = new Set(['ros', 'customers', 'vehicles', 'timeclock', 'all']);
const COST_PROFILE_PERCENT_FIELDS = [
  'parts_margin_pct',
  'materials_margin_pct',
  'sublet_margin_pct',
];

function isOwnerOrAdmin(user) {
  return ['owner', 'admin'].includes(user?.role);
}

async function resetRos(shopId) {
  await dbRun(
    `DELETE FROM ro_photos
     WHERE ro_id IN (SELECT id FROM repair_orders WHERE shop_id = $1)`,
    [shopId]
  );
  await dbRun(
    `DELETE FROM parts_orders
     WHERE ro_id IN (SELECT id FROM repair_orders WHERE shop_id = $1)`,
    [shopId]
  );
  await dbRun(
    `DELETE FROM job_status_log
     WHERE ro_id IN (SELECT id FROM repair_orders WHERE shop_id = $1)`,
    [shopId]
  );
  await dbRun(
    `DELETE FROM parts_requests
     WHERE ro_id IN (SELECT id FROM repair_orders WHERE shop_id = $1)`,
    [shopId]
  );
  const roResult = await dbRun('DELETE FROM repair_orders WHERE shop_id = $1', [shopId]);
  return roResult.rowCount || 0;
}

async function resetCustomers(shopId) {
  await dbRun('UPDATE users SET customer_id = NULL WHERE shop_id = $1', [shopId]);
  const result = await dbRun('DELETE FROM customers WHERE shop_id = $1', [shopId]);
  return result.rowCount || 0;
}

async function resetVehicles(shopId) {
  const result = await dbRun('DELETE FROM vehicles WHERE shop_id = $1', [shopId]);
  return result.rowCount || 0;
}

async function resetTimeclock(shopId) {
  await dbRun('DELETE FROM lunch_breaks WHERE shop_id = $1', [shopId]);
  const entries = await dbRun('DELETE FROM time_entries WHERE shop_id = $1', [shopId]);
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

    const deleted = {};
    const shopId = req.user.shop_id;

    if (section === 'ros') {
      deleted.ros = await resetRos(shopId);
    }

    if (section === 'customers') {
      deleted.customers = await resetCustomers(shopId);
    }

    if (section === 'vehicles') {
      deleted.vehicles = await resetVehicles(shopId);
    }

    if (section === 'timeclock') {
      deleted.timeclock = await resetTimeclock(shopId);
    }

    if (section === 'all') {
      deleted.ros = await resetRos(shopId);
      deleted.vehicles = await resetVehicles(shopId);
      deleted.customers = await resetCustomers(shopId);
      deleted.timeclock = await resetTimeclock(shopId);
    }

    return res.json({ ok: true, deleted });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
