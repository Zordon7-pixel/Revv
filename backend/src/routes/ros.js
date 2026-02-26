const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');
const { calculateProfit } = require('../services/profit');
const { sendSMS, isConfigured } = require('../services/sms');
const { getStatusMessage } = require('../services/notifications');
const { sendMail } = require('../services/mailer');
const { v4: uuidv4 } = require('uuid');

const STATUSES = ['intake','estimate','approval','parts','repair','paint','qc','delivery','closed'];
const COMM_TYPES = ['call', 'text', 'email', 'in-person'];

async function ensureRoCommsTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ro_comms (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

async function ensureApprovalLinksTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS estimate_approval_links (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_by TEXT,
      decline_reason TEXT,
      responded_at TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

async function enrichRO(ro) {
  if (!ro) return null;
  const vehicle  = await dbGet('SELECT * FROM vehicles WHERE id = $1', [ro.vehicle_id]);
  const customer = await dbGet('SELECT * FROM customers WHERE id = $1', [ro.customer_id]);
  const log      = await dbAll('SELECT * FROM job_status_log WHERE ro_id = $1 ORDER BY created_at ASC', [ro.id]);
  const parts    = await dbAll('SELECT * FROM parts_orders WHERE ro_id = $1 ORDER BY created_at ASC', [ro.id]);
  const profit   = calculateProfit(ro);
  const assigned_tech = ro.assigned_to
    ? await dbGet('SELECT id, name, role FROM users WHERE id = $1', [ro.assigned_to])
    : null;
  if (customer) {
    const portalUser = await dbGet('SELECT id FROM users WHERE customer_id = $1 AND shop_id = $2', [customer.id, ro.shop_id]);
    customer.has_portal_access = !!portalUser;
  }
  return { ...ro, vehicle, customer, log, parts, profit, assigned_tech };
}

router.get('/', auth, async (req, res) => {
  try {
    const ros = await dbAll(`
      SELECT ro.*, v.year, v.make, v.model, v.color, c.name as customer_name, c.phone as customer_phone
      FROM repair_orders ro
      LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      LEFT JOIN customers c ON c.id = ro.customer_id
      WHERE ro.shop_id = $1
      ORDER BY ro.created_at DESC
    `, [req.user.shop_id]);
    res.json({ ros });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/carryover-pending', auth, requireAdmin, async (req, res) => {
  try {
    const ros = await dbAll(
      `
        SELECT
          ro.id,
          ro.ro_number,
          c.name AS customer_name,
          CONCAT_WS(' ', v.year::text, v.make, v.model) AS vehicle,
          ro.total AS total_cost,
          ro.billing_month,
          ro.status,
          ro.revenue_period,
          ro.carried_over
        FROM repair_orders ro
        LEFT JOIN customers c ON c.id = ro.customer_id
        LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        WHERE ro.shop_id = $1
          AND ro.carried_over = TRUE
        ORDER BY ro.created_at ASC
      `,
      [req.user.shop_id]
    );
    return res.json({ ros });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/:id/revenue-period', auth, requireAdmin, async (req, res) => {
  try {
    const { revenue_period } = req.body || {};
    if (!['previous', 'current'].includes(revenue_period)) {
      return res.status(400).json({ error: 'Invalid revenue_period' });
    }

    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    if (revenue_period === 'current') {
      await dbRun(
        `
          UPDATE repair_orders
          SET revenue_period = $1,
              billing_month = TO_CHAR(NOW(), 'YYYY-MM'),
              carried_over = FALSE,
              updated_at = $2
          WHERE id = $3 AND shop_id = $4
        `,
        [revenue_period, new Date().toISOString(), req.params.id, req.user.shop_id]
      );
    } else {
      await dbRun(
        `
          UPDATE repair_orders
          SET revenue_period = $1,
              carried_over = FALSE,
              updated_at = $2
          WHERE id = $3 AND shop_id = $4
        `,
        [revenue_period, new Date().toISOString(), req.params.id, req.user.shop_id]
      );
    }

    const updated = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    return res.json({ ok: true, ro: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/job-cost/summary', auth, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    let dateFilter = '';
    const params = [req.user.shop_id];
    if (from) { params.push(from); dateFilter += ` AND ro.created_at >= $${params.length}`; }
    if (to)   { params.push(to + ' 23:59:59'); dateFilter += ` AND ro.created_at <= $${params.length}`; }

    const rows = await dbAll(`
      SELECT ro.id, ro.ro_number, ro.status, ro.total, ro.parts_cost, ro.labor_cost,
             ro.sublet_cost, ro.true_profit, ro.created_at,
             c.name AS customer_name, v.year, v.make, v.model
      FROM repair_orders ro
      LEFT JOIN customers c ON c.id = ro.customer_id
      LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE ro.shop_id = $1${dateFilter}
      ORDER BY ro.created_at DESC
    `, params);

    const totalJobs = rows.length;
    const totalRevenue = rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
    const totalCost = rows.reduce((s, r) => s + parseFloat(r.parts_cost || 0) + parseFloat(r.labor_cost || 0) + parseFloat(r.sublet_cost || 0), 0);
    const grossProfit = rows.reduce((s, r) => s + parseFloat(r.true_profit || 0), 0);
    const profitableCount = rows.filter(r => parseFloat(r.true_profit || 0) > 0).length;
    const avgMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    res.json({ totalJobs, totalRevenue, totalCost, grossProfit, avgMargin, profitableCount, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });
    res.json(await enrichRO(ro));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/invoice', auth, async (req, res) => {
  try {
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });
    const shop = await dbGet('SELECT * FROM shops WHERE id = $1', [ro.shop_id]);
    res.json({ ...await enrichRO(ro), shop });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/email-invoice', auth, async (req, res) => {
  try {
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const customer = await dbGet('SELECT name, email FROM customers WHERE id = $1', [ro.customer_id]);
    if (!customer?.email) return res.status(400).json({ error: 'Customer email not found' });

    const shop = await dbGet('SELECT name, phone FROM shops WHERE id = $1', [ro.shop_id]);
    const invoiceTotal = Number(ro.total || (Number(ro.parts_cost || 0) + Number(ro.labor_cost || 0) + Number(ro.sublet_cost || 0)));
    const subject = `Invoice ${ro.ro_number} from ${shop?.name || 'REVV Shop'}`;
    const html = `
      <h3>Invoice Ready</h3>
      <p>RO: <strong>${ro.ro_number}</strong></p>
      <p>Total: <strong>$${invoiceTotal.toFixed(2)}</strong></p>
      <p>Thank you for your business.${shop?.phone ? ` Contact us: ${shop.phone}` : ''}</p>
    `;

    const sent = await sendMail(customer.email, subject, html);
    if (!sent) {
      console.log('[InvoiceEmail] Email skipped: mail not configured', { roId: ro.id, customer: customer.email });
      return res.json({ ok: true, skipped: true, reason: 'email_not_configured' });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id/comms', auth, async (req, res) => {
  try {
    await ensureRoCommsTable();
    const ro = await dbGet('SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const comms = await dbAll(
      `SELECT
        c.id,
        c.type,
        c.notes,
        c.created_at,
        c.user_id,
        COALESCE(u.name, 'System') AS logged_by
       FROM ro_comms c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.ro_id = $1 AND c.shop_id = $2
       ORDER BY c.created_at DESC`,
      [req.params.id, req.user.shop_id]
    );
    return res.json({ comms });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/comms', auth, async (req, res) => {
  try {
    await ensureRoCommsTable();
    const ro = await dbGet('SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const { type, notes } = req.body || {};
    if (!COMM_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid communication type' });
    if (!notes?.trim()) return res.status(400).json({ error: 'Notes are required' });

    const id = uuidv4();
    await dbRun(
      `INSERT INTO ro_comms (id, ro_id, shop_id, user_id, type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, req.params.id, req.user.shop_id, req.user.id, type, notes.trim()]
    );

    const comm = await dbGet(
      `SELECT
        c.id,
        c.type,
        c.notes,
        c.created_at,
        c.user_id,
        COALESCE(u.name, 'System') AS logged_by
       FROM ro_comms c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [id]
    );
    return res.status(201).json({ comm });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approval-link', auth, async (req, res) => {
  try {
    await ensureApprovalLinksTable();
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const token = uuidv4().replace(/-/g, '');
    const existing = await dbGet('SELECT id FROM estimate_approval_links WHERE ro_id = $1 AND responded_at IS NULL', [ro.id]);
    if (existing) {
      await dbRun('DELETE FROM estimate_approval_links WHERE id = $1', [existing.id]);
    }
    await dbRun(
      `INSERT INTO estimate_approval_links (id, ro_id, shop_id, token, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), ro.id, req.user.shop_id, token, req.user.id]
    );
    await dbRun('UPDATE repair_orders SET estimate_token = $1, updated_at = $2 WHERE id = $3', [token, new Date().toISOString(), ro.id]);
    return res.json({ token, link: `${req.protocol}://${req.get('host')}/approve/${token}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/approval/:token', async (req, res) => {
  try {
    await ensureApprovalLinksTable();
    const link = await dbGet('SELECT * FROM estimate_approval_links WHERE token = $1', [req.params.token]);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [link.ro_id]);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });
    const customer = await dbGet('SELECT id, name, phone, email FROM customers WHERE id = $1', [ro.customer_id]);
    const vehicle = await dbGet('SELECT id, year, make, model FROM vehicles WHERE id = $1', [ro.vehicle_id]);
    const shop = await dbGet('SELECT id, name, phone FROM shops WHERE id = $1', [ro.shop_id]);

    return res.json({
      link: { token: link.token, responded_at: link.responded_at, decline_reason: link.decline_reason },
      ro: {
        id: ro.id,
        ro_number: ro.ro_number,
        status: ro.status,
        parts_cost: ro.parts_cost || 0,
        labor_cost: ro.labor_cost || 0,
        sublet_cost: ro.sublet_cost || 0,
        tax: ro.tax || 0,
        total: ro.total || 0,
      },
      customer,
      vehicle,
      shop,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/approval/:token/respond', async (req, res) => {
  try {
    await ensureApprovalLinksTable();
    await ensureRoCommsTable();
    const link = await dbGet('SELECT * FROM estimate_approval_links WHERE token = $1', [req.params.token]);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.responded_at) return res.status(400).json({ error: 'Response already submitted' });

    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [link.ro_id]);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const { decision, reason } = req.body || {};
    if (!['approve', 'decline'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision' });
    }

    const now = new Date().toISOString();
    if (decision === 'approve') {
      const fromStatus = ro.status;
      await dbRun('UPDATE repair_orders SET status = $1, estimate_approved_at = $2, updated_at = $3 WHERE id = $4', ['approval', now, now, ro.id]);
      await dbRun(
        'INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuidv4(), ro.id, fromStatus, 'approval', null, 'Estimate approved by customer via public approval link']
      );
      await dbRun('UPDATE estimate_approval_links SET responded_at = $1 WHERE token = $2', [now, req.params.token]);
      return res.json({ ok: true, decision: 'approve' });
    }

    if (!reason?.trim()) return res.status(400).json({ error: 'Reason is required when requesting changes' });

    await dbRun(
      `INSERT INTO ro_comms (id, ro_id, shop_id, user_id, type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), ro.id, ro.shop_id, null, 'email', `Estimate change request: ${reason.trim()}`]
    );
    await dbRun('UPDATE estimate_approval_links SET responded_at = $1, decline_reason = $2 WHERE token = $3', [now, reason.trim(), req.params.token]);
    return res.json({ ok: true, decision: 'decline' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { customer_id, vehicle_id, job_type, payment_type, claim_number, insurer, adjuster_name, adjuster_phone, deductible, notes, estimated_delivery, damaged_panels } = req.body;
    const countRow = await dbGet('SELECT COUNT(*)::int as n FROM repair_orders WHERE shop_id = $1', [req.user.shop_id]);
    const roNumber = `RO-2026-${String(countRow.n + 1).padStart(4, '0')}`;
    const id = uuidv4();
    const today = new Date().toISOString().split('T')[0];
    const panelsJson = Array.isArray(damaged_panels) ? JSON.stringify(damaged_panels) : (damaged_panels || '[]');
    await dbRun(`
      INSERT INTO repair_orders (id, shop_id, ro_number, vehicle_id, customer_id, job_type, status, payment_type, claim_number, insurer, adjuster_name, adjuster_phone, deductible, intake_date, estimated_delivery, notes, damaged_panels)
      VALUES ($1, $2, $3, $4, $5, $6, 'intake', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [id, req.user.shop_id, roNumber, vehicle_id, customer_id, job_type || 'collision', payment_type || 'insurance', claim_number || null, insurer || null, adjuster_name || null, adjuster_phone || null, deductible || 0, today, estimated_delivery || null, notes || null, panelsJson]);
    await dbRun('INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4, $5)', [uuidv4(), id, null, 'intake', req.user.id]);
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [id]);
    
    // Auto-generate tracking link and send SMS (non-blocking)
    setImmediate(async () => {
      try {
        const { dbRun: run, dbGet: get } = require('../db');
        const { sendSMS, isConfigured } = require('../services/sms');
        
        // Get customer and shop info
        const roContext = await get(`
          SELECT ro.*, c.phone as customer_phone, c.name as customer_name,
                 s.name as shop_name, s.twilio_phone_number
          FROM repair_orders ro
          LEFT JOIN customers c ON c.id = ro.customer_id
          LEFT JOIN shops s ON s.id = ro.shop_id
          WHERE ro.id = $1
        `, [id]);
        
        if (!roContext?.customer_phone) return;
        
        // Generate token
        const token = uuidv4().replace(/-/g, '');
        const tokenId = uuidv4();
        await run(`
          INSERT INTO portal_tokens (id, ro_id, shop_id, token)
          VALUES ($1, $2, $3, $4)
        `, [tokenId, id, req.user.shop_id, token]);
        
        // Send SMS
        if (isConfigured()) {
          const baseUrl = process.env.PUBLIC_URL || 'https://revv-production-ffa9.up.railway.app';
          const trackingUrl = `${baseUrl}/track/${token}`;
          const message = `Hi ${roContext.customer_name || 'there'}! Track your vehicle repair at ${roContext.shop_name}:\n${trackingUrl}`;
          await sendSMS(roContext.customer_phone, message);
          console.log(`[Auto-Track] Tracking link SMS sent for RO ${roNumber}`);
        }
      } catch (err) {
        console.error('[Auto-Track] Failed to send tracking SMS:', err.message);
      }
    });
    
    res.status(201).json(await enrichRO(ro));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });
    const ALLOWED_RO_FIELDS = ['status','notes','tech_notes','assigned_to','estimate_amount','actual_amount','updated_at','insurance_company','adjuster_name','adjuster_phone','claim_number','deductible','auth_number','job_type','payment_type','insurer','adjuster_email','estimated_delivery','parts_cost','labor_cost','sublet_cost','tax','total','deductible_waived','referral_fee','goodwill_repair_cost','damaged_panels'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_RO_FIELDS.includes(k)));
    if (Object.keys(updates).length > 0) {
      const profit = calculateProfit({ ...ro, ...updates });
      updates.true_profit = profit.trueProfit;
      updates.updated_at = new Date().toISOString();
      const updateKeys = Object.keys(updates);
      const updateVals = Object.values(updates);
      const setClauses = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      await dbRun(`UPDATE repair_orders SET ${setClauses} WHERE id = $${updateKeys.length + 1}`, [...updateVals, req.params.id]);
    }
    res.json(await enrichRO(await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });
    const fromStatus = ro.status;
    const now = new Date().toISOString();
    if (status === 'delivery') {
      await dbRun('UPDATE repair_orders SET status = $1, updated_at = $2, actual_delivery = $3 WHERE id = $4', [status, now, now.split('T')[0], req.params.id]);
    } else {
      await dbRun('UPDATE repair_orders SET status = $1, updated_at = $2 WHERE id = $3', [status, now, req.params.id]);
    }
    await dbRun('INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)', [uuidv4(), req.params.id, fromStatus, status, req.user.id, note || null]);

    const updatedRO = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id]);
    res.json(await enrichRO(updatedRO));

    setImmediate(async () => {
      try {
        const smsContext = await dbGet(`
          SELECT ro.status, c.phone AS customer_phone, v.year, v.make, v.model, s.name AS shop_name
          FROM repair_orders ro
          LEFT JOIN customers c ON c.id = ro.customer_id
          LEFT JOIN vehicles v ON v.id = ro.vehicle_id
          LEFT JOIN shops s ON s.id = ro.shop_id
          WHERE ro.id = $1 AND ro.shop_id = $2
        `, [req.params.id, req.user.shop_id]);
        if (!smsContext?.customer_phone || !isConfigured()) return;
        const message = getStatusMessage(smsContext.status, smsContext.shop_name, smsContext.year, smsContext.make, smsContext.model);
        if (!message) return;
        const result = await sendSMS(smsContext.customer_phone, message);
        if (!result.ok) console.error(`[SMS] Failed for RO ${req.params.id}`);
        else console.log(`[SMS] Sent RO status update for ${req.params.id}`);
      } catch (err) {
        console.error(`[SMS] Unexpected error for RO ${req.params.id}:`, err.message);
      }

      // Email notifications on status change
      try {
        const emailContext = await dbGet(`
          SELECT ro.status, c.email AS customer_email, ro.ro_number
          FROM repair_orders ro
          LEFT JOIN customers c ON c.id = ro.customer_id
          WHERE ro.id = $1
        `, [req.params.id]);
        if (!emailContext) return;

        if (emailContext.status === 'estimate_sent' && emailContext.customer_email) {
          await sendMail(emailContext.customer_email, 'Your Estimate is Ready', '<p>Your vehicle repair estimate is ready for review. Log in to your portal to view it.</p>').catch(e => console.error('[Email] estimate_sent failed:', e.message));
        } else if (emailContext.status === 'completed' && emailContext.customer_email) {
          await sendMail(emailContext.customer_email, 'Your Vehicle is Ready for Pickup', '<p>Your vehicle repair is complete and ready for pickup. Please contact us to arrange pickup.</p>').catch(e => console.error('[Email] completed failed:', e.message));
        }
      } catch (err) {
        console.error(`[Email] Status change notification failed for RO ${req.params.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/assign', auth, requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.body;
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });
    await dbRun('UPDATE repair_orders SET assigned_to = $1, updated_at = $2 WHERE id = $3', [user_id || null, new Date().toISOString(), req.params.id]);
    res.json(await enrichRO(await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const { status, note, ...otherFields } = req.body || {};
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    if (!status) {
      const ALLOWED_PATCH_FIELDS = ['tech_notes'];
      const updates = Object.fromEntries(Object.entries(otherFields).filter(([k]) => ALLOWED_PATCH_FIELDS.includes(k)));
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
      updates.updated_at = new Date().toISOString();
      const updateKeys = Object.keys(updates);
      const updateVals = Object.values(updates);
      const setClauses = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      await dbRun(`UPDATE repair_orders SET ${setClauses} WHERE id = $${updateKeys.length + 1}`, [...updateVals, req.params.id]);
      return res.json(await enrichRO(await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id])));
    }

    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    // Payment gate: prevent closing without payment
    if (status === 'closed') {
      const paymentCheck = await dbGet('SELECT payment_received FROM repair_orders WHERE id = $1', [req.params.id]);
      if (!paymentCheck || !paymentCheck.payment_received) {
        return res.status(400).json({ error: 'Payment must be received before closing this RO' });
      }
    }

    const fromStatus = ro.status;
    const now = new Date().toISOString();
    if (status === 'delivery') {
      await dbRun('UPDATE repair_orders SET status = $1, updated_at = $2, actual_delivery = $3 WHERE id = $4', [status, now, now.split('T')[0], req.params.id]);
    } else {
      await dbRun('UPDATE repair_orders SET status = $1, updated_at = $2 WHERE id = $3', [status, now, req.params.id]);
    }
    await dbRun('INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)', [uuidv4(), req.params.id, fromStatus, status, req.user.id, note || null]);

    const updatedRO = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id]);
    res.json(await enrichRO(updatedRO));

    setImmediate(async () => {
      try {
        const smsContext = await dbGet(`
          SELECT ro.status, c.phone AS customer_phone, v.year, v.make, v.model, s.name AS shop_name
          FROM repair_orders ro
          LEFT JOIN customers c ON c.id = ro.customer_id
          LEFT JOIN vehicles v ON v.id = ro.vehicle_id
          LEFT JOIN shops s ON s.id = ro.shop_id
          WHERE ro.id = $1 AND ro.shop_id = $2
        `, [req.params.id, req.user.shop_id]);
        if (!smsContext?.customer_phone || !isConfigured()) return;
        const message = getStatusMessage(smsContext.status, smsContext.shop_name, smsContext.year, smsContext.make, smsContext.model);
        if (!message) return;
        const result = await sendSMS(smsContext.customer_phone, message);
        if (!result.ok) console.error(`[SMS] Failed for RO ${req.params.id}`);
        else console.log(`[SMS] Sent RO status update for ${req.params.id}`);
      } catch (err) {
        console.error(`[SMS] Unexpected error for RO ${req.params.id}:`, err.message);
      }

      // Email notifications on status change
      try {
        const emailContext = await dbGet(`
          SELECT ro.status, c.email AS customer_email, ro.ro_number
          FROM repair_orders ro
          LEFT JOIN customers c ON c.id = ro.customer_id
          WHERE ro.id = $1
        `, [req.params.id]);
        if (!emailContext) return;

        if (emailContext.status === 'estimate_sent' && emailContext.customer_email) {
          await sendMail(emailContext.customer_email, 'Your Estimate is Ready', '<p>Your vehicle repair estimate is ready for review. Log in to your portal to view it.</p>').catch(e => console.error('[Email] estimate_sent failed:', e.message));
        } else if (emailContext.status === 'completed' && emailContext.customer_email) {
          await sendMail(emailContext.customer_email, 'Your Vehicle is Ready for Pickup', '<p>Your vehicle repair is complete and ready for pickup. Please contact us to arrange pickup.</p>').catch(e => console.error('[Email] completed failed:', e.message));
        }
      } catch (err) {
        console.error(`[Email] Status change notification failed for RO ${req.params.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approve-estimate', auth, async (req, res) => {
  try {
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });
    const now = new Date().toISOString();
    await dbRun('UPDATE repair_orders SET estimate_approved_at = $1, estimate_approved_by = $2, updated_at = $3 WHERE id = $4', [now, req.user.id, now, req.params.id]);
    const updatedRO = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id]);
    res.json(await enrichRO(updatedRO));

    setImmediate(async () => {
      try {
        const shopUser = await dbGet('SELECT u.name, u.email FROM users u WHERE u.id = $1', [req.user.id]);
        const shopUsers = await dbAll('SELECT u.id, u.email FROM users u WHERE u.shop_id = $1 AND u.role IN ($2, $3)', [req.user.shop_id, 'owner', 'admin']);
        if (shopUsers && shopUsers.length > 0) {
          const managerEmails = shopUsers.map(u => u.email).filter(e => e);
          const estimateApprovedHtml = `<p>Estimate approved by ${shopUser?.name || 'Team Member'}.</p><p>RO: ${ro.ro_number}</p>`;
          for (const email of managerEmails) {
            await sendMail(email, `Estimate Approved - ${ro.ro_number}`, estimateApprovedHtml).catch(e => console.error(`[Email] Manager notification failed for ${email}:`, e.message));
          }
        }
      } catch (err) {
        console.error(`[Email] Estimate approval notification failed for RO ${req.params.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/mark-paid', auth, async (req, res) => {
  try {
    const { payment_method } = req.body || {};
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const now = new Date().toISOString();
    const method = payment_method || 'cash';

    // Update payment received and auto-close RO
    await dbRun(
      'UPDATE repair_orders SET payment_received = 1, payment_received_at = $1, payment_method = $2, payment_status = $3, status = $4, updated_at = $5 WHERE id = $6',
      [now, method, 'succeeded', 'closed', now, req.params.id]
    );

    // Log the status change
    await dbRun(
      'INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), req.params.id, ro.status, 'closed', req.user.id, `Payment received (${method})`]
    );

    const updatedRO = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id]);
    res.json(await enrichRO(updatedRO));

    // Send customer email
    setImmediate(async () => {
      try {
        const emailContext = await dbGet(
          'SELECT c.email, ro.ro_number FROM repair_orders ro LEFT JOIN customers c ON c.id = ro.customer_id WHERE ro.id = $1',
          [req.params.id]
        );
        if (emailContext?.email) {
          await sendMail(
            emailContext.email,
            'Your Vehicle is Ready for Pickup',
            '<p>Your vehicle repair is complete and payment has been received. Your vehicle is ready for pickup!</p>'
          ).catch(e => console.error('[Email] Payment notification failed:', e.message));
        }
      } catch (err) {
        console.error(`[Email] Payment notification failed for RO ${req.params.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const ro = await dbGet('SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    await dbRun('DELETE FROM ro_photos WHERE ro_id = $1', [id]);
    await dbRun('DELETE FROM parts_orders WHERE ro_id = $1', [id]);
    await dbRun('DELETE FROM job_status_log WHERE ro_id = $1', [id]);
    await dbRun('DELETE FROM parts_requests WHERE ro_id = $1', [id]);
    await dbRun('DELETE FROM ro_comms WHERE ro_id = $1', [id]);
    await dbRun('DELETE FROM estimate_approval_links WHERE ro_id = $1', [id]);
    await dbRun('DELETE FROM repair_orders WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
