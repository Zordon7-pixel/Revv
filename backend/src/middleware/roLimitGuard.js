const { dbGet } = require('../db');

const FREE_RO_LIMIT = 25;

module.exports = async function roLimitGuard(req, res, next) {
  try {
    const shopId = req.user?.shop_id;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const shop = await dbGet(
      'SELECT plan, trial_ends_at FROM shops WHERE id = $1',
      [shopId]
    );
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const plan = shop.plan || 'free';
    const trialActive = !!shop.trial_ends_at && new Date(shop.trial_ends_at) > new Date();

    if (plan === 'free' && !trialActive) {
      const row = await dbGet(
        `SELECT COUNT(*)::int AS count
         FROM repair_orders
         WHERE shop_id = $1
           AND created_at >= DATE_TRUNC('month', NOW())
           AND created_at < (DATE_TRUNC('month', NOW()) + INTERVAL '1 month')`,
        [shopId]
      );

      const count = Number(row?.count || 0);
      if (count >= FREE_RO_LIMIT) {
        return res.status(403).json({
          error: 'ro_limit_reached',
          count,
          limit: FREE_RO_LIMIT,
        });
      }
    }

    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
