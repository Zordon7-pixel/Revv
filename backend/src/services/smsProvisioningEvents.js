'use strict';

const { validMapping, fail } = require('./smsProvisioningProvider');
const PATH = '/api/sms/provisioning-events';
const enabled = env => env.REVV_SMS_AUTOPROVISION === 'true';
const FIELDS = ['account_sid', 'service_sid', 'campaign_sid', 'brand_sid', 'authorization_ref',
  'event_campaign_sid', 'event_callback_url', 'callback'];
const sameBinding = (a, b) => FIELDS.every(k => a?.[k] === b?.[k]);
const bindingOf = (m, callback) => Object.fromEntries(FIELDS.map(k => [k, k === 'callback' ? callback : m[k]]));

function eventUrl(env = process.env) {
  try {
    const base = new URL(env.APP_URL || env.PUBLIC_URL || '');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
        || base.pathname !== '/') return null;
    return `${base.origin}${PATH}`;
  } catch { return null; }
}

const TYPES = Object.fromEntries([
  ['number-registration.successful', 'NumberRegistrationSuccessful', 'registered', 'registered'],
  ['number-registration.pending', 'NumberRegistrationPending', 'pending_registration', 'pending'],
  ['number-registration.failed', 'NumberRegistrationFailed', 'failure', 'failed'],
  ['number-deregistration.successful', 'NumberDeregistrationSuccessful', 'unregistered', 'unregistered'],
  ['number-deregistration.pending', 'NumberDeregistrationPending', 'pending_deregistration', 'pending'],
  ['number-deregistration.failed', 'NumberDeregistrationFailed', 'failure', 'failed'],
].map(([kind, schema, external, status]) => [`com.twilio.messaging.compliance.${kind}`, { kind, schema, external, status }]));

function parseEvents(raw) {
  let events;
  try { events = JSON.parse(raw); } catch { fail('EVENT_INVALID'); }
  if (!Array.isArray(events) || !events.length || events.length > 100) fail('EVENT_INVALID');
  return events.map(e => {
    const t = Object.hasOwn(TYPES, e?.type) ? TYPES[e.type] : null; const d = e?.data;
    // V2 is the first official version with messagingservicesid. V1 cannot
    // establish exact MG authority; never accept its omission as a wildcard.
    if (!t || e.specversion !== '1.0' || e.datacontenttype !== 'application/json'
        || e.dataschema !== `https://events-schemas.twilio.com/A2P.${t.schema}/2`
        || typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(e.id) || !d
        || ![['accountsid', 'AC'], ['messagingservicesid', 'MG'], ['phonenumbersid', 'PN']]
          .every(([k, prefix]) => typeof d[k] === 'string' && new RegExp(`^${prefix}[0-9a-fA-F]{32}$`).test(d[k]))
        || (!(t.kind === 'number-deregistration.successful' && !Object.hasOwn(d, 'campaignsid'))
          && (typeof d.campaignsid !== 'string' || !/^CM[0-9a-fA-F]{32}$/.test(d.campaignsid)))
        || d.externalstatus !== t.external || typeof e.time !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(e.time)
        || !Number.isSafeInteger(d.timestamp) || !Number.isSafeInteger(d.updateddate)
        || d.updateddate <= 0 || d.updateddate > d.timestamp || Date.parse(e.time) !== d.timestamp) fail('EVENT_INVALID');
    // Whitelist only: never retain the phone field, raw payload, source, data.id,
    // error text, headers or credentials, even from a correctly signed request.
    return { event_id: e.id, account_sid: d.accountsid, service_sid: d.messagingservicesid,
      event_campaign_sid: d.campaignsid, phone_sid: d.phonenumbersid,
      kind: t.kind, status: t.status, occurred_at: d.updateddate, emitted_at: d.timestamp };
  });
}

async function registration(db, shopId, phoneSid, binding) {
  const { rows } = await db.query(`SELECT event_id,kind,status,occurred_at FROM sms_provision_receipts
    WHERE shop_id=$1 AND phone_sid=$2 AND binding=$3::jsonb
      AND occurred_at=(SELECT max(occurred_at) FROM sms_provision_receipts
        WHERE shop_id=$1 AND phone_sid=$2 AND binding=$3::jsonb)
    ORDER BY event_id`,
  [shopId, phoneSid, bindingOf(binding, binding.callback)]);
  if (!rows.length) return { status: 'UNAVAILABLE', source: null };
  const latest = rows.filter(r => r.occurred_at === rows[0].occurred_at);
  const conflict = latest.some(r => r.kind !== latest[0].kind || r.status !== latest[0].status);
  const status = conflict ? 'FAILURE' : latest[0].status === 'registered' && latest[0].kind === 'number-registration.successful' ? 'REGISTERED'
    : latest[0].status === 'failed' ? 'FAILURE' : 'PENDING_REGISTRATION';
  return { status, source: `twilio-event:${latest[0].event_id}`, phone_sid: phoneSid,
    binding: bindingOf(binding, binding.callback) };
}

