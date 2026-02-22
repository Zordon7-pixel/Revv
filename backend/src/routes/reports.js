const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/summary', auth, (req, res) => {
  const sid = req.user.shop_id;
  const total = db.prepare('SELECT COUNT(*) as n FROM repair_orders WHERE shop_id = ?').get(sid).n;
  const active = db.prepare("SELECT COUNT(*) as n FROM repair_orders WHERE shop_id = ? AND status NOT IN ('closed','delivery')").get(sid).n;
  const completed = db.prepare("SELECT COUNT(*) as n FROM repair_orders WHERE shop_id = ? AND status IN ('delivery','closed')").get(sid).n;
  const revenue = db.prepare('SELECT COALESCE(SUM(total),0) as r FROM repair_orders WHERE shop_id = ?').get(sid).r;
  const profit = db.prepare('SELECT COALESCE(SUM(true_profit),0) as p FROM repair_orders WHERE shop_id = ?').get(sid).p;
  const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM repair_orders WHERE shop_id = ? GROUP BY status").all(sid);
  const byType = db.prepare("SELECT job_type, COUNT(*) as count, SUM(total) as revenue FROM repair_orders WHERE shop_id = ? GROUP BY job_type").all(sid);
  const recent = db.prepare(`
    SELECT ro.*, v.year, v.make, v.model, c.name as customer_name
    FROM repair_orders ro
    LEFT JOIN vehicles v ON v.id = ro.vehicle_id
    LEFT JOIN customers c ON c.id = ro.customer_id
    WHERE ro.shop_id = ? ORDER BY ro.updated_at DESC LIMIT 10
  `).all(sid);
  res.json({ total, active, completed, revenue, profit, byStatus, byType, recent });
});

module.exports = router;
