const router = require('express').Router();
const auth = require('../middleware/auth');
const { dbAll } = require('../db');
const calibrationData = require('../data/adas-calibrations.json');

const ACTIVE_STATUSES = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery'];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function lookupCalibration(year, make, model) {
  const numericYear = Number(year);
  const makeKey = normalize(make);
  const modelKey = normalize(model);
  return calibrationData.find((entry) => (
    normalize(entry.make) === makeKey
    && normalize(entry.model) === modelKey
    && numericYear >= Number(entry.year_start)
    && numericYear <= Number(entry.year_end)
  ));
}

router.get('/lookup', auth, (req, res) => {
  const { year, make, model } = req.query || {};
  if (!year || !make || !model) {
    return res.status(400).json({ error: 'year, make, and model are required' });
  }

  const found = lookupCalibration(year, make, model);
  if (!found) {
    return res.json({
      found: false,
      year: Number(year),
      make,
      model,
      systems: [],
      recommendation: 'No exact ADAS profile found in seed data. Confirm OEM calibration requirements manually.',
    });
  }

  return res.json({
    found: true,
    year: Number(year),
    make: found.make,
    model: found.model,
    systems: found.systems,
    recommendation: 'Perform pre-scan/post-scan and calibrate all impacted ADAS systems before delivery.',
  });
});

router.get('/queue', auth, async (req, res) => {
  try {
    const ros = await dbAll(
      `SELECT
        ro.id,
        ro.ro_number,
        ro.status,
        ro.estimated_delivery,
        ro.updated_at,
        c.name AS customer_name,
        v.year,
        v.make,
        v.model
       FROM repair_orders ro
       LEFT JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       WHERE ro.shop_id = $1
         AND ro.status = ANY($2)
       ORDER BY ro.updated_at DESC`,
      [req.user.shop_id, ACTIVE_STATUSES]
    );

    const queue = ros
      .map((ro) => {
        const profile = lookupCalibration(ro.year, ro.make, ro.model);
        if (!profile) return null;
        return {
          ro_id: ro.id,
          ro_number: ro.ro_number,
          status: ro.status,
          estimated_delivery: ro.estimated_delivery,
          customer_name: ro.customer_name,
          vehicle: `${ro.year || ''} ${ro.make || ''} ${ro.model || ''}`.trim(),
          systems_count: profile.systems.length,
          systems: profile.systems,
        };
      })
      .filter(Boolean);

    return res.json({
      count: queue.length,
      queue,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
