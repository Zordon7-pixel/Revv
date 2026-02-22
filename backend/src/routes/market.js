const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { getRatesForState, getAllStates } = require('../data/market-rates');

// GET /api/market/rates?state=TX  — returns suggested rates for a state
router.get('/rates', (req, res) => {
  const { state } = req.query;
  if (!state) {
    return res.json({ states: getAllStates() });
  }
  const rates = getRatesForState(state);
  if (!rates) return res.status(404).json({ error: 'State not found' });
  res.json(rates);
});

// GET /api/market/shop  — returns current shop's location + rates + geofence
router.get('/shop', auth, (req, res) => {
  const shop = db.prepare('SELECT id, name, phone, address, city, state, zip, market_tier, labor_rate, parts_markup, tax_rate, lat, lng, geofence_radius, tracking_api_key FROM shops WHERE id = ?').get(req.user.shop_id);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  res.json(shop);
});

// PUT /api/market/shop  — update shop location & rates
router.put('/shop', auth, (req, res) => {
  const { name, phone, address, city, state, zip, labor_rate, parts_markup, tax_rate, lat, lng, geofence_radius, tracking_api_key } = req.body;

  // If state is provided, look up market tier
  let market_tier = null;
  if (state) {
    const { getRatesForState } = require('../data/market-rates');
    const mkt = getRatesForState(state);
    if (mkt) market_tier = mkt.tier;
  }

  const fields = [];
  const vals   = [];

  if (name         != null) { fields.push('name = ?');         vals.push(name); }
  if (phone        != null) { fields.push('phone = ?');        vals.push(phone); }
  if (address      != null) { fields.push('address = ?');      vals.push(address); }
  if (city         != null) { fields.push('city = ?');         vals.push(city); }
  if (state        != null) { fields.push('state = ?');        vals.push(state.toUpperCase()); }
  if (zip          != null) { fields.push('zip = ?');          vals.push(zip); }
  if (market_tier  != null) { fields.push('market_tier = ?'); vals.push(market_tier); }
  if (labor_rate      != null) { fields.push('labor_rate = ?');      vals.push(parseFloat(labor_rate)); }
  if (parts_markup    != null) { fields.push('parts_markup = ?');    vals.push(parseFloat(parts_markup)); }
  if (tax_rate        != null) { fields.push('tax_rate = ?');        vals.push(parseFloat(tax_rate)); }
  if (lat             != null) { fields.push('lat = ?');             vals.push(parseFloat(lat)); }
  if (lng             != null) { fields.push('lng = ?');             vals.push(parseFloat(lng)); }
  if (geofence_radius   != null) { fields.push('geofence_radius = ?');   vals.push(parseFloat(geofence_radius)); }
  if (tracking_api_key !== undefined) { fields.push('tracking_api_key = ?'); vals.push(tracking_api_key || null); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(req.user.shop_id);
  db.prepare(`UPDATE shops SET ${fields.join(', ')} WHERE id = ?`).run(...vals);

  const updated = db.prepare('SELECT id, name, phone, address, city, state, zip, market_tier, labor_rate, parts_markup, tax_rate, lat, lng, geofence_radius, tracking_api_key FROM shops WHERE id = ?').get(req.user.shop_id);
  res.json(updated);
});

module.exports = router;
