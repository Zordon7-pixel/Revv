const router = require('express').Router();
const { dbGet, dbAll } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const { month } = req.query; // YYYY-MM format
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month param required in YYYY-MM format' });
    }

    const [year, monthNum] = month.split('-');
    const startDate = `${year}-${monthNum}-01`;
    const nextMonth = parseInt(monthNum) === 12 ? '01' : String(parseInt(monthNum) + 1).padStart(2, '0');
    const nextYear = parseInt(monthNum) === 12 ? String(parseInt(year) + 1) : year;
    const endDate = `${nextYear}-${nextMonth}-01`;

    // Get all ROs completed in this month with labor_cost, parts_cost, and assigned tech
    const ros = await dbAll(`
      SELECT ro.id, ro.assigned_to, ro.labor_cost, ro.parts_cost, ro.status, ro.created_at
      FROM repair_orders ro
      WHERE ro.shop_id = $1
        AND ro.actual_delivery >= $2
        AND ro.actual_delivery < $3
        AND ro.status = 'closed'
      ORDER BY ro.actual_delivery DESC
    `, [req.user.shop_id, startDate, endDate]);

    // Get all time entries for this month
    const timeEntries = await dbAll(`
      SELECT te.user_id, te.total_hours, te.clock_in
      FROM time_entries te
      WHERE te.shop_id = $1
        AND te.clock_in >= $2
        AND te.clock_in < $3
      ORDER BY te.clock_in DESC
    `, [req.user.shop_id, startDate, endDate]);

    // Get user names
    const users = await dbAll(`
      SELECT id, name
      FROM users
      WHERE shop_id = $1 AND role IN ('owner', 'admin', 'employee', 'staff')
      ORDER BY name ASC
    `, [req.user.shop_id]);

    // Build tech stats
    const userMap = {};
    users.forEach(u => { userMap[u.id] = u.name; });

    const techStats = {};

    // Group ROs by assigned tech
    ros.forEach(ro => {
      if (!ro.assigned_to) return;
      if (!techStats[ro.assigned_to]) {
        techStats[ro.assigned_to] = {
          name: userMap[ro.assigned_to] || 'Unknown',
          ros_completed: 0,
          total_labor_revenue: 0,
          total_parts_cost: 0,
        };
      }
      techStats[ro.assigned_to].ros_completed += 1;
      techStats[ro.assigned_to].total_labor_revenue += parseFloat(ro.labor_cost) || 0;
      techStats[ro.assigned_to].total_parts_cost += parseFloat(ro.parts_cost) || 0;
    });

    // Calculate avg hours per RO from time entries
    timeEntries.forEach(te => {
      if (!techStats[te.user_id]) {
        techStats[te.user_id] = {
          name: userMap[te.user_id] || 'Unknown',
          ros_completed: 0,
          total_labor_revenue: 0,
          total_parts_cost: 0,
        };
      }
    });

    const result = Object.entries(techStats).map(([userId, stats]) => {
      const userTimeEntries = timeEntries.filter(te => te.user_id === userId);
      const totalHours = userTimeEntries.reduce((sum, te) => sum + (parseFloat(te.total_hours) || 0), 0);
      const avgHours = stats.ros_completed > 0 ? (totalHours / stats.ros_completed).toFixed(2) : '0.00';

      return {
        user_id: userId,
        name: stats.name,
        ros_completed: stats.ros_completed,
        avg_hours_per_ro: parseFloat(avgHours),
        total_labor_revenue: stats.total_labor_revenue.toFixed(2),
        total_parts_cost: stats.total_parts_cost.toFixed(2),
      };
    });

    // Filter to only show techs with completed ROs
    const filtered = result.filter(t => t.ros_completed > 0).sort((a, b) => b.ros_completed - a.ros_completed);

    res.json({ month, stats: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
