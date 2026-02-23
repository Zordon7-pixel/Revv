const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');

async function enrich(s) {
  if (!s) return null;
  const user = await dbGet('SELECT id, name, email, role FROM users WHERE id = $1', [s.user_id]);
  return { ...s, user };
}

router.get('/', auth, async (req, res) => {
  try {
    const { week, user_id } = req.query;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);

    let sql = 'SELECT * FROM schedules WHERE shop_id = $1';
    const params = [req.user.shop_id];
    let paramIdx = 2;

    if (!isAdmin) {
      sql += ` AND user_id = $${paramIdx++}`;
      params.push(req.user.id);
    } else if (user_id) {
      sql += ` AND user_id = $${paramIdx++}`;
      params.push(user_id);
    }

    if (week) {
      const d = new Date(week);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const from = monday.toISOString().slice(0, 10);
      const to   = sunday.toISOString().slice(0, 10);
      sql += ` AND shift_date >= $${paramIdx++} AND shift_date <= $${paramIdx++}`;
      params.push(from, to);
    }

    sql += ' ORDER BY shift_date ASC, start_time ASC';
    const shifts = await dbAll(sql, params);
    res.json({ shifts: await Promise.all(shifts.map(enrich)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/today', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const shift = await dbGet(
      'SELECT * FROM schedules WHERE shop_id = $1 AND user_id = $2 AND shift_date = $3 LIMIT 1',
      [req.user.shop_id, req.user.id, today]
    );
    res.json({ shift: shift ? await enrich(shift) : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/employees', auth, requireAdmin, async (req, res) => {
  try {
    const staff = await dbAll(
      "SELECT id, name, email, role FROM users WHERE shop_id = $1 AND role IN ('admin','employee','staff','owner') ORDER BY name",
      [req.user.shop_id]
    );
    res.json({ employees: staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { user_id, shift_date, start_time, end_time, notes } = req.body;
    if (!user_id || !shift_date || !start_time || !end_time)
      return res.status(400).json({ error: 'user_id, shift_date, start_time, end_time required' });

    const exists = await dbGet(
      'SELECT id FROM schedules WHERE shop_id = $1 AND user_id = $2 AND shift_date = $3',
      [req.user.shop_id, user_id, shift_date]
    );
    if (exists) return res.status(409).json({ error: 'This employee already has a shift on that day' });

    const id = uuidv4();
    await dbRun(
      'INSERT INTO schedules (id, shop_id, user_id, shift_date, start_time, end_time, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, req.user.shop_id, user_id, shift_date, start_time, end_time, notes || null]
    );
    res.status(201).json({ shift: await enrich(await dbGet('SELECT * FROM schedules WHERE id = $1', [id])) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const shift = await dbGet('SELECT * FROM schedules WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const ALLOWED_SCHEDULE_FIELDS = ['day_of_week','shift_start','shift_end','start_time','end_time','notes'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_SCHEDULE_FIELDS.includes(k)));
    if (updates.shift_start !== undefined && updates.start_time === undefined) updates.start_time = updates.shift_start;
    if (updates.shift_end !== undefined && updates.end_time === undefined) updates.end_time = updates.shift_end;
    delete updates.shift_start;
    delete updates.shift_end;
    delete updates.day_of_week;
    updates.updated_at = new Date().toISOString();

    const updateKeys = Object.keys(updates);
    const updateVals = Object.values(updates);
    const set = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await dbRun(`UPDATE schedules SET ${set} WHERE id = $${updateKeys.length + 1}`, [...updateVals, req.params.id]);

    res.json({ shift: await enrich(await dbGet('SELECT * FROM schedules WHERE id = $1', [req.params.id])) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM schedules WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
