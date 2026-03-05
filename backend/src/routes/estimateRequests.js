const router = require('express').Router();
const { dbAll, dbGet, dbRun } = require('../db');
const auth = require('../middleware/auth');

const ALLOWED_STATUSES = ['pending', 'contacted', 'converted'];

function parsePhotos(photosJson) {
  try {
    const parsed = JSON.parse(photosJson || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

router.get('/', auth, async (req, res) => {
  try {
    const requestedStatus = String(req.query.status || 'pending').toLowerCase();
    if (!ALLOWED_STATUSES.includes(requestedStatus)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }

    const rows = await dbAll(
      `SELECT *
       FROM estimate_requests
       WHERE shop_id = $1 AND status = $2
       ORDER BY created_at DESC`,
      [req.user.shop_id, requestedStatus]
    );

    const requests = rows.map((row) => ({
      ...row,
      photos: parsePhotos(row.photos_json),
    }));

    return res.json({ success: true, requests });
  } catch (err) {
    console.error('[Estimate Requests] GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/status', auth, async (req, res) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const found = await dbGet(
      'SELECT id FROM estimate_requests WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!found) return res.status(404).json({ error: 'Not found' });

    await dbRun(
      'UPDATE estimate_requests SET status = $1 WHERE id = $2',
      [status, req.params.id]
    );

    const updated = await dbGet('SELECT * FROM estimate_requests WHERE id = $1', [req.params.id]);
    return res.json({
      success: true,
      request: {
        ...updated,
        photos: parsePhotos(updated?.photos_json),
      },
    });
  } catch (err) {
    console.error('[Estimate Requests] PATCH status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
