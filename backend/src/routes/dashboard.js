const router = require('express').Router();
const { dbGet, dbAll } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');

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
