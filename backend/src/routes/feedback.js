const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

// Feedback table is created in db/index.js initDb()

const SAFE_AI_CONFIG_ERROR = 'AI estimate extraction is not configured correctly. Please contact support.';
const FEEDBACK_SELECT = `
  SELECT
    id,
    app,
    tester_name,
    category,
    priority,
    message,
    expected,
    page,
    routed_to,
    shop_id,
    status,
    support_note,
    linked_ref,
    assigned_at,
    resolved_at,
    updated_at,
    created_at
  FROM feedback
`;

const feedbackPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback submissions. Please try again shortly.' },
});

function sanitizeFeedbackText(value) {
  const text = String(value || '').trim();
  if (!text) return text;
  const isAutoReport = /^\[AUTO\]/i.test(text);
  if (
    /incorrect api key provided/i.test(text) ||
    /invalid[_\s-]?api[_\s-]?key/i.test(text) ||
    /openai/i.test(text) ||
    /platform\.[a-z]+\.com\/account\/api-keys/i.test(text) ||
    /sk-(?:proj-)?[A-Za-z0-9_-]+/.test(text)
  ) {
    return isAutoReport ? `[AUTO] ${SAFE_AI_CONFIG_ERROR}` : SAFE_AI_CONFIG_ERROR;
  }
  return text.replace(/sk-(?:proj-)?[A-Za-z0-9_-]+/g, '[redacted]');
}

function getShopIdFromAuthHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.shop_id || null;
  } catch {
    return null;
  }
}

function isSuperadmin(user) {
  return String(user?.role || '').toLowerCase() === 'superadmin';
}

function requireSuperadmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!isSuperadmin(req.user)) return res.status(403).json({ error: 'Superadmin access required' });
  return next();
}

function paginationParams(query) {
  const requestedLimit = Number.parseInt(query.limit, 10);
  const requestedOffset = Number.parseInt(query.offset, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100;
  const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
  return { limit, offset };
}

router.post('/', feedbackPostLimiter, async (req, res) => {
  try {
    const { app, tester_name, category, priority, message, expected, page, routed_to } = req.body;
    const safeMessage = sanitizeFeedbackText(message);
    if (!safeMessage) return res.status(400).json({ error: 'Message required' });
    const shopId = getShopIdFromAuthHeader(req.headers.authorization);
    const normalizedApp = ['revv', 'payload', 'forge', 'shopcommand'].includes(String(app || '').toLowerCase())
      ? String(app).toLowerCase()
      : 'revv';
    const id = uuidv4();
    await dbRun(
      `INSERT INTO feedback (id, app, tester_name, category, priority, message, expected, page, routed_to, shop_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, normalizedApp, tester_name || 'Anonymous', category || 'general', priority || 'medium', safeMessage, sanitizeFeedbackText(expected) || null, page || null, routed_to || null, shopId]
    );
    res.status(201).json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/all', auth, requireSuperadmin, async (req, res) => {
  try {
    const { limit, offset } = paginationParams(req.query);
    const feedback = await dbAll(`${FEEDBACK_SELECT} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ feedback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const shopId = req.user?.shop_id;
    if (!shopId && !isSuperadmin(req.user)) {
      return res.status(403).json({ error: 'Shop context required' });
    }
    const { limit, offset } = paginationParams(req.query);
    const params = isSuperadmin(req.user) && !shopId ? [limit, offset] : [String(shopId), limit, offset];
    const sql = isSuperadmin(req.user) && !shopId
      ? `${FEEDBACK_SELECT} ORDER BY created_at DESC LIMIT $1 OFFSET $2`
      : `${FEEDBACK_SELECT} WHERE shop_id::text = $1::text ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    const feedback = await dbAll(sql, params);
    res.json({ feedback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.sanitizeFeedbackText = sanitizeFeedbackText;
router.feedbackPostLimiter = feedbackPostLimiter;

module.exports = router;
