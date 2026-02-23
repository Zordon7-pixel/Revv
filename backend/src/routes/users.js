const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { dbGet, dbAll, dbRun } = require('../db');
const auth    = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 }   = require('uuid');

router.get('/me', auth, async (req, res) => {
  try {
    const user = await dbGet('SELECT id, name, email, phone, role FROM users WHERE id = $1', [req.user.id]);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/me', auth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    await dbRun('UPDATE users SET name = $1, phone = $2 WHERE id = $3', [name || null, phone || null, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.name, u.email, u.role, u.customer_id, u.created_at,
             c.name as customer_name
      FROM users u
      LEFT JOIN customers c ON c.id = u.customer_id
      WHERE u.shop_id = $1
      ORDER BY CASE u.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'employee' THEN 3 WHEN 'staff' THEN 4 ELSE 5 END, u.name
    `, [req.user.shop_id]);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, customer_id } = req.body;
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'name, email, password required' });
    const validRoles = ['admin', 'employee', 'staff', 'customer'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });

    const existing = await dbGet('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const id = uuidv4();
    await dbRun(
      'INSERT INTO users (id, shop_id, name, email, password_hash, role, customer_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, req.user.shop_id, name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 10), role, customer_id || null]
    );
    res.status(201).json(await dbGet('SELECT id, name, email, role, customer_id, created_at FROM users WHERE id = $1', [id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const user = await dbGet('SELECT id FROM users WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const ALLOWED_USER_FIELDS = ['name','phone','role','email','password'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_USER_FIELDS.includes(k)));
    const fields = []; const vals = [];
    if (updates.name)     { fields.push('name');          vals.push(updates.name.trim()); }
    if (updates.email)    { fields.push('email');         vals.push(updates.email.trim().toLowerCase()); }
    if (updates.password) { fields.push('password_hash'); vals.push(bcrypt.hashSync(updates.password, 10)); }
    if (updates.role)     { fields.push('role');          vals.push(updates.role); }
    if (updates.phone !== undefined) { fields.push('phone'); vals.push(updates.phone || null); }

    if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' });
    vals.push(req.params.id);
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    await dbRun(`UPDATE users SET ${setClauses} WHERE id = $${fields.length + 1}`, vals);
    res.json(await dbGet('SELECT id, name, email, role, customer_id, created_at FROM users WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/portal-access', auth, requireAdmin, async (req, res) => {
  try {
    const { customer_id } = req.body;
    if (!customer_id) return res.status(400).json({ error: 'customer_id required' });

    const customer = await dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [customer_id, req.user.shop_id]);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!customer.email) return res.status(400).json({ error: 'No email on file for this customer. Add their email first.' });

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const password = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    const existing = await dbGet('SELECT id FROM users WHERE shop_id = $1 AND customer_id = $2', [req.user.shop_id, customer_id]);
    if (existing) {
      await dbRun('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(password, 10), existing.id]);
      res.json({ email: customer.email, password, reset: true });
    } else {
      const id = uuidv4();
      await dbRun(
        'INSERT INTO users (id, shop_id, name, email, password_hash, role, customer_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, req.user.shop_id, customer.name, customer.email.toLowerCase(), bcrypt.hashSync(password, 10), 'customer', customer_id]
      );
      res.json({ email: customer.email, password, reset: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
    const user = await dbGet('SELECT role FROM users WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'owner') return res.status(403).json({ error: 'Cannot delete the shop owner' });
    await dbRun('UPDATE users SET revoke_all_before = $1 WHERE id = $2', [new Date().toISOString(), req.params.id]);
    await dbRun('DELETE FROM users WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
