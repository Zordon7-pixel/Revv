const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { calculateProfit } = require('../services/profit');
const { sendSMS, isConfigured } = require('../services/sms');
const { getStatusMessage } = require('../services/notifications');
const { v4: uuidv4 } = require('uuid');

const STATUSES = ['intake','estimate','approval','parts','repair','paint','qc','delivery','closed'];

// Enrich RO with vehicle + customer + assigned tech
function enrichRO(ro) {
  if (!ro) return null;
  const vehicle  = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(ro.vehicle_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(ro.customer_id);
  const log      = db.prepare('SELECT * FROM job_status_log WHERE ro_id = ? ORDER BY created_at ASC').all(ro.id);
  const parts    = db.prepare('SELECT * FROM parts_orders WHERE ro_id = ? ORDER BY created_at ASC').all(ro.id);
  const profit   = calculateProfit(ro);
  const assigned_tech = ro.assigned_to
    ? db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(ro.assigned_to)
    : null;
  // Portal access flag — lets UI show "Generate Login" or "Reset Password"
  if (customer) {
    const portalUser = db.prepare('SELECT id FROM users WHERE customer_id = ? AND shop_id = ?').get(customer.id, ro.shop_id);
    customer.has_portal_access = !!portalUser;
  }
  return { ...ro, vehicle, customer, log, parts, profit, assigned_tech };
}

// GET all ROs for shop
router.get('/', auth, (req, res) => {
  const ros = db.prepare(`
    SELECT ro.*, v.year, v.make, v.model, v.color, c.name as customer_name, c.phone as customer_phone
    FROM repair_orders ro
    LEFT JOIN vehicles v ON v.id = ro.vehicle_id
    LEFT JOIN customers c ON c.id = ro.customer_id
    WHERE ro.shop_id = ?
    ORDER BY ro.created_at DESC
  `).all(req.user.shop_id);
  res.json({ ros });
});

// GET single RO
router.get('/:id', auth, (req, res) => {
  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'Not found' });
  res.json(enrichRO(ro));
});

// GET invoice data for a single RO
router.get('/:id/invoice', auth, (req, res) => {
  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'Not found' });
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(ro.shop_id);
  res.json({ ...enrichRO(ro), shop });
});

// POST create RO
router.post('/', auth, (req, res) => {
  const { customer_id, vehicle_id, job_type, payment_type, claim_number, insurer, adjuster_name, adjuster_phone, deductible, notes, estimated_delivery } = req.body;
  const count = db.prepare('SELECT COUNT(*) as n FROM repair_orders WHERE shop_id = ?').get(req.user.shop_id);
  const roNumber = `RO-2026-${String(count.n + 1).padStart(4, '0')}`;
  const id = uuidv4();
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO repair_orders (id, shop_id, ro_number, vehicle_id, customer_id, job_type, status, payment_type, claim_number, insurer, adjuster_name, adjuster_phone, deductible, intake_date, estimated_delivery, notes)
    VALUES (?, ?, ?, ?, ?, ?, 'intake', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.shop_id, roNumber, vehicle_id, customer_id, job_type || 'collision', payment_type || 'insurance', claim_number || null, insurer || null, adjuster_name || null, adjuster_phone || null, deductible || 0, today, estimated_delivery || null, notes || null);
  db.prepare(`INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?, ?)`).run(uuidv4(), id, null, 'intake', req.user.id);
  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(id);
  res.status(201).json(enrichRO(ro));
});

// PUT update RO fields
router.put('/:id', auth, (req, res) => {
  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'Not found' });
  const ALLOWED_RO_FIELDS = ['status','notes','tech_notes','assigned_to','estimate_amount','actual_amount','updated_at','insurance_company','adjuster_name','adjuster_phone','claim_number','deductible','auth_number','job_type','payment_type','insurer','adjuster_email','estimated_delivery','parts_cost','labor_cost','sublet_cost','tax','total','deductible_waived','referral_fee','goodwill_repair_cost'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_RO_FIELDS.includes(k)));
  if (Object.keys(updates).length > 0) {
    const profit = calculateProfit({ ...ro, ...updates });
    updates.true_profit = profit.trueProfit;
    updates.updated_at = new Date().toISOString();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE repair_orders SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);
  }
  res.json(enrichRO(db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(req.params.id)));
});

