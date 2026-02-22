const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const auth    = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 }   = require('uuid');

// GET all users for this shop
router.get('/', auth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.customer_id, u.created_at,
           c.name as customer_name
    FROM users u
    LEFT JOIN customers c ON c.id = u.customer_id
    WHERE u.shop_id = ?
    ORDER BY CASE u.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'employee' THEN 3 WHEN 'staff' THEN 4 ELSE 5 END, u.name
  `).all(req.user.shop_id);
  res.json({ users });
});

// POST create user (employee or customer login)
router.post('/', auth, requireAdmin, (req, res) => {
  const { name, email, password, role, customer_id } = req.body;
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'name, email, password required' });
  const validRoles = ['admin', 'employee', 'staff', 'customer'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const id = uuidv4();
  db.prepare(`INSERT INTO users (id, shop_id, name, email, password_hash, role, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.user.shop_id, name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 10), role, customer_id || null);

  res.status(201).json(db.prepare('SELECT id, name, email, role, customer_id, created_at FROM users WHERE id = ?').get(id));
});

// PUT update user
router.put('/:id', auth, requireAdmin, (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const { name, email, password, role, customer_id } = req.body;
  const fields = []; const vals = [];
  if (name)        { fields.push('name = ?');          vals.push(name.trim()); }
  if (email)       { fields.push('email = ?');         vals.push(email.trim().toLowerCase()); }
  if (password)    { fields.push('password_hash = ?'); vals.push(bcrypt.hashSync(password, 10)); }
  if (role)        { fields.push('role = ?');          vals.push(role); }
  if (customer_id !== undefined) { fields.push('customer_id = ?'); vals.push(customer_id || null); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  res.json(db.prepare('SELECT id, name, email, role, customer_id, created_at FROM users WHERE id = ?').get(req.params.id));
});

// DELETE user (cannot delete yourself or the owner)
router.delete('/:id', auth, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const user = db.prepare('SELECT role FROM users WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'owner') return res.status(403).json({ error: 'Cannot delete the shop owner' });
  db.prepare('DELETE FROM users WHERE id = ? AND shop_id = ?').run(req.params.id, req.user.shop_id);
  res.json({ ok: true });
});

module.exports = router;
