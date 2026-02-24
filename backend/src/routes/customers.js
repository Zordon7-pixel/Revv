const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

router.get('/', auth, async (req, res) => {
  try {
    const customers = await dbAll('SELECT * FROM customers WHERE shop_id = $1 ORDER BY name', [req.user.shop_id]);
    res.json({ customers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/full', auth, async (req, res) => {
  try {
    const customer = await dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    const vehicles = await dbAll('SELECT * FROM vehicles WHERE customer_id = $1 ORDER BY created_at DESC', [customer.id]);
    const ros = await dbAll(
      'SELECT ro_number, id, status, job_type, created_at, updated_at, total, notes FROM repair_orders WHERE customer_id = $1 ORDER BY created_at DESC',
      [customer.id]
    );
    res.json({ customer, vehicles, ros });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const customer = await dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    const vehicles = await dbAll('SELECT * FROM vehicles WHERE customer_id = $1', [customer.id]);
    const ros = await dbAll('SELECT ro_number, status, job_type, created_at FROM repair_orders WHERE customer_id = $1 ORDER BY created_at DESC', [customer.id]);
    res.json({ ...customer, vehicles, ros });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, phone, email, address, insurance_company, policy_number } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Customer name is required.' });
    const shop = await dbGet('SELECT id FROM shops WHERE id = $1', [req.user.shop_id]);
    if (!shop) return res.status(401).json({ error: 'Session expired. Please log out and back in.' });
    const id = uuidv4();
    await dbRun(
      'INSERT INTO customers (id, shop_id, name, phone, email, address, insurance_company, policy_number) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, req.user.shop_id, name.trim(), phone || null, email || null, address || null, insurance_company || null, policy_number || null]
    );
    res.status(201).json(await dbGet('SELECT * FROM customers WHERE id = $1', [id]));
  } catch (err) {
    console.error('Customer save error:', err.message);
    res.status(500).json({ error: 'Error saving customer. Please try again.' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { name, phone, email, address, insurance_company, policy_number } = req.body;
    await dbRun(
      'UPDATE customers SET name=$1, phone=$2, email=$3, address=$4, insurance_company=$5, policy_number=$6 WHERE id=$7 AND shop_id=$8',
      [name, phone, email, address, insurance_company, policy_number, req.params.id, req.user.shop_id]
    );
    res.json(await dbGet('SELECT * FROM customers WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await dbRun('UPDATE users SET customer_id = NULL WHERE customer_id = $1', [req.params.id]);
    await dbRun('DELETE FROM customers WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
