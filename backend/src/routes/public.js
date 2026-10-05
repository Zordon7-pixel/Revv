const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { sendDiscordEmbed } = require('../utils/discord');
const { resolvePublicShop, sendPublicIntakeError, validIntakePhotos } = require('../services/publicShop');

const estimateRequestRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const intakeMetadataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
router.get('/intake/:slug', intakeMetadataLimiter, async (req, res) => {
  try {
    const shopId = await resolvePublicShop(req);
    const shop = await dbGet('SELECT name, logo_url FROM shops WHERE id = $1', [shopId]);
    if (!shop) return res.status(404).json({ error: 'Shop not found', code: 'SHOP_NOT_FOUND' });
    return res.json({ name: shop.name, logo_url: shop.logo_url });
  } catch (err) {
    return sendPublicIntakeError(res, err);
  }
});

// Get public shop info with ratings and reviews
router.get('/shop/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    
    // Get shop info
    const shop = await dbGet(`
      SELECT id, name, phone, address, city, state, zip, labor_rate
      FROM shops WHERE id = $1
    `, [shopId]);
    
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    // Get rating stats
    const ratingStats = await dbGet(`
      SELECT 
        AVG(rating)::numeric(2,1) as avg_rating,
        COUNT(*)::int as review_count
      FROM ro_ratings
      WHERE shop_id = $1
    `, [shopId]);
    
    // Get recent reviews (last 10)
    const reviews = await dbAll(`
      SELECT r.id, r.rating, r.created_at,
             ro.ro_number, v.year, v.make, v.model
      FROM ro_ratings r
      LEFT JOIN repair_orders ro ON ro.id = r.ro_id
      LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE r.shop_id = $1
      ORDER BY r.created_at DESC
      LIMIT 10
    `, [shopId]);
    
    // Calculate badges
    const avgRating = parseFloat(ratingStats?.avg_rating || 0);
    const reviewCount = ratingStats?.review_count || 0;
    
    const badges = [];
    if (avgRating >= 4.5 && reviewCount >= 10) {
      badges.push({ type: 'top_rated', label: 'Top Rated', description: '4.5+ stars with 10+ reviews' });
    }
    if (avgRating >= 5.0 && reviewCount >= 5) {
      badges.push({ type: 'perfect_score', label: 'Perfect Score', description: '5.0 average with 5+ reviews' });
    }
    
    res.json({
      shop: {
        id: shop.id,
        name: shop.name,
        phone: shop.phone,
        address: shop.address,
        city: shop.city,
        state: shop.state,
        zip: shop.zip,
        labor_rate: shop.labor_rate,
      },
      rating: {
        avg: avgRating || null,
        count: reviewCount,
      },
      badges,
      reviews: reviews.map(r => ({
        id: r.id,
        rating: r.rating,
        date: r.created_at,
        vehicle: r.year && r.make && r.model ? `${r.year} ${r.make} ${r.model}` : null,
      })),
    });
  } catch (err) {
    console.error('[Public Shop] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/estimate-request', estimateRequestRateLimit, async (req, res) => {
  try {
    const resolvedShopId = await resolvePublicShop(req);
    const {
      name,
      phone,
      email,
      year,
      make,
      model,
      damage_type,
      description,
      preferred_date,
      photos,
    } = req.body || {};

    if (
      !name?.trim() ||
      !phone?.trim() ||
      !email?.trim() ||
      !year?.toString().trim() ||
      !make?.trim() ||
      !model?.trim() ||
      !damage_type?.trim()
    ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const normalizedEmail = String(email).trim();
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const normalizedPhoneDigits = String(phone).replace(/\D/g, '');
    if (normalizedPhoneDigits.length < 10) {
      return res.status(400).json({ error: 'Invalid phone' });
    }

    let normalizedPreferredDate = null;
    if (preferred_date) {
      const parsedPreferredDate = new Date(preferred_date);
      if (Number.isNaN(parsedPreferredDate.getTime())) {
        return res.status(400).json({ error: 'Invalid preferred_date' });
      }
      normalizedPreferredDate = parsedPreferredDate.toISOString();
    }

    const allowedDamageTypes = ['front impact', 'rear impact', 'side damage', 'hail', 'glass'];
    if (!allowedDamageTypes.includes(String(damage_type).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid damage_type' });
    }

    if (!validIntakePhotos(photos)) {
      return res.status(400).json({ error: 'Invalid photos: up to 5 JPEG, PNG or WebP base64 images, 300 KiB each' });
    }
    const normalizedPhotos = photos || [];
    const requestId = uuidv4();

    await dbRun(
      `INSERT INTO estimate_requests
        (id, shop_id, name, phone, email, year, make, model, damage_type, description, preferred_date, photos_json, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')`,
      [
        requestId,
        resolvedShopId,
        name.trim(),
        normalizedPhoneDigits,
        normalizedEmail,
        String(year).trim(),
        make.trim(),
        model.trim(),
        String(damage_type).toLowerCase(),
        description?.trim() || null,
        normalizedPreferredDate,
        JSON.stringify(normalizedPhotos),
      ]
    );

    // Only internal identifiers and a fixed request type may leave the app.
    Promise.resolve().then(() => sendDiscordEmbed({
      title: 'New intake request',
      fields: [
        { name: 'Shop ID', value: resolvedShopId },
        { name: 'Request ID', value: requestId },
        { name: 'Type', value: 'estimate' },
      ],
    })).catch(() => console.error('[Public Intake] Notification failed'));

    return res.status(201).json({ success: true, message: 'Request received' });
  } catch (err) {
    return sendPublicIntakeError(res, err);
  }
});

module.exports = router;
