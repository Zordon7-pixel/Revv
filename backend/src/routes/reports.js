const router = require('express').Router();
const { dbGet, dbAll } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

router.get('/summary', auth, requireAdmin, async (req, res) => {
  try {
    const sid = req.user.shop_id;
    const totalRow    = await dbGet('SELECT COUNT(*)::int as n FROM repair_orders WHERE shop_id = $1', [sid]);
    const activeRow   = await dbGet("SELECT COUNT(*)::int as n FROM repair_orders WHERE shop_id = $1 AND status NOT IN ('closed','delivery')", [sid]);
    const completedRow = await dbGet("SELECT COUNT(*)::int as n FROM repair_orders WHERE shop_id = $1 AND status IN ('delivery','closed')", [sid]);
    const revenueRow  = await dbGet('SELECT COALESCE(SUM(total),0) as r FROM repair_orders WHERE shop_id = $1', [sid]);
    const profitRow   = await dbGet('SELECT COALESCE(SUM(true_profit),0) as p FROM repair_orders WHERE shop_id = $1', [sid]);
    const byStatus = await dbAll("SELECT status, COUNT(*)::int as count FROM repair_orders WHERE shop_id = $1 GROUP BY status", [sid]);
    const byType   = await dbAll("SELECT job_type, COUNT(*)::int as count, SUM(total) as revenue FROM repair_orders WHERE shop_id = $1 GROUP BY job_type", [sid]);
    const recent   = await dbAll(`
      SELECT ro.*, v.year, v.make, v.model, c.name as customer_name
      FROM repair_orders ro
      LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      LEFT JOIN customers c ON c.id = ro.customer_id
      WHERE ro.shop_id = $1 ORDER BY ro.updated_at DESC LIMIT 10
    `, [sid]);
    res.json({
      total: totalRow.n,
      active: activeRow.n,
      completed: completedRow.n,
      revenue: parseFloat(revenueRow.r),
      profit: parseFloat(profitRow.p),
      byStatus,
      byType,
      recent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:tab', auth, requireAdmin, async (req, res) => {
  try {
    const sid = req.user.shop_id;
    const { tab } = req.params;

    if (tab === 'revenue') {
      const monthly = await dbAll(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
          TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') as label,
          COUNT(*)::int as count,
          COALESCE(SUM(total), 0)::numeric(12,2) as revenue,
          COALESCE(AVG(NULLIF(total,0)), 0)::numeric(12,2) as avg_ro
        FROM repair_orders
        WHERE shop_id = $1 AND created_at >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at) ASC
      `, [sid]);

      const totalRow = await dbGet('SELECT COALESCE(SUM(total),0)::numeric(12,2) as total FROM repair_orders WHERE shop_id = $1', [sid]);
      const avgRow   = await dbGet('SELECT COALESCE(AVG(NULLIF(total,0)),0)::numeric(12,2) as avg FROM repair_orders WHERE shop_id = $1', [sid]);
      const bestRow  = await dbAll(`
        SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') as month,
               COALESCE(SUM(total),0)::numeric(12,2) as revenue
        FROM repair_orders WHERE shop_id = $1
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY revenue DESC LIMIT 3
      `, [sid]);

      return res.json({
        monthly,
        total: parseFloat(totalRow.total),
        avg: parseFloat(avgRow.avg),
        topMonths: bestRow
      });
    }

    if (tab === 'ros') {
      const byStatus = await dbAll(`
        SELECT status, COUNT(*)::int as count
        FROM repair_orders WHERE shop_id = $1
        GROUP BY status ORDER BY count DESC
      `, [sid]);

      const avgRow = await dbGet(`
        SELECT COALESCE(
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400), 0
        )::numeric(10,1) as avg_days
        FROM repair_orders
        WHERE shop_id = $1 AND status = 'closed'
      `, [sid]);

      const thisMonth = await dbGet(`
        SELECT COUNT(*)::int as count FROM repair_orders
        WHERE shop_id = $1 AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
      `, [sid]);

      const lastMonth = await dbGet(`
        SELECT COUNT(*)::int as count FROM repair_orders
        WHERE shop_id = $1 AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
      `, [sid]);

      return res.json({
        byStatus,
        avgDays: parseFloat(avgRow.avg_days) || 0,
        thisMonth: thisMonth.count,
        lastMonth: lastMonth.count
      });
    }

    if (tab === 'performance') {
      const summary = await dbGet('SELECT COUNT(*)::int as n FROM repair_orders WHERE shop_id = $1', [sid]);
      return res.json({ redirect: '/performance', count: summary.n });
    }

    return res.status(400).json({ error: 'Unknown tab' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
