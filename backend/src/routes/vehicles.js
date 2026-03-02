const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

router.get('/', auth, async (req, res) => {
  try {
    const vehicles = await dbAll(`
      SELECT v.*, c.name as customer_name FROM vehicles v
      LEFT JOIN customers c ON c.id = v.customer_id
      WHERE v.shop_id = $1 ORDER BY v.created_at DESC
    `, [req.user.shop_id]);
    res.json({ vehicles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { customer_id, year, make, model, vin, color, plate, mileage } = req.body;
    if (customer_id) {
      const customer = await dbGet('SELECT id FROM customers WHERE id = $1 AND shop_id = $2', [customer_id, req.user.shop_id]);
      if (!customer) return res.status(400).json({ error: 'Invalid customer_id for this shop' });
    }
    const id = uuidv4();
    await dbRun(
      'INSERT INTO vehicles (id, shop_id, customer_id, year, make, model, vin, color, plate, mileage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [id, req.user.shop_id, customer_id || null, year, make, model, vin || null, color || null, plate || null, mileage || null]
    );
    res.status(201).json(await dbGet('SELECT * FROM vehicles WHERE id = $1', [id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
