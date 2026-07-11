const router = require('express').Router();
const { dbAll } = require('../db');
const auth = require('../middleware/auth');

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const RESULT_LIMIT = 20;

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

router.get('/', auth, async (req, res) => {
  try {
    const query = String(req.query?.q || '').trim();
    if (query.length < MIN_QUERY_LENGTH) return res.json({ results: [] });
    if (query.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: `Search must be ${MAX_QUERY_LENGTH} characters or fewer` });
    }

    const escaped = escapeLike(query);
    const technicianOnly = String(req.user.role || '').trim().toLowerCase() === 'technician';
    const params = [req.user.shop_id, query, `${escaped}%`, `%${escaped}%`];
    if (technicianOnly) params.push(req.user.id);
    const assignmentScope = technicianOnly
      ? 'AND ro.assigned_to::text = $5::text'
      : '';
    const results = await dbAll(
      `SELECT
         ro.id,
         ro.ro_number,
         ro.status,
         COALESCE(c.name, '') AS customer_name,
         v.year,
         v.make,
         v.model,
         COALESCE(v.plate, '') AS plate,
         COALESCE(v.vin, '') AS vin,
         COALESCE(NULLIF(ro.insurance_claim_number, ''), ro.claim_number, '') AS claim_number
       FROM repair_orders ro
       LEFT JOIN customers c
         ON c.id::text = ro.customer_id::text
        AND c.shop_id::text = ro.shop_id::text
       LEFT JOIN vehicles v
         ON v.id::text = ro.vehicle_id::text
        AND v.shop_id::text = ro.shop_id::text
       WHERE ro.shop_id::text = $1::text
         ${assignmentScope}
         AND (
           ro.ro_number ILIKE $4 ESCAPE '\\'
           OR COALESCE(c.name, '') ILIKE $4 ESCAPE '\\'
           OR COALESCE(v.plate, '') ILIKE $4 ESCAPE '\\'
           OR COALESCE(v.vin, '') ILIKE $4 ESCAPE '\\'
           OR COALESCE(ro.claim_number, '') ILIKE $4 ESCAPE '\\'
           OR COALESCE(ro.insurance_claim_number, '') ILIKE $4 ESCAPE '\\'
         )
       ORDER BY CASE
         WHEN LOWER(ro.ro_number) = LOWER($2) THEN 0
         WHEN LOWER(COALESCE(v.plate, '')) = LOWER($2) THEN 1
         WHEN LOWER(COALESCE(v.vin, '')) = LOWER($2) THEN 2
         WHEN ro.ro_number ILIKE $3 ESCAPE '\\' THEN 3
         WHEN COALESCE(c.name, '') ILIKE $3 ESCAPE '\\' THEN 4
         WHEN COALESCE(v.plate, '') ILIKE $3 ESCAPE '\\' THEN 5
         WHEN COALESCE(v.vin, '') ILIKE $3 ESCAPE '\\' THEN 6
         ELSE 7
       END,
       ro.updated_at DESC
       LIMIT ${RESULT_LIMIT}`,
      params
    );

    return res.json({ results: results || [] });
  } catch (err) {
    console.error('[Search] query failed:', err);
    return res.status(500).json({ error: 'Search is temporarily unavailable' });
  }
});

module.exports = router;
