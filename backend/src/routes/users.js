const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const auth    = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 }   = require('uuid');

// GET /api/users/me — get current user's profile
router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// PUT /api/users/me — update current user's name and phone
router.put('/me', auth, (req, res) => {
  const { name, phone } = req.body;
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name || null, phone || null, req.user.id);
  res.json({ ok: true });
});

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

  const ALLOWED_USER_FIELDS = ['name','phone','role','email','password'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_USER_FIELDS.includes(k)));
  const fields = []; const vals = [];
  if (updates.name)     { fields.push('name = ?');          vals.push(updates.name.trim()); }
  if (updates.email)    { fields.push('email = ?');         vals.push(updates.email.trim().toLowerCase()); }
  if (updates.password) { fields.push('password_hash = ?'); vals.push(bcrypt.hashSync(updates.password, 10)); }
  if (updates.role)     { fields.push('role = ?');          vals.push(updates.role); }
  if (updates.phone !== undefined) { fields.push('phone = ?'); vals.push(updates.phone || null); }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  res.json(db.prepare('SELECT id, name, email, role, customer_id, created_at FROM users WHERE id = ?').get(req.params.id));
});

// POST /api/users/portal-access — generate (or reset) portal credentials for a customer
// Returns { email, password } — admin sees it once, texts it to the customer
router.post('/portal-access', auth, requireAdmin, (req, res) => {
  const { customer_id } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND shop_id = ?').get(customer_id, req.user.shop_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  if (!customer.email) return res.status(400).json({ error: 'No email on file for this customer. Add their email first.' });

  // Generate a readable password — avoids ambiguous chars (0/O, 1/l/I)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const password = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

  const existing = db.prepare('SELECT id FROM users WHERE shop_id = ? AND customer_id = ?').get(req.user.shop_id, customer_id);
  if (existing) {
    // Reset existing password
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), existing.id);
    res.json({ email: customer.email, password, reset: true });
  } else {
    // Create new portal account
    const id = uuidv4();
    db.prepare('INSERT INTO users (id, shop_id, name, email, password_hash, role, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.user.shop_id, customer.name, customer.email.toLowerCase(), bcrypt.hashSync(password, 10), 'customer', customer_id);
    res.json({ email: customer.email, password, reset: false });
  }
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
