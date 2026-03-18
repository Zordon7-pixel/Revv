const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireAdmin, requireTechnician } = require('../middleware/roles');
const { calculateProfit } = require('../services/profit');
const { sendSMS, isConfigured } = require('../services/sms');
const { sendMail } = require('../services/mailer');
const { statusChangeEmail } = require('../services/emailTemplates');
const { createNotification } = require('../services/notifications');
const roLimitGuard = require('../middleware/roLimitGuard');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const STATUSES = ['intake','estimate','approval','parts','repair','paint','qc','delivery','closed','total_loss','siu_hold'];
const STATUS_SMS_LABELS = {
  intake: 'Inspection',
  estimate: 'Estimate Ready',
  approval: 'Approved',
  repair: 'In Progress',
  'in-progress': 'In Progress',
  qc: 'Quality Check',
  ready: 'Ready for Pickup',
  delivery: 'Ready for Pickup',
};
const SMS_STATUSES = new Set(Object.keys(STATUS_SMS_LABELS));
const publicTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
});

function toBase64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function queueStatusSMS(roId, shopId, toStatus) {
  setImmediate(async () => {
    try {
      if (!SMS_STATUSES.has(toStatus)) return;
      if (!isConfigured()) return;

      const ro = await dbGet(
        `SELECT ro.id, ro.estimate_token, v.year, v.make, v.model, c.phone AS customer_phone, s.name AS shop_name,
                COALESCE(s.sms_notifications_enabled, TRUE) AS sms_notifications_enabled
         FROM repair_orders ro
         LEFT JOIN vehicles v ON v.id = ro.vehicle_id
         LEFT JOIN customers c ON c.id = ro.customer_id
         LEFT JOIN shops s ON s.id = ro.shop_id
         WHERE ro.id = $1 AND ro.shop_id = $2`,
        [roId, shopId]
      );
      if (!ro?.customer_phone) return;
      if (!ro.sms_notifications_enabled) return;

      let trackingToken = ro.estimate_token;
      if (!trackingToken) {
        const tokenRow = await dbGet(
          'SELECT token FROM portal_tokens WHERE ro_id = $1 ORDER BY created_at DESC LIMIT 1',
          [roId]
        );
        trackingToken = tokenRow?.token || null;
      }
      if (!trackingToken) return;

      const statusLabel = STATUS_SMS_LABELS[toStatus];
      const vehicle = [ro.year, ro.make, ro.model].filter(Boolean).join(' ') || 'vehicle';
      const shopName = ro.shop_name || 'your shop';
      const message = `Your ${vehicle} at ${shopName} is now: ${statusLabel}. Track your repair: https://revvshop.app/track/${trackingToken}`;
      await sendSMS(ro.customer_phone, message);
    } catch (_) {
      // Non-blocking fire-and-forget path; ignore SMS errors.
    }
  });
}

function queueStatusEmail(roId, shopId, toStatus) {
  setImmediate(async () => {
    try {
      const emailContext = await dbGet(
        `SELECT ro.ro_number, ro.estimate_token, c.email AS customer_email, s.name AS shop_name,
                v.year, v.make, v.model,
                COALESCE(s.email_notifications_enabled, TRUE) AS email_notifications_enabled
         FROM repair_orders ro
         LEFT JOIN customers c ON c.id = ro.customer_id
         LEFT JOIN shops s ON s.id = ro.shop_id
         LEFT JOIN vehicles v ON v.id = ro.vehicle_id
         WHERE ro.id = $1 AND ro.shop_id = $2`,
        [roId, shopId]
      );
      if (!emailContext?.customer_email) return;
      if (!emailContext.email_notifications_enabled) return;

      let portalToken = null;
      const tokenRow = await dbGet(
        'SELECT token FROM portal_tokens WHERE ro_id = $1 ORDER BY created_at DESC LIMIT 1',
        [roId]
      );
      portalToken = tokenRow?.token || emailContext.estimate_token || null;

      const appUrl = process.env.APP_URL || process.env.PUBLIC_URL || 'https://revvshop.app';
      const portalUrl = portalToken ? `${appUrl}/track/${portalToken}` : null;
      const vehicle = [emailContext.year, emailContext.make, emailContext.model].filter(Boolean).join(' ') || 'Vehicle on file';
      const { subject, html } = statusChangeEmail({
        shopName: emailContext.shop_name || 'Your Repair Shop',
        roNumber: emailContext.ro_number || 'N/A',
        vehicle,
        status: toStatus,
        portalUrl,
      });

      sendMail(emailContext.customer_email, subject, html).catch((e) => {
        console.error('[Email] status notification failed:', e.message);
      });
    } catch (_) {
      // Non-blocking fire-and-forget path; ignore email errors.
    }
  });
}

