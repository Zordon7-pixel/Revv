const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('../services/notifications');

async function enrich(s) {
  if (!s) return null;
  const user = await dbGet('SELECT id, name, email, role FROM users WHERE id = $1', [s.user_id]);
  return { ...s, user };
}

function parseTimeToMinutes(value) {
  const text = String(value || '');
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h * 60 + m;
}

function isOvernightShift(startTime, endTime) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return false;
  return end < start;
}

function addDaysIso(isoDate, days) {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function notifyAdminsIfAssistantAction(req, action, shift) {
  if (req.user?.role !== 'assistant' || !shift) return;

  try {
    const [actor, target, admins] = await Promise.all([
      dbGet('SELECT name FROM users WHERE id = $1', [req.user.id]),
      dbGet('SELECT name FROM users WHERE id = $1', [shift.user_id]),
      dbAll(
        "SELECT id FROM users WHERE shop_id = $1 AND role IN ('owner', 'admin')",
        [req.user.shop_id]
      ),
    ]);

    if (!admins.length) return;

    const actorName = actor?.name || 'Assistant';
    const targetName = target?.name || 'Tech';
    const title = `Schedule ${action}`;
    const body = `${actorName} ${action.toLowerCase()} a shift for ${targetName} on ${shift.shift_date} (${shift.start_time} - ${shift.end_time}).`;

    await Promise.all(
      admins.map((adminUser) =>
        createNotification(req.user.shop_id, adminUser.id, 'schedule_audit', title, body)
      )
    );
  } catch {
    // Best-effort audit notification.
  }
}

router.get('/', auth, async (req, res) => {
  try {
    const { week, user_id, from, to } = req.query;
    const isAdmin = ['owner', 'admin', 'assistant'].includes(req.user.role);

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

    if (from && to) {
      sql += ` AND shift_date >= $${paramIdx++} AND shift_date <= $${paramIdx++}`;
      params.push(from, to);
    } else if (week) {
      const d = new Date(week);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fromDate = monday.toISOString().slice(0, 10);
      const toDate   = sunday.toISOString().slice(0, 10);
      sql += ` AND shift_date >= $${paramIdx++} AND shift_date <= $${paramIdx++}`;
      params.push(fromDate, toDate);
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
    const shiftToday = await dbGet(
      'SELECT * FROM schedules WHERE shop_id = $1 AND user_id = $2 AND shift_date = $3 LIMIT 1',
      [req.user.shop_id, req.user.id, today]
    );
    if (shiftToday) {
      return res.json({ shift: await enrich(shiftToday) });
    }

    const yesterday = addDaysIso(today, -1);
    const carryover = await dbGet(
      'SELECT * FROM schedules WHERE shop_id = $1 AND user_id = $2 AND shift_date = $3 LIMIT 1',
      [req.user.shop_id, req.user.id, yesterday]
    );
    if (carryover && isOvernightShift(carryover.start_time, carryover.end_time)) {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const endMinutes = parseTimeToMinutes(carryover.end_time);
      if (endMinutes != null && nowMinutes <= endMinutes) {
        return res.json({ shift: await enrich(carryover) });
      }
    }

    res.json({ shift: null });
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
    const { user_id, shift_date, start_time, end_time, notes, lunch_break_minutes } = req.body;
    if (!user_id || !shift_date || !start_time || !end_time)
      return res.status(400).json({ error: 'user_id, shift_date, start_time, end_time required' });
    const startMinutes = parseTimeToMinutes(start_time);
    const endMinutes = parseTimeToMinutes(end_time);
    if (startMinutes == null || endMinutes == null) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:MM.' });
    }
    if (startMinutes === endMinutes) {
      return res.status(400).json({ error: 'Start and end time cannot be the same.' });
    }

    const exists = await dbGet(
      'SELECT id FROM schedules WHERE shop_id = $1 AND user_id = $2 AND shift_date = $3',
      [req.user.shop_id, user_id, shift_date]
    );
    if (exists) return res.status(409).json({ error: 'This tech already has a shift on that day' });
    const employee = await dbGet('SELECT id FROM users WHERE id = $1 AND shop_id = $2', [user_id, req.user.shop_id]);
    if (!employee) return res.status(400).json({ error: 'Invalid user_id for this shop' });

    const id = uuidv4();
    const lunchMins = lunch_break_minutes != null ? parseInt(lunch_break_minutes, 10) : 30;
    await dbRun(
      'INSERT INTO schedules (id, shop_id, user_id, shift_date, start_time, end_time, notes, lunch_break_minutes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, req.user.shop_id, user_id, shift_date, start_time, end_time, notes || null, lunchMins]
    );
    const createdShift = await dbGet('SELECT * FROM schedules WHERE id = $1', [id]);
    await notifyAdminsIfAssistantAction(req, 'Created', createdShift);
    res.status(201).json({ shift: await enrich(createdShift) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const shift = await dbGet('SELECT * FROM schedules WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const ALLOWED_SCHEDULE_FIELDS = ['day_of_week','shift_start','shift_end','start_time','end_time','notes','lunch_break_minutes'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_SCHEDULE_FIELDS.includes(k)));
    if (updates.shift_start !== undefined && updates.start_time === undefined) updates.start_time = updates.shift_start;
    if (updates.shift_end !== undefined && updates.end_time === undefined) updates.end_time = updates.shift_end;
    delete updates.shift_start;
    delete updates.shift_end;
    delete updates.day_of_week;

    const nextStartTime = updates.start_time !== undefined ? updates.start_time : shift.start_time;
    const nextEndTime = updates.end_time !== undefined ? updates.end_time : shift.end_time;
    const startMinutes = parseTimeToMinutes(nextStartTime);
    const endMinutes = parseTimeToMinutes(nextEndTime);
    if (startMinutes == null || endMinutes == null) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:MM.' });
    }
    if (startMinutes === endMinutes) {
      return res.status(400).json({ error: 'Start and end time cannot be the same.' });
    }

    updates.updated_at = new Date().toISOString();

    const updateKeys = Object.keys(updates);
    if (!updateKeys.length) return res.json({ shift: await enrich(shift) });
    const updateVals = Object.values(updates);
    const set = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await dbRun(`UPDATE schedules SET ${set} WHERE id = $${updateKeys.length + 1}`, [...updateVals, req.params.id]);

    const updatedShift = await dbGet('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    await notifyAdminsIfAssistantAction(req, 'Updated', updatedShift);
    res.json({ shift: await enrich(updatedShift) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const shift = await dbGet('SELECT * FROM schedules WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    await dbRun('DELETE FROM schedules WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    await notifyAdminsIfAssistantAction(req, 'Removed', shift);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
