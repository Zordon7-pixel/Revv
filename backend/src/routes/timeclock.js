const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const bcrypt = require('bcryptjs');
const sms = require('../services/sms');
const { randomUUID } = require('crypto');

// Haversine distance in km between two lat/lng points
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

async function enrich(entry) {
  if (!entry) return null;
  const user = await dbGet('SELECT id, name, email, role FROM users WHERE id = $1', [entry.user_id]);
  return { ...entry, user };
}

function formatTime12(hour24, minute) {
  const d = new Date();
  d.setHours(hour24, minute, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function parseShiftTimeToDate(now, shiftStart) {
  if (!shiftStart || !shiftStart.includes(':')) return null;
  const [h, m] = shiftStart.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const dt = new Date(now);
  dt.setHours(h, m, 0, 0);
  return dt;
}

async function getTodaySchedule(shopId, userId, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const byDate = await dbGet(
    'SELECT * FROM schedules WHERE shop_id = $1 AND user_id = $2 AND shift_date = $3 LIMIT 1',
    [shopId, userId, today]
  );
  if (byDate) {
    return { shiftStart: byDate.start_time, shiftEnd: byDate.end_time, source: 'shift_date', row: byDate };
  }
  return null;
}

async function checkGeofence(shopId, lat, lng) {
  const shop = await dbGet('SELECT lat, lng, geofence_radius FROM shops WHERE id = $1', [shopId]);
  if (!shop || shop.lat == null || shop.lng == null) return null;
  const dist = distanceKm(lat, lng, shop.lat, shop.lng);
  const radiusKm = shop.geofence_radius || 0.5;
  if (dist > radiusKm) {
    const feet = Math.round(dist * 3281);
    const limit = Math.round(radiusKm * 3281);
    return `You are ${feet} ft from the shop. Must be within ${limit} ft to clock in or out.`;
  }
  return null;
}

async function checkSchedule(shopId, userId, nowIso) {
  const schedule = await getTodaySchedule(shopId, userId, new Date(nowIso));
  if (!schedule?.shiftStart) return { scheduled_start: null, is_late: 0, late_minutes: 0 };

  const now = new Date(nowIso);
  const scheduledStartDate = parseShiftTimeToDate(now, schedule.shiftStart);
  if (!scheduledStartDate) return { scheduled_start: schedule.shiftStart, is_late: 0, late_minutes: 0 };

  const scheduledMs = scheduledStartDate.getTime();
  const nowMs = now.getTime();
  const GRACE_MS = 15 * 60 * 1000;

  if (nowMs <= scheduledMs + GRACE_MS) {
    return { scheduled_start: schedule.shiftStart, is_late: 0, late_minutes: 0 };
  }

  const lateMin = Math.round((nowMs - scheduledMs) / 60000);
  return { scheduled_start: schedule.shiftStart, is_late: 1, late_minutes: lateMin };
}

function awaitPromiseSafe(p) {
  if (!p || typeof p.then !== 'function') return;
  p.catch((err) => {
    console.error('[timeclock] async sms send failed:', err?.message || err);
  });
}

async function handleClockIn(req, res) {
  try {
    const { lat, lng } = req.body;

    if (lat != null && lng != null) {
      const fenceErr = await checkGeofence(req.user.shop_id, lat, lng);
      if (fenceErr) return res.status(403).json({ error: fenceErr });
    }

    const open = await dbGet(
      'SELECT id FROM time_entries WHERE shop_id = $1 AND user_id = $2 AND clock_out IS NULL LIMIT 1',
      [req.user.shop_id, req.user.id]
    );
    if (open) return res.status(409).json({ error: 'Already clocked in.' });

    const now = new Date();
    const nowIso = now.toISOString();
    const today = nowIso.slice(0, 10);

    const schedule = await getTodaySchedule(req.user.shop_id, req.user.id, now);
    let earlyAuth = null;
    if (schedule?.shiftStart) {
      const shiftStartDate = parseShiftTimeToDate(now, schedule.shiftStart);
      if (shiftStartDate) {
        const earlyDiffMs = shiftStartDate.getTime() - now.getTime();
        const TEN_MIN_MS = 10 * 60 * 1000;

        if (earlyDiffMs > TEN_MIN_MS) {
          earlyAuth = await dbGet(`
            SELECT id FROM early_clockin_authorizations
            WHERE shop_id = $1 AND employee_id = $2 AND date = $3 AND used = 0
            ORDER BY created_at DESC
            LIMIT 1
          `, [req.user.shop_id, req.user.id, today]);

          if (!earlyAuth) {
            const shiftStart = formatTime12(shiftStartDate.getHours(), shiftStartDate.getMinutes());
            return res.status(403).json({
              error: 'early',
              message: `Your shift doesn't start until ${shiftStart}. Clock-in is not authorized yet.`,
              shiftStart,
            });
          }
        }
      }
    }

    const { scheduled_start, is_late, late_minutes } = await checkSchedule(req.user.shop_id, req.user.id, nowIso);

    const id = randomUUID();
    await dbRun(`
      INSERT INTO time_entries (id, shop_id, user_id, clock_in, clock_in_lat, clock_in_lng, scheduled_start, is_late, late_minutes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [id, req.user.shop_id, req.user.id, nowIso, lat || null, lng || null, scheduled_start, is_late ? 1 : 0, late_minutes]);

    if (earlyAuth?.id) {
      await dbRun('UPDATE early_clockin_authorizations SET used = 1 WHERE id = $1', [earlyAuth.id]);
    }

    const entry = await dbGet('SELECT * FROM time_entries WHERE id = $1', [id]);

    try {
      if (schedule?.shiftStart) {
        const shiftStartDate = parseShiftTimeToDate(now, schedule.shiftStart);
        if (shiftStartDate) {
          const lateByMin = Math.round((now.getTime() - shiftStartDate.getTime()) / 60000);
          if (lateByMin > 15) {
            const admin = await dbGet(
              "SELECT id, name, phone FROM users WHERE shop_id = $1 AND role = 'admin' ORDER BY created_at ASC LIMIT 1",
              [req.user.shop_id]
            );
            if (admin?.phone) {
              const employee = await dbGet('SELECT name FROM users WHERE id = $1', [req.user.id]);
              const clockInStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
              const shiftStartStr = formatTime12(shiftStartDate.getHours(), shiftStartDate.getMinutes());
              const message = `Late Clock-In Alert: ${employee?.name || 'Employee'} clocked in at ${clockInStr}, ${lateByMin} minutes late for their ${shiftStartStr} shift.`;
              awaitPromiseSafe(sms.sendSMS(admin.phone, message));
            }
          }
        }
      }
    } catch (err) {
      console.error('[timeclock] late clock-in sms failed:', err.message);
    }

    return res.status(201).json({ entry: await enrich(entry), is_late, late_minutes, scheduled_start });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

router.get('/status', auth, async (req, res) => {
  try {
    const open = await dbGet(
      'SELECT * FROM time_entries WHERE shop_id = $1 AND user_id = $2 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
      [req.user.shop_id, req.user.id]
    );
    res.json({ clocked_in: !!open, entry: open || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/in', auth, handleClockIn);
router.post('/clock-in', auth, handleClockIn);

router.post('/authorize-early', auth, async (req, res) => {
  try {
    const { employee_id, admin_password } = req.body || {};
    if (!employee_id || !admin_password) {
      return res.status(400).json({ error: 'employee_id and admin_password required' });
    }

    const admin = await dbGet(
      "SELECT id, password_hash FROM users WHERE shop_id = $1 AND role = 'admin' ORDER BY created_at ASC LIMIT 1",
      [req.user.shop_id]
    );
    if (!admin?.password_hash) {
      return res.status(401).json({ error: 'invalid_password', message: 'Incorrect admin password' });
    }

    const valid = await bcrypt.compare(admin_password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid_password', message: 'Incorrect admin password' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const existing = await dbGet(`
      SELECT id FROM early_clockin_authorizations
      WHERE shop_id = $1 AND employee_id = $2 AND date = $3 AND used = 0
      LIMIT 1
    `, [req.user.shop_id, employee_id, today]);

    if (!existing) {
      await dbRun(`
        INSERT INTO early_clockin_authorizations (id, shop_id, employee_id, date, authorized_by, used)
        VALUES ($1, $2, $3, $4, $5, 0)
      `, [randomUUID(), req.user.shop_id, employee_id, today, admin.id]);
    }

    return res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/early-auth-status/:employeeId', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const row = await dbGet(`
      SELECT id FROM early_clockin_authorizations
      WHERE shop_id = $1 AND employee_id = $2 AND date = $3 AND used = 0
      LIMIT 1
    `, [req.user.shop_id, req.params.employeeId, today]);
    res.json({ authorized: !!row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/out', auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (lat != null && lng != null) {
      const fenceErr = await checkGeofence(req.user.shop_id, lat, lng);
      if (fenceErr) return res.status(403).json({ error: fenceErr });
    }

    const open = await dbGet(
      'SELECT * FROM time_entries WHERE shop_id = $1 AND user_id = $2 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
      [req.user.shop_id, req.user.id]
    );
    if (!open) return res.status(409).json({ error: 'Not currently clocked in.' });

    const nowIso = new Date().toISOString();
    const totalHours = (new Date(nowIso) - new Date(open.clock_in)) / 3600000;

    await dbRun(`
      UPDATE time_entries
      SET clock_out = $1, clock_out_lat = $2, clock_out_lng = $3, total_hours = $4, updated_at = $5
      WHERE id = $6
    `, [nowIso, lat || null, lng || null, +totalHours.toFixed(4), nowIso, open.id]);

    const entry = await dbGet('SELECT * FROM time_entries WHERE id = $1', [open.id]);
    res.json({ entry: await enrich(entry), total_hours: totalHours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/entries', auth, async (req, res) => {
  try {
    const { user_id, date_from, date_to } = req.query;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);

    let sql = 'SELECT * FROM time_entries WHERE shop_id = $1';
    const params = [req.user.shop_id];
    let paramIdx = 2;

    if (!isAdmin) {
      sql += ` AND user_id = $${paramIdx++}`;
      params.push(req.user.id);
    } else if (user_id) {
      sql += ` AND user_id = $${paramIdx++}`;
      params.push(user_id);
    }

    if (date_from) { sql += ` AND clock_in >= $${paramIdx++}`; params.push(date_from); }
    if (date_to)   { sql += ` AND clock_in <= $${paramIdx++}`; params.push(date_to + 'T23:59:59'); }

    sql += ' ORDER BY clock_in DESC LIMIT 200';
    const entries = await dbAll(sql, params);
    res.json({ entries: await Promise.all(entries.map(enrich)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const entry = await dbGet('SELECT * FROM time_entries WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    const ALLOWED_TIMECLOCK_FIELDS = ['clock_in','clock_out','notes'];
    const bodyUpdates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_TIMECLOCK_FIELDS.includes(k)));
    if (bodyUpdates.notes !== undefined && bodyUpdates.admin_note === undefined) {
      bodyUpdates.admin_note = bodyUpdates.notes;
    }
    delete bodyUpdates.notes;

    const updates = { updated_at: new Date().toISOString(), adjusted_by: req.user.id };

    if (bodyUpdates.clock_in  != null) updates.clock_in  = bodyUpdates.clock_in;
    if (bodyUpdates.clock_out != null) updates.clock_out = bodyUpdates.clock_out;
    if (bodyUpdates.admin_note != null) updates.admin_note = bodyUpdates.admin_note;

    const newIn  = bodyUpdates.clock_in  || entry.clock_in;
    const newOut = bodyUpdates.clock_out || entry.clock_out;
    if (newIn && newOut) {
      updates.total_hours = +((new Date(newOut) - new Date(newIn)) / 3600000).toFixed(4);
    }

    const updateKeys = Object.keys(updates);
    const updateVals = Object.values(updates);
    const setClauses = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await dbRun(`UPDATE time_entries SET ${setClauses} WHERE id = $${updateKeys.length + 1}`, [...updateVals, req.params.id]);

    res.json({ entry: await enrich(await dbGet('SELECT * FROM time_entries WHERE id = $1', [req.params.id])) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM time_entries WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
