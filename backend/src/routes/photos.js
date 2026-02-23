const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

router.post('/:ro_id', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { caption, photo_type } = req.body;
    const id = uuidv4();
    const photo_url = `/uploads/photos/${req.file.filename}`;
    await dbRun(
      'INSERT INTO ro_photos (id, ro_id, user_id, photo_url, caption, photo_type) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, req.params.ro_id, req.user.id, photo_url, caption || null, photo_type || 'damage']
    );
    res.status(201).json(await dbGet('SELECT * FROM ro_photos WHERE id = $1', [id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:ro_id', auth, async (req, res) => {
  try {
    const photos = await dbAll('SELECT * FROM ro_photos WHERE ro_id = $1 ORDER BY created_at ASC', [req.params.ro_id]);
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:photo_id', auth, async (req, res) => {
  try {
    const photo = await dbGet('SELECT * FROM ro_photos WHERE id = $1', [req.params.photo_id]);
    if (!photo) return res.status(404).json({ error: 'Not found' });
    const filePath = path.join(__dirname, '../../', photo.photo_url);
    try { fs.unlinkSync(filePath); } catch (_) {}
    await dbRun('DELETE FROM ro_photos WHERE id = $1', [req.params.photo_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 5MB)' });
  res.status(400).json({ error: err.message });
});

module.exports = router;