async function queueClosedReviewEmail(roId) {
  try {
    const reviewContext = await dbGet(
      `SELECT ro.id, ro.shop_id, ro.status, ro.updated_at, c.email AS customer_email, s.name AS shop_name
       FROM repair_orders ro
       LEFT JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN shops s ON s.id = ro.shop_id
       WHERE ro.id = $1`,
      [roId]
    );
    if (!reviewContext || reviewContext.status !== 'closed' || !reviewContext.customer_email) return;

    const closedAtMs = reviewContext.updated_at ? new Date(reviewContext.updated_at).getTime() : Date.now();
    const tokenPayload = {
      ro_id: roId,
      shop_id: reviewContext.shop_id,
      exp: closedAtMs + (72 * 60 * 60 * 1000),
    };
    const payloadPart = toBase64Url(JSON.stringify(tokenPayload));
    const signaturePart = toBase64Url(
      crypto.createHmac('sha256', process.env.JWT_SECRET).update(payloadPart).digest()
    );
    const token = `${payloadPart}.${signaturePart}`;
    const appUrl = process.env.APP_URL || 'https://revvshop.app';
    const reviewLink = `${appUrl}/review/${token}`;
    const shopName = reviewContext.shop_name || 'our shop';

    const html = `
      <p>Thank you for choosing ${shopName}.</p>
      <p>We would love your feedback on your recent repair experience.</p>
      <p style="margin: 24px 0;">
        <a href="${reviewLink}" style="font-size: 22px; font-weight: 700; color: #ffffff; background: #4f46e5; padding: 12px 18px; border-radius: 10px; text-decoration: none;">
          Leave a Star Rating
        </a>
      </p>
      <p>This link expires in 72 hours.</p>
    `;
    await sendMail(
      reviewContext.customer_email,
      `How was your experience at ${shopName}?`,
      html
    ).catch((e) => console.error('[Email] review request failed:', e.message));
  } catch (err) {
    console.error(`[Email] Review request failed for RO ${roId}:`, err.message);
  }
}

async function notifyUsersByRole(shopId, roles, type, title, body, roId) {
  try {
    const users = await dbAll(
      'SELECT id FROM users WHERE shop_id = $1 AND role = ANY($2::text[])',
      [shopId, roles]
    );
    await Promise.all(users.map((user) => createNotification(shopId, user.id, type, title, body, roId)));
  } catch (err) {
    console.error('[Notification] Role delivery failed:', err.message);
  }
}

function notifyStatusChange(shopId, ro, toStatus) {
  const body = `RO #${ro.ro_number || 'N/A'} status changed to "${toStatus}"`;
  if (ro.assigned_to) {
    createNotification(shopId, ro.assigned_to, 'status_change', 'RO Status Updated', body, ro.id).catch(() => {});
  }
  notifyUsersByRole(shopId, ['owner'], 'status_change', 'RO Status Updated', body, ro.id).catch(() => {});
}

function normalizeSupplementStatus(value) {
  const allowed = ['none', 'requested', 'pending', 'approved', 'denied'];
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : null;
}

function toIntCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

