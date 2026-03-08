const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

const publicReviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
});

function decodeBase64Url(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function decodeReviewToken(rawToken) {
  try {
    const [payloadPart, signaturePart] = String(rawToken || '').split('.');
    if (!payloadPart || !signaturePart) return null;
    if (!process.env.JWT_SECRET) return null;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.JWT_SECRET)
      .update(payloadPart)
      .digest();
    const providedSignature = decodeBase64Url(signaturePart);

    if (providedSignature.length !== expectedSignature.length) return null;
    if (!crypto.timingSafeEqual(providedSignature, expectedSignature)) return null;

    const decoded = decodeBase64Url(payloadPart).toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

router.get('/context/:token', publicReviewLimiter, async (req, res) => {
  const payload = decodeReviewToken(req.params.token);
  const exp = Number(payload?.exp);
  if (!payload?.ro_id || !payload?.shop_id || !Number.isFinite(exp)) {
    return res.status(400).json({ error: 'Invalid review link.' });
  }
  if (Date.now() > exp) {
    return res.status(410).json({ error: 'This review link has expired.' });
  }

  try {
    const shop = await dbGet('SELECT name FROM shops WHERE id = $1', [payload.shop_id]);
    if (!shop) return res.status(404).json({ error: 'Shop not found.' });

    const existing = await dbGet(
      'SELECT id FROM shop_reviews WHERE ro_id = $1 AND shop_id = $2',
      [payload.ro_id, payload.shop_id]
    );
    if (existing) return res.status(409).json({ error: 'Feedback was already submitted for this repair.' });

    return res.json({ shop_name: shop.name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/submit/:token', publicReviewLimiter, async (req, res) => {
  const payload = decodeReviewToken(req.params.token);
  const exp = Number(payload?.exp);
  if (!payload?.ro_id || !payload?.shop_id || !Number.isFinite(exp)) {
    return res.status(400).json({ error: 'Invalid review link.' });
  }
  if (Date.now() > exp) {
    return res.status(410).json({ error: 'This review link has expired.' });
  }

  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
  }

  try {
    const ro = await dbGet(
      `SELECT ro.id, ro.shop_id, c.name AS customer_name
       FROM repair_orders ro
       LEFT JOIN customers c ON c.id = ro.customer_id
       WHERE ro.id = $1 AND ro.shop_id = $2`,
      [payload.ro_id, payload.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found for this review link.' });

    const existing = await dbGet(
      'SELECT id FROM shop_reviews WHERE ro_id = $1 AND shop_id = $2',
      [payload.ro_id, payload.shop_id]
    );
    if (existing) return res.status(409).json({ error: 'Feedback was already submitted for this repair.' });

    await dbRun(
      `INSERT INTO shop_reviews (shop_id, ro_id, rating, comment, customer_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [payload.shop_id, payload.ro_id, rating, comment || null, ro.customer_name || null]
    );

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const reviews = await dbAll(
      `SELECT id, ro_id, rating, comment, customer_name, submitted_at
       FROM shop_reviews
       WHERE shop_id = $1
       ORDER BY submitted_at DESC`,
      [req.user.shop_id]
    );
    return res.json({ reviews });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/summary', auth, async (req, res) => {
  try {
    const summary = await dbGet(
      `SELECT ROUND(AVG(rating)::numeric, 1) AS average_rating, COUNT(*)::int AS total_reviews
       FROM shop_reviews
       WHERE shop_id = $1`,
      [req.user.shop_id]
    );

    const rows = await dbAll(
      `SELECT rating, COUNT(*)::int AS count
       FROM shop_reviews
       WHERE shop_id = $1
       GROUP BY rating`,
      [req.user.shop_id]
    );
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of rows) distribution[row.rating] = row.count;

    return res.json({
      average_rating: Number(summary?.average_rating || 0),
      total_reviews: Number(summary?.total_reviews || 0),
      distribution,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
