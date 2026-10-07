const { hasConfirmedSmsConsent } = require('./customerConsent');
const { randomUUID } = require('crypto');
const { ensureDelivery, fail } = require('./partsDelivery');
const PUBLIC_FIELDS = ['status', 'expected_date', 'eta_source', 'quantity', 'received_quantity', 'customer_note'];
const LABELS = {ordered:'Ordered',backordered:'Backordered',shipped:'Shipped',partially_received:'Partially received',received:'Received by the shop',cancelled:'Cancelled'};
const SOURCE_LABELS = {supplier:'supplier estimate',carrier:'carrier estimate',shop:'shop estimate',unknown:'not confirmed'};
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function publicChange(before, after) {
  return !!before && PUBLIC_FIELDS.some(k => (before[k] ?? null) !== (after[k] ?? null));
}
function content(context, part) {
  const lines = [`Parts update from ${context.shop_name || 'your shop'} — ${context.ro_number || 'your repair'}`,
    `${part.part_name}: ${LABELS[part.status] || 'Status updated'}.`,
    `${Number(part.received_quantity || 0)} of ${Number(part.quantity)} received and checked by the shop.`];
  if (!['received','cancelled'].includes(part.status)) {
    lines.push(part.expected_date ? `Estimated parts arrival: ${part.expected_date} (${SOURCE_LABELS[part.eta_source] || SOURCE_LABELS.unknown}).` : 'The shop is confirming the parts arrival date.');
  }
  if (part.customer_note) lines.push(part.customer_note);
  lines.push('Parts arrival estimates do not confirm when vehicle repairs will be complete.');
  return {subject:`Parts update — ${context.ro_number || 'your repair'}`,text:lines.join('\n'),html:lines.map(line=>`<p>${escapeHtml(line)}</p>`).join('')};
}
function channelAllowed(c, channel) {
  const preference = c.preferred_contact_method || '';
  if (preference && preference !== 'both' && preference !== channel) return 'contact_preference';
  if (channel === 'sms' ? !hasConfirmedSmsConsent(c) : c.email_consent !== true) return 'no_consent';
  if (c[`${channel}_notifications_enabled`] === false) return 'shop_disabled';
  if (!c[channel === 'sms' ? 'phone' : 'email']) return 'missing_contact';
  return null;
}
async function boundedProviderCall(send, timeoutMs=8000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(send),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Provider outcome unknown')),timeoutMs);})]);
  } finally {clearTimeout(timer);}
}
function cooldownSeconds(value = process.env.PARTS_NOTIFICATION_COOLDOWN_SECONDS) {
  if (typeof value !== 'string' || !/^[0-9]{2,4}$/.test(value)) return 600;
  const seconds = Number(value);
  return seconds >= 60 && seconds <= 3600 ? seconds : 600;
}
function providerReference(channel, response) {
  const value = channel === 'sms' ? response?.sid : response?.id;
  if (typeof value !== 'string') return null;
  if (channel === 'sms') return value.length === 34 && /^SM[0-9a-fA-F]{32}$/.test(value) ? value : null;
  return value.length === 36 && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value) ? value : null;
}
// A reason alone is not proof: provider errors can contain identical text.
// Only an explicit adapter marker can prove that it never entered the provider.
const NO_SEND_REASONS = new Map([
  ['no_confirmed_consent','no_consent'], ['consent_lookup_failed','consent_unavailable'],
  ['opted_out','opted_out'], ['sms_not_entitled','plan_unavailable'],
  ['missing_recipient_scope','missing_contact'], ['not configured','not_configured'],
]);
async function claimCooldown(db, shopId, customerId, channel, now) {
  const claimId = randomUUID();
  // A single conditional UPSERT serializes competing processes, even for different ROs.
  // The optional clock is an internal test dependency; request data is never passed here.
  const claim = await db.query(`WITH clock AS (SELECT COALESCE($5::timestamptz, clock_timestamp()) AS now)
    INSERT INTO parts_notification_cooldowns(shop_id,customer_id,channel,claim_id,expires_at)
    SELECT $1,$2,$3,$4,clock.now + ($6::integer * INTERVAL '1 second') FROM clock WHERE TRUE
    ON CONFLICT(shop_id,customer_id,channel) DO UPDATE
      SET claim_id=EXCLUDED.claim_id, expires_at=EXCLUDED.expires_at
      WHERE parts_notification_cooldowns.expires_at <= (SELECT now FROM clock)
    RETURNING claim_id`, [String(shopId),String(customerId),channel,claimId,now ? now() : null,cooldownSeconds()]);
  return claim.rowCount ? claimId : null;
}
async function releaseCooldown(db, shopId, customerId, channel, claimId) {
  // A delayed denial must never release a newer attempt's window.
  await db.query(`DELETE FROM parts_notification_cooldowns
    WHERE shop_id=$1 AND customer_id=$2 AND channel=$3 AND claim_id=$4`,
  [String(shopId),String(customerId),channel,claimId]);
}
async function notifyPartUpdate(db, shopId, part, previousRevision, providers = {}) {
  // Explicit per-update opt-in only. No-op saves cannot re-send the previous event.
  if (part.delivery_revision <= previousRevision) return {status:'skipped',reason:'no_customer_change',channels:[]};
  await ensureDelivery(db);
  const {rows} = await db.query(`SELECT e.before_state,e.after_state,r.ro_number,c.id AS customer_id,c.phone,c.email,c.sms_consent,c.sms_consent_at,c.sms_consent_method,c.sms_consent_by,c.email_consent,
      c.preferred_contact_method,s.name AS shop_name,s.sms_notifications_enabled,s.email_notifications_enabled
    FROM parts_delivery_events e
    JOIN parts_orders p ON p.id::text=e.part_id AND p.shop_id::text=e.shop_id AND p.delivery_revision=e.revision
    JOIN repair_orders r ON r.id=p.ro_id AND r.shop_id=p.shop_id
    JOIN customers c ON c.id=r.customer_id AND c.shop_id=r.shop_id
    JOIN shops s ON s.id=r.shop_id
    WHERE e.part_id=$1 AND e.shop_id=$2 AND e.revision=$3 AND e.source='staff'`,
  [String(part.id),String(shopId),part.delivery_revision]);
  const context = rows[0];
  if (!context || !publicChange(context.before_state,context.after_state)) return {status:'skipped',reason:'no_customer_change',channels:[]};
  const claim = await db.query(`INSERT INTO parts_delivery_notifications(shop_id,part_id,revision,result)
    VALUES($1,$2,$3,$4) ON CONFLICT(shop_id,part_id,revision) DO NOTHING RETURNING revision`,
  [String(shopId),String(part.id),part.delivery_revision,JSON.stringify({status:'pending',channels:[]})]);
  if (!claim.rowCount) return {status:'skipped',reason:'already_requested',channels:[]};
  const message = content(context, context.after_state);
  const channels = [];
  for (const channel of ['sms','email']) {
    const reason = channelAllowed(context,channel);
    if (reason) { channels.push({channel,status:'skipped',reason}); continue; }
    try {
      if (context.customer_id == null) throw new Error('Missing scoped customer');
      const cooldown = await claimCooldown(db,shopId,context.customer_id,channel,providers.now);
      if (!cooldown) { channels.push({channel,status:'skipped',reason:'cooldown'}); continue; }
      const response = await boundedProviderCall(() => channel === 'sms'
        ? (providers.sendSMS || require('./sms').sendSMS)(context.phone,message.text,{shopId})
        : (providers.sendMail || require('./mailer').sendMail)(context.email,message.subject,message.html),providers.timeoutMs);

      const reference = providerReference(channel,response);
      const accepted = reference && (channel !== 'sms' || response?.ok === true && !response.simulated);
      const noSend = channel === 'sms'
        ? response?.ok === false && response.provider_attempted === false && NO_SEND_REASONS.get(response.reason)
        : response === null && 'not_configured';
      if (accepted) channels.push({channel,status:'accepted',provider_reference:reference});
      else if (noSend) {
        await releaseCooldown(db,shopId,context.customer_id,channel,cooldown);
        channels.push({channel,status:'not_sent',reason:noSend});
      } else if (channel === 'sms' && response?.ok === false) {
        // The adapter may have attempted a send. Retain the window and event claim.
        channels.push({channel,status:'not_sent',reason:'provider_failed'});
      } else channels.push({channel,status:'unknown',reason:'verify_before_retry'});
    } catch { channels.push({channel,status:'unknown',reason:'verify_before_retry'}); }
  }
  const result = {status:'complete',channels};
  // If recording fails after provider acceptance, preserve the unique pending claim; never retry automatically.
  await db.query('UPDATE parts_delivery_notifications SET result=$4,updated_at=NOW() WHERE shop_id=$1 AND part_id=$2 AND revision=$3',
    [String(shopId),String(part.id),part.delivery_revision,JSON.stringify(result)]);
  return result;
}
function validateNotificationRequest(body) {
  if (body.notify_customer !== undefined && typeof body.notify_customer !== 'boolean') throw fail('Notify customer must be true or false.');
}
module.exports = {notifyPartUpdate,publicChange,content,channelAllowed,validateNotificationRequest,cooldownSeconds};
