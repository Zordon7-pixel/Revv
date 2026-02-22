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

router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, shop_id, customer_id FROM users WHERE id = ?').get(req.user.id);
  const shop = db.prepare('SELECT id, name, phone, address, city, state, zip FROM shops WHERE id = ?').get(user.shop_id);
  res.json({ user, shop });
});

module.exports = router;
