const router = require('express').Router();
const { dbGet, dbAll } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');

function requireOwnerAdminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const role = String(req.user.role || '').toLowerCase();
  if (!['owner', 'admin', 'superadmin'].includes(role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

router.get('/supplements/monthly-opportunity', auth, requireOwnerAdminOnly, async (req, res) => {
  try {
    const shopId = req.user.shop_id;

    // Phase 1 does not persist analyze snapshots. Until a shop-scoped analyze-results
    // table exists, compute the month-to-date opportunity from stored RO estimate lines.
    const row = await dbGet(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN LOWER(COALESCE(eli.type, '')) = 'labor'
              AND COALESCE(s.labor_rate, 0) > COALESCE(eli.unit_price, 0)
             THEN (COALESCE(s.labor_rate, 0) - COALESCE(eli.unit_price, 0)) * COALESCE(eli.quantity, 0)
             ELSE 0
           END
         ), 0)::numeric(12,2) AS total_supplement_opportunity,
         COUNT(DISTINCT ro.id)::int AS ro_count
       FROM repair_orders ro
       JOIN estimate_line_items eli ON eli.ro_id = ro.id AND eli.shop_id = ro.shop_id
       JOIN shops s ON s.id = ro.shop_id
       WHERE ro.shop_id = $1
         AND ro.created_at >= DATE_TRUNC('month', NOW())
         AND ro.created_at < DATE_TRUNC('month', NOW()) + INTERVAL '1 month'`,
      [shopId]
    );

    return res.json({
      success: true,
      month_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
      total_supplement_opportunity: Number(row?.total_supplement_opportunity || 0),
      ro_count: Number(row?.ro_count || 0),
      source: 'estimate_line_items',
    });
  } catch (err) {
    console.error('[Dashboard] supplement monthly opportunity error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/owner-kpis', auth, requireOwnerAdminOnly, async (req, res) => {
  try {
    const shopId = req.user.shop_id;

    const [cycleTimeByStage, supplementCapture, techEfficiency] = await Promise.all([
      dbAll(
        `WITH ordered_logs AS (
           SELECT
             ro.id AS ro_id,
             COALESCE(NULLIF(LOWER(TRIM(l.to_status)), ''), 'intake') AS stage,
             NULLIF(l.created_at::text, '')::timestamptz AS stage_started_at,
             LEAD(NULLIF(l.created_at::text, '')::timestamptz) OVER (PARTITION BY l.ro_id ORDER BY NULLIF(l.created_at::text, '')::timestamptz ASC) AS next_stage_at,
             ro.status AS current_status,
             NULLIF(ro.updated_at::text, '')::timestamptz AS updated_at
           FROM job_status_log l
           JOIN repair_orders ro ON ro.id = l.ro_id
           WHERE ro.shop_id = $1
             AND NULLIF(l.created_at::text, '')::timestamptz >= NOW() - INTERVAL '120 days'
         ),
         stage_durations AS (
           SELECT
             stage,
             EXTRACT(EPOCH FROM (
               COALESCE(
                 next_stage_at,
                 CASE
                   WHEN COALESCE(NULLIF(LOWER(TRIM(current_status)), ''), 'intake') = stage THEN NOW()
                   ELSE updated_at
                 END
               ) - stage_started_at
             )) / 3600.0 AS hours_in_stage
           FROM ordered_logs
           WHERE stage NOT IN ('total_loss', 'siu_hold')
         )
         SELECT
           stage,
           COUNT(*)::int AS sample_count,
           ROUND(AVG(hours_in_stage)::numeric, 1)::float AS avg_hours,
           ROUND((AVG(hours_in_stage) / 24.0)::numeric, 2)::float AS avg_days
         FROM stage_durations
         WHERE hours_in_stage >= 0
           AND hours_in_stage <= 24 * 120
         GROUP BY stage
         ORDER BY CASE stage
           WHEN 'intake' THEN 1
           WHEN 'estimate' THEN 2
           WHEN 'approval' THEN 3
           WHEN 'parts' THEN 4
           WHEN 'repair' THEN 5
           WHEN 'paint' THEN 6
           WHEN 'qc' THEN 7
           WHEN 'delivery' THEN 8
           WHEN 'closed' THEN 9
           ELSE 99
         END`,
        [shopId]
      ),
      dbGet(
        `SELECT
           COUNT(*) FILTER (WHERE LOWER(COALESCE(supplement_status, 'none')) IN ('requested', 'pending', 'approved'))::int AS supplement_ro_count,
           COALESCE(SUM(CASE
             WHEN LOWER(COALESCE(supplement_status, 'none')) IN ('requested', 'pending', 'approved')
             THEN supplement_amount
             ELSE 0
           END), 0)::bigint AS requested_cents,
           COALESCE(SUM(CASE
             WHEN LOWER(COALESCE(supplement_status, 'none')) = 'approved'
             THEN supplement_amount
             ELSE 0
           END), 0)::bigint AS captured_cents
         FROM repair_orders
         WHERE shop_id = $1
           AND created_at >= DATE_TRUNC('month', NOW())
           AND created_at < DATE_TRUNC('month', NOW()) + INTERVAL '1 month'`,
        [shopId]
      ),
      dbAll(
        `SELECT
           u.id AS tech_id,
           u.name AS tech_name,
           COUNT(*) FILTER (WHERE l.from_status IS NOT NULL)::int AS status_advances,
           COUNT(DISTINCT l.ro_id) FILTER (WHERE l.from_status IS NOT NULL)::int AS ros_advanced,
           COUNT(DISTINCT l.ro_id) FILTER (WHERE LOWER(TRIM(l.to_status)) IN ('closed', 'completed'))::int AS ros_closed
         FROM job_status_log l
         JOIN repair_orders ro ON ro.id = l.ro_id
         JOIN users u ON u.id::text = CASE
           WHEN l.changed_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN l.changed_by
           ELSE NULL
         END
         WHERE ro.shop_id = $1
           AND u.shop_id = $1
           AND l.created_at >= DATE_TRUNC('month', NOW())
           AND l.created_at < DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
           AND u.role IN ('owner', 'admin', 'technician', 'employee', 'staff')
         GROUP BY u.id, u.name
         HAVING COUNT(*) FILTER (WHERE l.from_status IS NOT NULL) > 0
             OR COUNT(DISTINCT l.ro_id) FILTER (WHERE LOWER(TRIM(l.to_status)) IN ('closed', 'completed')) > 0
         ORDER BY ros_closed DESC, ros_advanced DESC, u.name ASC
         LIMIT 10`,
        [shopId]
      ),
    ]);

    const capturedCents = Number(supplementCapture?.captured_cents || 0);
    const requestedCents = Number(supplementCapture?.requested_cents || 0);

    return res.json({
      cycle_time_by_stage: cycleTimeByStage || [],
      supplement_capture: {
        supplement_ro_count: Number(supplementCapture?.supplement_ro_count || 0),
        requested_cents: requestedCents,
        captured_cents: capturedCents,
        capture_rate: requestedCents > 0 ? Number(((capturedCents / requestedCents) * 100).toFixed(1)) : 0,
      },
      tech_efficiency: techEfficiency || [],
    });
  } catch (err) {
    console.error('[Dashboard] owner KPIs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/weekly', auth, requireTechnician, async (req, res) => {
  try {
    const shopId = req.user.shop_id;

    const counts = await dbGet(
      `WITH bounds AS (
         SELECT
           DATE_TRUNC('week', NOW()) AS week_start,
           DATE_TRUNC('week', NOW()) + INTERVAL '7 days' AS week_end,
           DATE_TRUNC('week', NOW()) - INTERVAL '7 days' AS last_week_start
       )
       SELECT
         (SELECT COUNT(*)::int
          FROM repair_orders ro, bounds b
          WHERE ro.shop_id = $1
            AND ro.created_at >= b.week_start
            AND ro.created_at < b.week_end) AS this_week,
         (SELECT COUNT(*)::int
          FROM repair_orders ro, bounds b
          WHERE ro.shop_id = $1
            AND ro.created_at >= b.last_week_start
            AND ro.created_at < b.week_start) AS last_week,
         (SELECT b.week_start FROM bounds b) AS week_start,
         (SELECT b.week_end FROM bounds b) AS week_end`,
      [shopId]
    );

    const thisWeek = Number(counts?.this_week || 0);
    const lastWeek = Number(counts?.last_week || 0);
    const trendPercent = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : (thisWeek > 0 ? 100 : 0);
    const trendDirection = thisWeek === lastWeek ? 'flat' : thisWeek > lastWeek ? 'up' : 'down';

    const revenueRow = await dbGet(
      `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
       FROM ro_payments
       WHERE shop_id = $1
         AND status = 'succeeded'
         AND paid_at::timestamptz >= DATE_TRUNC('week', NOW())
         AND paid_at::timestamptz < DATE_TRUNC('week', NOW()) + INTERVAL '7 days'`,
      [shopId]
    );

    const topTechs = await dbAll(
      `SELECT
         u.id AS tech_id,
         u.name AS tech_name,
         COUNT(ro.id)::int AS jobs_completed
       FROM repair_orders ro
       JOIN users u ON u.id::text = ro.assigned_to::text
       WHERE ro.shop_id = $1
         AND ro.status IN ('delivery', 'closed')
         AND COALESCE(NULLIF(ro.actual_delivery::text, '')::timestamptz, ro.updated_at) >= DATE_TRUNC('week', NOW())
         AND COALESCE(NULLIF(ro.actual_delivery::text, '')::timestamptz, ro.updated_at) < DATE_TRUNC('week', NOW()) + INTERVAL '7 days'
       GROUP BY u.id, u.name
       ORDER BY jobs_completed DESC, u.name ASC
       LIMIT 3`,
      [shopId]
    );

    const pendingPartsRow = await dbGet(
      `SELECT COUNT(DISTINCT ro.id)::int AS pending_parts_count
       FROM repair_orders ro
       JOIN parts_orders p ON p.ro_id = ro.id
       WHERE ro.shop_id = $1
         AND ro.status NOT IN ('closed')
         AND LOWER(COALESCE(p.status, '')) IN ('ordered', 'awaiting', 'pending', 'backordered')`,
      [shopId]
    );

    const statusCounts = await dbAll(
      `SELECT COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'intake') AS status, COUNT(*)::int AS count
       FROM repair_orders
       WHERE shop_id = $1
       GROUP BY 1`,
      [shopId]
    );

    return res.json({
      week: {
        start: counts?.week_start,
        end: counts?.week_end,
      },
      ro_opened: {
        this_week: thisWeek,
        last_week: lastWeek,
        trend_direction: trendDirection,
        trend_percent: Number(trendPercent.toFixed(1)),
      },
      revenue_collected_this_week: Number(revenueRow?.amount_cents || 0) / 100,
      top_techs: topTechs || [],
      pending_parts_count: Number(pendingPartsRow?.pending_parts_count || 0),
      status_counts: statusCounts || [],
      chart: {
        labels: ['This Week', 'Last 7 Days'],
        data: [thisWeek, lastWeek],
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
