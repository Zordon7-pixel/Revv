const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ─── Carrier detection from tracking number format ────────────────────────────
function detectCarrier(num) {
  const n = num.trim().replace(/[\s-]/g, '').toUpperCase();
  if (/^1Z[A-Z0-9]{16}$/.test(n))                           return 'ups';
  if (/^T\d{10}$/.test(n))                                   return 'ups';   // UPS mail innovations
  if (/^(96|98|77|61|02|03|62|88)\d{18,20}/.test(n))        return 'fedex';
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n))             return 'fedex';
  if (/^(94|93|92|9400|9205|9206|9407|9208|9300|9261|9274|9275|9276|9278|9279|9202|9261)\d+/.test(n)) return 'usps';
  if (/^(70|71|73|77|80|81|83|85|86|87|88|89|91|92|93|94|95|96|97|98|99)\d{18}$/.test(n)) return 'usps';
  if (/^\d{10}$/.test(n) && n.startsWith('0'))               return 'usps';
  if (/^[0-9]{10}JD/.test(n) || /^JD\d{18}$/.test(n))      return 'dhl';
  if (/^\d{10,11}$/.test(n))                                  return 'dhl';
  return null;
}

// ─── Direct-to-carrier tracking URLs ──────────────────────────────────────────
function trackingUrl(carrier, num) {
  const n = num.trim().replace(/\s/g, '');
  switch (carrier) {
    case 'ups':   return `https://www.ups.com/track?tracknum=${n}&requester=WT/trackdetails`;
    case 'fedex': return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case 'usps':  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case 'dhl':   return `https://www.dhl.com/en/express/tracking.html?AWB=${n}&brand=DHL`;
    default:      return `https://www.google.com/search?q=track+package+${n}`;
  }
}

// ─── Carrier display labels ────────────────────────────────────────────────────
const CARRIER_LABELS = { ups:'UPS', fedex:'FedEx', usps:'USPS', dhl:'DHL' };

// ─── 17track API call ──────────────────────────────────────────────────────────
async function fetchTrackingFrom17track(apiKey, trackingNumber, carrier) {
  // Map our carrier name to 17track carrier codes (0 = auto-detect)
  const carrierMap = { ups: 100002, fedex: 100003, usps: 100001, dhl: 100004 };
  const carrierCode = carrierMap[carrier] || 0;

  const body = JSON.stringify([{ num: trackingNumber, carrier: carrierCode }]);
  const resp = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', '17token': apiKey },
    body,
  });

  if (!resp.ok) throw new Error(`17track API error: ${resp.status}`);
  const data = await resp.json();

  if (!data?.data?.accepted?.length) {
    // Maybe not registered yet — try registering first
    await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', '17token': apiKey },
      body,
    });
    return null; // Will pick up on next poll
  }

  const item = data.data.accepted[0];
  return parseTrackingResult(item);
}

function parseTrackingResult(item) {
  const info = item?.track_info;
  if (!info) return null;

  // Map 17track status to our simple status
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
  const mapped     = statusMap[rawStatus] || { status: 'in_transit', detail: null };

  // Use the latest event description as the detail if available
  const latestEvent = info.tracking?.providers?.[0]?.events?.[0];
  const detail = latestEvent?.description || mapped.detail || rawStatus;

  return {
    tracking_status: mapped.status,
    tracking_detail: detail,
  };
}

