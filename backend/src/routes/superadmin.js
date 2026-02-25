const router = require('express').Router();
const { dbAll, dbGet } = require('../db');
const superadmin = require('../middleware/superadmin');

router.use(superadmin);

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

module.exports = router;
