const router = require('express').Router();
const { dbAll, dbGet } = require('../db');
const apiKeyAuth = require('../middleware/apiKeyAuth');

router.use(apiKeyAuth);

function ok(res, data, meta = undefined) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return res.json(payload);
}

function fail(res, status, code, message, details = undefined) {
  const payload = {
    success: false,
    error: { code, message },
  };
  if (details) payload.error.details = details;
  return res.status(status).json(payload);
}

function mapEstimate(row) {
  return {
    id: row.id,
    ro_number: row.ro_number,
    estimate_status: row.estimate_status_normalized,
    repair_status: row.status,
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
    },
    vehicle: {
      id: row.vehicle_id,
      year: row.year,
      make: row.make,
      model: row.model,
      vin: row.vin,
    },
    pricing: {
      parts_cost: Number(row.parts_cost || 0),
      labor_cost: Number(row.labor_cost || 0),
      sublet_cost: Number(row.sublet_cost || 0),
      tax: Number(row.tax || 0),
      total: Number(row.total || 0),
    },
    timestamps: {
      intake_date: row.intake_date,
      estimate_approved_at: row.estimate_approved_at,
      updated_at: row.updated_at,
      created_at: row.created_at,
    },
  };
}

const BASE_ESTIMATE_SELECT = `
  SELECT
    ro.id,
    ro.ro_number,
    ro.status,
    ro.estimate_status,
    ro.estimate_approved_at,
    ro.parts_cost,
    ro.labor_cost,
    ro.sublet_cost,
    ro.tax,
    ro.total,
    ro.intake_date,
    ro.created_at,
    ro.updated_at,
    ro.vehicle_id,
    ro.customer_id,
    v.year,
    v.make,
    v.model,
    v.vin,
    c.name AS customer_name,
    c.phone AS customer_phone,
    c.email AS customer_email,
    CASE
      WHEN ro.estimate_approved_at IS NOT NULL THEN 'approved'
      WHEN ro.status IN ('approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed') THEN 'approved'
      WHEN COALESCE(ro.estimate_status, 'pending') = '' THEN 'pending'
      ELSE COALESCE(ro.estimate_status, 'pending')
    END AS estimate_status_normalized
  FROM repair_orders ro
  LEFT JOIN vehicles v ON v.id = ro.vehicle_id
  LEFT JOIN customers c ON c.id = ro.customer_id
`;

router.get('/estimates/:id', async (req, res) => {
  try {
    const row = await dbGet(
      `${BASE_ESTIMATE_SELECT} WHERE ro.id = $1`,
      [req.params.id]
    );

    if (!row) {
      return fail(res, 404, 'ESTIMATE_NOT_FOUND', 'Estimate not found.');
    }

    return ok(res, mapEstimate(row));
  } catch (err) {
    return fail(res, 500, 'INTERNAL_ERROR', 'Failed to load estimate.', { message: err.message });
  }
});

router.get('/estimates', async (req, res) => {
  try {
    const filters = [];
    const params = [];

    if (req.query.status) {
      params.push(String(req.query.status).toLowerCase());
      filters.push(`LOWER(CASE
        WHEN ro.estimate_approved_at IS NOT NULL THEN 'approved'
        WHEN ro.status IN ('approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed') THEN 'approved'
        WHEN COALESCE(ro.estimate_status, 'pending') = '' THEN 'pending'
        ELSE COALESCE(ro.estimate_status, 'pending')
      END) = $${params.length}`);
    }

    if (req.query.ro_status) {
      params.push(String(req.query.ro_status).toLowerCase());
      filters.push(`LOWER(ro.status) = $${params.length}`);
    }

    const limitRaw = Number(req.query.limit || 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const rows = await dbAll(
      `${BASE_ESTIMATE_SELECT}
       ${whereSql}
       ORDER BY ro.updated_at DESC
       LIMIT ${limit}`,
      params
    );

    return ok(res, rows.map(mapEstimate), { count: rows.length });
  } catch (err) {
    return fail(res, 500, 'INTERNAL_ERROR', 'Failed to list estimates.', { message: err.message });
  }
});

router.get('/jobs/:id/status', async (req, res) => {
  try {
    const job = await dbGet(
      `SELECT
        id,
        ro_number,
        status,
        intake_date,
        estimated_delivery,
        actual_delivery,
        updated_at
       FROM repair_orders
       WHERE id = $1`,
      [req.params.id]
    );

    if (!job) {
      return fail(res, 404, 'JOB_NOT_FOUND', 'Job not found.');
    }

    return ok(res, {
      id: job.id,
      ro_number: job.ro_number,
      status: job.status,
      intake_date: job.intake_date,
      estimated_delivery: job.estimated_delivery,
      actual_delivery: job.actual_delivery,
      updated_at: job.updated_at,
    });
  } catch (err) {
    return fail(res, 500, 'INTERNAL_ERROR', 'Failed to load job status.', { message: err.message });
  }
});

router.use('/inspections', require('./inspections'));

module.exports = router;
