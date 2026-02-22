/**
 * Customer Portal Routes
 * Customers log in and can ONLY see their own repair orders.
 * No financial data, no other customers, no admin functions.
 */
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// Plain-English status descriptions for customers
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

// GET /api/portal/my-ros — customer sees only their own repair orders
router.get('/my-ros', auth, (req, res) => {
  if (!req.user.customer_id) return res.status(403).json({ error: 'No customer profile linked to this account' });

  const ros = db.prepare(`
    SELECT ro.id, ro.ro_number, ro.status, ro.job_type, ro.intake_date, ro.estimated_delivery, ro.actual_delivery,
           v.year, v.make, v.model, v.color, v.plate,
           s.name as shop_name, s.phone as shop_phone, s.address as shop_address
    FROM repair_orders ro
    JOIN vehicles v ON v.id = ro.vehicle_id
    JOIN shops s    ON s.id = ro.shop_id
    WHERE ro.customer_id = ? AND ro.shop_id = ?
    ORDER BY ro.created_at DESC
  `).all(req.user.customer_id, req.user.shop_id);

  const enriched = ros.map(r => {
    // Fetch pending parts — shown to customer when in 'parts' stage
    // Include tracking status but strip cost/part_number (customer-safe fields only)
    const pendingParts = db.prepare(`
      SELECT part_name, status, expected_date, tracking_status, tracking_detail, carrier
      FROM parts_orders
      WHERE ro_id = ? AND status IN ('ordered','backordered')
      ORDER BY created_at ASC
    `).all(r.id);

    return {
      ...r,
      status_info: STATUS_MESSAGES[r.status] || { label: r.status, msg: 'Your vehicle is being worked on.', emoji: '🔧' },
      pending_parts: pendingParts,
    };
  });

  res.json({ ros: enriched });
});

// GET /api/portal/shop — shop contact info only (for SMS button)
router.get('/shop', auth, (req, res) => {
  const shop = db.prepare('SELECT name, phone, address, city, state, zip FROM shops WHERE id = ?').get(req.user.shop_id);
  res.json(shop);
});

module.exports = router;
