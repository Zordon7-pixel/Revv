const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, shop_id: user.shop_id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, shop_id: user.shop_id } });
});

router.get('/me', require('../middleware/auth'), (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, shop_id FROM users WHERE id = ?').get(req.user.id);
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(user.shop_id);
  res.json({ user, shop });
});

module.exports = router;
