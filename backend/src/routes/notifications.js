const router = require('express').Router();
const { dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireEmployee } = require('../middleware/roles');

// GET /api/notifications — unread for current user (latest 10)
router.get('/', auth, requireEmployee, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT n.*, ro.ro_number FROM notifications n
       LEFT JOIN repair_orders ro ON ro.id = n.ro_id
       WHERE n.shop_id = $1
         AND n.read = FALSE
         AND (n.user_id IS NULL OR n.user_id = $2)
       ORDER BY n.created_at DESC
       LIMIT 10`,
      [req.user.shop_id, req.user.id]
    );
    res.json({ notifications: rows, unread: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', auth, requireEmployee, async (req, res) => {
  try {
    await dbRun(
      `UPDATE notifications SET read = TRUE WHERE shop_id = $1 AND (user_id IS NULL OR user_id = $2) AND read = FALSE`,
      [req.user.shop_id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', auth, requireEmployee, async (req, res) => {
  try {
    await dbRun(
      `UPDATE notifications
       SET read = TRUE
       WHERE id = $1
         AND shop_id = $2
         AND (user_id IS NULL OR user_id = $3)`,
      [req.params.id, req.user.shop_id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
