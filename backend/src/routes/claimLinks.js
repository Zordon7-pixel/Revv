const express = require('express');
const router = express.Router();
const { dbGet, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/assessments');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/:roId', auth, async (req, res) => {
  try {
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.roId, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'RO not found' });

    const existing = await dbGet('SELECT * FROM claim_links WHERE ro_id = $1 AND submitted_at IS NULL', [req.params.roId]);
    if (existing) return res.json({ token: existing.token, url: `/claim/${existing.token}` });

    const token = uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await dbRun(
      'INSERT INTO claim_links (id, shop_id, ro_id, token, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), req.user.shop_id, req.params.roId, token, req.user.id, expiresAt]
    );
    res.json({ token, url: `/claim/${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/view/:token', async (req, res) => {
  try {
    const link = await dbGet('SELECT * FROM claim_links WHERE token = $1', [req.params.token]);
    if (!link) return res.status(404).json({ error: 'Link not found or expired' });
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [link.ro_id]);
    const vehicle = ro ? await dbGet('SELECT * FROM vehicles WHERE id = $1', [ro.vehicle_id]) : null;
    const customer = ro ? await dbGet('SELECT name, phone, email FROM customers WHERE id = $1', [ro.customer_id]) : null;
    const shop = await dbGet('SELECT name, phone, address, city, state FROM shops WHERE id = $1', [link.shop_id]);
    res.json({ link, ro, vehicle, customer, shop });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:token', async (req, res, next) => {
  if (req.params.token === 'ro') return next();
  try {
    const link = await dbGet('SELECT * FROM claim_links WHERE token = $1', [req.params.token]);
    if (!link) return res.status(404).json({ error: 'Link not found or expired' });
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [link.ro_id]);
    const vehicle = ro ? await dbGet('SELECT * FROM vehicles WHERE id = $1', [ro.vehicle_id]) : null;
    const customer = ro ? await dbGet('SELECT name, phone, email FROM customers WHERE id = $1', [ro.customer_id]) : null;
    const shop = await dbGet('SELECT name, phone, address, city, state FROM shops WHERE id = $1', [link.shop_id]);
    res.json({ link, ro, vehicle, customer, shop });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/view/:token/submit', upload.single('assessment'), async (req, res) => {
  try {
    const link = await dbGet('SELECT * FROM claim_links WHERE token = $1', [req.params.token]);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.submitted_at) return res.status(400).json({ error: 'Already submitted' });

    const { adjustor_name, adjustor_company, adjustor_email, approved_labor, approved_parts, supplement_amount, adjustor_notes } = req.body;
    const filename = req.file ? req.file.filename : null;

    await dbRun(`
      UPDATE claim_links SET
        adjustor_name = $1, adjustor_company = $2, adjustor_email = $3,
        approved_labor = $4, approved_parts = $5, supplement_amount = $6,
        adjustor_notes = $7, assessment_filename = $8, submitted_at = NOW()
      WHERE token = $9
    `, [
      adjustor_name || null, adjustor_company || null, adjustor_email || null,
      Number.isFinite(parseFloat(approved_labor)) ? parseFloat(approved_labor) : null,
      Number.isFinite(parseFloat(approved_parts)) ? parseFloat(approved_parts) : null,
      Number.isFinite(parseFloat(supplement_amount)) ? parseFloat(supplement_amount) : null,
      adjustor_notes || null, filename, req.params.token
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:token/submit', upload.single('assessment'), async (req, res) => {
  try {
    const link = await dbGet('SELECT * FROM claim_links WHERE token = $1', [req.params.token]);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.submitted_at) return res.status(400).json({ error: 'Already submitted' });

    const { adjustor_name, adjustor_company, adjustor_email, approved_labor, approved_parts, supplement_amount, adjustor_notes } = req.body;
    const filename = req.file ? req.file.filename : null;

    await dbRun(`
      UPDATE claim_links SET
        adjustor_name = $1, adjustor_company = $2, adjustor_email = $3,
        approved_labor = $4, approved_parts = $5, supplement_amount = $6,
        adjustor_notes = $7, assessment_filename = $8, submitted_at = NOW()
      WHERE token = $9
    `, [
      adjustor_name || null, adjustor_company || null, adjustor_email || null,
      Number.isFinite(parseFloat(approved_labor)) ? parseFloat(approved_labor) : null,
      Number.isFinite(parseFloat(approved_parts)) ? parseFloat(approved_parts) : null,
      Number.isFinite(parseFloat(supplement_amount)) ? parseFloat(supplement_amount) : null,
      adjustor_notes || null, filename, req.params.token
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ro/:roId', auth, async (req, res) => {
  try {
    const link = await dbGet('SELECT * FROM claim_links WHERE ro_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.roId]);
    res.json(link || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
