const router = require('express').Router();
const db = require('../db');
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
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// POST /api/photos/:ro_id — upload photo
router.post('/:ro_id', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { caption, photo_type } = req.body;
  const id = uuidv4();
  const photo_url = `/uploads/photos/${req.file.filename}`;
  db.prepare(`
    INSERT INTO ro_photos (id, ro_id, user_id, photo_url, caption, photo_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, req.params.ro_id, req.user.id, photo_url, caption || null, photo_type || 'damage');
  res.status(201).json(db.prepare('SELECT * FROM ro_photos WHERE id = ?').get(id));
});

// GET /api/photos/:ro_id — all photos for RO
router.get('/:ro_id', auth, (req, res) => {
  const photos = db.prepare('SELECT * FROM ro_photos WHERE ro_id = ? ORDER BY created_at ASC').all(req.params.ro_id);
  res.json({ photos });
});

// DELETE /api/photos/:photo_id — delete photo + file
router.delete('/:photo_id', auth, (req, res) => {
  const photo = db.prepare('SELECT * FROM ro_photos WHERE id = ?').get(req.params.photo_id);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(__dirname, '../../', photo.photo_url);
  try { fs.unlinkSync(filePath); } catch (_) {}
  db.prepare('DELETE FROM ro_photos WHERE id = ?').run(req.params.photo_id);
  res.json({ ok: true });
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 5MB)' });
  res.status(400).json({ error: err.message });
});

module.exports = router;
