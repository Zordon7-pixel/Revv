const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db');
const auth     = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });

  const payload = { id: user.id, shop_id: user.shop_id, role: user.role };
  if (user.customer_id) payload.customer_id = user.customer_id;

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, shop_id: user.shop_id, customer_id: user.customer_id || null },
  });
});

// POST /api/auth/register — open customer self-registration
// If email matches an existing customer record → linked automatically
// If no match → account + blank customer record created; shop can link their RO later
router.post('/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email?.trim() || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const emailNorm = email.trim().toLowerCase();
  const { v4: uuidv4 } = require('uuid');

  // Block if account already exists for this email
  const existingByEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(emailNorm);
  if (existingByEmail) {
    return res.status(409).json({ error: 'An account already exists with that email. Just sign in.' });
  }

  // Get the shop (single-tenant — one shop per deployment)
  const shop = db.prepare('SELECT id FROM shops LIMIT 1').get();
  if (!shop) return res.status(500).json({ error: 'Shop not configured.' });

  // Try to match an existing customer record by email
  let customer = db.prepare('SELECT * FROM customers WHERE LOWER(email) = ? AND shop_id = ?').get(emailNorm, shop.id);

  // No match — create a blank customer record so the shop can link their RO later
  if (!customer) {
    const custId = uuidv4();
    const displayName = name?.trim() || emailNorm.split('@')[0];
    db.prepare(`INSERT INTO customers (id, shop_id, name, email) VALUES (?, ?, ?, ?)`)
      .run(custId, shop.id, displayName, emailNorm);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(custId);
  }

  // Block if this customer already has a linked login
  const existingByCust = db.prepare('SELECT id, email FROM users WHERE customer_id = ?').get(customer.id);
  if (existingByCust) {
    return res.status(409).json({
      error: `An account already exists for this customer. Sign in with ${existingByCust.email}.`
    });
  }

  // Create the portal account, linked to the customer record
  const id = uuidv4();
  db.prepare(`INSERT INTO users (id, shop_id, name, email, password_hash, role, customer_id) VALUES (?, ?, ?, ?, ?, 'customer', ?)`)
    .run(id, shop.id, customer.name, emailNorm, bcrypt.hashSync(password, 10), customer.id);

  const payload = { id, shop_id: shop.id, role: 'customer', customer_id: customer.id };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({
    token,
    user: { id, name: customer.name, email: emailNorm, role: 'customer', shop_id: shop.id, customer_id: customer.id },
  });
});

router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, shop_id, customer_id FROM users WHERE id = ?').get(req.user.id);
  const shop = db.prepare('SELECT id, name, phone, address, city, state, zip FROM shops WHERE id = ?').get(user.shop_id);
  res.json({ user, shop });
});

module.exports = router;
