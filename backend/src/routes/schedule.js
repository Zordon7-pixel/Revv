const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');

function enrich(s) {
  if (!s) return null;
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(s.user_id);
  return { ...s, user };
}

// GET /api/schedule?week=YYYY-MM-DD&user_id=
// Admin: all employees. Employee: own only.
router.get('/', auth, (req, res) => {
  const { week, user_id } = req.query; // week = any day in the desired week
  const isAdmin = ['owner', 'admin'].includes(req.user.role);

  let sql = 'SELECT * FROM schedules WHERE shop_id = ?';
  const params = [req.user.shop_id];

  if (!isAdmin) {
    sql += ' AND user_id = ?';
    params.push(req.user.id);
  } else if (user_id) {
    sql += ' AND user_id = ?';
    params.push(user_id);
  }

  if (week) {
    // Return shifts for the 7-day window starting Monday of the given week
    const d = new Date(week);
    const day = d.getDay(); // 0=Sun
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const from = monday.toISOString().slice(0, 10);
    const to   = sunday.toISOString().slice(0, 10);
    sql += ' AND shift_date >= ? AND shift_date <= ?';
    params.push(from, to);
  }

  sql += ' ORDER BY shift_date ASC, start_time ASC';
  const shifts = db.prepare(sql).all(...params);
  res.json({ shifts: shifts.map(enrich) });
});

// GET /api/schedule/today — today's shift for the logged-in user
router.get('/today', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const shift = db.prepare(
    'SELECT * FROM schedules WHERE shop_id = ? AND user_id = ? AND shift_date = ? LIMIT 1'
  ).get(req.user.shop_id, req.user.id, today);
  res.json({ shift: shift ? enrich(shift) : null });
});

// GET /api/schedule/employees — admin: list of staff with name/id for dropdown
router.get('/employees', auth, requireAdmin, (req, res) => {
  const staff = db.prepare(
    "SELECT id, name, email, role FROM users WHERE shop_id = ? AND role IN ('admin','employee','staff','owner') ORDER BY name"
  ).all(req.user.shop_id);
  res.json({ employees: staff });
});

// POST /api/schedule — admin only: create a shift
router.post('/', auth, requireAdmin, (req, res) => {
  const { user_id, shift_date, start_time, end_time, notes } = req.body;
  if (!user_id || !shift_date || !start_time || !end_time)
    return res.status(400).json({ error: 'user_id, shift_date, start_time, end_time required' });

  // Check for duplicate shift same day
  const exists = db.prepare(
    'SELECT id FROM schedules WHERE shop_id = ? AND user_id = ? AND shift_date = ?'
  ).get(req.user.shop_id, user_id, shift_date);
  if (exists) return res.status(409).json({ error: 'This employee already has a shift on that day' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO schedules (id, shop_id, user_id, shift_date, start_time, end_time, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.shop_id, user_id, shift_date, start_time, end_time, notes || null);

  res.status(201).json({ shift: enrich(db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)) });
});

// PUT /api/schedule/:id — admin only
router.put('/:id', auth, requireAdmin, (req, res) => {
  const shift = db.prepare('SELECT * FROM schedules WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  const { start_time, end_time, notes } = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (start_time != null) updates.start_time = start_time;
  if (end_time   != null) updates.end_time   = end_time;
  if (notes      != null) updates.notes      = notes;

  const set = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE schedules SET ${set} WHERE id = ?`).run(...Object.values(updates), req.params.id);

  res.json({ shift: enrich(db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id)) });
});

// DELETE /api/schedule/:id — admin only
router.delete('/:id', auth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ? AND shop_id = ?').run(req.params.id, req.user.shop_id);
  res.json({ ok: true });
});

module.exports = router;
