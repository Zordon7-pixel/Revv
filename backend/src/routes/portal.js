const router = require('express').Router();
const { dbGet, dbAll } = require('../db');
const auth   = require('../middleware/auth');

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

module.exports = router;