async function ensureRoCommsTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ro_comms (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      user_id TEXT,
      channel TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'outbound',
      summary TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await dbRun(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS channel TEXT`).catch(() => {});
  await dbRun(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS direction TEXT`).catch(() => {});
  await dbRun(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS summary TEXT`).catch(() => {});
  await dbRun(`
    UPDATE ro_comms
    SET channel = CASE
      WHEN channel IS NOT NULL THEN channel
      WHEN type = 'text' THEN 'sms'
      WHEN type IN ('call', 'email', 'in-person') THEN type
      ELSE 'call'
    END
  `).catch(() => {});
  await dbRun(`UPDATE ro_comms SET direction = COALESCE(direction, 'outbound')`).catch(() => {});
  await dbRun(`UPDATE ro_comms SET summary = COALESCE(summary, notes, '')`).catch(() => {});
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
  const enriched = await dbGet(
    `SELECT
       row_to_json(v) AS vehicle,
       CASE WHEN c.id IS NULL THEN NULL ELSE row_to_json(c) END AS customer,
       COALESCE(log_data.log, '[]'::json) AS log,
       COALESCE(parts_data.parts, '[]'::json) AS parts,
       CASE
         WHEN tech.id IS NULL THEN NULL
         ELSE json_build_object('id', tech.id, 'name', tech.name, 'role', tech.role)
       END AS assigned_tech,
       EXISTS (
         SELECT 1
         FROM users portal_user
         WHERE portal_user.customer_id = ro.customer_id
           AND portal_user.shop_id = ro.shop_id
       ) AS has_portal_access
     FROM repair_orders ro
     LEFT JOIN vehicles v ON v.id = ro.vehicle_id
     LEFT JOIN customers c ON c.id = ro.customer_id
     LEFT JOIN users tech ON tech.id = ro.assigned_to
     LEFT JOIN LATERAL (
       SELECT json_agg(l ORDER BY l.created_at ASC) AS log
       FROM job_status_log l
       WHERE l.ro_id = ro.id
     ) log_data ON TRUE
     LEFT JOIN LATERAL (
       SELECT json_agg(p ORDER BY p.created_at ASC) AS parts
       FROM parts_orders p
       WHERE p.ro_id = ro.id
     ) parts_data ON TRUE
     WHERE ro.id = $1`,
    [ro.id]
  );
  const profit   = calculateProfit(ro);
  const assigned_tech = enriched?.assigned_tech || null;
  const vehicle = enriched?.vehicle || null;
  const customer = enriched?.customer
    ? { ...enriched.customer, has_portal_access: !!enriched.has_portal_access }
    : null;
  const log = Array.isArray(enriched?.log) ? enriched.log : [];
  const parts = Array.isArray(enriched?.parts) ? enriched.parts : [];
  if (customer) {
    customer.has_portal_access = !!enriched?.has_portal_access;
  }
  return { ...ro, vehicle, customer, log, parts, profit, assigned_tech };
}

router.get('/', auth, async (req, res) => {
  try {
    const {
      search = '',
      status = '',
      tech_id = '',
      assigned_to = '',
      type = '',
      date_from = '',
      date_to = '',
      payment_status = '',
    } = req.query || {};
    const params = [req.user.shop_id];
    const where = ['ro.shop_id = $1'];

    const normalizedSearch = String(search || '').trim();
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const normalizedTechId = String(tech_id || '').trim();
    const normalizedAssignedTo = String(assigned_to || '').trim();
    const assignedFilter = normalizedTechId || normalizedAssignedTo;
    const normalizedType = String(type || '').trim().toLowerCase();
    const normalizedDateFrom = String(date_from || '').trim();
    const normalizedDateTo = String(date_to || '').trim();
    const normalizedPaymentStatus = String(payment_status || '').trim().toLowerCase();

    if (normalizedSearch) {
      params.push(`%${normalizedSearch}%`);
      const idx = params.length;
      where.push(`(
        ro.ro_number ILIKE $${idx}
        OR c.name ILIKE $${idx}
        OR CONCAT_WS(' ', v.year::text, v.make, v.model) ILIKE $${idx}
      )`);
    }

    if (normalizedStatus && normalizedStatus !== 'all') {
      if (normalizedStatus === 'open') {
        where.push(`ro.status IN ('intake', 'estimate', 'approval', 'parts')`);
      } else if (normalizedStatus === 'in-progress') {
        where.push(`ro.status IN ('repair', 'paint', 'qc', 'in-progress')`);
      } else if (normalizedStatus === 'completed') {
        where.push(`ro.status IN ('delivery', 'ready')`);
      } else if (normalizedStatus === 'closed') {
        where.push(`ro.status = 'closed'`);
      } else {
        params.push(normalizedStatus);
        where.push(`ro.status = $${params.length}`);
      }
    }

    if (assignedFilter && assignedFilter !== 'all') {
      params.push(assignedFilter);
      where.push(`ro.assigned_to = $${params.length}`);
    }

    if (normalizedType && normalizedType !== 'all') {
      params.push(normalizedType);
      where.push(`ro.job_type = $${params.length}`);
    }

    if (normalizedDateFrom) {
      params.push(normalizedDateFrom);
      where.push(`ro.created_at >= $${params.length}::date`);
    }

    if (normalizedDateTo) {
      params.push(normalizedDateTo);
      where.push(`ro.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    if (normalizedPaymentStatus && normalizedPaymentStatus !== 'all') {
      params.push(normalizedPaymentStatus);
      where.push(`ro.payment_status = $${params.length}`);
    }

    const ros = await dbAll(`
      SELECT ro.*, v.year, v.make, v.model, v.color, c.name as customer_name, c.phone as customer_phone
      FROM repair_orders ro
      LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      LEFT JOIN customers c ON c.id = ro.customer_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY ro.created_at DESC
    `, params);
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

// GET /api/ros/turnaround-estimate?job_type=collision&shop_id=...
router.get('/turnaround-estimate', auth, async (req, res) => {
  try {
    const { job_type } = req.query;
    const shopId = req.user.shop_id;

    // Pull historical completion times: intake → closed, same job_type, last 90 days
    const history = await dbAll(`
      SELECT
        EXTRACT(EPOCH FROM (closed_log.created_at - intake_log.created_at)) / 86400 AS days
      FROM repair_orders ro
      JOIN job_status_log intake_log ON intake_log.ro_id = ro.id AND intake_log.to_status = 'intake'
      JOIN job_status_log closed_log ON closed_log.ro_id = ro.id AND closed_log.to_status = 'closed'
      WHERE ro.shop_id = $1
        AND ro.status = 'closed'
        AND ($2::text IS NULL OR ro.job_type = $2)
        AND closed_log.created_at > NOW() - INTERVAL '90 days'
      ORDER BY closed_log.created_at DESC
      LIMIT 50
    `, [shopId, job_type || null]);

    // Active RO count (workload factor)
    const activeRow = await dbGet(
      `SELECT COUNT(*) as cnt FROM repair_orders WHERE shop_id = $1 AND status NOT IN ('closed', 'total_loss')`,
      [shopId]
    );
    const activeCount = parseInt(activeRow?.cnt || 0);

    let minDays;
    let maxDays;

    if (history.length >= 3) {
      // Sort completion times ascending
      const days = history.map(r => parseFloat(r.days)).sort((a, b) => a - b);
      const p25 = days[Math.floor(days.length * 0.25)];
      const p75 = days[Math.floor(days.length * 0.75)];
      // Add workload buffer: +0.25 days per active RO over 5
      const buffer = Math.max(0, (activeCount - 5) * 0.25);
      minDays = Math.max(1, Math.round(p25 + buffer));
      maxDays = Math.max(minDays + 1, Math.round(p75 + buffer));
    } else {
      // Fallback defaults by job_type
      const defaults = {
        collision: [5, 10],
        mechanical: [1, 3],
        pdr: [1, 2],
        detailing: [1, 1],
        glass: [1, 2],
      };
      [minDays, maxDays] = defaults[job_type] || [3, 7];
    }

    // Convert to calendar dates (skip weekends)
    function addBusinessDays(date, days) {
      let d = new Date(date);
      let added = 0;
      while (added < days) {
        d.setDate(d.getDate() + 1);
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) added++;
      }
      return d;
    }

    const now = new Date();
    const startDate = addBusinessDays(now, minDays);
    const endDate = addBusinessDays(now, maxDays);

    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isoDate = (d) => d.toISOString().split('T')[0];

    res.json({
      minDays,
      maxDays,
      startDate: isoDate(startDate),
      endDate: isoDate(endDate),
      label: startDate.toDateString() === endDate.toDateString()
        ? fmt(startDate)
        : `${fmt(startDate)} – ${fmt(endDate)}`,
      basedOnSamples: history.length,
      activeROs: activeCount,
    });
  } catch (err) {
    console.error('[Turnaround]', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function bulkStatusUpdateHandler(req, res) {
  if (!['owner', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { ids, status, new_status } = req.body || {};
    const normalizedStatus = String(new_status || status || '').trim().toLowerCase();
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
    if (!STATUSES.includes(normalizedStatus)) return res.status(400).json({ error: 'Invalid status' });

    const result = await dbRun(
      `UPDATE repair_orders
       SET status = $1, updated_at = NOW()
       WHERE shop_id = $2
         AND id = ANY($3::uuid[])`,
      [normalizedStatus, req.user.shop_id, ids]
    );
    res.json({ updated: result.rowCount || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/repair-orders/bulk-status
router.post('/bulk-status', auth, requireTechnician, bulkStatusUpdateHandler);

// POST /api/ros/bulk-update — backward compatible bulk status endpoint
router.post('/bulk-update', auth, requireTechnician, bulkStatusUpdateHandler);

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

router.post('/:id/email-invoice', auth, requireTechnician, async (req, res) => {
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

router.get('/:id/notes', auth, requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const notes = await dbAll(
      `SELECT
         n.id,
         n.ro_id,
         n.user_id,
         n.note,
         n.created_at,
         COALESCE(u.name, 'Unknown') AS author_name
       FROM ro_internal_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.ro_id = $1 AND n.shop_id = $2
       ORDER BY n.created_at DESC`,
      [req.params.id, req.user.shop_id]
    );
    return res.json({ notes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/notes', auth, requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note is required' });

    const id = uuidv4();
    await dbRun(
      `INSERT INTO ro_internal_notes (id, ro_id, shop_id, user_id, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.params.id, req.user.shop_id, req.user.id, note]
    );

    const created = await dbGet(
      `SELECT
         n.id,
         n.ro_id,
         n.user_id,
         n.note,
         n.created_at,
         COALESCE(u.name, 'Unknown') AS author_name
       FROM ro_internal_notes n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.id = $1`,
      [id]
    );
    return res.status(201).json({ note: created });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/notes/:noteId', auth, requireAdmin, async (req, res) => {
  try {
    const ro = await dbGet(
      'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const note = await dbGet(
      'SELECT id FROM ro_internal_notes WHERE id = $1 AND ro_id = $2 AND shop_id = $3',
      [req.params.noteId, req.params.id, req.user.shop_id]
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });

    await dbRun('DELETE FROM ro_internal_notes WHERE id = $1', [req.params.noteId]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id/insurance', auth, async (req, res) => {
  try {
    const ro = await dbGet(
      `SELECT
        id, shop_id,
        insurance_claim_number, insurance_company,
        adjuster_name, adjuster_phone, adjuster_email,
        policy_number, deductible, is_drp,
        insurance_approved_amount, supplement_status,
        supplement_amount, supplement_notes, total_insurer_owed,
        claim_number, insurer
      FROM repair_orders
      WHERE id = $1 AND shop_id = $2`,
      [req.params.id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    return res.json({
      insurance_claim_number: ro.insurance_claim_number || ro.claim_number || null,
      insurance_company: ro.insurance_company || ro.insurer || null,
      adjuster_name: ro.adjuster_name || null,
      adjuster_phone: ro.adjuster_phone || null,
      adjuster_email: ro.adjuster_email || null,
      policy_number: ro.policy_number || null,
      deductible: ro.deductible !== null && ro.deductible !== undefined ? Number(ro.deductible) : null,
      is_drp: !!ro.is_drp,
      insurance_approved_amount: ro.insurance_approved_amount !== null && ro.insurance_approved_amount !== undefined ? Number(ro.insurance_approved_amount) : null,
      supplement_status: normalizeSupplementStatus(ro.supplement_status) || 'none',
      supplement_amount: ro.supplement_amount !== null && ro.supplement_amount !== undefined ? Number(ro.supplement_amount) : null,
      supplement_notes: ro.supplement_notes || null,
      total_insurer_owed: ro.total_insurer_owed !== null && ro.total_insurer_owed !== undefined
        ? Number(ro.total_insurer_owed)
        : ((Number(ro.insurance_approved_amount) || 0) + (Number(ro.supplement_amount) || 0)),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/insurance', auth, requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet('SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const allowed = [
      'insurance_claim_number',
      'insurance_company',
      'adjuster_name',
      'adjuster_phone',
      'adjuster_email',
      'policy_number',
      'deductible',
      'is_drp',
      'insurance_approved_amount',
      'supplement_status',
      'supplement_amount',
      'supplement_notes',
      'total_insurer_owed',
    ];
    const updates = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No insurance fields provided' });

    if (Object.prototype.hasOwnProperty.call(updates, 'supplement_status')) {
      const normalized = normalizeSupplementStatus(updates.supplement_status);
      if (!normalized) return res.status(400).json({ error: 'Invalid supplement_status' });
      updates.supplement_status = normalized;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'is_drp')) {
      updates.is_drp = !!updates.is_drp;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'insurance_approved_amount')) {
      updates.insurance_approved_amount = toIntCents(updates.insurance_approved_amount);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'supplement_amount')) {
      updates.supplement_amount = toIntCents(updates.supplement_amount);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'deductible')) {
      updates.deductible = toIntCents(updates.deductible);
    }

    if (!Object.prototype.hasOwnProperty.call(updates, 'total_insurer_owed')) {
      const existing = await dbGet(
        'SELECT insurance_approved_amount, supplement_amount FROM repair_orders WHERE id = $1 AND shop_id = $2',
        [req.params.id, req.user.shop_id]
      );
      const approved = Object.prototype.hasOwnProperty.call(updates, 'insurance_approved_amount')
        ? (updates.insurance_approved_amount || 0)
        : (Number(existing?.insurance_approved_amount) || 0);
      const supplement = Object.prototype.hasOwnProperty.call(updates, 'supplement_amount')
        ? (updates.supplement_amount || 0)
        : (Number(existing?.supplement_amount) || 0);
      updates.total_insurer_owed = approved + supplement;
    } else {
      updates.total_insurer_owed = toIntCents(updates.total_insurer_owed);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'insurance_claim_number')) {
      updates.claim_number = updates.insurance_claim_number || null;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'insurance_company')) {
      updates.insurer = updates.insurance_company || null;
    }

    updates.updated_at = new Date().toISOString();
    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await dbRun(`UPDATE repair_orders SET ${setClauses} WHERE id = $${keys.length + 1} AND shop_id = $${keys.length + 2}`, [...vals, req.params.id, req.user.shop_id]);

    const refreshed = await dbGet(
      `SELECT
        insurance_claim_number, insurance_company,
        adjuster_name, adjuster_phone, adjuster_email,
        policy_number, deductible, is_drp,
        insurance_approved_amount, supplement_status,
        supplement_amount, supplement_notes, total_insurer_owed
      FROM repair_orders
      WHERE id = $1 AND shop_id = $2`,
      [req.params.id, req.user.shop_id]
    );
    return res.json(refreshed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/supplement', auth, requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet(
      'SELECT id, shop_id, ro_number, insurance_approved_amount FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [req.params.id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    const amount = toIntCents(req.body?.amount);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    if (amount === null || amount < 0) return res.status(400).json({ error: 'Valid supplement amount is required (in cents)' });

    const approved = Number(ro.insurance_approved_amount) || 0;
    const totalInsurerOwed = approved + amount;
    const now = new Date().toISOString();

    await dbRun(
      `UPDATE repair_orders
       SET supplement_status = $1,
           supplement_amount = $2,
           supplement_notes = $3,
           total_insurer_owed = $4,
           updated_at = $5
       WHERE id = $6 AND shop_id = $7`,
      ['requested', amount, notes || null, totalInsurerOwed, now, req.params.id, req.user.shop_id]
    );

    await ensureRoCommsTable();
    await dbRun(
      `INSERT INTO ro_comms (id, ro_id, shop_id, user_id, channel, direction, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        uuidv4(),
        req.params.id,
        req.user.shop_id,
        req.user.id,
        'in-person',
        'outbound',
        `Supplement requested: $${(amount / 100).toFixed(2)}${notes ? ` — ${notes}` : ''}`,
      ]
    );

    await createNotification(
      req.user.shop_id,
      null,
      'supplement_requested',
      'Supplement Requested',
      `RO #${ro.ro_number || 'N/A'} supplement requested for $${(amount / 100).toFixed(2)}`,
      req.params.id
    ).catch(() => {});

    const updated = await dbGet(
      `SELECT supplement_status, supplement_amount, supplement_notes, insurance_approved_amount, total_insurer_owed
       FROM repair_orders
       WHERE id = $1 AND shop_id = $2`,
      [req.params.id, req.user.shop_id]
    );
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approval-link', auth, requireTechnician, async (req, res) => {
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

router.get('/approval/:token', publicTokenLimiter, async (req, res) => {
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

router.post('/approval/:token/respond', publicTokenLimiter, async (req, res) => {
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
      notifyStatusChange(ro.shop_id, ro, 'approval');
      queueStatusSMS(ro.id, ro.shop_id, 'approval');
      await dbRun('UPDATE estimate_approval_links SET responded_at = $1 WHERE token = $2', [now, req.params.token]);
      return res.json({ ok: true, decision: 'approve' });
    }

    if (!reason?.trim()) return res.status(400).json({ error: 'Reason is required when requesting changes' });

    await dbRun(
      `INSERT INTO ro_comms (id, ro_id, shop_id, user_id, channel, direction, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv4(), ro.id, ro.shop_id, null, 'email', 'inbound', `Estimate change request: ${reason.trim()}`]
    );
    await dbRun('UPDATE estimate_approval_links SET responded_at = $1, decline_reason = $2 WHERE token = $3', [now, reason.trim(), req.params.token]);
    return res.json({ ok: true, decision: 'decline' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, requireTechnician, roLimitGuard, async (req, res) => {
  try {
    const { customer_id, vehicle_id, job_type, payment_type, claim_number, insurer, adjuster_name, adjuster_phone, deductible, notes, estimated_delivery, damaged_panels } = req.body;
    if (!customer_id || !vehicle_id) {
      return res.status(400).json({ error: 'customer_id and vehicle_id are required' });
    }
    const customer = await dbGet('SELECT id FROM customers WHERE id = $1 AND shop_id = $2', [customer_id, req.user.shop_id]);
    if (!customer) return res.status(400).json({ error: 'Invalid customer_id for this shop' });
    const vehicle = await dbGet(
      'SELECT id, year, make, model, vin FROM vehicles WHERE id = $1 AND shop_id = $2 AND customer_id = $3',
      [vehicle_id, req.user.shop_id, customer_id]
    );
    if (!vehicle) return res.status(400).json({ error: 'Invalid vehicle_id for this customer/shop' });

    const duplicateConditions = ['ro.customer_id = $2'];
    const duplicateParams = [req.user.shop_id, customer_id];
    if (vehicle?.year && vehicle?.make && vehicle?.model) {
      duplicateParams.push(vehicle.year, vehicle.make, vehicle.model);
      let vehicleCondition = `
        v.year = $3
        AND LOWER(COALESCE(v.make, '')) = LOWER($4)
        AND LOWER(COALESCE(v.model, '')) = LOWER($5)
      `;
      if (vehicle.vin) {
        duplicateParams.push(vehicle.vin);
        vehicleCondition += ` AND LOWER(COALESCE(v.vin, '')) = LOWER($6)`;
      }
      duplicateConditions.push(`(${vehicleCondition})`);
    }
    const duplicateRows = await dbAll(
      `
        SELECT ro.id, ro.ro_number, ro.status, ro.created_at
        FROM repair_orders ro
        LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        WHERE ro.shop_id = $1
          AND ro.status NOT IN ('closed', 'completed')
          AND ro.created_at >= NOW() - INTERVAL '30 days'
          AND (${duplicateConditions.join(' OR ')})
        ORDER BY ro.created_at DESC
      `,
      duplicateParams
    );

    let roNumber;
    let roId;
    let attempts = 0;
    const today = new Date().toISOString().split('T')[0];
    const panelsJson = Array.isArray(damaged_panels) ? JSON.stringify(damaged_panels) : (damaged_panels || '[]');
    while (attempts < 5) {
      const maxRow = await dbGet(
        `
          SELECT COALESCE(
            MAX(
              CASE
                WHEN ro_number ~ '^RO-[0-9]{4}-[0-9]+$' THEN CAST(SPLIT_PART(ro_number, '-', 3) AS INTEGER)
                ELSE NULL
              END
            ),
            0
          )::int as n
          FROM repair_orders
          WHERE shop_id = $1
        `,
        [req.user.shop_id]
      );
      const nextNum = (maxRow?.n || 0) + 1;
      roNumber = `RO-2026-${String(nextNum).padStart(4, '0')}`;
      roId = uuidv4();
      try {
        await dbRun(`
          INSERT INTO repair_orders (
            id, shop_id, ro_number, vehicle_id, customer_id, job_type, status, payment_type,
            claim_number, insurer, insurance_claim_number, insurance_company,
            adjuster_name, adjuster_phone, deductible, intake_date, estimated_delivery, notes, damaged_panels
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'intake', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `, [
          roId,
          req.user.shop_id,
          roNumber,
          vehicle_id,
          customer_id,
          job_type || 'collision',
          payment_type || 'insurance',
          claim_number || null,
          insurer || null,
          claim_number || null,
          insurer || null,
          adjuster_name || null,
          adjuster_phone || null,
          deductible || 0,
          today,
          estimated_delivery || null,
          notes || null,
          panelsJson
        ]);
        break;
      } catch (err) {
        if (err?.code === '23505' || (err?.message && err.message.includes('duplicate key'))) {
          attempts += 1;
          continue;
        }
        throw err;
      }
    }
    if (attempts >= 5) throw new Error('Failed to generate unique RO number after 5 attempts');
    await dbRun('INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4, $5)', [uuidv4(), roId, null, 'intake', req.user.id]);
    await createNotification(
      req.user.shop_id,
      null,
      'ro_created',
      'New Repair Order Created',
      `RO #${roNumber} — ${job_type || 'collision'} job has been opened`,
      roId
    );
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [roId]);
    
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
        `, [roId]);
        
        if (!roContext?.customer_phone) return;
        
        // Generate token
        const token = uuidv4().replace(/-/g, '');
        const tokenId = uuidv4();
        await run(`
          INSERT INTO portal_tokens (id, ro_id, shop_id, token)
          VALUES ($1, $2, $3, $4)
        `, [tokenId, roId, req.user.shop_id, token]);
        
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

    const enriched = await enrichRO(ro);
    if (duplicateRows.length > 0) {
      return res.status(201).json({
        ...enriched,
        duplicate_warning: {
          count: duplicateRows.length,
          ros: duplicateRows.map((dup) => ({
            id: dup.id,
            ro_number: dup.ro_number,
            status: dup.status,
            created_at: dup.created_at,
          })),
        },
      });
    }
    res.status(201).json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, requireTechnician, async (req, res) => {
  try {
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });
    const ALLOWED_RO_FIELDS = ['status','notes','tech_notes','assigned_to','estimate_amount','actual_amount','updated_at','insurance_company','adjuster_name','adjuster_phone','claim_number','insurance_claim_number','policy_number','is_drp','insurance_approved_amount','supplement_status','supplement_amount','supplement_notes','total_insurer_owed','deductible','auth_number','job_type','payment_type','insurer','adjuster_email','estimated_delivery','parts_cost','labor_cost','sublet_cost','tax','total','deductible_waived','referral_fee','goodwill_repair_cost','damaged_panels','claim_status'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => ALLOWED_RO_FIELDS.includes(k)));
    const statusChanged = Object.prototype.hasOwnProperty.call(updates, 'status') && updates.status !== ro.status;
    if (Object.keys(updates).length > 0) {
      const profit = calculateProfit({ ...ro, ...updates });
      updates.true_profit = profit.trueProfit;
      updates.updated_at = new Date().toISOString();
      const updateKeys = Object.keys(updates);
      const updateVals = Object.values(updates);
      const setClauses = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      await dbRun(`UPDATE repair_orders SET ${setClauses} WHERE id = $${updateKeys.length + 1}`, [...updateVals, req.params.id]);
    }
    if (statusChanged) {
      queueStatusEmail(req.params.id, req.user.shop_id, updates.status);
    }
    res.json(await enrichRO(await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/status', auth, requireTechnician, async (req, res) => {
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
    notifyStatusChange(req.user.shop_id, { ...ro, id: req.params.id }, status);
    queueStatusSMS(req.params.id, req.user.shop_id, status);

    const updatedRO = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id]);
    res.json(await enrichRO(updatedRO));

    setImmediate(async () => {
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
        } else if (emailContext.status === 'closed' && emailContext.customer_email) {
          await queueClosedReviewEmail(req.params.id);
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
    if (user_id) {
      const assigned = await dbGet('SELECT id FROM users WHERE id = $1 AND shop_id = $2', [user_id, req.user.shop_id]);
      if (!assigned) return res.status(400).json({ error: 'Invalid user_id for this shop' });
    }
    await dbRun('UPDATE repair_orders SET assigned_to = $1, updated_at = $2 WHERE id = $3', [user_id || null, new Date().toISOString(), req.params.id]);
    res.json(await enrichRO(await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, requireTechnician, async (req, res) => {
  try {
    const { status, note, ...otherFields } = req.body || {};
    const ro = await dbGet('SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Not found' });

    if (!status) {
      const hasVinUpdate = Object.prototype.hasOwnProperty.call(otherFields, 'vin');
      const { vin, ...nonVinFields } = otherFields;
      const ALLOWED_PATCH_FIELDS = ['tech_notes','damaged_panels','claim_status','parts_cost','labor_cost','sublet_cost','tax','total','notes','estimated_delivery'];
      const updates = Object.fromEntries(Object.entries(nonVinFields).filter(([k]) => ALLOWED_PATCH_FIELDS.includes(k)));
      if (!hasVinUpdate && Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

      if (hasVinUpdate) {
        if (!ro.vehicle_id) return res.status(400).json({ error: 'No vehicle attached to this RO' });
        const normalizedVin = String(vin || '').trim() || null;
        await dbRun(
          'UPDATE vehicles SET vin = $1 WHERE id = $2 AND shop_id = $3',
          [normalizedVin, ro.vehicle_id, req.user.shop_id]
        );
      }

      // Claim status business logic
      if (updates.claim_status) {
        const now = new Date().toISOString();
        if (updates.claim_status === 'total_loss') {
          updates.status = 'total_loss';
          await dbRun('INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)',
            [uuidv4(), req.params.id, ro.status, 'total_loss', req.user.id, 'Claim marked as Total Loss']);
          notifyStatusChange(req.user.shop_id, { ...ro, id: req.params.id }, 'total_loss');
          queueStatusSMS(req.params.id, req.user.shop_id, 'total_loss');
        } else if (updates.claim_status === 'siu') {
          updates.pre_siu_status = ro.status; // remember where we were
          updates.status = 'siu_hold';
          await dbRun('INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)',
            [uuidv4(), req.params.id, ro.status, 'siu_hold', req.user.id, 'Claim placed under SIU investigation']);
          notifyStatusChange(req.user.shop_id, { ...ro, id: req.params.id }, 'siu_hold');
          queueStatusSMS(req.params.id, req.user.shop_id, 'siu_hold');
        } else if (updates.claim_status === 'approved') {
          // Resume from where we were before SIU, or fall back to 'approval'
          const resumeStatus = ro.pre_siu_status || (ro.status === 'siu_hold' || ro.status === 'total_loss' ? 'approval' : ro.status);
          updates.status = resumeStatus;
          updates.pre_siu_status = null;
          await dbRun('INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6)',
            [uuidv4(), req.params.id, ro.status, resumeStatus, req.user.id, 'Claim approved for work — workflow resumed']);
          notifyStatusChange(req.user.shop_id, { ...ro, id: req.params.id }, resumeStatus);
          queueStatusSMS(req.params.id, req.user.shop_id, 'approval');
        }
      }

      updates.updated_at = new Date().toISOString();
      const updateKeys = Object.keys(updates);
      const updateVals = Object.values(updates);
      const setClauses = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      await dbRun(`UPDATE repair_orders SET ${setClauses} WHERE id = $${updateKeys.length + 1}`, [...updateVals, req.params.id]);
      return res.json(await enrichRO(await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id])));
    }

    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    // SIU hold gate: block normal progression while under investigation
    const normalStatuses = ['intake','estimate','approval','parts','repair','paint','qc','delivery','closed'];
    if (ro.status === 'siu_hold' && normalStatuses.includes(status)) {
      return res.status(400).json({ error: 'This RO is under SIU investigation. Clear the SIU hold before changing status.' });
    }

    // Total loss gate: block progression on total loss jobs
    if (ro.status === 'total_loss' && normalStatuses.includes(status) && status !== 'closed') {
      return res.status(400).json({ error: 'This vehicle is a total loss. Only closing is permitted.' });
    }

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
    notifyStatusChange(req.user.shop_id, { ...ro, id: req.params.id }, status);
    queueStatusSMS(req.params.id, req.user.shop_id, status);

    const updatedRO = await dbGet('SELECT * FROM repair_orders WHERE id = $1', [req.params.id]);
    res.json(await enrichRO(updatedRO));

    setImmediate(async () => {
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
        } else if (emailContext.status === 'closed' && emailContext.customer_email) {
          await queueClosedReviewEmail(req.params.id);
        }
      } catch (err) {
        console.error(`[Email] Status change notification failed for RO ${req.params.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approve-estimate', auth, requireTechnician, async (req, res) => {
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

router.post('/:id/mark-paid', auth, requireTechnician, async (req, res) => {
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
    notifyStatusChange(req.user.shop_id, { ...ro, id: req.params.id }, 'closed');
    notifyUsersByRole(
      req.user.shop_id,
      ['owner'],
      'payment',
      'Payment Received',
      `Payment was marked received for RO #${ro.ro_number || 'N/A'}.`,
      req.params.id
    ).catch(() => {});

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

router.delete('/:id', auth, requireTechnician, async (req, res) => {
  try {
    const { id } = req.params;
    const ro = await dbGet(
      'SELECT id, status FROM repair_orders WHERE id = $1 AND shop_id = $2',
      [id, req.user.shop_id]
    );
    if (!ro) return res.status(404).json({ error: 'Not found' });

    // Delete child records that lack CASCADE to avoid FK violations
    await dbRun('DELETE FROM job_status_log WHERE ro_id = $1', [id]);
    await dbRun('DELETE FROM ro_payments WHERE ro_id = $1', [id]).catch(() => {});
    await dbRun('DELETE FROM estimate_approval_links WHERE ro_id = $1', [id]).catch(() => {});
    await dbRun('DELETE FROM ro_comms WHERE ro_id = $1', [id]).catch(() => {});
    await dbRun('DELETE FROM repair_orders WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
