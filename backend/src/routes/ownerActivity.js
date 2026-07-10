const router = require('express').Router();
const { dbAll } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const {
  getOwnerActivityPreferences,
  sendOwnerActivityDigest,
  upsertOwnerActivityPreferences,
} = require('../services/ownerActivity');

function requireOwnerActivityAccess(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  if (!['owner', 'admin', 'superadmin'].includes(role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

router.get('/', auth, requireAdmin, requireOwnerActivityAccess, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 250));
    const events = await dbAll(
      `SELECT id, ro_id, actor_user_id, actor_name, actor_role, event_type, severity, summary, created_at
       FROM owner_activity_events
       WHERE shop_id::text = $1::text
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.shop_id, limit]
    );
    return res.json({ events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/preferences', auth, requireAdmin, requireOwnerActivityAccess, async (req, res) => {
  try {
    return res.json(await getOwnerActivityPreferences(req.user.shop_id));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/preferences', auth, requireAdmin, requireOwnerActivityAccess, async (req, res) => {
  try {
    return res.json(await upsertOwnerActivityPreferences(req.user.shop_id, req.body || {}));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/digest/test', auth, requireAdmin, requireOwnerActivityAccess, async (req, res) => {
  try {
    const until = new Date();
    const since = new Date(until.getTime() - 24 * 60 * 60 * 1000);
    const recipient = req.user.email ? [req.user.email] : null;
    const result = await sendOwnerActivityDigest({
      shopId: req.user.shop_id,
      since: since.toISOString(),
      until: until.toISOString(),
      recipientOverride: recipient,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
