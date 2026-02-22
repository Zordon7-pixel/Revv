const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { v4: uuidv4 } = require('uuid');

// Haversine distance in km between two lat/lng points
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Enrich a time_entry with user info
function enrich(entry) {
  if (!entry) return null;
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(entry.user_id);
  return { ...entry, user };
}

// Validate that employee is within shop geofence
// Returns null if OK, or an error string if blocked
function checkGeofence(shopId, lat, lng) {
  const shop = db.prepare('SELECT lat, lng, geofence_radius FROM shops WHERE id = ?').get(shopId);
  if (!shop || shop.lat == null || shop.lng == null) return null; // geofence not configured — allow
  const dist = distanceKm(lat, lng, shop.lat, shop.lng);
  const radiusKm = shop.geofence_radius || 0.5;
  if (dist > radiusKm) {
    const feet = Math.round(dist * 3281);
    const limit = Math.round(radiusKm * 3281);
    return `You are ${feet} ft from the shop. Must be within ${limit} ft to clock in or out.`;
  }
  return null;
}

// Find today's scheduled shift for a user and calculate late status
function checkSchedule(shopId, userId, nowIso) {
  const today = nowIso.slice(0, 10); // 'YYYY-MM-DD'
  const shift = db.prepare(
    'SELECT * FROM schedules WHERE shop_id = ? AND user_id = ? AND shift_date = ? LIMIT 1'
  ).get(shopId, userId, today);
  if (!shift) return { scheduled_start: null, is_late: 0, late_minutes: 0 };

  const scheduledStart = `${shift.shift_date}T${shift.start_time}:00`;
  const scheduledMs = new Date(scheduledStart).getTime();
  const nowMs = new Date(nowIso).getTime();
  const GRACE_MS = 15 * 60 * 1000; // 15 minutes

  if (nowMs <= scheduledMs + GRACE_MS) {
    return { scheduled_start: shift.start_time, is_late: 0, late_minutes: 0 };
  } else {
    const lateMin = Math.round((nowMs - scheduledMs) / 60000);
    return { scheduled_start: shift.start_time, is_late: 1, late_minutes: lateMin };
  }
}

// GET /api/timeclock/status — am I currently clocked in?
router.get('/status', auth, (req, res) => {
  const open = db.prepare(
    'SELECT * FROM time_entries WHERE shop_id = ? AND user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
  ).get(req.user.shop_id, req.user.id);
  res.json({ clocked_in: !!open, entry: open || null });
});

// POST /api/timeclock/in — clock in
router.post('/in', auth, (req, res) => {
  const { lat, lng } = req.body;

  // Check geofence
  if (lat != null && lng != null) {
    const fenceErr = checkGeofence(req.user.shop_id, lat, lng);
    if (fenceErr) return res.status(403).json({ error: fenceErr });
  }

  // Block double clock-in
  const open = db.prepare(
    'SELECT id FROM time_entries WHERE shop_id = ? AND user_id = ? AND clock_out IS NULL LIMIT 1'
  ).get(req.user.shop_id, req.user.id);
  if (open) return res.status(409).json({ error: 'Already clocked in.' });

  const nowIso = new Date().toISOString();
  const { scheduled_start, is_late, late_minutes } = checkSchedule(req.user.shop_id, req.user.id, nowIso);

  const id = uuidv4();
  db.prepare(`
    INSERT INTO time_entries (id, shop_id, user_id, clock_in, clock_in_lat, clock_in_lng, scheduled_start, is_late, late_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.shop_id, req.user.id, nowIso, lat || null, lng || null, scheduled_start, is_late ? 1 : 0, late_minutes);

  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  res.status(201).json({ entry: enrich(entry), is_late, late_minutes, scheduled_start });
});

// POST /api/timeclock/out — clock out
router.post('/out', auth, (req, res) => {
  const { lat, lng } = req.body;

  // Check geofence
  if (lat != null && lng != null) {
    const fenceErr = checkGeofence(req.user.shop_id, lat, lng);
    if (fenceErr) return res.status(403).json({ error: fenceErr });
  }

  const open = db.prepare(
    'SELECT * FROM time_entries WHERE shop_id = ? AND user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
  ).get(req.user.shop_id, req.user.id);
  if (!open) return res.status(409).json({ error: 'Not currently clocked in.' });

  const nowIso = new Date().toISOString();
  const totalHours = (new Date(nowIso) - new Date(open.clock_in)) / 3600000;

  db.prepare(`
    UPDATE time_entries
    SET clock_out = ?, clock_out_lat = ?, clock_out_lng = ?, total_hours = ?, updated_at = ?
    WHERE id = ?
  `).run(nowIso, lat || null, lng || null, +totalHours.toFixed(4), nowIso, open.id);

  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(open.id);
  res.json({ entry: enrich(entry), total_hours: totalHours });
});

// GET /api/timeclock/entries?user_id=&date_from=&date_to=
// Admin: all employees. Employee: own only.
router.get('/entries', auth, (req, res) => {
  const { user_id, date_from, date_to } = req.query;
  const isAdmin = ['owner', 'admin'].includes(req.user.role);

  let sql = 'SELECT * FROM time_entries WHERE shop_id = ?';
  const params = [req.user.shop_id];

  if (!isAdmin) {
    // Employees can only see their own entries
    sql += ' AND user_id = ?';
    params.push(req.user.id);
  } else if (user_id) {
    sql += ' AND user_id = ?';
    params.push(user_id);
  }

  if (date_from) { sql += ' AND clock_in >= ?'; params.push(date_from); }
  if (date_to)   { sql += ' AND clock_in <= ?'; params.push(date_to + 'T23:59:59'); }

  sql += ' ORDER BY clock_in DESC LIMIT 200';
  const entries = db.prepare(sql).all(...params);
  res.json({ entries: entries.map(enrich) });
});

// PUT /api/timeclock/:id — admin only: adjust clock_in, clock_out, add note
router.put('/:id', auth, requireAdmin, (req, res) => {
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const { clock_in, clock_out, admin_note } = req.body;
  const updates = { updated_at: new Date().toISOString(), adjusted_by: req.user.id };

  if (clock_in  != null) updates.clock_in  = clock_in;
  if (clock_out != null) updates.clock_out = clock_out;
  if (admin_note != null) updates.admin_note = admin_note;

  // Recalculate total_hours
  const newIn  = clock_in  || entry.clock_in;
  const newOut = clock_out || entry.clock_out;
  if (newIn && newOut) {
    updates.total_hours = +((new Date(newOut) - new Date(newIn)) / 3600000).toFixed(4);
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE time_entries SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);

  res.json({ entry: enrich(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id)) });
});

// DELETE /api/timeclock/:id — admin only
router.delete('/:id', auth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM time_entries WHERE id = ? AND shop_id = ?').run(req.params.id, req.user.shop_id);
  res.json({ ok: true });
});

module.exports = router;
