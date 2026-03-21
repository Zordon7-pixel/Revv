/**
 * GET /api/export/ro/:id
 *
 * Returns a complete structured package of everything REVV knows about an RO:
 *   - RO details + vehicle + customer
 *   - Estimate line items
 *   - Parts orders
 *   - Supplements
 *   - Payments
 *   - Photos (URLs)
 *   - SMS thread
 *   - Status history
 *   - Internal notes (admin only)
 *
 * Used by OpenClaw sync agents to organise local folders on Miles' Mac mini.
 */

const router = require('express').Router();
const auth = require('../middleware/auth');
const { dbGet, dbAll } = require('../db');

router.get('/ro/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const shopId = req.user.shop_id;

    // ── Core RO + vehicle + customer ────────────────────────────────────────
    const ro = await dbGet(
      `SELECT ro.*,
              v.year, v.make, v.model, v.vin, v.color, v.license_plate,
              c.name  AS customer_name,
              c.email AS customer_email,
              c.phone AS customer_phone,
              s.name  AS shop_name,
              s.phone AS shop_phone,
              s.address AS shop_address
       FROM repair_orders ro
       LEFT JOIN vehicles  v ON v.id = ro.vehicle_id
       LEFT JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN shops     s ON s.id = ro.shop_id
       WHERE ro.id = $1 AND ro.shop_id = $2`,
      [id, shopId]
    );

    if (!ro) return res.status(404).json({ error: 'RO not found' });

    // ── Parallel data fetches ────────────────────────────────────────────────
    const [
      estimateItems,
      partsOrders,
      supplements,
      payments,
      photos,
      smsMessages,
      statusHistory,
      internalNotes,
    ] = await Promise.all([
      // Estimate line items
      dbAll(
        `SELECT id, description, type, quantity, unit_price, total, taxable, sort_order, created_at
         FROM estimate_line_items
         WHERE ro_id = $1
         ORDER BY sort_order ASC, created_at ASC`,
        [id]
      ).catch(() => []),

      // Parts orders
      dbAll(
        `SELECT id, part_name, part_number, quantity, unit_cost, vendor, status, ordered_at, received_at
         FROM parts_orders
         WHERE ro_id = $1 AND shop_id = $2
         ORDER BY created_at ASC`,
        [id, shopId]
      ).catch(() => []),

      // Supplements
      dbAll(
        `SELECT id, description, amount, status, submitted_date, notes
         FROM ro_supplements
         WHERE ro_id = $1 AND shop_id = $2
         ORDER BY submitted_date ASC`,
        [id, shopId]
      ).catch(() => []),

      // Payments
      dbAll(
        `SELECT id, amount, payment_method, paid_at, notes
         FROM ro_payments
         WHERE ro_id = $1 AND shop_id = $2
         ORDER BY paid_at ASC`,
        [id, shopId]
      ).catch(() => []),

      // Photos
      dbAll(
        `SELECT id, photo_url, caption, photo_type, created_at
         FROM ro_photos
         WHERE ro_id = $1
         ORDER BY created_at ASC`,
        [id]
      ).catch(() => []),

      // SMS thread
      dbAll(
        `SELECT id, direction, from_phone, to_phone, body, created_at
         FROM sms_messages
         WHERE ro_id = $1 AND shop_id = $2
         ORDER BY created_at ASC`,
        [id, shopId]
      ).catch(() => []),

      // Status history
      dbAll(
        `SELECT id, from_status, to_status, note, changed_by, created_at
         FROM job_status_log
         WHERE ro_id = $1
         ORDER BY created_at ASC`,
        [id]
      ).catch(() => []),

      // Internal notes (visible to admin only — checked at caller level)
      req.user.role === 'admin' || req.user.role === 'assistant'
        ? dbAll(
            `SELECT id, note, created_at
             FROM ro_internal_notes
             WHERE ro_id = $1 AND shop_id = $2
             ORDER BY created_at ASC`,
            [id, shopId]
          ).catch(() => [])
        : Promise.resolve([]),
    ]);

    // ── Summary financials ───────────────────────────────────────────────────
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const estimateTotal = estimateItems.reduce((sum, i) => sum + Number(i.total || 0), 0);
    const partsTotal = partsOrders.reduce(
      (sum, p) => sum + Number(p.unit_cost || 0) * Number(p.quantity || 1),
      0
    );
    const supplementTotal = supplements
      .filter(s => s.status === 'Approved')
      .reduce((sum, s) => sum + Number(s.amount || 0), 0);

    // ── Folder name suggestion (for OpenClaw sync agent) ─────────────────────
    const vehicle = [ro.year, ro.make, ro.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
    const roNum = ro.ro_number || ro.id.slice(0, 8).toUpperCase();
    const customerSlug = (ro.customer_name || 'Unknown').replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const dateSlug = ro.intake_date
      ? new Date(ro.intake_date).toISOString().slice(0, 7)
      : new Date(ro.created_at).toISOString().slice(0, 7);
    const suggestedFolder = `${dateSlug} / RO-${roNum} — ${vehicle} (${customerSlug})`;

    // ── Response ─────────────────────────────────────────────────────────────
    return res.json({
      success: true,
      exported_at: new Date().toISOString(),
      suggested_folder: suggestedFolder,

      ro: {
        id: ro.id,
        ro_number: ro.ro_number,
        status: ro.status,
        job_type: ro.job_type,
        intake_date: ro.intake_date,
        estimated_delivery: ro.estimated_delivery,
        actual_delivery: ro.actual_delivery,
        claim_number: ro.claim_number,
        insurer: ro.insurer,
        insurance_company: ro.insurance_company,
        adjuster_name: ro.adjuster_name,
        adjuster_phone: ro.adjuster_phone,
        notes: ro.notes,
        created_at: ro.created_at,
      },

      vehicle: {
        year: ro.year,
        make: ro.make,
        model: ro.model,
        vin: ro.vin,
        color: ro.color,
        license_plate: ro.license_plate,
      },

      customer: {
        name: ro.customer_name,
        email: ro.customer_email,
        phone: ro.customer_phone,
      },

      shop: {
        name: ro.shop_name,
        phone: ro.shop_phone,
        address: ro.shop_address,
      },

      financials: {
        estimate_total: estimateTotal,
        parts_total: partsTotal,
        supplement_total: supplementTotal,
        total_paid: totalPaid,
        balance_due: Math.max(0, estimateTotal - totalPaid),
        insurance_approved_amount: ro.insurance_approved_amount,
        deductible: ro.deductible,
      },

      estimate_items: estimateItems,
      parts_orders: partsOrders,
      supplements,
      payments,
      photos,
      sms_thread: smsMessages,
      status_history: statusHistory,
      internal_notes: internalNotes,
    });
  } catch (err) {
    console.error('[export/ro] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/export/shop/ros
 *
 * Returns a lightweight index of all ROs for the shop — for OpenClaw to
 * detect new/changed jobs and decide which ones need a local folder sync.
 */
router.get('/shop/ros', auth, async (req, res) => {
  try {
    const { since } = req.query; // ISO timestamp — only return ROs updated after this
    const shopId = req.user.shop_id;

    const sinceClause = since ? `AND ro.updated_at > $2` : '';
    const params = since ? [shopId, since] : [shopId];

    const rows = await dbAll(
      `SELECT ro.id, ro.ro_number, ro.status, ro.updated_at, ro.created_at,
              v.year, v.make, v.model,
              c.name AS customer_name
       FROM repair_orders ro
       LEFT JOIN vehicles  v ON v.id = ro.vehicle_id
       LEFT JOIN customers c ON c.id = ro.customer_id
       WHERE ro.shop_id = $1 ${sinceClause}
       ORDER BY ro.updated_at DESC
       LIMIT 500`,
      params
    );

    return res.json({
      success: true,
      count: rows.length,
      ros: rows,
    });
  } catch (err) {
    console.error('[export/shop/ros] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
