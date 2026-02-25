const router = require('express').Router();
const { dbGet, dbRun } = require('../db');
const { v4: uuidv4 } = require('uuid');

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
      type TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

router.get('/:token', async (req, res) => {
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
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:token/respond', async (req, res) => {
  try {
    await ensureTables();
    const link = await dbGet('SELECT * FROM estimate_approval_links WHERE token = $1', [req.params.token]);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.responded_at) return res.status(400).json({ error: 'Response already submitted' });

    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [link.ro_id]);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const { decision, reason } = req.body || {};
    if (!['approve', 'decline'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision' });
    }

    const now = new Date().toISOString();
    if (decision === 'approve') {
      const fromStatus = ro.status;
      await dbRun('UPDATE repair_orders SET status = $1, estimate_approved_at = $2, updated_at = $3 WHERE id = $4', ['approval', now, now, ro.id]);
      await dbRun(
        'INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuidv4(), ro.id, fromStatus, 'approval', null, 'Estimate approved by customer via public approval link']
      );
      await dbRun('UPDATE estimate_approval_links SET responded_at = $1 WHERE token = $2', [now, req.params.token]);
      return res.json({ ok: true, decision: 'approve' });
    }

    if (!reason?.trim()) return res.status(400).json({ error: 'Reason is required when requesting changes' });
    await dbRun(
      `INSERT INTO ro_comms (id, ro_id, shop_id, user_id, type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), ro.id, ro.shop_id, null, 'email', `Estimate change request: ${reason.trim()}`]
    );
    await dbRun('UPDATE estimate_approval_links SET responded_at = $1, decline_reason = $2 WHERE token = $3', [now, reason.trim(), req.params.token]);
    return res.json({ ok: true, decision: 'decline' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
