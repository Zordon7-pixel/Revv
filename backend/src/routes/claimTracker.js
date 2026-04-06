const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');

const MAX_EVIDENCE_FILE_SIZE_BYTES = 40 * 1024 * 1024;
const MAX_EVIDENCE_FILE_SIZE_MB = Math.round(MAX_EVIDENCE_FILE_SIZE_BYTES / (1024 * 1024));
const CONTACT_CHANNELS = new Set(['phone', 'email', 'sms', 'portal', 'in-person']);

const uploadDir = path.join(__dirname, '../../uploads/claim-evidence');
fs.mkdirSync(uploadDir, { recursive: true });

function safeExtFromFile(file) {
  const ext = String(path.extname(file?.originalname || '') || '').toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  if (String(file?.mimetype || '').startsWith('image/')) return '.jpg';
  if (String(file?.mimetype || '').startsWith('video/')) return '.mp4';
  return '';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${safeExtFromFile(file)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_EVIDENCE_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const mime = String(file?.mimetype || '');
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
      return cb(new Error('Only image or video files are allowed'));
    }
    return cb(null, true);
  },
});

let ensureTablesPromise = null;

async function ensureClaimTrackerTables() {
  if (ensureTablesPromise) return ensureTablesPromise;

  ensureTablesPromise = (async () => {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS ro_claim_evidence (
        id TEXT PRIMARY KEY,
        ro_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        uploaded_by TEXT,
        media_url TEXT NOT NULL,
        media_type TEXT NOT NULL,
        mime_type TEXT,
        caption TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS ro_claim_contacts (
        id TEXT PRIMARY KEY,
        ro_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        logged_by TEXT,
        insurer_name TEXT,
        contact_name TEXT NOT NULL,
        channel TEXT NOT NULL,
        summary TEXT NOT NULL,
        outcome TEXT,
        follow_up TEXT,
        contact_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS ro_claim_disputes (
        id TEXT PRIMARY KEY,
        ro_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        created_by TEXT,
        note TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await dbRun('CREATE INDEX IF NOT EXISTS idx_ro_claim_evidence_ro_created ON ro_claim_evidence(ro_id, created_at DESC)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_ro_claim_evidence_shop_ro ON ro_claim_evidence(shop_id, ro_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_ro_claim_contacts_ro_created ON ro_claim_contacts(ro_id, created_at DESC)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_ro_claim_contacts_shop_ro ON ro_claim_contacts(shop_id, ro_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_ro_claim_disputes_ro_created ON ro_claim_disputes(ro_id, created_at DESC)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_ro_claim_disputes_shop_ro ON ro_claim_disputes(shop_id, ro_id)');
  })().catch((err) => {
    ensureTablesPromise = null;
    throw err;
  });

  return ensureTablesPromise;
}

async function ensureRoAccess(roId, shopId) {
  if (!roId || !shopId) return null;
  return dbGet(
    'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
    [roId, shopId]
  );
}

function normalizeText(value, maxLen) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.slice(0, maxLen);
}

router.get('/ro/:roId', auth, async (req, res) => {
  try {
    await ensureClaimTrackerTables();

    const ro = await ensureRoAccess(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const evidence = await dbAll(
      `SELECT
         e.id,
         e.ro_id,
         e.media_url,
         e.media_type,
         e.mime_type,
         e.caption,
         e.created_at,
         COALESCE(u.name, 'Unknown') AS uploaded_by_name
       FROM ro_claim_evidence e
       LEFT JOIN users u ON u.id = e.uploaded_by
       WHERE e.ro_id = $1 AND e.shop_id = $2
       ORDER BY e.created_at DESC`,
      [req.params.roId, req.user.shop_id]
    );

    const contacts = await dbAll(
      `SELECT
         c.id,
         c.ro_id,
         c.insurer_name,
         c.contact_name,
         c.channel,
         c.summary,
         c.outcome,
         c.follow_up,
         c.contact_at,
         c.created_at,
         COALESCE(u.name, 'Unknown') AS logged_by_name
       FROM ro_claim_contacts c
       LEFT JOIN users u ON u.id = c.logged_by
       WHERE c.ro_id = $1 AND c.shop_id = $2
       ORDER BY c.contact_at DESC, c.created_at DESC`,
      [req.params.roId, req.user.shop_id]
    );

    const disputes = await dbAll(
      `SELECT
         d.id,
         d.ro_id,
         d.note,
         d.created_at,
         COALESCE(u.name, 'Unknown') AS created_by_name
       FROM ro_claim_disputes d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.ro_id = $1 AND d.shop_id = $2
       ORDER BY d.created_at DESC`,
      [req.params.roId, req.user.shop_id]
    );

    return res.json({ evidence, contacts, disputes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/ro/:roId/evidence', auth, requireTechnician, upload.single('media'), async (req, res) => {
  try {
    await ensureClaimTrackerTables();

    const ro = await ensureRoAccess(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });
    if (!req.file) return res.status(400).json({ error: 'No media file uploaded' });

    const mimeType = String(req.file.mimetype || '').toLowerCase();
    const mediaType = mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('image/')
        ? 'photo'
        : null;
    if (!mediaType) return res.status(400).json({ error: 'Unsupported media type' });

    const caption = normalizeText(req.body?.caption, 300);
    const evidenceId = uuidv4();
    const mediaUrl = `/uploads/claim-evidence/${req.file.filename}`;

    await dbRun(
      `INSERT INTO ro_claim_evidence (id, ro_id, shop_id, uploaded_by, media_url, media_type, mime_type, caption)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        evidenceId,
        req.params.roId,
        req.user.shop_id,
        req.user.id,
        mediaUrl,
        mediaType,
        mimeType || null,
        caption || null,
      ]
    );

    const created = await dbGet(
      `SELECT
         e.id,
         e.ro_id,
         e.media_url,
         e.media_type,
         e.mime_type,
         e.caption,
         e.created_at,
         COALESCE(u.name, 'Unknown') AS uploaded_by_name
       FROM ro_claim_evidence e
       LEFT JOIN users u ON u.id = e.uploaded_by
       WHERE e.id = $1`,
      [evidenceId]
    );

    return res.status(201).json({ evidence: created });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/evidence/:id', auth, requireTechnician, async (req, res) => {
  try {
    await ensureClaimTrackerTables();

    const existing = await dbGet(
      'SELECT id, media_url FROM ro_claim_evidence WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Evidence item not found' });

    await dbRun('DELETE FROM ro_claim_evidence WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);

    if (existing.media_url) {
      const relativePath = String(existing.media_url).replace(/^\//, '');
      const filePath = path.join(__dirname, '../../', relativePath);
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.error('[ClaimTracker] Evidence file cleanup error:', { filePath, error: unlinkErr.message });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/ro/:roId/contacts', auth, requireTechnician, async (req, res) => {
  try {
    await ensureClaimTrackerTables();

    const ro = await ensureRoAccess(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const insurerName = normalizeText(req.body?.insurer_name, 120);
    const contactName = normalizeText(req.body?.contact_name, 120);
    const channel = normalizeText(req.body?.channel, 30).toLowerCase();
    const summary = normalizeText(req.body?.summary, 1200);
    const outcome = normalizeText(req.body?.outcome, 600);
    const followUp = normalizeText(req.body?.follow_up, 300);

    if (!contactName) return res.status(400).json({ error: 'Contact name is required' });
    if (!CONTACT_CHANNELS.has(channel)) return res.status(400).json({ error: 'Invalid contact channel' });
    if (!summary) return res.status(400).json({ error: 'Summary is required' });

    let contactAt = null;
    if (req.body?.contact_at) {
      const parsed = new Date(req.body.contact_at);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid contact date/time' });
      }
      contactAt = parsed.toISOString();
    }

    const contactId = uuidv4();
    await dbRun(
      `INSERT INTO ro_claim_contacts
        (id, ro_id, shop_id, logged_by, insurer_name, contact_name, channel, summary, outcome, follow_up, contact_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()))`,
      [
        contactId,
        req.params.roId,
        req.user.shop_id,
        req.user.id,
        insurerName || null,
        contactName,
        channel,
        summary,
        outcome || null,
        followUp || null,
        contactAt,
      ]
    );

    const created = await dbGet(
      `SELECT
         c.id,
         c.ro_id,
         c.insurer_name,
         c.contact_name,
         c.channel,
         c.summary,
         c.outcome,
         c.follow_up,
         c.contact_at,
         c.created_at,
         COALESCE(u.name, 'Unknown') AS logged_by_name
       FROM ro_claim_contacts c
       LEFT JOIN users u ON u.id = c.logged_by
       WHERE c.id = $1`,
      [contactId]
    );

    return res.status(201).json({ contact: created });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', auth, requireTechnician, async (req, res) => {
  try {
    await ensureClaimTrackerTables();

    const existing = await dbGet(
      'SELECT id FROM ro_claim_contacts WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Contact log entry not found' });

    await dbRun('DELETE FROM ro_claim_contacts WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/ro/:roId/disputes', auth, requireTechnician, async (req, res) => {
  try {
    await ensureClaimTrackerTables();

    const ro = await ensureRoAccess(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const note = normalizeText(req.body?.note, 2000);
    if (!note) return res.status(400).json({ error: 'Dispute note is required' });

    const disputeId = uuidv4();
    await dbRun(
      `INSERT INTO ro_claim_disputes (id, ro_id, shop_id, created_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [disputeId, req.params.roId, req.user.shop_id, req.user.id, note]
    );

    const created = await dbGet(
      `SELECT
         d.id,
         d.ro_id,
         d.note,
         d.created_at,
         COALESCE(u.name, 'Unknown') AS created_by_name
       FROM ro_claim_disputes d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.id = $1`,
      [disputeId]
    );

    return res.status(201).json({ dispute: created });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/disputes/:id', auth, requireTechnician, async (req, res) => {
  try {
    await ensureClaimTrackerTables();

    const existing = await dbGet(
      'SELECT id FROM ro_claim_disputes WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Dispute note not found' });

    await dbRun('DELETE FROM ro_claim_disputes WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `File too large (max ${MAX_EVIDENCE_FILE_SIZE_MB}MB)` });
  }
  return res.status(400).json({ error: err.message || 'Invalid request' });
});

module.exports = router;
