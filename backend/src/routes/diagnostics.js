const router = require('express').Router();
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const db = require('../db');

// GET /api/diagnostics — run full health check (admin only)
router.get('/', auth, requireAdmin, (req, res) => {
  const checks = [];
  let canHeal = false;

  // 1. DB integrity
  try {
    const result = db.prepare('PRAGMA integrity_check').get();
    checks.push({ name: 'Database Integrity', ok: result.integrity_check === 'ok', detail: result.integrity_check });
  } catch (e) {
    checks.push({ name: 'Database Integrity', ok: false, detail: e.message });
  }

  // 2. Required tables exist
  const requiredTables = ['shops', 'users', 'customers', 'vehicles', 'repair_orders', 'ro_log', 'parts_orders', 'time_entries', 'schedules'];
  for (const t of requiredTables) {
    try {
      db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get();
      checks.push({ name: `Table: ${t}`, ok: true, detail: 'exists' });
    } catch (e) {
      checks.push({ name: `Table: ${t}`, ok: false, detail: 'missing' });
      canHeal = true;
    }
  }

  // 3. Seed data present
  const shopCount = db.prepare('SELECT COUNT(*) as c FROM shops').get().c;
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  checks.push({ name: 'Shop Record', ok: shopCount > 0, detail: `${shopCount} shop(s)` });
  checks.push({ name: 'User Records', ok: userCount > 0, detail: `${userCount} user(s)` });
  if (shopCount === 0 || userCount === 0) canHeal = true;

  // 4. Invalid RO statuses
  const validStatuses = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed'];
  try {
    const badROs = db.prepare(`SELECT COUNT(*) as c FROM repair_orders WHERE status NOT IN (${validStatuses.map(() => '?').join(',')}) `).get(...validStatuses);
    checks.push({ name: 'RO Status Validity', ok: badROs.c === 0, detail: badROs.c > 0 ? `${badROs.c} invalid status(es)` : 'all valid' });
    if (badROs.c > 0) canHeal = true;
  } catch (e) {
    checks.push({ name: 'RO Status Validity', ok: false, detail: e.message });
  }

  // 5. Admin user exists
  const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('owner','admin')").get().c;
  checks.push({ name: 'Admin Account', ok: adminCount > 0, detail: `${adminCount} admin(s)` });
  if (adminCount === 0) canHeal = true;

  const allOk = checks.every(c => c.ok);
  res.json({ ok: allOk, canHeal: !allOk, checks });
});

// POST /api/diagnostics/heal — auto-fix detected issues (admin only)
router.post('/heal', auth, requireAdmin, async (req, res) => {
  const actions = [];

  // Fix invalid RO statuses → reset to 'intake'
  const validStatuses = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed'];
  try {
    const result = db.prepare(`UPDATE repair_orders SET status='intake' WHERE status NOT IN (${validStatuses.map(() => '?').join(',')})`).run(...validStatuses);
    if (result.changes > 0) actions.push(`Fixed ${result.changes} invalid RO status(es) → reset to intake`);
  } catch (e) {
    actions.push(`⚠️ Could not fix RO statuses: ${e.message}`);
  }

  // Re-seed if shop or users missing
  const shopCount = db.prepare('SELECT COUNT(*) as c FROM shops').get().c;
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (shopCount === 0 || userCount === 0) {
    try {
      require('../db/seed').runSeed();
      actions.push('Re-seeded missing shop and user data');
    } catch (e) {
      actions.push(`⚠️ Re-seed failed: ${e.message}`);
    }
  }

  // VACUUM (compact DB)
  try {
    db.exec('VACUUM');
    actions.push('Database compacted (VACUUM)');
  } catch (e) {}

  if (actions.length === 0) actions.push('No issues found — everything looks healthy');

  // Log to Control Room
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
});

module.exports = router;
