const router = require('express').Router();
const { dbGet, dbRun } = require('../db');
const auth = require('../middleware/auth');

const SECTIONS = new Set(['ros', 'customers', 'vehicles', 'timeclock', 'all']);

function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  return next();
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

router.get('/', auth, async (req, res) => {
  try {
    const settings = await dbGet(
      'SELECT COALESCE(sms_notifications_enabled, TRUE) AS sms_notifications_enabled FROM shops WHERE id = $1',
      [req.user.shop_id]
    );
    if (!settings) return res.status(404).json({ error: 'Shop not found' });
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/', auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const updates = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'sms_notifications_enabled')) {
      updates.sms_notifications_enabled = !!req.body.sms_notifications_enabled;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid settings provided' });
    }

    await dbRun(
      'UPDATE shops SET sms_notifications_enabled = $1 WHERE id = $2',
      [updates.sms_notifications_enabled, req.user.shop_id]
    );

    const updated = await dbGet(
      'SELECT COALESCE(sms_notifications_enabled, TRUE) AS sms_notifications_enabled FROM shops WHERE id = $1',
      [req.user.shop_id]
    );
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/reset/:section', auth, requireOwner, async (req, res) => {
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
