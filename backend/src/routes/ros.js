const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { calculateProfit } = require('../services/profit');
const { v4: uuidv4 } = require('uuid');

const STATUSES = ['intake','estimate','approval','parts','repair','paint','qc','delivery','closed'];

// Enrich RO with vehicle + customer
function enrichRO(ro) {
  if (!ro) return null;
  const vehicle  = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(ro.vehicle_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(ro.customer_id);
  const log      = db.prepare('SELECT * FROM job_status_log WHERE ro_id = ? ORDER BY created_at ASC').all(ro.id);
  const parts    = db.prepare('SELECT * FROM parts_orders WHERE ro_id = ? ORDER BY created_at ASC').all(ro.id);
  const profit   = calculateProfit(ro);
  return { ...ro, vehicle, customer, log, parts, profit };
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
  const fields = ['job_type','payment_type','claim_number','insurer','adjuster_name','adjuster_phone','adjuster_email','deductible','estimated_delivery','parts_cost','labor_cost','sublet_cost','tax','total','deductible_waived','referral_fee','goodwill_repair_cost','notes'];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
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
  res.json(enrichRO(db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(req.params.id)));
});

// DELETE RO
router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM repair_orders WHERE id = ? AND shop_id = ?').run(req.params.id, req.user.shop_id);
  res.json({ ok: true });
});

module.exports = router;
