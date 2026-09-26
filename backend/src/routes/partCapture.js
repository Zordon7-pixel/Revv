const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');
const { extractLabel, createCatalogLookup, partNumber, clean, normalizeNumber } = require('../services/partCapture');
const { findStock } = require('../services/stockCapture');

function createPartCaptureRouter({ database = pool, extract = extractLabel, lookup = createCatalogLookup(), env = process.env } = {}) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0 } }).single('photo');
  router.use(auth, requireTechnician, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user.shop_id) return res.status(403).json({ error: 'Shop access required.' });
    next();
  });
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, keyGenerator: (req) => `${req.user.shop_id}:${req.user.id}`, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many lookups. Please try again in a few minutes.' } }));
  router.get('/capabilities', (req, res) => res.json({ photo_reading: !!env.OPENAI_API_KEY, external_catalog: !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) }));
  router.post('/extract', (req, res) => upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Choose a photo under 4MB.' : 'Upload one JPEG, PNG or WebP photo.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a label photo.' });
    try { return res.json(await extract(req.file.buffer)); }
    catch (error) { const expected = error.publicMessage === true && [400, 422, 503].includes(error.status); return res.status(expected ? error.status : 502).json({ error: expected ? error.message : 'Photo reading is temporarily unavailable. Enter the number or try again.' }); }
  }));
  router.get('/lookup', async (req, res) => {
    try {
      const number = partNumber(req.query.part_number), brand = clean(req.query.brand, 100);
      const stock = await findStock(database, req.user.shop_id, number);
      const catalog = req.query.external === 'true' ? await lookup(number, brand) : { status: 'not_requested', candidates: [] };
      res.json({ part_number: number, brand, stock: stock.map((item) => ({ ...item,
        brand_match: !brand || !item.brand ? 'unconfirmed' : normalizeNumber(brand) === normalizeNumber(item.brand) ? 'match' : 'different',
      })), catalog });
    } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not look up this part.' }); }
  });
  return router;
}
module.exports = createPartCaptureRouter();
module.exports.createPartCaptureRouter = createPartCaptureRouter;
