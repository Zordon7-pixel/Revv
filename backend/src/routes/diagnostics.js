const router = require('express').Router();
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { dbGet, dbAll, dbRun, pool } = require('../db');

router.get('/', auth, requireAdmin, async (req, res) => {
  try {
    const checks = [];
    let canHeal = false;

    // 1. DB connectivity
    try {
      await pool.query('SELECT 1');
      checks.push({ name: 'Database Connection', ok: true, detail: 'connected' });
    } catch (e) {
      checks.push({ name: 'Database Connection', ok: false, detail: e.message });
    }

    // 2. Required tables exist
    const requiredTables = ['shops', 'users', 'customers', 'vehicles', 'repair_orders', 'job_status_log', 'parts_orders', 'time_entries', 'schedules'];
    for (const t of requiredTables) {
      try {
        await pool.query(`SELECT 1 FROM ${t} LIMIT 1`);
        checks.push({ name: `Table: ${t}`, ok: true, detail: 'exists' });
      } catch (e) {
        checks.push({ name: `Table: ${t}`, ok: false, detail: 'missing' });
        canHeal = true;
      }
    }

    // 3. Seed data present
    const shopRow = await dbGet('SELECT COUNT(*)::int as c FROM shops', []);
    const userRow = await dbGet('SELECT COUNT(*)::int as c FROM users', []);
    const shopCount = shopRow.c;
    const userCount = userRow.c;
    checks.push({ name: 'Shop Record', ok: shopCount > 0, detail: `${shopCount} shop(s)` });
    checks.push({ name: 'User Records', ok: userCount > 0, detail: `${userCount} user(s)` });
    if (shopCount === 0 || userCount === 0) canHeal = true;

    // 4. Invalid RO statuses
    const validStatuses = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed'];
    try {
      const placeholders = validStatuses.map((_, i) => `$${i + 1}`).join(',');
      const badRow = await dbGet(`SELECT COUNT(*)::int as c FROM repair_orders WHERE status NOT IN (${placeholders})`, validStatuses);
      checks.push({ name: 'RO Status Validity', ok: badRow.c === 0, detail: badRow.c > 0 ? `${badRow.c} invalid status(es)` : 'all valid' });
      if (badRow.c > 0) canHeal = true;
    } catch (e) {
      checks.push({ name: 'RO Status Validity', ok: false, detail: e.message });
    }

    // 5. Admin user exists
    const adminRow = await dbGet("SELECT COUNT(*)::int as c FROM users WHERE role IN ('owner','admin')", []);
    checks.push({ name: 'Admin Account', ok: adminRow.c > 0, detail: `${adminRow.c} admin(s)` });
    if (adminRow.c === 0) canHeal = true;

    const allOk = checks.every(c => c.ok);
    res.json({ ok: allOk, canHeal: !allOk, checks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/heal', auth, requireAdmin, async (req, res) => {
  try {
    const actions = [];

    const validStatuses = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed'];
    try {
      const placeholders = validStatuses.map((_, i) => `$${i + 1}`).join(',');
      const result = await dbRun(`UPDATE repair_orders SET status='intake' WHERE status NOT IN (${placeholders})`, validStatuses);
      if (result.rowCount > 0) actions.push(`Fixed ${result.rowCount} invalid RO status(es) → reset to intake`);
    } catch (e) {
      actions.push(`⚠️ Could not fix RO statuses: ${e.message}`);
    }

    const shopRow = await dbGet('SELECT COUNT(*)::int as c FROM shops', []);
    const userRow = await dbGet('SELECT COUNT(*)::int as c FROM users', []);
    if (shopRow.c === 0 || userRow.c === 0) {
      try {
        await require('../db/seed').runSeed();
        actions.push('Re-seeded missing shop and user data');
      } catch (e) {
        actions.push(`⚠️ Re-seed failed: ${e.message}`);
      }
    }

    if (actions.length === 0) actions.push('No issues found — everything looks healthy');

    try {
      const actPath = '/Users/zordon/.openclaw/workspace/second-brain/data/activity.json';
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync(actPath, 'utf8'));
      data.activity.push({
        id: `act-heal-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'diagnostic',
        icon: '🔧',
        message: `REVV self-heal ran: ${actions.length} action(s)`,
        detail: actions.join('; ')
      });
      fs.writeFileSync(actPath, JSON.stringify(data, null, 2));
    } catch (e) {}

    res.json({ ok: true, actions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
