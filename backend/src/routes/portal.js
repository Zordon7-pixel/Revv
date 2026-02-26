const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth   = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createNotification } = require('../services/notifications');

const STATUS_MESSAGES = {
  intake:   { label: 'Vehicle Received',        msg: "Your vehicle has been received at the shop and is being checked in.",         emoji: '📋' },
  estimate: { label: 'Preparing Estimate',       msg: "We're inspecting your vehicle and preparing your repair estimate.",            emoji: '🔍' },
  approval: { label: 'Awaiting Approval',        msg: "Your estimate is ready. We're waiting for insurance or your authorization.",   emoji: '⏳' },
  parts:    { label: 'Parts on Order',           msg: "Approved! We're ordering the parts needed for your repair.",                  emoji: '📦' },
  repair:   { label: 'In Repair',                msg: "Your vehicle is currently being repaired by our technicians.",                emoji: '🔧' },
  paint:    { label: 'In Paint',                 msg: "The bodywork is done. Your vehicle is in our paint booth.",                   emoji: '🎨' },
  qc:       { label: 'Quality Check',            msg: "Paint is complete. We're doing a final quality inspection.",                  emoji: '✅' },
  delivery: { label: 'Ready for Pickup! 🎉',    msg: "Your vehicle is ready! Please call us to arrange pickup.",                   emoji: '🚗' },
  closed:   { label: 'Repair Complete',          msg: "Your repair is complete and your vehicle has been picked up. Thank you!",    emoji: '⭐' },
};

const uploadDir = path.join(__dirname, '../../uploads/portal-photos');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

async function notifyOwnersAndAdmins(shopId, type, title, body, roId) {
  const users = await dbAll(
    'SELECT id FROM users WHERE shop_id = $1 AND role = ANY($2::text[])',
    [shopId, ['owner', 'admin']]
  );
  await Promise.all(users.map((user) => createNotification(shopId, user.id, type, title, body, roId)));
}

