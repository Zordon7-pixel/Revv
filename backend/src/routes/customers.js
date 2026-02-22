const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

router.get('/', auth, (req, res) => {
  const customers = db.prepare('SELECT * FROM customers WHERE shop_id = ? ORDER BY name').all(req.user.shop_id);
  res.json({ customers });
});

router.get('/:id', auth, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const vehicles = db.prepare('SELECT * FROM vehicles WHERE customer_id = ?').all(customer.id);
  const ros = db.prepare('SELECT ro_number, status, job_type, created_at FROM repair_orders WHERE customer_id = ? ORDER BY created_at DESC').all(customer.id);
  res.json({ ...customer, vehicles, ros });
});

router.post('/', auth, (req, res) => {
  const { name, phone, email, address, insurance_company, policy_number } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO customers (id, shop_id, name, phone, email, address, insurance_company, policy_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, req.user.shop_id, name, phone || null, email || null, address || null, insurance_company || null, policy_number || null);
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
});

router.put('/:id', auth, (req, res) => {
  const { name, phone, email, address, insurance_company, policy_number } = req.body;
  db.prepare('UPDATE customers SET name=?, phone=?, email=?, address=?, insurance_company=?, policy_number=? WHERE id=? AND shop_id=?').run(name, phone, email, address, insurance_company, policy_number, req.params.id, req.user.shop_id);
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM customers WHERE id = ? AND shop_id = ?').run(req.params.id, req.user.shop_id);
  res.json({ ok: true });
});

module.exports = router;
