const { dbGet } = require('../db');

const PLAN_RANK = {
  free: 0,
  pro: 1,
  agency: 2,
};

function requirePlan(minPlan) {
  return async (req, res, next) => {
    try {
      const shopId = req.user?.shop_id;
      if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

      const requiredRank = PLAN_RANK[minPlan];
      if (requiredRank === undefined) {
        return res.status(500).json({ error: 'Invalid plan guard configuration' });
      }

      const shop = await dbGet(
        'SELECT plan, trial_ends_at FROM shops WHERE id = $1',
        [shopId]
      );
      if (!shop) return res.status(404).json({ error: 'Shop not found' });

      const plan = shop.plan || 'free';
      const currentRank = PLAN_RANK[plan] ?? PLAN_RANK.free;
      const trialActive = !!shop.trial_ends_at && new Date(shop.trial_ends_at) > new Date();

      if (currentRank < requiredRank && !trialActive) {
        return res.status(403).json({
          error: 'upgrade_required',
          plan,
          required: minPlan,
        });
      }

      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { requirePlan };