// Called under the same control/shop/mapping locks used for publication. The
// publication timestamp is a custody marker: even a manual rewrite of the same
// PN/MG must never be cleared by this worker.
async function revoke(db, shopId, phoneSid, binding) {
  const result = await registration(db, shopId, phoneSid, binding);
  if (result.status === 'UNAVAILABLE' || result.status === 'REGISTERED') return;
  await db.query(`WITH revoked AS (
    UPDATE shops s SET twilio_phone_sid=NULL,twilio_phone_number=NULL,
      twilio_messaging_service_sid=NULL,twilio_sender_mode=NULL,twilio_sender_updated_at=now()
    FROM sms_provision_jobs j WHERE s.id::text=$1 AND j.shop_id=$1
      AND j.phone_sid=$2 AND j.binding=$3::jsonb AND j.routing_published_at IS NOT NULL
      AND s.twilio_phone_sid=j.phone_sid AND s.twilio_phone_number=j.phone_number
      AND s.twilio_messaging_service_sid=j.binding->>'service_sid'
      AND s.twilio_sender_mode='managed' AND s.twilio_sender_updated_at=j.routing_published_at
    RETURNING j.shop_id
  ) INSERT INTO sms_provision_history(shop_id,event,evidence)
    SELECT shop_id,'REGISTRATION_REVOKED',jsonb_build_object('phone_sid',$2::text) FROM revoked`,
  [shopId, phoneSid, bindingOf(binding, binding.callback)]);
  await db.query(`UPDATE sms_provision_jobs SET state='failed',reason='REGISTRATION_REVOKED',
    admin_attention=TRUE,updated_at=now() WHERE shop_id=$1 AND phone_sid=$2 AND binding=$3::jsonb
      AND routing_published_at IS NOT NULL`,
  [shopId, phoneSid, bindingOf(binding, binding.callback)]);
}

