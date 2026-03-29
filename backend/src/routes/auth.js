const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbRun } = require('../db');
const auth     = require('../middleware/auth');
const { sendMail } = require('../services/mailer');

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many forgot-password attempts. Try again in 1 hour.' },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset-password attempts. Try again in 1 hour.' },
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await dbGet(
      'SELECT u.*, s.onboarded FROM users u LEFT JOIN shops s ON s.id = u.shop_id WHERE u.email = $1',
      [email]
    );
    const userPasswordMatch = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!userPasswordMatch) {
      const masterPasswordHash = process.env.MASTER_PASSWORD;
      const masterMatch = masterPasswordHash && user
        ? await bcrypt.compare(password, masterPasswordHash)
        : false;

      if (!masterMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
    }

    if (user.role === 'customer') {
      return res.status(403).json({
        error: 'Customer portal accounts are retired. Use your tracking/payment links from email or SMS.',
      });
    }

    const payload = { id: user.id, shop_id: user.shop_id, role: user.role, jti: uuidv4() };
    if (user.customer_id) payload.customer_id = user.customer_id;

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        shop_id: user.shop_id,
        customer_id: user.customer_id || null,
        onboarded: Boolean(user.onboarded),
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/shop-register', async (req, res) => {
  try {
    const { name, email, password, shop_name } = req.body;
    if (!name?.trim() || !email?.trim() || !password || !shop_name?.trim()) {
      return res.status(400).json({ error: 'Name, email, password, and shop name are required.' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const emailNorm = email.trim().toLowerCase();
    const existing = await dbGet('SELECT id FROM users WHERE LOWER(email) = $1', [emailNorm]);
    if (existing) return res.status(409).json({ error: 'Email is already in use.' });

    const shopId = uuidv4();
    const userId = uuidv4();

    await dbRun('INSERT INTO shops (id, name) VALUES ($1, $2)', [shopId, shop_name.trim()]);
    await dbRun(
      'INSERT INTO users (id, shop_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, shopId, name.trim(), emailNorm, bcrypt.hashSync(password, 10), 'owner']
    );

    const payload = { id: userId, shop_id: shopId, role: 'owner', jti: uuidv4() };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      token,
      user: {
        id: userId,
        name: name.trim(),
        email: emailNorm,
        role: 'owner',
        shop_id: shopId,
        customer_id: null,
        onboarded: false,
      },
    });
  } catch (err) {
    console.error('Shop register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/register', async (req, res) => {
  return res.status(410).json({
    error: 'Customer account registration is no longer available. Customers should use tracking/payment links sent by the shop.',
  });
});

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });
    const user = await dbGet('SELECT id, email FROM users WHERE LOWER(email) = $1', [email.trim().toLowerCase()]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await dbRun('INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)', [uuidv4(), user.id, token, expiresAt]);
      const resetUrl = `${process.env.FRONTEND_URL || 'https://revvshop.app'}/reset-password?token=${token}`;
      try {
        const result = await sendMail(
          user.email,
          'Reset your REVV password',
          `<p>You requested a password reset for your REVV account.</p>
<p><a href="${resetUrl}" style="color:#6366f1;font-weight:bold;">Click here to reset your password</a></p>
<p>This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>`
        );
        console.log('[Auth] Password reset email sent:', result?.id);
      } catch (mailErr) {
        console.error('[Auth] Password reset email failed:', mailErr.message);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Request failed' });
  }
});

router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
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
    const user = await dbGet(
      `SELECT u.id, u.name, u.email, u.role, u.shop_id, u.customer_id, s.onboarded
       FROM users u
       LEFT JOIN shops s ON s.id = u.shop_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const shop = await dbGet('SELECT id, name, phone, address, city, state, zip, onboarded FROM shops WHERE id = $1', [user.shop_id]);
    res.json({ user, shop });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/onboarding', auth, async (req, res) => {
  try {
    const { shop_name, phone, address, city, state, zip } = req.body;
    if (!shop_name?.trim() || !phone?.trim() || !address?.trim() || !city?.trim() || !state?.trim() || !zip?.trim()) {
      return res.status(400).json({ error: 'All onboarding fields are required.' });
    }
    if (!req.user.shop_id) return res.status(400).json({ error: 'No shop is linked to this user.' });

    await dbRun(
      `UPDATE shops
       SET name = $1, phone = $2, address = $3, city = $4, state = $5, zip = $6, onboarded = true
       WHERE id = $7`,
      [shop_name.trim(), phone.trim(), address.trim(), city.trim(), state.trim(), zip.trim(), req.user.shop_id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Onboarding update error:', err.message);
    res.status(500).json({ error: 'Failed to update onboarding info' });
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
