const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { getRatesForState, getAllStates } = require('../data/market-rates');
const { isConfigured } = require('../services/sms');

router.get('/rates', (req, res) => {
  const { state } = req.query;
  if (!state) return res.json({ states: getAllStates() });
  const rates = getRatesForState(state);
  if (!rates) return res.status(404).json({ error: 'State not found' });
  res.json(rates);
});

router.get('/shop', auth, async (req, res) => {
  try {
    const shop = await dbGet('SELECT id, name, phone, address, city, state, zip, market_tier, labor_rate, parts_markup, tax_rate, lat, lng, geofence_radius, tracking_api_key, twilio_account_sid, twilio_auth_token, twilio_phone_number, monthly_revenue_target FROM shops WHERE id = $1', [req.user.shop_id]);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    res.json({ ...shop, sms_configured: isConfigured(), sms_phone: process.env.TWILIO_PHONE_NUMBER || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/shop', auth, async (req, res) => {
  try {
    const ALLOWED_MARKET_FIELDS = ['state','labor_rate','paint_rate','parts_markup','name','phone','twilio_account_sid','twilio_auth_token','twilio_phone_number','address','city','zip','tax_rate','lat','lng','geofence_radius','tracking_api_key','monthly_revenue_target'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_MARKET_FIELDS.includes(k)));
    const {
      name, phone, address, city, state, zip, labor_rate, parts_markup, tax_rate,
      lat, lng, geofence_radius, tracking_api_key, twilio_account_sid, twilio_auth_token,
      twilio_phone_number, monthly_revenue_target,
    } = updates;

    let market_tier = null;
    if (state) {
      const mkt = getRatesForState(state);
      if (mkt) market_tier = mkt.tier;
    }

    const fields = []; const vals = [];
    if (name         != null) { fields.push('name');         vals.push(name); }
    if (phone        != null) { fields.push('phone');        vals.push(phone); }
    if (address      != null) { fields.push('address');      vals.push(address); }
    if (city         != null) { fields.push('city');         vals.push(city); }
    if (state        != null) { fields.push('state');        vals.push(state.toUpperCase()); }
    if (zip          != null) { fields.push('zip');          vals.push(zip); }
    if (market_tier  != null) { fields.push('market_tier');  vals.push(market_tier); }
    if (labor_rate      != null) { fields.push('labor_rate');      vals.push(parseFloat(labor_rate)); }
    if (parts_markup    != null) { fields.push('parts_markup');    vals.push(parseFloat(parts_markup)); }
    if (tax_rate        != null) { fields.push('tax_rate');        vals.push(parseFloat(tax_rate)); }
    if (lat             != null) { fields.push('lat');             vals.push(parseFloat(lat)); }
    if (lng             != null) { fields.push('lng');             vals.push(parseFloat(lng)); }
    if (geofence_radius   != null) { fields.push('geofence_radius');   vals.push(parseFloat(geofence_radius)); }
    if (tracking_api_key !== undefined) { fields.push('tracking_api_key'); vals.push(tracking_api_key || null); }
    if (twilio_account_sid !== undefined) { fields.push('twilio_account_sid'); vals.push(twilio_account_sid); }
    if (twilio_auth_token  !== undefined) { fields.push('twilio_auth_token');  vals.push(twilio_auth_token); }
    if (twilio_phone_number !== undefined) { fields.push('twilio_phone_number'); vals.push(twilio_phone_number); }
    if (monthly_revenue_target != null) { fields.push('monthly_revenue_target'); vals.push(parseInt(monthly_revenue_target, 10)); }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(req.user.shop_id);
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    await dbRun(`UPDATE shops SET ${setClauses} WHERE id = $${fields.length + 1}`, vals);

    const updated = await dbGet('SELECT id, name, phone, address, city, state, zip, market_tier, labor_rate, parts_markup, tax_rate, lat, lng, geofence_radius, tracking_api_key, twilio_account_sid, twilio_auth_token, twilio_phone_number, monthly_revenue_target FROM shops WHERE id = $1', [req.user.shop_id]);
    res.json({ ...updated, sms_configured: isConfigured(), sms_phone: process.env.TWILIO_PHONE_NUMBER || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/demo-data', auth, async (req, res) => {
  try {
    const shopId = req.user.shop_id;
    await dbRun('DELETE FROM parts_orders WHERE ro_id IN (SELECT id FROM repair_orders WHERE shop_id = $1)', [shopId]);
    await dbRun('DELETE FROM job_status_log WHERE ro_id IN (SELECT id FROM repair_orders WHERE shop_id = $1)', [shopId]);
    await dbRun('DELETE FROM time_entries WHERE shop_id = $1', [shopId]);
    await dbRun('DELETE FROM schedules WHERE shop_id = $1', [shopId]);
    await dbRun('DELETE FROM repair_orders WHERE shop_id = $1', [shopId]);
    await dbRun('DELETE FROM vehicles WHERE shop_id = $1', [shopId]);
    await dbRun("DELETE FROM users WHERE shop_id = $1 AND role = 'customer'", [shopId]);
    await dbRun('DELETE FROM customers WHERE shop_id = $1', [shopId]);
    res.json({ ok: true, message: 'All demo data cleared. Shop settings and staff accounts are untouched.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
