const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { pool, dbGet, dbRun } = require('../db');

const { panelPublicHandler, noStore, publicError, publicRequestError, respondLegacyApproval } = require('../services/panelEstimatorApproval');

const publicApprovalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
});

router.use(publicRequestError(publicApprovalLimiter));
router.use(noStore);
router.use(publicApprovalLimiter);

async function ensureTables() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS estimate_approval_links (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_by TEXT,
      decline_reason TEXT,
      responded_at TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ro_comms (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      user_id TEXT,
      channel TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'outbound',
      summary TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await dbRun(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS channel TEXT`).catch(() => {});
  await dbRun(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS direction TEXT`).catch(() => {});
  await dbRun(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS summary TEXT`).catch(() => {});
  await dbRun(`
    UPDATE ro_comms
    SET channel = CASE
      WHEN channel IS NOT NULL THEN channel
      WHEN type = 'text' THEN 'sms'
      WHEN type IN ('call', 'email', 'in-person') THEN type
      ELSE 'call'
    END
  `).catch(() => {});
  await dbRun(`UPDATE ro_comms SET direction = COALESCE(direction, 'outbound')`).catch(() => {});
  await dbRun(`UPDATE ro_comms SET summary = COALESCE(summary, notes, '')`).catch(() => {});
}

router.get('/:token/pdf', panelPublicHandler(pool, 'pdf'), (req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

router.get('/:token', panelPublicHandler(pool, 'get'), async (req, res) => {
  try {
    await ensureTables();
    const link = await dbGet('SELECT * FROM estimate_approval_links WHERE token = $1', [req.params.token]);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [link.ro_id]);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });
    const customer = await dbGet('SELECT id, name, phone, email FROM customers WHERE id = $1', [ro.customer_id]);
    const vehicle = await dbGet('SELECT id, year, make, model FROM vehicles WHERE id = $1', [ro.vehicle_id]);
    const shop = await dbGet('SELECT id, name, phone FROM shops WHERE id = $1', [ro.shop_id]);

    return res.json({
      link: { token: link.token, responded_at: link.responded_at, decline_reason: link.decline_reason },
      ro: {
        id: ro.id,
        ro_number: ro.ro_number,
        status: ro.status,
        parts_cost: ro.parts_cost || 0,
        labor_cost: ro.labor_cost || 0,
        sublet_cost: ro.sublet_cost || 0,
        tax: ro.tax || 0,
        total: ro.total || 0,
      },
      customer,
      vehicle,
      shop,
    });
  } catch (err) {
    return publicError(res, err);
  }
});

router.post(['/:token', '/:token/respond'], panelPublicHandler(pool, 'respond'), async (req, res) => {
  try {
    const { decision } = await respondLegacyApproval(pool, req.params.token, req.body, 'approval');
    return res.json({ ok: true, decision });
  } catch (err) { return publicError(res, err); }
});

router.use(publicRequestError(publicApprovalLimiter));

module.exports = router;
