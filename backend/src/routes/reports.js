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

module.exports = router;
