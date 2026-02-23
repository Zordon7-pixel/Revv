const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/assessments');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

// POST /api/claim-links/:roId — generate a share link (shop auth required)
router.post('/:roId', auth, (req, res) => {
  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ? AND shop_id = ?').get(req.params.roId, req.user.shop_id);
  if (!ro) return res.status(404).json({ error: 'RO not found' });

  const existing = db.prepare('SELECT * FROM claim_links WHERE ro_id = ? AND submitted_at IS NULL').get(req.params.roId);
  if (existing) return res.json({ token: existing.token, url: `/claim/${existing.token}` });

  const token = uuidv4().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO claim_links (id, shop_id, ro_id, token, created_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), req.user.shop_id, req.params.roId, token, req.user.id, expiresAt);

  res.json({ token, url: `/claim/${token}` });
});

// GET /api/claim-links/view/:token (also mounted on /api/claim-link) — public view
router.get('/view/:token', (req, res) => {
  const link = db.prepare('SELECT * FROM claim_links WHERE token = ?').get(req.params.token);
  if (!link) return res.status(404).json({ error: 'Link not found or expired' });

  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(link.ro_id);
  const vehicle = ro ? db.prepare('SELECT * FROM vehicles WHERE id = ?').get(ro.vehicle_id) : null;
  const customer = ro ? db.prepare('SELECT name, phone, email FROM customers WHERE id = ?').get(ro.customer_id) : null;
  const shop = db.prepare('SELECT name, phone, address, city, state FROM shops WHERE id = ?').get(link.shop_id);

  res.json({ link, ro, vehicle, customer, shop });
});

// Alias: GET /api/claim-link/:token — public view
router.get('/:token', (req, res, next) => {
  if (req.params.token === 'ro') return next();
  const link = db.prepare('SELECT * FROM claim_links WHERE token = ?').get(req.params.token);
  if (!link) return res.status(404).json({ error: 'Link not found or expired' });

  const ro = db.prepare('SELECT * FROM repair_orders WHERE id = ?').get(link.ro_id);
  const vehicle = ro ? db.prepare('SELECT * FROM vehicles WHERE id = ?').get(ro.vehicle_id) : null;
  const customer = ro ? db.prepare('SELECT name, phone, email FROM customers WHERE id = ?').get(ro.customer_id) : null;
  const shop = db.prepare('SELECT name, phone, address, city, state FROM shops WHERE id = ?').get(link.shop_id);

  res.json({ link, ro, vehicle, customer, shop });
});

// POST /api/claim-links/view/:token/submit (also mounted on /api/claim-link) — public submit
router.post('/view/:token/submit', upload.single('assessment'), (req, res) => {
  const link = db.prepare('SELECT * FROM claim_links WHERE token = ?').get(req.params.token);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  if (link.submitted_at) return res.status(400).json({ error: 'Already submitted' });

  const {
    adjustor_name,
    adjustor_company,
    adjustor_email,
    approved_labor,
    approved_parts,
    supplement_amount,
    adjustor_notes,
  } = req.body;

  const filename = req.file ? req.file.filename : null;

  db.prepare(`
    UPDATE claim_links SET
      adjustor_name = ?, adjustor_company = ?, adjustor_email = ?,
      approved_labor = ?, approved_parts = ?, supplement_amount = ?,
      adjustor_notes = ?, assessment_filename = ?, submitted_at = datetime('now')
    WHERE token = ?
  `).run(
    adjustor_name || null,
    adjustor_company || null,
    adjustor_email || null,
    Number.isFinite(parseFloat(approved_labor)) ? parseFloat(approved_labor) : null,
    Number.isFinite(parseFloat(approved_parts)) ? parseFloat(approved_parts) : null,
    Number.isFinite(parseFloat(supplement_amount)) ? parseFloat(supplement_amount) : null,
    adjustor_notes || null,
    filename,
    req.params.token
  );

  res.json({ ok: true });
});

// Alias: POST /api/claim-link/:token/submit — public submit
router.post('/:token/submit', upload.single('assessment'), (req, res) => {
  const link = db.prepare('SELECT * FROM claim_links WHERE token = ?').get(req.params.token);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  if (link.submitted_at) return res.status(400).json({ error: 'Already submitted' });

  const {
    adjustor_name,
    adjustor_company,
    adjustor_email,
    approved_labor,
    approved_parts,
    supplement_amount,
    adjustor_notes,
  } = req.body;

  const filename = req.file ? req.file.filename : null;

  db.prepare(`
    UPDATE claim_links SET
      adjustor_name = ?, adjustor_company = ?, adjustor_email = ?,
      approved_labor = ?, approved_parts = ?, supplement_amount = ?,
      adjustor_notes = ?, assessment_filename = ?, submitted_at = datetime('now')
    WHERE token = ?
  `).run(
    adjustor_name || null,
    adjustor_company || null,
    adjustor_email || null,
    Number.isFinite(parseFloat(approved_labor)) ? parseFloat(approved_labor) : null,
    Number.isFinite(parseFloat(approved_parts)) ? parseFloat(approved_parts) : null,
    Number.isFinite(parseFloat(supplement_amount)) ? parseFloat(supplement_amount) : null,
    adjustor_notes || null,
    filename,
    req.params.token
  );

  res.json({ ok: true });
});

// GET /api/claim-links/ro/:roId — get claim link status for an RO (shop auth)
router.get('/ro/:roId', auth, (req, res) => {
  const link = db.prepare('SELECT * FROM claim_links WHERE ro_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.roId);
  res.json(link || null);
});

module.exports = router;
