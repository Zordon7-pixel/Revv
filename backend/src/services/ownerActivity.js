const { v4: uuidv4 } = require('uuid');
const { dbAll, dbGet, dbRun } = require('../db');
const { sendEmail } = require('./email');

const SENSITIVE_KEY_RE = /(password|token|secret|key|authorization|cookie|body|html|raw|jwt|signature)/i;

function redactActivityValue(value) {
  if (Array.isArray(value)) return value.map(redactActivityValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_RE.test(key) ? '[redacted]' : redactActivityValue(entry),
    ])
  );
}

function actorLabel(actor = {}) {
  return actor.name || actor.email || actor.id || 'System';
}

async function recordOwnerActivity({
  shopId,
  roId = null,
  actor = {},
  eventType,
  severity = 'info',
  summary,
  before = {},
  after = {},
}) {
  if (!shopId || !eventType || !summary) return;
  try {
    await dbRun(
      `INSERT INTO owner_activity_events
        (id, shop_id, ro_id, actor_user_id, actor_name, actor_role, event_type, severity, summary, before_json, after_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      [
        uuidv4(),
        shopId,
        roId,
        actor.id || null,
        actorLabel(actor),
        actor.role || null,
        eventType,
        severity,
        summary,
        JSON.stringify(redactActivityValue(before)),
        JSON.stringify(redactActivityValue(after)),
      ]
    );
    if (severity === 'critical') {
      sendImmediateOwnerActivityAlert({ shopId, summary, actor }).catch((err) => {
        console.error('[OwnerActivity] immediate alert failed:', err.message);
      });
    }
  } catch (err) {
    console.error('[OwnerActivity] record failed:', err.message);
  }
}

async function sendImmediateOwnerActivityAlert({ shopId, summary, actor }) {
  const prefs = await getOwnerActivityPreferences(shopId);
  if (!prefs.owner_activity_immediate_alerts_enabled) return { ok: true, skipped: true };
  const [shop, ownerRows] = await Promise.all([
    dbGet('SELECT name FROM shops WHERE id::text = $1::text', [shopId]),
    dbAll(
      `SELECT email FROM users
       WHERE shop_id::text = $1::text
         AND LOWER(role) IN ('owner', 'admin', 'superadmin')
         AND email IS NOT NULL`,
      [shopId]
    ),
  ]);
  const recipients = [...new Set([
    ...ownerRows.map((row) => row.email),
    ...parseRecipientList(prefs.owner_activity_digest_recipients),
  ].map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return { ok: true, skipped: true };
  const subject = `REVV owner alert - ${shop?.name || 'Your shop'}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.45;">
      <h2 style="margin:0 0 8px;">REVV owner alert</h2>
      <p style="margin:0 0 12px;">${escapeHtml(summary)}</p>
      <p style="margin:0;color:#6b7280;font-size:13px;">Triggered by ${escapeHtml(actorLabel(actor))}.</p>
    </div>
  `;
  for (const recipient of recipients) {
    await sendEmail(recipient, subject, html);
  }
  return { ok: true, sent: recipients.length };
}

async function getOwnerActivityPreferences(shopId) {
  const prefs = await dbGet(
    `SELECT
       COALESCE(owner_activity_digest_enabled, TRUE) AS owner_activity_digest_enabled,
       COALESCE(owner_activity_immediate_alerts_enabled, TRUE) AS owner_activity_immediate_alerts_enabled,
       COALESCE(owner_activity_digest_time, '19:00') AS owner_activity_digest_time,
       COALESCE(owner_activity_digest_recipients, '') AS owner_activity_digest_recipients
     FROM shop_notification_preferences
     WHERE shop_id::text = $1::text`,
    [shopId]
  );
  return prefs || {
    owner_activity_digest_enabled: true,
    owner_activity_immediate_alerts_enabled: true,
    owner_activity_digest_time: '19:00',
    owner_activity_digest_recipients: '',
  };
}

async function upsertOwnerActivityPreferences(shopId, body = {}) {
  const digestEnabled = body.owner_activity_digest_enabled !== false;
  const immediateEnabled = body.owner_activity_immediate_alerts_enabled === true;
  const digestTime = /^\d{2}:\d{2}$/.test(String(body.owner_activity_digest_time || ''))
    ? body.owner_activity_digest_time
    : '19:00';
  const recipients = String(body.owner_activity_digest_recipients || '').trim();

  await dbRun(
    `INSERT INTO shop_notification_preferences
       (shop_id, owner_activity_digest_enabled, owner_activity_immediate_alerts_enabled, owner_activity_digest_time, owner_activity_digest_recipients, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (shop_id) DO UPDATE SET
       owner_activity_digest_enabled = EXCLUDED.owner_activity_digest_enabled,
       owner_activity_immediate_alerts_enabled = EXCLUDED.owner_activity_immediate_alerts_enabled,
       owner_activity_digest_time = EXCLUDED.owner_activity_digest_time,
       owner_activity_digest_recipients = EXCLUDED.owner_activity_digest_recipients,
       updated_at = NOW()`,
    [shopId, digestEnabled, immediateEnabled, digestTime, recipients]
  );
  return getOwnerActivityPreferences(shopId);
}

function parseRecipientList(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function buildOwnerActivityDigestHtml({ shopName, events, since, until }) {
  const rows = events.map((event) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${new Date(event.created_at).toLocaleString()}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(event.actor_name || 'System')}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(event.summary || event.event_type)}</td>
    </tr>
  `).join('');
  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.45;">
      <h2 style="margin:0 0 8px;">REVV daily activity digest</h2>
      <p style="margin:0 0 16px;color:#4b5563;">${escapeHtml(shopName || 'Your shop')} activity from ${new Date(since).toLocaleString()} to ${new Date(until).toLocaleString()}.</p>
      ${events.length ? `
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:10px;">Time</th>
              <th style="padding:10px;">User</th>
              <th style="padding:10px;">Activity</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      ` : '<p style="padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">No tracked owner activity in this period.</p>'}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendOwnerActivityDigest({ shopId, since, until, recipientOverride = null }) {
  const prefs = await getOwnerActivityPreferences(shopId);
  if (!recipientOverride && !prefs.owner_activity_digest_enabled) return { ok: true, skipped: true };

  const [shop, ownerRows, events] = await Promise.all([
    dbGet('SELECT name FROM shops WHERE id::text = $1::text', [shopId]),
    dbAll(
      `SELECT email FROM users
       WHERE shop_id::text = $1::text
         AND LOWER(role) IN ('owner', 'admin', 'superadmin')
         AND email IS NOT NULL`,
      [shopId]
    ),
    dbAll(
      `SELECT id, ro_id, actor_name, actor_role, event_type, severity, summary, created_at
       FROM owner_activity_events
       WHERE shop_id::text = $1::text
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at DESC
       LIMIT 250`,
      [shopId, since, until]
    ),
  ]);

  const recipients = recipientOverride || [
    ...ownerRows.map((row) => row.email),
    ...parseRecipientList(prefs.owner_activity_digest_recipients),
  ];
  const uniqueRecipients = [...new Set(recipients.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
  if (uniqueRecipients.length === 0) return { ok: true, skipped: true, reason: 'no_recipients' };

  const html = buildOwnerActivityDigestHtml({
    shopName: shop?.name || 'Your shop',
    events,
    since,
    until,
  });
  const subject = `REVV daily activity digest - ${shop?.name || 'Your shop'}`;
  const results = [];
  for (const recipient of uniqueRecipients) {
    results.push(await sendEmail(recipient, subject, html));
  }
  return { ok: results.every((result) => result?.ok !== false), sent: results.length, events: events.length, results };
}

module.exports = {
  buildOwnerActivityDigestHtml,
  getOwnerActivityPreferences,
  recordOwnerActivity,
  redactActivityValue,
  sendImmediateOwnerActivityAlert,
  sendOwnerActivityDigest,
  upsertOwnerActivityPreferences,
};
