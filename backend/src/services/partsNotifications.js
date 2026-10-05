const { hasConfirmedSmsConsent } = require('./customerConsent');
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
async function notifyPartUpdate(db, shopId, part, previousRevision, providers = {}) {
  // Explicit per-update opt-in only. No-op saves cannot re-send the previous event.
  if (part.delivery_revision <= previousRevision) return {status:'skipped',reason:'no_customer_change',channels:[]};
  await ensureDelivery(db);
  const {rows} = await db.query(`SELECT e.before_state,e.after_state,r.ro_number,c.phone,c.email,c.sms_consent,c.sms_consent_at,c.sms_consent_method,c.sms_consent_by,c.email_consent,
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
      const response = await boundedProviderCall(() => channel === 'sms'
        ? (providers.sendSMS || require('./sms').sendSMS)(context.phone,message.text,{shopId})
        : (providers.sendMail || require('./mailer').sendMail)(context.email,message.subject,message.html),providers.timeoutMs);

      const accepted = channel === 'sms' ? response?.ok === true && !response.simulated : !!response?.id;
      const rawReason = channel === 'sms' ? response?.reason : response ? 'provider_failed' : 'not_configured';
      const safeReason = ({no_confirmed_consent:'no_consent',consent_lookup_failed:'consent_unavailable',opted_out:'opted_out',sms_not_entitled:'plan_unavailable','not configured':'not_configured',not_configured:'not_configured'})[rawReason] || 'provider_failed';
      channels.push({channel,status:accepted?'accepted':'not_sent',...(accepted?{provider_reference:String(response.sid || response.id || '').slice(0,200)}:{reason:safeReason})});
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
module.exports = {notifyPartUpdate,publicChange,content,channelAllowed,validateNotificationRequest};