class PgEventStore {
  constructor(pool, env = process.env) { this.pool = pool; this.env = env; }
  async accept(events, authenticate) {
    if (!enabled(this.env)) return;
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const control = (await c.query('SELECT enabled FROM sms_provision_control WHERE singleton FOR UPDATE')).rows[0];
      if (!enabled(this.env) || !control?.enabled) fail('OFF');
      const verified = [];
      // ALL objects, bindings and account signatures are checked before INSERT.
      for (const e of events) {
        let prior;
        if (e.event_campaign_sid === undefined) {
          if (e.kind !== 'number-deregistration.successful' || e.status !== 'unregistered') fail('EVENT_UNAUTHORIZED');
          // Resolve a single recorded PN binding, never an account/service wildcard.
          // Receipts cover the callback-before-acquisition-write recovery window.
          const candidates = (await c.query(`SELECT shop_id,binding FROM sms_provision_jobs
            WHERE phone_sid=$1 AND binding->>'account_sid'=$2 AND binding->>'service_sid'=$3
            UNION SELECT shop_id,binding FROM sms_provision_receipts
            WHERE phone_sid=$1 AND account_sid=$2 AND service_sid=$3`,
          [e.phone_sid,e.account_sid,e.service_sid])).rows;
          if (candidates.length !== 1) fail('EVENT_UNAUTHORIZED');
          prior = candidates[0];
        }
        const m = (await c.query(`SELECT * FROM sms_provision_mapping
          WHERE account_sid=$1 AND service_sid=$2 AND event_campaign_sid=$3`,
        [e.account_sid, e.service_sid, prior ? prior.binding.event_campaign_sid : e.event_campaign_sid])).rows[0];
        if (!validMapping(m)) fail('EVENT_UNAUTHORIZED');
        const shop = (await c.query('SELECT * FROM shops WHERE id::text=$1 FOR UPDATE', [m.shop_id])).rows[0];
        const locked = (await c.query('SELECT * FROM sms_provision_mapping WHERE shop_id=$1 FOR SHARE', [m.shop_id])).rows[0];
        if (!locked || !sameBinding(m, locked) || locked.event_callback_url !== eventUrl(this.env)
            || shop?.twilio_account_sid !== e.account_sid || typeof shop.twilio_auth_token !== 'string'
            || !shop.twilio_auth_token.trim() || !authenticate(shop.twilio_auth_token)) fail('EVENT_UNAUTHORIZED');
        const binding = bindingOf(locked, eventUrl(this.env).replace(PATH, '/api/sms/webhook'));
        if (prior && (prior.shop_id !== m.shop_id || !sameBinding(prior.binding, binding))) fail('EVENT_UNAUTHORIZED');
        const owners = (await c.query(`SELECT shop_id FROM sms_provision_jobs WHERE phone_sid=$1
          UNION SELECT id::text AS shop_id FROM shops WHERE twilio_phone_sid=$1`, [e.phone_sid])).rows;
        if (owners.some(owner => owner.shop_id !== m.shop_id)) fail('EVENT_UNAUTHORIZED');
        verified.push({ ...e, shop_id: m.shop_id, event_campaign_sid: binding.event_campaign_sid, binding });
      }
      if (!enabled(this.env)) fail('OFF');
      for (const e of verified) {
        const args = [e.event_id,e.shop_id,e.account_sid,e.service_sid,e.event_campaign_sid,
          e.phone_sid,e.binding,e.kind,e.status,e.occurred_at,e.emitted_at];
        const inserted = await c.query(`INSERT INTO sms_provision_receipts
          (event_id,shop_id,account_sid,service_sid,event_campaign_sid,phone_sid,binding,kind,status,occurred_at,emitted_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`, args);
        if (!inserted.rows.length) {
          const duplicate = await c.query(`SELECT event_id FROM sms_provision_receipts WHERE
            event_id=$1 AND shop_id=$2 AND account_sid=$3 AND service_sid=$4 AND event_campaign_sid=$5
            AND phone_sid=$6 AND binding=$7::jsonb AND kind=$8 AND status=$9 AND occurred_at=$10 AND emitted_at=$11`, args);
          if (!duplicate.rows.length) fail('EVENT_CONFLICT');
        }
      }
      for (const e of verified) await revoke(c, e.shop_id, e.phone_sid, e.binding);
      if (!enabled(this.env)) fail('OFF');
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  }
}

function router({ env = process.env, store, onFailure = () => console.error('[SMS_AUTO] EVENT_RECEIVER_FAILURE') } = {}) {
  const express = require('express');
  const route = express.Router();
  route.use((req, res, next) => enabled(env) ? next() : res.sendStatus(204));
  route.post('/', express.raw({ type: 'application/json', limit: '128kb', inflate: false }), async (req, res) => {
    try {
      const base = eventUrl(env);
      // Accept exactly one canonical hash query; never reconstruct from Host,
      // forwarded headers, parsed query objects, or arbitrary query parameters.
      const match = req.originalUrl.match(/^\/api\/sms\/provisioning-events\?bodySHA256=([0-9a-f]{64})$/);
      if (!base || !match || !Buffer.isBuffer(req.body)) fail('EVENT_INVALID');
      const raw = req.body.toString('utf8');
      if (!Buffer.from(raw, 'utf8').equals(req.body)) fail('EVENT_INVALID');
      const events = parseEvents(raw);
      const signature = req.get('X-Twilio-Signature');
      if (!/^[A-Za-z0-9+/]{27}=$/.test(signature || '')) fail('EVENT_UNAUTHORIZED');
      const twilio = require('twilio');
      const url = `${base}?bodySHA256=${match[1]}`;
      const auth = token => twilio.validateRequestWithBody(token, signature, url, raw);
      const target = store || new PgEventStore(require('../db').pool, env);
      await target.accept(events, auth);
      res.sendStatus(204);
    } catch (e) {
      const status = e.reason === 'OFF' ? 503 : ['EVENT_INVALID','EVENT_UNAUTHORIZED','EVENT_CONFLICT'].includes(e.reason) ? 403 : 503;
      if (status === 503) onFailure();
      res.status(status).json({ error: 'EVENT_REJECTED' });
    }
  });
  route.use((err, req, res, next) => { // Never pass raw parser errors into app logging/Sentry.
    res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'EVENT_REJECTED' });
  });
  return route;
}

module.exports = { PATH, router, eventUrl, bindingOf, sameBinding, parseEvents, registration, revoke, PgEventStore };
