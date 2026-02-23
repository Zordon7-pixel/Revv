const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbRun } = require('../db');
const auth     = require('../middleware/auth');

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await dbGet('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid email or password' });

    const payload = { id: user.id, shop_id: user.shop_id, role: user.role, jti: uuidv4() };
    if (user.customer_id) payload.customer_id = user.customer_id;

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, shop_id: user.shop_id, customer_id: user.customer_id || null },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/register — open customer self-registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email?.trim() || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const emailNorm = email.trim().toLowerCase();

    const existingByEmail = await dbGet('SELECT id FROM users WHERE LOWER(email) = $1', [emailNorm]);
    if (existingByEmail) {
      return res.status(409).json({ error: 'An account already exists with that email. Just sign in.' });
    }

    const shop = await dbGet('SELECT id FROM shops LIMIT 1', []);
    if (!shop) return res.status(500).json({ error: 'Shop not configured.' });

    let customer = await dbGet('SELECT * FROM customers WHERE LOWER(email) = $1 AND shop_id = $2', [emailNorm, shop.id]);

    if (!customer) {
      const custId = uuidv4();
      const displayName = name?.trim() || emailNorm.split('@')[0];
      await dbRun('INSERT INTO customers (id, shop_id, name, email) VALUES ($1, $2, $3, $4)', [custId, shop.id, displayName, emailNorm]);
      customer = await dbGet('SELECT * FROM customers WHERE id = $1', [custId]);
    }

    const existingByCust = await dbGet('SELECT id, email FROM users WHERE customer_id = $1', [customer.id]);
    if (existingByCust) {
      return res.status(409).json({
        error: `An account already exists for this customer. Sign in with ${existingByCust.email}.`
      });
    }

    const id = uuidv4();
    await dbRun(
      `INSERT INTO users (id, shop_id, name, email, password_hash, role, customer_id) VALUES ($1, $2, $3, $4, $5, 'customer', $6)`,
      [id, shop.id, customer.name, emailNorm, bcrypt.hashSync(password, 10), customer.id]
    );

    const payload = { id, shop_id: shop.id, role: 'customer', customer_id: customer.id, jti: uuidv4() };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      token,
      user: { id, name: customer.name, email: emailNorm, role: 'customer', shop_id: shop.id, customer_id: customer.id },
    });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });
    const user = await dbGet('SELECT id, email FROM users WHERE LOWER(email) = $1', [email.trim().toLowerCase()]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await dbRun('INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)', [uuidv4(), user.id, token, expiresAt]);
      console.log(`PASSWORD RESET LINK: /reset-password?token=${token}`);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Request failed' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const record = await dbGet(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = 0 AND expires_at > $2',
      [token, new Date().toISOString()]
    );
    if (!record) return res.status(400).json({ error: 'Reset link is invalid or expired.' });
    await dbRun('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(password, 10), record.user_id]);
    await dbRun('UPDATE password_reset_tokens SET used = 1 WHERE id = $1', [record.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Reset failed' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await dbGet('SELECT id, name, email, role, shop_id, customer_id FROM users WHERE id = $1', [req.user.id]);
    const shop = await dbGet('SELECT id, name, phone, address, city, state, zip FROM shops WHERE id = $1', [user.shop_id]);
    res.json({ user, shop });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', auth, async (req, res) => {
  try {
    const jti = req.user.jti;
    if (jti) {
      await dbRun(
        'INSERT INTO revoked_tokens (id, token_jti, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [uuidv4(), jti, req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout-all', auth, async (req, res) => {
  try {
    const now = new Date().toISOString();
    await dbRun('UPDATE users SET revoke_all_before = $1 WHERE id = $2', [now, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
