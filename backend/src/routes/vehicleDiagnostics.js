const router = require('express').Router();
const auth = require('../middleware/auth');
const { requireAdmin, requireTechnician } = require('../middleware/roles');
const { dbGet, dbAll, dbRun } = require('../db');

const DTC_SEVERITIES = new Set(['info', 'warning', 'critical']);
const ADAS_STATUSES = new Set(['ok', 'needs_calibration', 'fault']);

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value;
}

function validateDtcCodes(value) {
  const dtcCodes = normalizeArray(value);
  for (const item of dtcCodes) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Each DTC entry must be an object' };
    if (!item.code || typeof item.code !== 'string') return { ok: false, error: 'Each DTC entry requires a code' };
    if (!item.description || typeof item.description !== 'string') return { ok: false, error: 'Each DTC entry requires a description' };
    if (!DTC_SEVERITIES.has(String(item.severity || ''))) {
      return { ok: false, error: 'DTC severity must be info, warning, or critical' };
    }
  }
  return { ok: true, value: dtcCodes };
}

function validateAdasSystems(value) {
  const adasSystems = normalizeArray(value);
  for (const item of adasSystems) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Each ADAS entry must be an object' };
    if (!item.system || typeof item.system !== 'string') return { ok: false, error: 'Each ADAS entry requires a system' };
    if (!ADAS_STATUSES.has(String(item.status || ''))) {
      return { ok: false, error: 'ADAS status must be ok, needs_calibration, or fault' };
    }
  }
  return { ok: true, value: adasSystems };
}

function parseScanId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

router.post('/', auth, requireTechnician, async (req, res) => {
  try {
    const {
      ro_id = null,
      vehicle_id = null,
      vin,
      scan_date = null,
      scanned_by,
      scanner_tool = null,
      pre_repair = false,
      post_repair = false,
      dtc_codes = [],
      adas_systems = [],
      notes = null,
    } = req.body || {};

    if (!req.user.shop_id) return res.status(400).json({ error: 'Shop context is required' });
    if (!vin || typeof vin !== 'string' || !vin.trim()) {
      return res.status(400).json({ error: 'vin is required' });
    }
    if (!scanned_by || typeof scanned_by !== 'string' || !scanned_by.trim()) {
      return res.status(400).json({ error: 'scanned_by is required' });
    }

    const dtcValidation = validateDtcCodes(dtc_codes);
    if (!dtcValidation.ok) return res.status(400).json({ error: dtcValidation.error });

    const adasValidation = validateAdasSystems(adas_systems);
    if (!adasValidation.ok) return res.status(400).json({ error: adasValidation.error });

    const { rows } = await dbRun(
      `INSERT INTO vehicle_diagnostic_scans
         (shop_id, ro_id, vehicle_id, vin, scan_date, scanned_by, scanner_tool, pre_repair, post_repair, dtc_codes, adas_systems, notes)
       VALUES
         ($1, $2, $3, $4, COALESCE($5, NOW()), $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
       RETURNING *`,
      [
        req.user.shop_id,
        ro_id,
        vehicle_id,
        vin.trim(),
        scan_date,
        scanned_by.trim(),
        scanner_tool,
        Boolean(pre_repair),
        Boolean(post_repair),
        JSON.stringify(dtcValidation.value),
        JSON.stringify(adasValidation.value),
        notes,
      ]
    );

    return res.status(201).json({ scan: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    if (!req.user.shop_id) return res.status(400).json({ error: 'Shop context is required' });

    const { ro_id } = req.query || {};

    if (ro_id) {
      const scans = await dbAll(
        `SELECT *
         FROM vehicle_diagnostic_scans
         WHERE shop_id = $1 AND ro_id = $2
         ORDER BY scan_date DESC, created_at DESC, id DESC`,
        [req.user.shop_id, ro_id]
      );
      return res.json({ scans });
    }

    const scans = await dbAll(
      `SELECT *
       FROM vehicle_diagnostic_scans
       WHERE shop_id = $1
       ORDER BY scan_date DESC, created_at DESC, id DESC`,
      [req.user.shop_id]
    );

    return res.json({ scans });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    if (!req.user.shop_id) return res.status(400).json({ error: 'Shop context is required' });

    const id = parseScanId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid scan id' });

    const scan = await dbGet(
      `SELECT *
       FROM vehicle_diagnostic_scans
       WHERE id = $1 AND shop_id = $2`,
      [id, req.user.shop_id]
    );

    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    return res.json({ scan });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    if (!req.user.shop_id) return res.status(400).json({ error: 'Shop context is required' });

    const id = parseScanId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid scan id' });

    const { rows } = await dbRun(
      `DELETE FROM vehicle_diagnostic_scans
       WHERE id = $1 AND shop_id = $2
       RETURNING id`,
      [id, req.user.shop_id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Scan not found' });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
