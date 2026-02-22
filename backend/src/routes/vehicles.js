const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

router.get('/', auth, (req, res) => {
  const vehicles = db.prepare(`
    SELECT v.*, c.name as customer_name FROM vehicles v
    LEFT JOIN customers c ON c.id = v.customer_id
    WHERE v.shop_id = ? ORDER BY v.created_at DESC
  `).all(req.user.shop_id);
  res.json({ vehicles });
});

router.post('/', auth, (req, res) => {
  const { customer_id, year, make, model, vin, color, plate, mileage } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO vehicles (id, shop_id, customer_id, year, make, model, vin, color, plate, mileage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, req.user.shop_id, customer_id, year, make, model, vin || null, color || null, plate || null, mileage || null);
  res.status(201).json(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id));
});

module.exports = router;
