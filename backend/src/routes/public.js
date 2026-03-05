const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const estimateRequestRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const {
      shop_id,
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

    if (Array.isArray(photos) && photos.length > 5) {
      return res.status(400).json({ error: 'A maximum of 5 photos is allowed' });
    }

    const incomingPhotos = Array.isArray(photos) ? photos : [];
    const normalizedPhotos = incomingPhotos
      .map((photo) => {
        if (!photo || typeof photo !== 'string') return null;
        return photo.trim();
      })
      .filter(Boolean);

    let resolvedShopId = req.query?.shop || shop_id || null;
    if (resolvedShopId) {
      const shop = await dbGet('SELECT id FROM shops WHERE id = $1', [resolvedShopId]);
      if (!shop?.id) return res.status(400).json({ error: 'Invalid shop_id' });
      resolvedShopId = shop.id;
    } else {
      const firstShop = await dbGet('SELECT id FROM shops ORDER BY created_at ASC LIMIT 1');
      resolvedShopId = firstShop?.id || null;
    }

    await dbRun(
      `INSERT INTO estimate_requests
        (id, shop_id, name, phone, email, year, make, model, damage_type, description, preferred_date, photos_json, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')`,
      [
        uuidv4(),
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

    return res.status(201).json({ success: true, message: 'Request received' });
  } catch (err) {
    console.error('[Public Estimate Request] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