// ─── Helper: update part tracking in DB and auto-receive if delivered ──────────
function applyTrackingResult(partId, result) {
  if (!result) return;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE parts_orders
    SET tracking_status = ?, tracking_detail = ?, tracking_updated_at = ?, updated_at = ?
    WHERE id = ?
  `).run(result.tracking_status, result.tracking_detail, now, now, partId);

  // Auto-mark as received when carrier says delivered
  if (result.tracking_status === 'delivered') {
    const part = db.prepare('SELECT status FROM parts_orders WHERE id = ?').get(partId);
    if (part && part.status !== 'received') {
      db.prepare(`
        UPDATE parts_orders SET status = 'received', received_date = ?, updated_at = ? WHERE id = ?
      `).run(now.slice(0, 10), now, partId);
    }
  }
}

// ─── GET /api/tracking/detect?num=... ─────────────────────────────────────────
// Returns carrier + tracking URL for a given tracking number (no auth needed for UI hints)
router.get('/detect', auth, (req, res) => {
  const num = req.query.num || '';
  if (!num.trim()) return res.status(400).json({ error: 'num required' });
  const carrier = detectCarrier(num);
  res.json({
    carrier,
    carrier_label: CARRIER_LABELS[carrier] || 'Unknown',
    tracking_url:  trackingUrl(carrier, num),
  });
});

// ─── POST /api/tracking/check/:partId ─────────────────────────────────────────
// Manually refresh tracking for one part (admin/employee)
router.post('/check/:partId', auth, async (req, res) => {
  const part = db.prepare('SELECT * FROM parts_orders WHERE id = ? AND shop_id = ?').get(req.params.partId, req.user.shop_id);
  if (!part) return res.status(404).json({ error: 'Part not found' });
  if (!part.tracking_number) return res.status(400).json({ error: 'No tracking number on this part' });

  const shop = db.prepare('SELECT tracking_api_key FROM shops WHERE id = ?').get(req.user.shop_id);
  if (!shop?.tracking_api_key) {
    // No API key — just return the tracking URL for manual checking
    const url = trackingUrl(part.carrier || detectCarrier(part.tracking_number), part.tracking_number);
    return res.json({ manual: true, tracking_url: url, message: 'No tracking API key configured. Track manually via the link.' });
  }

  try {
    const result = await fetchTrackingFrom17track(shop.tracking_api_key, part.tracking_number, part.carrier);
    applyTrackingResult(part.id, result);
    const updated = db.prepare('SELECT * FROM parts_orders WHERE id = ?').get(part.id);
    res.json({ part: updated, tracking_url: trackingUrl(updated.carrier, updated.tracking_number) });
  } catch (err) {
    res.status(500).json({ error: `Tracking check failed: ${err.message}` });
  }
});

// ─── POST /api/tracking/poll-shop ─────────────────────────────────────────────
// Poll all open parts with tracking numbers for this shop (background / cron-like)
router.post('/poll-shop', auth, async (req, res) => {
  const shop = db.prepare('SELECT tracking_api_key FROM shops WHERE id = ?').get(req.user.shop_id);
  if (!shop?.tracking_api_key) return res.json({ skipped: true, reason: 'No API key configured' });

  // Only check parts that are not yet received and have a tracking number
  // Throttle: skip if checked within last 30 minutes
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const openParts = db.prepare(`
    SELECT * FROM parts_orders
    WHERE shop_id = ? AND tracking_number IS NOT NULL
      AND status NOT IN ('received', 'cancelled')
      AND (tracking_updated_at IS NULL OR tracking_updated_at < ?)
    LIMIT 20
  `).all(req.user.shop_id, thirtyMinsAgo);

  const results = [];
  for (const part of openParts) {
    try {
      const result = await fetchTrackingFrom17track(shop.tracking_api_key, part.tracking_number, part.carrier);
      applyTrackingResult(part.id, result);
      results.push({ id: part.id, part_name: part.part_name, result });
    } catch (e) {
      results.push({ id: part.id, part_name: part.part_name, error: e.message });
    }
  }

  res.json({ polled: results.length, results });
});

// ─── GET /api/tracking/url?carrier=&num= ──────────────────────────────────────
router.get('/url', auth, (req, res) => {
  const { carrier, num } = req.query;
  if (!num) return res.status(400).json({ error: 'num required' });
  const c = carrier || detectCarrier(num) || 'unknown';
  res.json({ url: trackingUrl(c, num), carrier: c, carrier_label: CARRIER_LABELS[c] || 'Carrier' });
});

module.exports = router;
module.exports.detectCarrier = detectCarrier;
module.exports.trackingUrl   = trackingUrl;
module.exports.CARRIER_LABELS = CARRIER_LABELS;
