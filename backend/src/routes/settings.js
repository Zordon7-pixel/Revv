const router = require('express').Router();
const { dbRun } = require('../db');
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
