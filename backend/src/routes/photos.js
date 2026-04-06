const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_SIZE_MB = Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024));

async function analyzeDamagePhoto(filePath) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const imageData = fs.readFileSync(filePath);
    const base64Image = imageData.toString('base64');
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Image }
          },
          {
            type: 'text',
            text: 'You are an auto body damage assessor. Analyze this vehicle damage photo. Respond with JSON only, no markdown: {"severity":"minor|moderate|severe","zones":["affected body parts"],"description":"one sentence max"}'
          }
        ]
      }]
    });

    const text = (response.content[0]?.text || '').trim();
    // Strip markdown code fences if model wraps response
    const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[Photos] AI assessment error:', err.message);
    return null;
  }
}

const uploadDir = path.join(__dirname, '../../uploads/photos');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

router.post('/ro/:roId/predropoff', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const id = uuidv4();
    const photo_url = `/uploads/photos/${req.file.filename}`;
    const caption = String(req.body?.caption || '').trim() || null;
    const fullPath = path.join(uploadDir, req.file.filename);
    const ai = await analyzeDamagePhoto(fullPath);
    await dbRun(
      `INSERT INTO ro_photos (id, ro_id, user_id, photo_url, caption, photo_type, ai_severity, ai_zones, ai_description)
       VALUES ($1, $2, $3, $4, $5, 'predropoff', $6, $7, $8)`,
      [id, req.params.roId, req.user.id, photo_url, caption,
       ai?.severity || null, ai?.zones ? JSON.stringify(ai.zones) : null, ai?.description || null]
    );
    return res.status(201).json(await dbGet('SELECT * FROM ro_photos WHERE id = $1', [id]));
  } catch (err) {
    console.error('[Photos] POST predropoff error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ro/:roId/predropoff', auth, async (req, res) => {
  try {
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.roId, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const photos = await dbAll(
      `SELECT *
       FROM ro_photos
       WHERE ro_id = $1 AND photo_type = 'predropoff'
       ORDER BY created_at ASC`,
      [req.params.roId]
    );
    return res.json({ photos });
  } catch (err) {
    console.error('[Photos] GET predropoff error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:ro_id', auth, upload.single('photo'), async (req, res) => {
  try {
    if (Array.isArray(req.body?.photos) && req.body.photos.length > 5) {
      return res.status(400).json({ error: 'A maximum of 5 photos is allowed' });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ro = await dbGet('SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.ro_id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const existingCountRow = await dbGet(
      'SELECT COUNT(*)::int AS count FROM ro_photos WHERE ro_id = $1',
      [req.params.ro_id]
    );
    if ((existingCountRow?.count || 0) >= 5) {
      return res.status(400).json({ error: 'A maximum of 5 photos is allowed' });
    }

    const { caption, photo_type } = req.body;
    const id = uuidv4();
    const photo_url = `/uploads/photos/${req.file.filename}`;
    const resolvedType = photo_type || 'damage';
    const fullPath = path.join(uploadDir, req.file.filename);
    const ai = resolvedType === 'damage' ? await analyzeDamagePhoto(fullPath) : null;
    await dbRun(
      'INSERT INTO ro_photos (id, ro_id, user_id, photo_url, caption, photo_type, ai_severity, ai_zones, ai_description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, req.params.ro_id, req.user.id, photo_url, caption || null, resolvedType,
       ai?.severity || null, ai?.zones ? JSON.stringify(ai.zones) : null, ai?.description || null]
    );
    res.status(201).json(await dbGet('SELECT * FROM ro_photos WHERE id = $1', [id]));
  } catch (err) {
    console.error('[Photos] POST upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:ro_id', auth, async (req, res) => {
  try {
    const photos = await dbAll('SELECT * FROM ro_photos WHERE ro_id = $1 ORDER BY created_at ASC', [req.params.ro_id]);
    res.json({ photos });
  } catch (err) {
    console.error('[Photos] GET by RO error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:photo_id', auth, async (req, res) => {
  try {
    const photo = await dbGet(
      `SELECT p.*, ro.shop_id
       FROM ro_photos p
       LEFT JOIN repair_orders ro ON ro.id = p.ro_id
       WHERE p.id = $1`,
      [req.params.photo_id]
    );
    if (!photo) return res.status(404).json({ error: 'Not found' });
    if (photo.shop_id !== req.user.shop_id) return res.status(403).json({ error: 'Forbidden' });
    const filePath = path.join(__dirname, '../../', photo.photo_url);
    try {
      fs.unlinkSync(filePath);
    } catch (unlinkErr) {
      console.error('[Photos] DELETE file cleanup error:', { photo_id: req.params.photo_id, filePath, error: unlinkErr.message });
    }
    await dbRun(
      `DELETE FROM ro_photos
       WHERE id = $1
         AND ro_id IN (SELECT id FROM repair_orders WHERE shop_id = $2)`,
      [req.params.photo_id, req.user.shop_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[Photos] DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `File too large (max ${MAX_UPLOAD_SIZE_MB}MB)` });
  }
  res.status(400).json({ error: err.message });
});

module.exports = router;
