const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');

const CHANNELS = ['call', 'email', 'sms', 'in-person'];
const DIRECTIONS = ['inbound', 'outbound'];

async function ensureRoCommsTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ro_comms (
      id UUID PRIMARY KEY,
      ro_id TEXT NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      channel TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'outbound',
      summary TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
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

router.get('/ro/:roId', auth, async (req, res) => {
  try {
    await ensureRoCommsTable();

    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const comms = await dbAll(
      `SELECT
         c.id,
         c.ro_id,
         c.shop_id,
         c.user_id,
         c.channel,
         c.direction,
         c.summary,
         c.created_at,
         COALESCE(u.name, 'System') AS logged_by
       FROM ro_comms c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.ro_id = $1 AND c.shop_id = $2
       ORDER BY c.created_at DESC`,
      [req.params.roId, req.user.shop_id]
    );

    return res.json({ comms });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/ro/:roId', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRoCommsTable();

    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const channel = String(req.body?.channel || '').trim().toLowerCase();
    const direction = String(req.body?.direction || '').trim().toLowerCase();
    const summary = String(req.body?.summary || '').trim();

    if (!CHANNELS.includes(channel)) {
      return res.status(400).json({ error: 'Invalid channel' });
    }
    if (!DIRECTIONS.includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction' });
    }
    if (!summary) {
      return res.status(400).json({ error: 'Summary is required' });
    }

    const commId = uuidv4();
    await dbRun(
      `INSERT INTO ro_comms (id, ro_id, shop_id, user_id, channel, direction, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [commId, req.params.roId, req.user.shop_id, req.user.id, channel, direction, summary]
    );

    const comm = await dbGet(
      `SELECT
         c.id,
         c.ro_id,
         c.shop_id,
         c.user_id,
         c.channel,
         c.direction,
         c.summary,
         c.created_at,
         COALESCE(u.name, 'System') AS logged_by
       FROM ro_comms c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [commId]
    );

    return res.status(201).json({ comm });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, requireTechnician, async (req, res) => {
  try {
    await ensureRoCommsTable();

    const existing = await dbGet(
      'SELECT id FROM ro_comms WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Communication log not found' });

    await dbRun('DELETE FROM ro_comms WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