router.get('/my-ros', auth, async (req, res) => {
  try {
    if (!req.user.customer_id) return res.status(403).json({ error: 'No customer profile linked to this account' });

    const ros = await dbAll(`
      SELECT ro.id, ro.ro_number, ro.status, ro.job_type, ro.intake_date, ro.estimated_delivery, ro.actual_delivery,
             v.year, v.make, v.model, v.color, v.plate,
             s.name as shop_name, s.phone as shop_phone, s.address as shop_address
      FROM repair_orders ro
      JOIN vehicles v ON v.id = ro.vehicle_id
      JOIN shops s    ON s.id = ro.shop_id
      WHERE ro.customer_id = $1 AND ro.shop_id = $2
      ORDER BY ro.created_at DESC
    `, [req.user.customer_id, req.user.shop_id]);

    const enriched = await Promise.all(ros.map(async (r) => {
      const pendingParts = await dbAll(`
        SELECT part_name, status, expected_date, tracking_status, tracking_detail, carrier
        FROM parts_orders
        WHERE ro_id = $1 AND status IN ('ordered','backordered')
        ORDER BY created_at ASC
      `, [r.id]);
      return {
        ...r,
        status_info: STATUS_MESSAGES[r.status] || { label: r.status, msg: 'Your vehicle is being worked on.', emoji: '🔧' },
        pending_parts: pendingParts,
      };
    }));

    res.json({ ros: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/shop', auth, async (req, res) => {
  try {
    const shop = await dbGet('SELECT name, phone, address, city, state, zip FROM shops WHERE id = $1', [req.user.shop_id]);
    res.json(shop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer tracking portal - public endpoints

router.get('/track/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find the portal token
    const tokenRecord = await dbGet(`
      SELECT id, ro_id, shop_id, created_at, expires_at
      FROM portal_tokens
      WHERE token = $1
    `, [token]);
    
    if (!tokenRecord) {
      return res.status(404).json({ error: 'Tracking link not found' });
    }
    
    // Check expiration
    if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Tracking link has expired' });
    }
    
    // Get RO with vehicle, customer, shop info
    const ro = await dbGet(`
      SELECT ro.*, 
             v.year, v.make, v.model, v.color, v.plate, v.vin,
             c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
             s.name as shop_name, s.phone as shop_phone, s.address as shop_address, s.city as shop_city, s.state as shop_state, s.zip as shop_zip
      FROM repair_orders ro
      LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      LEFT JOIN customers c ON c.id = ro.customer_id
      LEFT JOIN shops s ON s.id = ro.shop_id
      WHERE ro.id = $1
    `, [tokenRecord.ro_id]);
    
    if (!ro) {
      return res.status(404).json({ error: 'Repair order not found' });
    }
    
    // Get parts
    const parts = await dbAll(`
      SELECT part_name, part_number, status, expected_date, received_date
      FROM parts_orders
      WHERE ro_id = $1
      ORDER BY created_at ASC
    `, [ro.id]);
    
    // Get photos
    const photos = await dbAll(`
      SELECT id, photo_url, caption, photo_type, created_at
      FROM ro_photos
      WHERE ro_id = $1
      ORDER BY created_at DESC
    `, [ro.id]);
    
    // Get status log for timeline
    const timeline = await dbAll(`
      SELECT to_status, note, created_at
      FROM job_status_log
      WHERE ro_id = $1
      ORDER BY created_at ASC
    `, [ro.id]);
    
    // Check if customer has already rated
    const existingRating = await dbGet(`
      SELECT rating FROM ro_ratings WHERE ro_id = $1
    `, [ro.id]);
    
    res.json({
      ro: {
        id: ro.id,
        ro_number: ro.ro_number,
        status: ro.status,
        job_type: ro.job_type,
        intake_date: ro.intake_date,
        estimated_delivery: ro.estimated_delivery,
        actual_delivery: ro.actual_delivery,
        notes: ro.notes,
        parts_cost: ro.parts_cost,
        labor_cost: ro.labor_cost,
        total: ro.total,
      },
      vehicle: {
        year: ro.year,
        make: ro.make,
        model: ro.model,
        color: ro.color,
        plate: ro.plate,
        vin: ro.vin,
      },
      customer: {
        name: ro.customer_name,
        phone: ro.customer_phone,
      },
      shop: {
        id: ro.shop_id,
        name: ro.shop_name,
        phone: ro.shop_phone,
        address: ro.shop_address,
        city: ro.shop_city,
        state: ro.shop_state,
        zip: ro.shop_zip,
      },
      parts,
      photos,
      timeline,
      has_rated: !!existingRating,
      user_rating: existingRating?.rating || null,
    });
  } catch (err) {
    console.error('[Portal Track] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Submit a message to the shop (public)
router.post('/track/:token/message', async (req, res) => {
  try {
    const { token } = req.params;
    const { notes } = req.body;
    
    if (!notes?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const tokenRecord = await dbGet(`
      SELECT ro_id, shop_id FROM portal_tokens WHERE token = $1
    `, [token]);
    
    if (!tokenRecord) {
      return res.status(404).json({ error: 'Tracking link not found' });
    }
    
    const id = require('uuid').v4();
    await dbRun(`
      INSERT INTO ro_comms (id, ro_id, shop_id, user_id, type, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, tokenRecord.ro_id, tokenRecord.shop_id, null, 'text', notes.trim()]);

    const ro = await dbGet('SELECT ro_number FROM repair_orders WHERE id = $1', [tokenRecord.ro_id]);
    await notifyOwnersAndAdmins(
      tokenRecord.shop_id,
      'customer_message',
      'New Customer Message',
      `Customer sent a new message on RO #${ro?.ro_number || 'N/A'}.`,
      tokenRecord.ro_id
    );
    
    res.json({ ok: true, message: 'Message sent to shop' });
  } catch (err) {
    console.error('[Portal Message] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/track/:token/photo', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const tokenRecord = await dbGet('SELECT ro_id, shop_id FROM portal_tokens WHERE token = $1', [req.params.token]);
    if (!tokenRecord) return res.status(404).json({ error: 'Tracking link not found' });

    const photoId = uuidv4();
    const photoUrl = `/uploads/portal-photos/${req.file.filename}`;
    await dbRun(
      'INSERT INTO ro_photos (id, ro_id, user_id, photo_url, caption, photo_type) VALUES ($1, $2, $3, $4, $5, $6)',
      [photoId, tokenRecord.ro_id, null, photoUrl, req.body?.caption || 'Customer upload', 'customer']
    );

    const ro = await dbGet('SELECT ro_number FROM repair_orders WHERE id = $1', [tokenRecord.ro_id]);
    await notifyOwnersAndAdmins(
      tokenRecord.shop_id,
      'customer_message',
      'New Customer Photo',
      `Customer uploaded a photo for RO #${ro?.ro_number || 'N/A'}.`,
      tokenRecord.ro_id
    );

    return res.status(201).json({ ok: true, photo_url: photoUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Submit a rating (public)
router.post('/track/:token/rating', async (req, res) => {
  try {
    const { token } = req.params;
    const { rating } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    const tokenRecord = await dbGet(`
      SELECT ro_id, shop_id FROM portal_tokens WHERE token = $1
    `, [token]);
    
    if (!tokenRecord) {
      return res.status(404).json({ error: 'Tracking link not found' });
    }

    const ro = await dbGet('SELECT status FROM repair_orders WHERE id = $1', [tokenRecord.ro_id]);
    if (!ro) {
      return res.status(404).json({ error: 'Repair order not found' });
    }
    if (ro.status !== 'closed') {
      return res.status(400).json({ error: 'Ratings are available after the repair is closed' });
    }
    
    // Check if already rated
    const existing = await dbGet(`
      SELECT id FROM ro_ratings WHERE ro_id = $1
    `, [tokenRecord.ro_id]);
    
    if (existing) {
      return res.status(400).json({ error: 'You have already submitted a rating' });
    }
    
    const id = uuidv4();
    await dbRun(`
      INSERT INTO ro_ratings (id, ro_id, shop_id, rating)
      VALUES ($1, $2, $3, $4)
    `, [id, tokenRecord.ro_id, tokenRecord.shop_id, rating]);
    
    res.json({ ok: true, message: 'Rating submitted', rating });
  } catch (err) {
    console.error('[Portal Rating] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate magic link for an RO (auth required)
async function createMagicLink(req, res, roId) {
  try {
    const ro = await dbGet(`
      SELECT ro.*, c.phone as customer_phone, c.name as customer_name,
             s.name as shop_name, s.twilio_phone_number
      FROM repair_orders ro
      LEFT JOIN customers c ON c.id = ro.customer_id
      LEFT JOIN shops s ON s.id = ro.shop_id
      WHERE ro.id = $1 AND ro.shop_id = $2
    `, [roId, req.user.shop_id]);
    
    if (!ro) {
      return res.status(404).json({ error: 'Repair order not found' });
    }
    
    // Generate unique token
    const token = uuidv4().replace(/-/g, '');
    
    // Store token
    const id = uuidv4();
    await dbRun(`
      INSERT INTO portal_tokens (id, ro_id, shop_id, token)
      VALUES ($1, $2, $3, $4)
    `, [id, roId, req.user.shop_id, token]);
    
    // Build tracking URL
    const baseUrl = req.protocol + '://' + req.get('host');
    const trackingUrl = `${baseUrl}/track/${token}`;
    
    // Send SMS to customer (non-blocking)
    if (ro.customer_phone) {
      setImmediate(async () => {
        try {
          const { sendSMS, isConfigured } = require('../services/sms');
          if (isConfigured()) {
            const message = `Hi ${ro.customer_name || 'there'}! Track your vehicle repair at ${ro.shop_name}:\n${trackingUrl}`;
            await sendSMS(ro.customer_phone, message);
            console.log(`[Portal] Tracking link SMS sent for RO ${ro.ro_number}`);
          }
        } catch (err) {
          console.error('[Portal] SMS failed:', err.message);
        }
      });
    }
    
    res.json({ 
      token, 
      trackingUrl,
      message: 'Tracking link generated and SMS sent to customer'
    });
  } catch (err) {
    console.error('[Portal Magic Link] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

router.post('/magic-link/:ro_id', auth, async (req, res) => {
  return createMagicLink(req, res, req.params.ro_id);
});

module.exports = router;
