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
       JOIN users u ON u.id = ro.assigned_to
       WHERE ro.shop_id = $1
         AND ro.status IN ('delivery', 'closed')
         AND COALESCE(ro.actual_delivery, ro.updated_at) >= DATE_TRUNC('week', NOW())
         AND COALESCE(ro.actual_delivery, ro.updated_at) < DATE_TRUNC('week', NOW()) + INTERVAL '7 days'
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
