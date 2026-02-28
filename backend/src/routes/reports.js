const router = require('express').Router();
const { dbGet, dbAll } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  return next();
}

function toCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

router.get('/summary', auth, requireAdmin, async (req, res) => {
  try {
    const sid = req.user.shop_id;
    const totalRow    = await dbGet("SELECT COUNT(*)::int as n FROM repair_orders WHERE shop_id = $1 AND billing_month = TO_CHAR(NOW(), 'YYYY-MM')", [sid]);
    const activeRow   = await dbGet("SELECT COUNT(*)::int as n FROM repair_orders WHERE shop_id = $1 AND billing_month = TO_CHAR(NOW(), 'YYYY-MM') AND status NOT IN ('closed','delivery')", [sid]);
    const completedRow = await dbGet("SELECT COUNT(*)::int as n FROM repair_orders WHERE shop_id = $1 AND billing_month = TO_CHAR(NOW(), 'YYYY-MM') AND status IN ('delivery','closed')", [sid]);
    const revenueRow  = await dbGet("SELECT COALESCE(SUM(total),0) as r FROM repair_orders WHERE shop_id = $1 AND billing_month = TO_CHAR(NOW(), 'YYYY-MM')", [sid]);
    const profitRow   = await dbGet("SELECT COALESCE(SUM(true_profit),0) as p FROM repair_orders WHERE shop_id = $1 AND billing_month = TO_CHAR(NOW(), 'YYYY-MM')", [sid]);
    const byStatus = await dbAll("SELECT status, COUNT(*)::int as count FROM repair_orders WHERE shop_id = $1 AND billing_month = TO_CHAR(NOW(), 'YYYY-MM') GROUP BY status", [sid]);
    const byType   = await dbAll("SELECT job_type, COUNT(*)::int as count, SUM(total) as revenue FROM repair_orders WHERE shop_id = $1 AND billing_month = TO_CHAR(NOW(), 'YYYY-MM') GROUP BY job_type", [sid]);
    const recent   = await dbAll(`
      SELECT ro.*, v.year, v.make, v.model, c.name as customer_name
      FROM repair_orders ro
      LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      LEFT JOIN customers c ON c.id = ro.customer_id
      WHERE ro.shop_id = $1 AND ro.billing_month = TO_CHAR(NOW(), 'YYYY-MM')
      ORDER BY ro.updated_at DESC LIMIT 10
    `, [sid]);

    const insuranceJobsRow = await dbGet(
      `SELECT COUNT(*)::int as n
       FROM repair_orders
       WHERE shop_id = $1
         AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
         AND (
           insurance_claim_number IS NOT NULL OR claim_number IS NOT NULL
         )`,
      [sid]
    );
    const insuranceApprovedVsBilled = await dbGet(
      `SELECT
         COALESCE(SUM(insurance_approved_amount), 0)::bigint AS approved_cents,
         COALESCE(SUM(total * 100), 0)::bigint AS billed_cents
       FROM repair_orders
       WHERE shop_id = $1
         AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
         AND (
           insurance_claim_number IS NOT NULL OR claim_number IS NOT NULL
         )`,
      [sid]
    );
    const openSupplements = await dbGet(
      `SELECT
         COUNT(*)::int AS open_count,
         COALESCE(SUM(supplement_amount), 0)::bigint AS open_amount_cents
       FROM repair_orders
       WHERE shop_id = $1
         AND supplement_status IN ('requested', 'pending')`,
      [sid]
    );
    const drpSplit = await dbGet(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(is_drp, FALSE) = TRUE)::int AS drp_count,
         COUNT(*) FILTER (WHERE COALESCE(is_drp, FALSE) = FALSE)::int AS non_drp_count
       FROM repair_orders
       WHERE shop_id = $1
         AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
         AND (
           insurance_claim_number IS NOT NULL OR claim_number IS NOT NULL
         )`,
      [sid]
    );

    res.json({
      total: totalRow.n,
      active: activeRow.n,
      completed: completedRow.n,
      revenue: parseFloat(revenueRow.r),
      profit: parseFloat(profitRow.p),
      byStatus,
      byType,
      recent,
      insuranceSummary: {
        insuranceJobsThisMonth: insuranceJobsRow?.n || 0,
        approvedAmountCents: Number(insuranceApprovedVsBilled?.approved_cents || 0),
        billedAmountCents: Number(insuranceApprovedVsBilled?.billed_cents || 0),
        openSupplementsCount: openSupplements?.open_count || 0,
        openSupplementsAmountCents: Number(openSupplements?.open_amount_cents || 0),
        drpCount: drpSplit?.drp_count || 0,
        nonDrpCount: drpSplit?.non_drp_count || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monthly/:yearMonth', auth, requireOwner, async (req, res) => {
  try {
    const { yearMonth } = req.params;
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const sid = req.user.shop_id;
    const ros = await dbAll(
      `
        SELECT
          ro.id,
          ro.ro_number,
          c.name AS customer_name,
          CONCAT_WS(' ', v.year::text, v.make, v.model) AS vehicle,
          ro.status,
          ro.total AS total_cost,
          ro.billing_month,
          ro.revenue_period,
          ro.carried_over,
          COALESCE(u.name, '') AS technician,
          ro.created_at,
          ro.actual_delivery AS completed_at
        FROM repair_orders ro
        LEFT JOIN customers c ON c.id = ro.customer_id
        LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        LEFT JOIN users u ON u.id = ro.assigned_to
        WHERE ro.shop_id = $1
          AND ro.billing_month = $2
        ORDER BY ro.created_at DESC
      `,
      [sid, yearMonth]
    );

    const totalRevenue = ros.reduce((sum, ro) => sum + Number(ro.total_cost || 0), 0);
    const completedRos = ros.filter(ro => ['completed', 'delivery', 'closed'].includes(ro.status)).length;
    const inProgressRos = ros.filter(ro => !['completed', 'delivery', 'closed', 'cancelled'].includes(ro.status)).length;
    const statusCounts = ros.reduce((acc, ro) => {
      acc[ro.status] = (acc[ro.status] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      summary: {
        year_month: yearMonth,
        total_revenue: Number(totalRevenue.toFixed(2)),
        total_ros: ros.length,
        completed_ros: completedRos,
        in_progress_ros: inProgressRos,
        avg_ro_value: ros.length ? Number((totalRevenue / ros.length).toFixed(2)) : 0,
        by_status: statusCounts,
      },
      ros,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/monthly/:yearMonth/csv', auth, requireOwner, async (req, res) => {
  try {
    const { yearMonth } = req.params;
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const sid = req.user.shop_id;
    const ros = await dbAll(
      `
        SELECT
          ro.ro_number,
          c.name AS customer_name,
          CONCAT_WS(' ', v.year::text, v.make, v.model) AS vehicle,
          ro.status,
          ro.total AS total_cost,
          ro.billing_month,
          COALESCE(u.name, '') AS technician,
          ro.created_at,
          ro.actual_delivery AS completed_at,
          ro.carried_over
        FROM repair_orders ro
        LEFT JOIN customers c ON c.id = ro.customer_id
        LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        LEFT JOIN users u ON u.id = ro.assigned_to
        WHERE ro.shop_id = $1
          AND ro.billing_month = $2
        ORDER BY ro.created_at DESC
      `,
      [sid, yearMonth]
    );

    const header = [
      'RO#',
      'Customer',
      'Vehicle',
      'Status',
      'Total Cost',
      'Revenue Month',
      'Technician',
      'Created',
      'Completed',
      'Carried Over',
    ].join(',');

    const rows = ros.map(ro => [
      toCsvValue(ro.ro_number),
      toCsvValue(ro.customer_name),
      toCsvValue(ro.vehicle),
      toCsvValue(ro.status),
      toCsvValue(Number(ro.total_cost || 0).toFixed(2)),
      toCsvValue(ro.billing_month),
      toCsvValue(ro.technician),
      toCsvValue(ro.created_at ? new Date(ro.created_at).toISOString() : ''),
      toCsvValue(ro.completed_at || ''),
      toCsvValue(ro.carried_over ? 'Yes' : 'No'),
    ].join(','));

    const csv = `${header}\n${rows.join('\n')}\n`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="revv-report-${yearMonth}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

    if (tab === 'insurance') {
      const thisMonthJobs = await dbGet(
        `SELECT COUNT(*)::int as count
         FROM repair_orders
         WHERE shop_id = $1
           AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
           AND (
             insurance_claim_number IS NOT NULL OR claim_number IS NOT NULL
           )`,
        [sid]
      );
      const approvedVsBilled = await dbGet(
        `SELECT
           COALESCE(SUM(insurance_approved_amount), 0)::bigint AS approved_cents,
           COALESCE(SUM(total * 100), 0)::bigint AS billed_cents
         FROM repair_orders
         WHERE shop_id = $1
           AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
           AND (
             insurance_claim_number IS NOT NULL OR claim_number IS NOT NULL
           )`,
        [sid]
      );
      const openSupplements = await dbGet(
        `SELECT
           COUNT(*)::int AS open_count,
           COALESCE(SUM(supplement_amount), 0)::bigint AS open_amount_cents
         FROM repair_orders
         WHERE shop_id = $1
           AND supplement_status IN ('requested', 'pending')`,
        [sid]
      );
      const drpSplit = await dbGet(
        `SELECT
           COUNT(*) FILTER (WHERE COALESCE(is_drp, FALSE) = TRUE)::int AS drp_count,
           COUNT(*) FILTER (WHERE COALESCE(is_drp, FALSE) = FALSE)::int AS non_drp_count
         FROM repair_orders
         WHERE shop_id = $1
           AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
           AND (
             insurance_claim_number IS NOT NULL OR claim_number IS NOT NULL
           )`,
        [sid]
      );

      return res.json({
        totalInsuranceJobs: thisMonthJobs?.count || 0,
        approvedAmountCents: Number(approvedVsBilled?.approved_cents || 0),
        billedAmountCents: Number(approvedVsBilled?.billed_cents || 0),
        openSupplementsCount: openSupplements?.open_count || 0,
        openSupplementsAmountCents: Number(openSupplements?.open_amount_cents || 0),
        drpCount: drpSplit?.drp_count || 0,
        nonDrpCount: drpSplit?.non_drp_count || 0,
      });
    }

    return res.status(400).json({ error: 'Unknown tab' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
