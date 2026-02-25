const router = require('express').Router();
const { dbGet, dbAll } = require('../db');

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
    console.error('[Public Shop] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