// PUT status transition
router.put('/:id/status', auth, (req, res) => {
  const { status, note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'Not found' });
  const fromStatus = ro.status;
  const extra = status === 'delivery' ? { actual_delivery: new Date().toISOString().split('T')[0] } : {};
  db.prepare(`UPDATE repair_orders SET status = ?, updated_at = ?, ${Object.keys(extra).map(k => k + ' = ?').join(', ') || 'notes = notes'} WHERE id = ?`).run(status, new Date().toISOString(), ...Object.values(extra), req.params.id);
  db.prepare(`INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?, ?)`).run(uuidv4(), req.params.id, fromStatus, status, req.user.id, note || null);

  const updatedRO = db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(req.params.id);
  res.json(enrichRO(updatedRO));

  setImmediate(async () => {
    try {
      const smsContext = db.prepare(`
        SELECT ro.status, c.phone AS customer_phone, v.year, v.make, v.model, s.name AS shop_name
        FROM repair_orders ro
        LEFT JOIN customers c ON c.id = ro.customer_id
        LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        LEFT JOIN shops s ON s.id = ro.shop_id
        WHERE ro.id = ? AND ro.shop_id = ?
      `).get(req.params.id, req.user.shop_id);

      if (!smsContext?.customer_phone) {
        console.log(`[SMS] Skipped RO ${req.params.id}: customer phone missing`);
        return;
      }
      if (!isConfigured()) {
        console.log(`[SMS] Skipped RO ${req.params.id}: Twilio not configured`);
        return;
      }

      const message = getStatusMessage(
        smsContext.status,
        smsContext.shop_name,
        smsContext.year,
        smsContext.make,
        smsContext.model
      );

      if (!message) {
        console.log(`[SMS] Skipped RO ${req.params.id}: no template for status ${smsContext.status}`);
        return;
      }

      const result = await sendSMS(smsContext.customer_phone, message);
      if (!result.ok) {
        console.error(`[SMS] Failed for RO ${req.params.id}`);
      } else {
        console.log(`[SMS] Sent RO status update for ${req.params.id}`);
      }
    } catch (err) {
      console.error(`[SMS] Unexpected error for RO ${req.params.id}:`, err.message);
    }
  });
});

// PATCH assign tech to RO (admin/owner only)
router.patch('/:id/assign', auth, requireAdmin, (req, res) => {
  const { user_id } = req.body;
  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE repair_orders SET assigned_to = ?, updated_at = ? WHERE id = ?')
    .run(user_id || null, new Date().toISOString(), req.params.id);
  res.json(enrichRO(db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(req.params.id)));
});

// PATCH RO — status transition OR general field update (tech_notes, etc.)
router.patch('/:id', auth, (req, res) => {
  const { status, note, ...otherFields } = req.body || {};

  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.id, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'Not found' });

  if (!status) {
    // General field update
    const ALLOWED_PATCH_FIELDS = ['tech_notes'];
    const updates = Object.fromEntries(Object.entries(otherFields).filter(([k]) => ALLOWED_PATCH_FIELDS.includes(k)));
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    updates.updated_at = new Date().toISOString();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE repair_orders SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);
    return res.json(enrichRO(db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(req.params.id)));
  }

  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const fromStatus = ro.status;
  const extra = status === 'delivery' ? { actual_delivery: new Date().toISOString().split('T')[0] } : {};
  db.prepare(`UPDATE repair_orders SET status = ?, updated_at = ?, ${Object.keys(extra).map(k => k + ' = ?').join(', ') || 'notes = notes'} WHERE id = ?`).run(status, new Date().toISOString(), ...Object.values(extra), req.params.id);
  db.prepare(`INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?, ?)`).run(uuidv4(), req.params.id, fromStatus, status, req.user.id, note || null);

  const updatedRO = db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(req.params.id);
  res.json(enrichRO(updatedRO));

  setImmediate(async () => {
    try {
      const smsContext = db.prepare(`
        SELECT ro.status, c.phone AS customer_phone, v.year, v.make, v.model, s.name AS shop_name
        FROM repair_orders ro
        LEFT JOIN customers c ON c.id = ro.customer_id
        LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        LEFT JOIN shops s ON s.id = ro.shop_id
        WHERE ro.id = ? AND ro.shop_id = ?
      `).get(req.params.id, req.user.shop_id);

      if (!smsContext?.customer_phone) {
        console.log(`[SMS] Skipped RO ${req.params.id}: customer phone missing`);
        return;
      }
      if (!isConfigured()) {
        console.log(`[SMS] Skipped RO ${req.params.id}: Twilio not configured`);
        return;
      }

      const message = getStatusMessage(
        smsContext.status,
        smsContext.shop_name,
        smsContext.year,
        smsContext.make,
        smsContext.model
      );

      if (!message) {
        console.log(`[SMS] Skipped RO ${req.params.id}: no template for status ${smsContext.status}`);
        return;
      }

      const result = await sendSMS(smsContext.customer_phone, message);
      if (!result.ok) {
        console.error(`[SMS] Failed for RO ${req.params.id}`);
      } else {
        console.log(`[SMS] Sent RO status update for ${req.params.id}`);
      }
    } catch (err) {
      console.error(`[SMS] Unexpected error for RO ${req.params.id}:`, err.message);
    }
  });
});

// DELETE RO
router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM repair_orders WHERE id = ? AND shop_id = ?').run(req.params.id, req.user.shop_id);
  res.json({ ok: true });
});

module.exports = router;
