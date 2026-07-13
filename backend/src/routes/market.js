const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { getRatesForState, getAllStates } = require('../data/market-rates');
const { isConfiguredForShop, getTwilioConfigForShop } = require('../services/sms');

const MAX_SHOP_LOGO_BYTES = 2 * 1024 * 1024;
const SHOP_LOGO_MIME_TYPES = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
});
const shopLogoDir = path.join(__dirname, '../../uploads/shop-logos');
fs.mkdirSync(shopLogoDir, { recursive: true });

function isSupportedShopLogoMime(mimeType) {
  return Object.hasOwn(SHOP_LOGO_MIME_TYPES, String(mimeType || '').toLowerCase());
}

function localShopLogoPath(logoUrl) {
  const filename = path.basename(String(logoUrl || ''));
  if (!filename || !String(logoUrl || '').startsWith('/uploads/shop-logos/')) return null;
  const candidate = path.join(shopLogoDir, filename);
  return path.dirname(candidate) === shopLogoDir ? candidate : null;
}

function removeLocalShopLogo(logoUrl) {
  const filePath = localShopLogoPath(logoUrl);
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

const shopLogoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, shopLogoDir),
  filename: (_req, file, cb) => {
    const extension = SHOP_LOGO_MIME_TYPES[String(file.mimetype || '').toLowerCase()] || '';
    cb(null, `${uuidv4()}${extension}`);
  },
});

const shopLogoUpload = multer({
  storage: shopLogoStorage,
  limits: { fileSize: MAX_SHOP_LOGO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isSupportedShopLogoMime(file.mimetype)) {
      return cb(new Error('Logo must be a PNG or JPEG image.'));
    }
    return cb(null, true);
  },
}).single('logo');

function receiveShopLogo(req, res, next) {
  shopLogoUpload(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Logo must be 2 MB or smaller.'
      : err.message || 'Could not upload logo.';
    return res.status(400).json({ error: message });
  });
}

async function getShopProfile(shopId) {
  return dbGet(
    `SELECT id, name, phone, logo_url, address, city, state, zip, market_tier,
            labor_rate, paint_rate, parts_markup, tax_rate, lat, lng, geofence_radius,
            twilio_phone_number, monthly_revenue_target
     FROM shops
     WHERE id::text = $1::text`,
    [shopId]
  );
}

router.get('/rates', (req, res) => {
  const { state } = req.query;
  if (!state) return res.json({ states: getAllStates() });
  const rates = getRatesForState(state);
  if (!rates) return res.status(404).json({ error: 'State not found' });
  res.json(rates);
});

router.get('/shop', auth, async (req, res) => {
  try {
    const shop = await getShopProfile(req.user.shop_id);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const smsConfig = await getTwilioConfigForShop(req.user.shop_id);
    res.json({ ...shop, sms_configured: await isConfiguredForShop(req.user.shop_id), sms_phone: smsConfig?.phoneNumber || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/shop/logo', auth, requireAdmin, receiveShopLogo, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a PNG or JPEG logo.' });
  try {
    const shop = await dbGet(
      'SELECT id, logo_url FROM shops WHERE id::text = $1::text',
      [req.user.shop_id]
    );
    if (!shop) {
      removeLocalShopLogo(`/uploads/shop-logos/${req.file.filename}`);
      return res.status(404).json({ error: 'Shop not found' });
    }

    const logoUrl = `/uploads/shop-logos/${req.file.filename}`;
    await dbRun(
      'UPDATE shops SET logo_url = $1 WHERE id::text = $2::text',
      [logoUrl, req.user.shop_id]
    );
    removeLocalShopLogo(shop.logo_url);
    return res.json({ logo_url: logoUrl });
  } catch (err) {
    removeLocalShopLogo(`/uploads/shop-logos/${req.file.filename}`);
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/shop/logo', auth, requireAdmin, async (req, res) => {
  try {
    const shop = await dbGet(
      'SELECT id, logo_url FROM shops WHERE id::text = $1::text',
      [req.user.shop_id]
    );
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    await dbRun(
      'UPDATE shops SET logo_url = NULL WHERE id::text = $1::text',
      [req.user.shop_id]
    );
    removeLocalShopLogo(shop.logo_url);
    return res.json({ logo_url: null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/shop', auth, async (req, res) => {
  try {
    const ALLOWED_MARKET_FIELDS = ['state','labor_rate','paint_rate','parts_markup','name','phone','twilio_account_sid','twilio_auth_token','twilio_phone_number','twilio_api_key','twilio_api_secret','address','city','zip','tax_rate','lat','lng','geofence_radius','tracking_api_key','monthly_revenue_target'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_MARKET_FIELDS.includes(k)));
    const {
      name, phone, address, city, state, zip, labor_rate, paint_rate, parts_markup, tax_rate,
      lat, lng, geofence_radius, tracking_api_key, twilio_account_sid, twilio_auth_token,
      twilio_phone_number, twilio_api_key, twilio_api_secret, monthly_revenue_target,
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
    if (paint_rate      != null) { fields.push('paint_rate');      vals.push(parseFloat(paint_rate)); }
    if (parts_markup    != null) { fields.push('parts_markup');    vals.push(parseFloat(parts_markup)); }
    if (tax_rate        != null) { fields.push('tax_rate');        vals.push(parseFloat(tax_rate)); }
    if (lat             != null) { fields.push('lat');             vals.push(parseFloat(lat)); }
    if (lng             != null) { fields.push('lng');             vals.push(parseFloat(lng)); }
    if (geofence_radius   != null) { fields.push('geofence_radius');   vals.push(parseFloat(geofence_radius)); }
    if (tracking_api_key !== undefined) { fields.push('tracking_api_key'); vals.push(tracking_api_key || null); }
    if (twilio_account_sid !== undefined) { fields.push('twilio_account_sid'); vals.push(twilio_account_sid); }
    if (twilio_auth_token  !== undefined) { fields.push('twilio_auth_token');  vals.push(twilio_auth_token || null); }
    if (twilio_phone_number !== undefined) { fields.push('twilio_phone_number'); vals.push(twilio_phone_number); }
    if (twilio_api_key    !== undefined) { fields.push('twilio_api_key');    vals.push(twilio_api_key || null); }
    if (twilio_api_secret !== undefined) { fields.push('twilio_api_secret'); vals.push(twilio_api_secret || null); }
    if (monthly_revenue_target != null) { fields.push('monthly_revenue_target'); vals.push(parseInt(monthly_revenue_target, 10)); }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(req.user.shop_id);
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    await dbRun(`UPDATE shops SET ${setClauses} WHERE id = $${fields.length + 1}`, vals);

    const updated = await getShopProfile(req.user.shop_id);
    const smsConfig = await getTwilioConfigForShop(req.user.shop_id);
    res.json({ ...updated, sms_configured: await isConfiguredForShop(req.user.shop_id), sms_phone: smsConfig?.phoneNumber || null });
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
module.exports._test = {
  MAX_SHOP_LOGO_BYTES,
  isSupportedShopLogoMime,
  localShopLogoPath,
};
