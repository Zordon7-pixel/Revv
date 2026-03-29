const router = require('express').Router();
const { dbAll, dbGet, dbRun } = require('../db');
const superadmin = require('../middleware/superadmin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

router.use(superadmin);

function issueImpersonationToken(targetUser, requestedBySuperadminId) {
  const payload = {
    id: targetUser.id,
    shop_id: targetUser.shop_id,
    role: targetUser.role,
    jti: uuidv4(),
    support_impersonation: true,
    impersonated_by: requestedBySuperadminId,
  };
  if (targetUser.customer_id) payload.customer_id = targetUser.customer_id;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

router.get('/shops', async (req, res) => {
  try {
    const shops = await dbAll(`
      SELECT s.id, s.name, s.phone, s.city, s.state, s.created_at,
             COALESCE(ro_counts.ro_count, 0) AS ro_count,
             COALESCE(user_counts.user_count, 0) AS user_count
      FROM shops s
      LEFT JOIN (
        SELECT shop_id, COUNT(*)::int AS ro_count
        FROM repair_orders
        GROUP BY shop_id
      ) ro_counts ON ro_counts.shop_id = s.id
      LEFT JOIN (
        SELECT shop_id, COUNT(*)::int AS user_count
        FROM users
        GROUP BY shop_id
      ) user_counts ON user_counts.shop_id = s.id
      ORDER BY s.created_at DESC
    `);
    res.json({ shops });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/shops/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const shop = await dbGet(
      'SELECT id, name, phone, address, city, state, zip, created_at FROM shops WHERE id = $1',
      [shopId]
    );
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const users = await dbAll(
      'SELECT id, name, email, role FROM users WHERE shop_id = $1 ORDER BY role, name',
      [shopId]
    );
    const recentRos = await dbAll(
      `SELECT id, status, job_type, created_at
       FROM repair_orders
       WHERE shop_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [shopId]
    );
    const roCount = await dbGet(
      'SELECT COUNT(*)::int AS count FROM repair_orders WHERE shop_id = $1',
      [shopId]
    );

    res.json({
      shop,
      users,
      recent_ros: recentRos,
      ro_count: roCount?.count || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await dbGet(`
      SELECT
        (SELECT COUNT(*)::int FROM shops) AS total_shops,
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COUNT(*)::int FROM repair_orders) AS total_ros,
        (SELECT COUNT(*)::int FROM customers) AS total_customers
    `);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get shop ratings for superadmin dashboard
router.get('/ratings', async (req, res) => {
  try {
    const shops = await dbAll(`
      SELECT 
        s.id,
        s.name,
        s.city,
        s.state,
        COALESCE(ro_counts.ro_count, 0) AS ro_count,
        COALESCE(rating_stats.avg_rating, 0)::numeric(2,1) AS avg_rating,
        COALESCE(rating_stats.review_count, 0) AS review_count
      FROM shops s
      LEFT JOIN (
        SELECT shop_id, COUNT(*)::int AS ro_count
        FROM repair_orders
        GROUP BY shop_id
      ) ro_counts ON ro_counts.shop_id = s.id
      LEFT JOIN (
        SELECT shop_id, AVG(rating)::numeric(2,1) AS avg_rating, COUNT(*)::int AS review_count
        FROM ro_ratings
        GROUP BY shop_id
      ) rating_stats ON rating_stats.shop_id = s.id
      ORDER BY avg_rating DESC NULLS LAST, review_count DESC
    `);
    res.json({ shops });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force-set a user's password (superadmin only)
router.post('/users/:userId/set-password', async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body || {};
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = await dbGet('SELECT id, email, role FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot modify superadmin accounts' });
    const hash = await bcrypt.hash(password, 10);
    await dbRun('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    res.json({ ok: true, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a user by ID (superadmin only — cross-shop, cascades)
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await dbGet('SELECT id, role, email FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot delete superadmin accounts' });
    
    // Null out FK references that aren't already ON DELETE CASCADE/SET NULL
    await dbRun('UPDATE time_entries SET user_id = NULL WHERE user_id = $1', [userId]);
    await dbRun('UPDATE job_status_log SET user_id = NULL WHERE user_id = $1', [userId]).catch(() => {});
    await dbRun('UPDATE ro_comms SET user_id = NULL WHERE user_id = $1', [userId]).catch(() => {});
    await dbRun('DELETE FROM ro_internal_notes WHERE user_id = $1', [userId]).catch(() => {});

    // Then delete the user
    await dbRun('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ ok: true, deleted: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Impersonate any non-superadmin user (support debugging)
router.post('/impersonate', async (req, res) => {
  try {
    const { user_id, shop_id } = req.body || {};

    let targetUser = null;
    if (user_id) {
      targetUser = await dbGet(
        `SELECT u.id, u.name, u.email, u.role, u.shop_id, u.customer_id, s.onboarded
         FROM users u
         LEFT JOIN shops s ON s.id = u.shop_id
         WHERE u.id = $1`,
        [user_id]
      );
    } else if (shop_id) {
      targetUser = await dbGet(
        `SELECT u.id, u.name, u.email, u.role, u.shop_id, u.customer_id, s.onboarded
         FROM users u
         LEFT JOIN shops s ON s.id = u.shop_id
         WHERE u.shop_id = $1
           AND u.role <> 'superadmin'
         ORDER BY
           CASE
             WHEN u.role = 'owner' THEN 0
             WHEN u.role = 'admin' THEN 1
             WHEN u.role = 'staff' THEN 2
             WHEN u.role = 'employee' THEN 3
             WHEN u.role = 'technician' THEN 4
             WHEN u.role = 'assistant' THEN 5
             ELSE 6
           END,
           u.created_at ASC
         LIMIT 1`,
        [shop_id]
      );
    } else {
      return res.status(400).json({ error: 'user_id or shop_id is required' });
    }

    if (!targetUser) return res.status(404).json({ error: 'Target user not found' });
    if (targetUser.role === 'superadmin') return res.status(403).json({ error: 'Cannot impersonate superadmin users' });
    if (!targetUser.shop_id) return res.status(400).json({ error: 'Target user is not linked to a shop' });

    const token = issueImpersonationToken(targetUser, req.user.id);
    return res.json({
      token,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
        shop_id: targetUser.shop_id,
        customer_id: targetUser.customer_id || null,
        onboarded: Boolean(targetUser.onboarded),
      },
      impersonation: {
        by_superadmin_id: req.user.id,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
