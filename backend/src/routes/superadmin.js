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

// Flat user account directory for support tooling
router.get('/accounts', async (req, res) => {
  try {
    const search = String(req.query.q || '').trim().toLowerCase();
    const searchLike = search ? `%${search}%` : '';
    const shopId = String(req.query.shop_id || '').trim();

    const accounts = await dbAll(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         u.shop_id,
         u.created_at,
         s.name AS shop_name,
         s.city AS shop_city,
         s.state AS shop_state
       FROM users u
       INNER JOIN shops s ON s.id = u.shop_id
       WHERE u.role <> 'superadmin'
         AND ($1 = '' OR u.shop_id = $1)
         AND (
           $2 = ''
           OR LOWER(COALESCE(u.name, '')) LIKE $2
           OR LOWER(COALESCE(u.email, '')) LIKE $2
           OR LOWER(COALESCE(u.role, '')) LIKE $2
           OR LOWER(COALESCE(s.name, '')) LIKE $2
         )
       ORDER BY
         s.name ASC,
         CASE
           WHEN u.role = 'owner' THEN 0
           WHEN u.role = 'admin' THEN 1
           WHEN u.role = 'assistant' THEN 2
           WHEN u.role = 'staff' THEN 3
           WHEN u.role = 'employee' THEN 4
           WHEN u.role = 'technician' THEN 5
           ELSE 6
         END,
         COALESCE(u.name, '') ASC`,
      [shopId, searchLike]
    );

    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Help desk feed: registered shops + app issues (feedback/errors)
router.get('/helpdesk', async (req, res) => {
  try {
    const shopId = String(req.query.shop_id || '').trim();
    const parsedLimit = Number(req.query.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.max(25, Math.min(500, Math.trunc(parsedLimit))) : 200;

    const issueTypeSql = `(COALESCE(f.tester_name, '') = 'Auto-Reporter' OR f.message ILIKE '[AUTO]%')`;

    const ownerAccounts = await dbAll(
      `SELECT
         u.id AS owner_id,
         u.name AS owner_name,
         u.email AS owner_email,
         u.shop_id,
         s.name AS shop_name,
         s.city AS shop_city,
         s.state AS shop_state,
         s.created_at AS shop_created_at,
         COALESCE(stats.issue_count, 0) AS issue_count,
         COALESCE(stats.error_count, 0) AS error_count,
         COALESCE(stats.feedback_count, 0) AS feedback_count,
         stats.last_issue_at
       FROM users u
       INNER JOIN shops s ON s.id = u.shop_id
       LEFT JOIN (
         SELECT
           f.shop_id,
           COUNT(*)::int AS issue_count,
           COUNT(*) FILTER (WHERE ${issueTypeSql})::int AS error_count,
           COUNT(*) FILTER (WHERE NOT ${issueTypeSql})::int AS feedback_count,
           MAX(f.created_at) AS last_issue_at
         FROM feedback f
         WHERE f.shop_id IS NOT NULL AND f.shop_id <> ''
         GROUP BY f.shop_id
       ) stats ON stats.shop_id = u.shop_id::text
       WHERE u.role = 'owner'
       ORDER BY COALESCE(stats.last_issue_at, s.created_at) DESC, s.name ASC, u.name ASC`
    );

    const issues = await dbAll(
      `SELECT
         f.id,
         f.shop_id,
         COALESCE(s.name, 'Unknown Shop') AS shop_name,
         s.city AS shop_city,
         s.state AS shop_state,
         f.tester_name,
         f.category,
         f.priority,
         f.status,
         f.page,
         f.message,
         f.expected,
         f.created_at,
         CASE WHEN ${issueTypeSql} THEN 'error' ELSE 'feedback' END AS issue_type
       FROM feedback f
       LEFT JOIN shops s ON s.id::text = f.shop_id
       WHERE ($1 = '' OR f.shop_id = $1)
       ORDER BY f.created_at DESC
       LIMIT $2`,
      [shopId, limit]
    );

    const summary = await dbGet(
      `SELECT
         COUNT(*)::int AS total_issues,
         COUNT(*) FILTER (WHERE ${issueTypeSql})::int AS total_errors,
         COUNT(*) FILTER (WHERE NOT ${issueTypeSql})::int AS total_feedback
       FROM feedback f
       WHERE ($1 = '' OR f.shop_id = $1)`,
      [shopId]
    );

    const teamUsers = shopId
      ? await dbAll(
          `SELECT
             u.id,
             u.name,
             u.email,
             u.role,
             u.created_at
           FROM users u
           WHERE u.shop_id = $1
             AND u.role <> 'superadmin'
             AND u.role <> 'customer'
           ORDER BY
             CASE
               WHEN u.role = 'owner' THEN 0
               WHEN u.role = 'admin' THEN 1
               WHEN u.role = 'assistant' THEN 2
               WHEN u.role = 'staff' THEN 3
               WHEN u.role = 'employee' THEN 4
               WHEN u.role = 'technician' THEN 5
               ELSE 6
             END,
             COALESCE(u.name, '') ASC`,
          [shopId]
        )
      : [];

    return res.json({
      owner_accounts: ownerAccounts,
      issues,
      team_users: teamUsers,
      summary: {
        total_issues: summary?.total_issues || 0,
        total_errors: summary?.total_errors || 0,
        total_feedback: summary?.total_feedback || 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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

    // Non-blocking audit log — do not fail the impersonation if log write fails
    await dbRun(
      `INSERT INTO audit_log (id, action, actor_id, target_user_id, target_shop_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [uuidv4(), 'impersonate', req.user.id, targetUser.id, targetUser.shop_id,
       JSON.stringify({ role: targetUser.role, email: targetUser.email })]
    ).catch((err) => {
      console.error('[superadmin] Audit log insert failed:', err.message);
    });

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
