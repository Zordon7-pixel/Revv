const router = require('express').Router();
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { dbAll } = require('../db');
const {
  connectUrl,
  verifyState,
  exchangeCodeForTokens,
  saveTokens,
  connectionStatus,
  syncInvoiceForRo,
  disconnect,
  setSyncEnabled,
} = require('../services/quickbooks');

const DEFAULT_APP_URL = 'https://revvshop.app';

function appUrl() {
  return String(process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
}

function settingsRedirect(pathAndQuery) {
  const base = appUrl();
  return `${base}/settings${pathAndQuery || ''}`;
}

function parseBool(value) {
  if (typeof value === 'boolean') return value;
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  return ['1', 'true', 'yes', 'on'].includes(v);
}

router.get('/quickbooks/status', auth, requireAdmin, async (req, res) => {
  try {
    const status = await connectionStatus(req.user.shop_id);
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/quickbooks/connect-url', auth, requireAdmin, async (req, res) => {
  try {
    const url = connectUrl({ shopId: req.user.shop_id, userId: req.user.id });
    return res.json({ url });
  } catch (err) {
    const msg = String(err?.message || 'Unable to start QuickBooks connection');
    if (msg.toLowerCase().includes('not configured')) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

router.get('/quickbooks/callback', async (req, res) => {
  try {
    const error = String(req.query?.error || '').trim();
    const stateToken = String(req.query?.state || '').trim();
    const code = String(req.query?.code || '').trim();
    const realmId = String(req.query?.realmId || '').trim();

    if (error) {
      return res.redirect(settingsRedirect(`?qb=error&reason=${encodeURIComponent(error)}`));
    }

    const state = verifyState(stateToken);
    if (!state?.shop_id || !code || !realmId) {
      return res.redirect(settingsRedirect('?qb=error&reason=missing_callback_data'));
    }

    const tokenData = await exchangeCodeForTokens(code);
    await saveTokens(state.shop_id, realmId, tokenData);
    return res.redirect(settingsRedirect('?qb=connected'));
  } catch (err) {
    const reason = String(err?.message || 'callback_failed').slice(0, 120);
    return res.redirect(settingsRedirect(`?qb=error&reason=${encodeURIComponent(reason)}`));
  }
});

router.post('/quickbooks/disconnect', auth, requireAdmin, async (req, res) => {
  try {
    const result = await disconnect(req.user.shop_id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/quickbooks/sync-enabled', auth, requireAdmin, async (req, res) => {
  try {
    const enabled = parseBool(req.body?.enabled);
    const result = await setSyncEnabled(req.user.shop_id, enabled);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/quickbooks/sync/ro/:id', auth, requireAdmin, async (req, res) => {
  try {
    const result = await syncInvoiceForRo(req.user.shop_id, req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/quickbooks/sync/batch', auth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const roIds = Array.isArray(body.ro_ids)
      ? body.ro_ids.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
    const from = String(body.from || '').trim();
    const to = String(body.to || '').trim();

    let limit = Number.parseInt(body.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    if (limit > 200) limit = 200;

    let ids = roIds;
    if (!ids.length) {
      const filters = [
        'shop_id = $1',
        "status = 'closed'",
        "(COALESCE(NULLIF(LOWER(payment_status), ''), 'unpaid') = 'succeeded' OR COALESCE(payment_received, 0) = 1)",
      ];
      const params = [req.user.shop_id];

      if (from) {
        params.push(from);
        filters.push(`COALESCE(actual_delivery::date, updated_at::date, created_at::date) >= $${params.length}::date`);
      }
      if (to) {
        params.push(to);
        filters.push(`COALESCE(actual_delivery::date, updated_at::date, created_at::date) <= $${params.length}::date`);
      }

      params.push(limit);
      const rows = await dbAll(
        `SELECT id
         FROM repair_orders
         WHERE ${filters.join(' AND ')}
         ORDER BY COALESCE(actual_delivery, updated_at, created_at) DESC
         LIMIT $${params.length}`,
        params
      );
      ids = rows.map((r) => r.id).filter(Boolean);
    }

    const synced = [];
    const failed = [];

    for (const roId of ids) {
      try {
        const result = await syncInvoiceForRo(req.user.shop_id, roId);
        synced.push(result);
      } catch (err) {
        failed.push({ ro_id: roId, error: err.message });
      }
    }

    return res.json({
      ok: true,
      attempted: ids.length,
      synced_count: synced.length,
      failed_count: failed.length,
      synced,
      failed,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
