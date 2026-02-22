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

// POST /api/auth/register — customer self-registration
// Customer enters the email the shop has on file + creates their own password
// System finds the customer record, creates the user account, and links them
router.post('/register', (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const emailNorm = email.trim().toLowerCase();

  // Find customer record by email (shop must have entered this email)
  const customer = db.prepare('SELECT * FROM customers WHERE LOWER(email) = ?').get(emailNorm);
  if (!customer) {
    return res.status(404).json({
      error: "We don't have that email on file. Double-check the email you gave the shop, or contact them to update it."
    });
  }

  // Block if account already exists for this email
  const existingByEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(emailNorm);
  if (existingByEmail) {
    return res.status(409).json({ error: 'An account already exists with that email. Just sign in.' });
  }

  // Block if this customer already has a login (linked by customer_id)
  const existingByCust = db.prepare('SELECT id, email FROM users WHERE customer_id = ?').get(customer.id);
  if (existingByCust) {
    return res.status(409).json({
      error: `An account already exists for your vehicle. Sign in with ${existingByCust.email}.`
    });
  }

  // Create the user account — auto-link to the customer record
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  db.prepare(`
    INSERT INTO users (id, shop_id, name, email, password_hash, role, customer_id)
    VALUES (?, ?, ?, ?, ?, 'customer', ?)
  `).run(id, customer.shop_id, customer.name, emailNorm, bcrypt.hashSync(password, 10), customer.id);

  const payload = { id, shop_id: customer.shop_id, role: 'customer', customer_id: customer.id };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({
    token,
    user: { id, name: customer.name, email: emailNorm, role: 'customer', shop_id: customer.shop_id, customer_id: customer.id },
  });
});

router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, shop_id, customer_id FROM users WHERE id = ?').get(req.user.id);
  const shop = db.prepare('SELECT id, name, phone, address, city, state, zip FROM shops WHERE id = ?').get(user.shop_id);
  res.json({ user, shop });
});

module.exports = router;
