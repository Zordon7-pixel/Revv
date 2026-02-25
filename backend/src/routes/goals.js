const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbRun } = require('../db');
const auth = require('../middleware/auth');

function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  return next();
}

function isValidYearMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
}

function previousMonth(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function ensureGoalForMonth(shopId, yearMonth) {
  let goal = await dbGet(
    `SELECT id, shop_id, year_month, revenue_goal, ro_goal, created_at
     FROM monthly_goals
     WHERE shop_id = $1 AND year_month = $2`,
    [shopId, yearMonth]
  );

  if (goal) return goal;

  const lastGoal = await dbGet(
    `SELECT revenue_goal, ro_goal
     FROM monthly_goals
     WHERE shop_id = $1
     ORDER BY year_month DESC
     LIMIT 1`,
    [shopId]
  );

  const shop = await dbGet(
    'SELECT monthly_revenue_target FROM shops WHERE id = $1',
    [shopId]
  );

  let defaultRoGoal = 0;
  if (!lastGoal) {
    const prevMonth = previousMonth(yearMonth);
    const roCountRow = await dbGet(
      'SELECT COUNT(*)::int AS n FROM repair_orders WHERE shop_id = $1 AND billing_month = $2',
      [shopId, prevMonth]
    );
    defaultRoGoal = roCountRow?.n || 0;
  }

  const revenueGoal = lastGoal?.revenue_goal ?? Number(shop?.monthly_revenue_target || 0);
  const roGoal = lastGoal?.ro_goal ?? defaultRoGoal;

  const id = uuidv4();
  await dbRun(
    `INSERT INTO monthly_goals (id, shop_id, year_month, revenue_goal, ro_goal)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (shop_id, year_month)
     DO UPDATE SET revenue_goal = EXCLUDED.revenue_goal, ro_goal = EXCLUDED.ro_goal`,
    [id, shopId, yearMonth, revenueGoal, roGoal]
  );

  goal = await dbGet(
    `SELECT id, shop_id, year_month, revenue_goal, ro_goal, created_at
     FROM monthly_goals
     WHERE shop_id = $1 AND year_month = $2`,
    [shopId, yearMonth]
  );

  return goal;
}

router.get('/:yearMonth', auth, async (req, res) => {
  try {
    const { yearMonth } = req.params;
    if (!isValidYearMonth(yearMonth)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const goal = await ensureGoalForMonth(req.user.shop_id, yearMonth);
    return res.json({ goal });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/:yearMonth', auth, requireOwner, async (req, res) => {
  try {
    const { yearMonth } = req.params;
    const { revenue_goal, ro_goal } = req.body || {};

    if (!isValidYearMonth(yearMonth)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const revenue = Number(revenue_goal);
    const ro = Number(ro_goal);

    if (!Number.isFinite(revenue) || revenue < 0) {
      return res.status(400).json({ error: 'Revenue goal must be a non-negative number' });
    }

    if (!Number.isInteger(ro) || ro < 0) {
      return res.status(400).json({ error: 'RO goal must be a non-negative integer' });
    }

    const existing = await dbGet(
      'SELECT id FROM monthly_goals WHERE shop_id = $1 AND year_month = $2',
      [req.user.shop_id, yearMonth]
    );

    if (existing) {
      await dbRun(
        'UPDATE monthly_goals SET revenue_goal = $1, ro_goal = $2 WHERE id = $3',
        [revenue, ro, existing.id]
      );
    } else {
      await dbRun(
        `INSERT INTO monthly_goals (id, shop_id, year_month, revenue_goal, ro_goal)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), req.user.shop_id, yearMonth, revenue, ro]
      );
    }

    const goal = await dbGet(
      `SELECT id, shop_id, year_month, revenue_goal, ro_goal, created_at
       FROM monthly_goals
       WHERE shop_id = $1 AND year_month = $2`,
      [req.user.shop_id, yearMonth]
    );

    return res.json({ goal });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
