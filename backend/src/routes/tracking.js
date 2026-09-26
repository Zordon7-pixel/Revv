const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth   = require('../middleware/auth');

const { detectCarrier, trackingUrl } = require('../services/trackingCarrier');
const { applyCarrier } = require('../services/partsDelivery');
const { pool } = require('../db');
const { requireTechnician } = require('../middleware/roles');
router.use(auth, requireTechnician);

const CARRIER_LABELS = { ups:'UPS', fedex:'FedEx', usps:'USPS', dhl:'DHL' };

async function fetchTrackingFrom17track(apiKey, trackingNumber, carrier) {
  const carrierMap = { ups: 100002, fedex: 100003, usps: 100001, dhl: 100004 };
  const carrierCode = carrierMap[carrier] || 0;
  const body = JSON.stringify([{ num: trackingNumber, carrier: carrierCode }]);
  const resp = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', '17token': apiKey },
    body,
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`17track API error: ${resp.status}`);
  const data = await resp.json();
  if (!data?.data?.accepted?.length) {
    await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', '17token': apiKey },
      body,
      signal: AbortSignal.timeout(12000),
    });
    return null;
  }
  return parseTrackingResult(data.data.accepted[0]);
}

function parseTrackingResult(item) {
  const info = item?.track_info;
  if (!info) return null;
  const statusMap = {
    'NotFound':      { status: 'pending',           detail: 'Tracking not yet active' },
    'InTransit':     { status: 'in_transit',         detail: null },
    'Undelivered':   { status: 'exception',          detail: 'Delivery attempted or issue reported' },
    'Delivered':     { status: 'delivered',          detail: 'Package delivered' },
    'Returning':     { status: 'exception',          detail: 'Package being returned to sender' },
    'Expired':       { status: 'expired',            detail: 'Tracking expired' },
    'PickedUp':      { status: 'in_transit',         detail: 'Picked up by carrier' },
    'AvailableForPickup': { status: 'out_for_delivery', detail: 'Available for pickup' },
    'OutForDelivery':    { status: 'out_for_delivery', detail: 'Out for delivery today' },
  };
  const rawStatus  = info.latest_status?.status || 'NotFound';
  const mapped     = statusMap[rawStatus] || { status: 'pending', detail: 'Carrier status unavailable' };
  const latestEvent = info.tracking?.providers?.[0]?.events?.[0];
  const detail = latestEvent?.description || mapped.detail || rawStatus;
  return { tracking_status: mapped.status, tracking_detail: detail };
}

router.get('/detect', auth, (req, res) => {
  const num = typeof req.query.num === 'string' ? req.query.num : '';
  if (!num.trim()) return res.status(400).json({ error: 'num required' });
  const carrier = detectCarrier(num);
  res.json({
    carrier,
    carrier_label: CARRIER_LABELS[carrier] || 'Unknown',
    tracking_url:  trackingUrl(carrier, num),
  });
});

router.post('/check/:partId', auth, async (req, res) => {
  try {
    const part = await dbGet('SELECT * FROM parts_orders WHERE id = $1 AND shop_id = $2', [req.params.partId, req.user.shop_id]);
    if (!part) return res.status(404).json({ error: 'Part not found' });
    if (!part.tracking_number) return res.status(400).json({ error: 'No tracking number on this part' });

    const shop = await dbGet('SELECT tracking_api_key FROM shops WHERE id = $1', [req.user.shop_id]);
    if (!shop?.tracking_api_key) {
      const url = trackingUrl(part.carrier || detectCarrier(part.tracking_number), part.tracking_number);
      return res.json({ manual: true, tracking_url: url, message: 'No tracking API key configured. Track manually via the link.' });
    }

    const result = await fetchTrackingFrom17track(shop.tracking_api_key, part.tracking_number, part.carrier);
    await applyCarrier(pool, part, result);
    const updated = await dbGet('SELECT * FROM parts_orders WHERE id = $1 AND shop_id = $2', [part.id, req.user.shop_id]);
    res.json({ part: updated, tracking_url: trackingUrl(updated.carrier, updated.tracking_number) });
  } catch (err) {
    res.status(500).json({ error: 'Tracking check failed. Try again later.' });
  }
});

router.post('/poll-shop', auth, async (req, res) => {
  try {
    const shop = await dbGet('SELECT tracking_api_key FROM shops WHERE id = $1', [req.user.shop_id]);
    if (!shop?.tracking_api_key) return res.json({ skipped: true, reason: 'No API key configured' });

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const openParts = await dbAll(`
      SELECT * FROM parts_orders
      WHERE shop_id = $1 AND tracking_number IS NOT NULL
        AND status NOT IN ('received', 'cancelled')
        AND (tracking_updated_at IS NULL OR tracking_updated_at < $2)
      LIMIT 20
    `, [req.user.shop_id, thirtyMinsAgo]);

    const results = [];
    for (const part of openParts) {
      try {
        const result = await fetchTrackingFrom17track(shop.tracking_api_key, part.tracking_number, part.carrier);
        await applyCarrier(pool, part, result);
        results.push({ id: part.id, part_name: part.part_name, result });
      } catch (e) {
        results.push({ id: part.id, part_name: part.part_name, error: 'Carrier check unavailable' });
      }
    }
    res.json({ polled: results.length, results });
  } catch (err) {
    res.status(500).json({ error: 'Tracking check failed. Try again later.' });
  }
});

router.get('/url', auth, (req, res) => {
  const { carrier, num } = req.query;
  if (typeof num !== 'string' || !num.trim()) return res.status(400).json({ error: 'num required' });
  const c = carrier || detectCarrier(num) || 'unknown';
  res.json({ url: trackingUrl(c, num), carrier: c, carrier_label: CARRIER_LABELS[c] || 'Carrier' });
});

module.exports = router;
module.exports.detectCarrier = detectCarrier;
module.exports.trackingUrl   = trackingUrl;
module.exports.CARRIER_LABELS = CARRIER_LABELS;
