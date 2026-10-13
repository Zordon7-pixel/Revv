'use strict';
const { randomUUID } = require('node:crypto');
const { createProvider, validMapping, fail } = require('./smsProvisioningProvider');
const { bindingOf, sameBinding, registration, eventUrl } = require('./smsProvisioningEvents');
const enabled = (env = process.env) => env.REVV_SMS_AUTOPROVISION === 'true';
const entitled = shop => !!shop && (shop.plan === 'pro' || shop.plan === 'agency' || shop.sms_comp === true);
const MAX_ATTEMPTS = 5;
const CADENCE_MS = 60000;
const REASONS = new Set(['DISCOVERED', 'OFF', 'INELIGIBLE', 'MAPPING_REQUIRED', 'CONFIG_DRIFT',
  'EVENT_SETUP_REQUIRED', 'REGISTRATION_REVOKED', 'RUN_CONFIG', 'CAP_DEFERRED', 'PURCHASE_INTENT', 'PURCHASE_UNCERTAIN', 'ACQUIRED', 'REUSED',
  'ACCOUNT_MISMATCH', 'BINDING_MISMATCH', 'NUMBER_MISMATCH', 'ATTACHMENT_MISMATCH',
  'CAMPAIGN_PENDING', 'CAMPAIGN_FAILED', 'CALLBACK_MISMATCH', 'NO_NUMBER',
  'REGISTRATION_SOURCE_REQUIRED', 'REGISTRATION_PENDING', 'REGISTRATION_FAILED',
  'ACTIVE', 'PROVIDER_TRANSIENT', 'PROVIDER_PERMANENT', 'RETRIES_EXHAUSTED', 'QUEUE_FAILURE']);
const DEFERRED = new Set(['EVENT_SETUP_REQUIRED', 'OFF', 'INELIGIBLE', 'MAPPING_REQUIRED', 'CAP_DEFERRED', 'CAMPAIGN_PENDING',
  'REGISTRATION_SOURCE_REQUIRED', 'REGISTRATION_PENDING']);
const TERMINAL = new Set(['CONFIG_DRIFT', 'RUN_CONFIG', 'PURCHASE_UNCERTAIN', 'ACCOUNT_MISMATCH',
  'BINDING_MISMATCH', 'NUMBER_MISMATCH', 'ATTACHMENT_MISMATCH', 'CAMPAIGN_FAILED',
  'CALLBACK_MISMATCH', 'REGISTRATION_FAILED', 'PROVIDER_PERMANENT']);
function reasonFor(e) {
  if (REASONS.has(e?.reason)) return e.reason;
  return Number(e?.status) >= 400 && Number(e?.status) < 500 && Number(e?.status) !== 429
    ? 'PROVIDER_PERMANENT' : 'PROVIDER_TRANSIENT';
}
function runConfig(env) {
  const id = env.REVV_SMS_AUTOPROVISION_RUN_ID;
  const cap = env.REVV_SMS_AUTOPROVISION_PURCHASE_CAP;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(id || '') || !/^(0|[1-9]\d{0,3})$/.test(cap || '') || Number(cap) > 1000) fail('RUN_CONFIG');
  return { id, cap: Number(cap) };
}

class PgStore {
  constructor(pool, env = process.env) { this.pool = pool; this.env = env; }
  async configure() {
    if (!enabled(this.env)) return;
    const { id, cap } = runConfig(this.env);
    const { rows } = await this.pool.query(`UPDATE sms_provision_control SET
      run_id=COALESCE(run_id,$1), purchase_cap=COALESCE(purchase_cap,$2)
      WHERE singleton AND enabled AND (run_id IS NULL OR (run_id=$1 AND purchase_cap=$2)) RETURNING run_id`, [id, cap]);
    if (!rows.length) fail('RUN_CONFIG');
  }
  async discover() {
    if (!enabled(this.env)) return;
    await this.pool.query(`INSERT INTO sms_provision_jobs(shop_id)
      SELECT id::text FROM shops WHERE plan IN ('pro','agency') OR sms_comp IS TRUE
      ON CONFLICT (shop_id) DO NOTHING`);
    // Failed jobs do not retry provider work, but acquired resources still need
    // durable attention after a later entitlement downgrade (including deletion).
    await this.pool.query(`WITH changed AS (
      UPDATE sms_provision_jobs j SET admin_attention=TRUE,reason='INELIGIBLE',updated_at=now()
      WHERE phone_sid IS NOT NULL AND reason != 'INELIGIBLE' AND NOT EXISTS
        (SELECT 1 FROM shops s WHERE s.id::text=j.shop_id AND (plan IN ('pro','agency') OR sms_comp IS TRUE))
      RETURNING shop_id,phone_sid
    ) INSERT INTO sms_provision_history(shop_id,event,evidence)
      SELECT shop_id,'INELIGIBLE',jsonb_build_object('phone_sid',phone_sid) FROM changed`);
  }
  async attention() {
    if (!enabled(this.env)) return [];
    return (await this.pool.query(`SELECT DISTINCT ON (reason) shop_id,reason FROM sms_provision_jobs
      WHERE admin_attention IS TRUE ORDER BY reason,updated_at DESC,shop_id`)).rows;
  }
  async due() {
    return (await this.pool.query(`SELECT shop_id FROM sms_provision_jobs
      WHERE state != 'failed' AND next_at <= now() ORDER BY next_at,shop_id LIMIT 25`)).rows;
  }
  async claim(shopId, fn) {
    if (!enabled(this.env)) return;
    const c = await this.pool.connect();
    // Session lock spans committed purchase intent AND provider request. No expiring
    // lease can permit a second worker to buy while the first request is in flight.
    let locked = false;
    try {
      locked = (await c.query('SELECT pg_try_advisory_lock(hashtextextended($1, 71931)) AS locked', [shopId])).rows[0].locked;
      if (!locked) return;
      const job = (await c.query(`SELECT *,xmin::text AS version,routing_published_at::text AS routing_published_at FROM sms_provision_jobs WHERE shop_id=$1
        AND state != 'failed' AND next_at <= now()`, [shopId])).rows[0];
      if (!job || !enabled(this.env)) return;
      return await fn(this.session(c), job);
    } finally {
      // Destroy this dedicated connection: releases all session locks even if a
      // transaction or unlock would fail. Never return a locked session to pool.
      c.release(true);
    }
  }
  session(c) {
    const env = this.env;
    let inTransaction = false;
    const current = async shopId => (await c.query(`SELECT *,xmin::text AS version,
      routing_published_at::text AS routing_published_at FROM sms_provision_jobs WHERE shop_id=$1`, [shopId])).rows[0];
    const transaction = async (job, fn) => {
      if (!enabled(env)) fail('OFF');
      const version = job.version; const published = job.routing_published_at;
      await c.query('BEGIN');
      try {
        // Shared lock order with the event receiver, including failure saves.
        const control = (await c.query('SELECT * FROM sms_provision_control WHERE singleton FOR UPDATE')).rows[0];
        if (!enabled(env) || !control?.enabled) fail('OFF');
        const shop = (await c.query('SELECT * FROM shops WHERE id::text=$1 FOR UPDATE', [job.shop_id])).rows[0];
        const m = (await c.query('SELECT * FROM sms_provision_mapping WHERE shop_id=$1 FOR SHARE', [job.shop_id])).rows[0];
        const persisted = (await c.query('SELECT xmin::text AS version FROM sms_provision_jobs WHERE shop_id=$1 FOR UPDATE', [job.shop_id])).rows[0];
        if (!job.version || persisted?.version !== job.version) fail('STALE_JOB');
        inTransaction = true;
        const result = await fn(shop, m, control);
        if (!enabled(env)) fail('OFF');
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK');
        job.version = version; job.routing_published_at = published;
        throw e;
      } finally { inTransaction = false; }
    };
    const save = async job => {
      if (!inTransaction) return transaction(job, async shop => {
        // Downgrade wins even when mapping/config validation failed first.
        if (!entitled(shop)) { job.reason = 'INELIGIBLE'; job.admin_attention = true; }
        if (job.state !== 'active' && job.reason !== 'INELIGIBLE') {
          // Use persisted identity and publication timestamp, not mutable job data.
          // Only routing is withdrawn; provider resources and acquisition stay held.
          await c.query(`UPDATE shops s SET twilio_phone_sid=NULL,twilio_phone_number=NULL,
            twilio_messaging_service_sid=NULL,twilio_sender_mode=NULL,twilio_sender_updated_at=now()
            FROM sms_provision_jobs j WHERE s.id::text=$1 AND j.shop_id=$1
              AND j.routing_published_at IS NOT NULL AND s.twilio_phone_sid=j.phone_sid
              AND s.twilio_phone_number=j.phone_number
              AND s.twilio_messaging_service_sid=j.binding->>'service_sid'
              AND s.twilio_sender_mode='managed' AND s.twilio_sender_updated_at=j.routing_published_at`, [job.shop_id]);
        }
        return save(job);
      });
      if (!REASONS.has(job.reason)) fail('QUEUE_FAILURE');
      const saved = await c.query(`WITH changed AS (
        UPDATE sms_provision_jobs SET state=$2,reason=$3,attempts=$4,next_at=$5,
          admin_attention=$6,binding=$7,intent_id=$8,candidate=$9,run_id=$10,
          phone_sid=$11,phone_number=$12,registration_source=$13,routing_published_at=$14,updated_at=now()
        WHERE shop_id=$1 AND xmin::text=$15 RETURNING *,xmin::text AS version
      ), history AS (INSERT INTO sms_provision_history(shop_id,event,evidence)
        SELECT shop_id,reason,jsonb_build_object('state',state,'attempts',attempts,'binding',binding,
          'intent_id',intent_id,'candidate',candidate,'run_id',run_id,'phone_sid',phone_sid,
          'phone_number',phone_number,'registration_source',registration_source) FROM changed)
      SELECT version FROM changed`,
      [job.shop_id,job.state,job.reason,job.attempts,job.next_at,job.admin_attention,job.binding,
        job.intent_id,job.candidate,job.run_id,job.phone_sid,job.phone_number,job.registration_source,job.routing_published_at,job.version]);
      if (!saved.rows.length) fail('STALE_JOB');
      job.version = saved.rows[0].version;
    };
    return {
      save, current,
      registration: (shopId, phoneSid, binding) => registration(c, shopId, phoneSid, binding),
      async mapping(shopId) {
        return (await c.query('SELECT * FROM sms_provision_mapping WHERE shop_id=$1', [shopId])).rows[0];
      },
      async guard(job, fn) {
        return transaction(job, async (shop, m, control) => {
          const cfg = runConfig(env);
          if (control.run_id !== cfg.id || control.purchase_cap !== cfg.cap) fail('RUN_CONFIG');
          if (!entitled(shop)) fail('INELIGIBLE');
          // Publishing activates per-shop credentials in sms.js.
          if (shop.twilio_account_sid && shop.twilio_account_sid !== job.binding.account_sid) fail('ACCOUNT_MISMATCH');
          const callback = require('./smsWebhookConfig').inboundWebhookUrl();
          if (!callback || (env.TWILIO_INBOUND_WEBHOOK_URL && env.TWILIO_INBOUND_WEBHOOK_URL !== callback)) fail('CALLBACK_MISMATCH');
          if (!sameBinding(job.binding, { ...m, callback })) fail('CONFIG_DRIFT');
          if (!enabled(env)) fail('OFF');
          return fn(shop);
        });
      },
      async reserve(job) {
        const { rows } = await c.query(`UPDATE sms_provision_control SET consumed=consumed+1
          WHERE singleton AND consumed < purchase_cap RETURNING run_id`);
        if (!rows.length) fail('CAP_DEFERRED');
        job.run_id = rows[0].run_id;
        await save(job);
      },
      async publish(job, shop) {
        // Do not reclaim a manual rewrite of even the same PN/MG on a later tick.
        const replaced = await c.query(`SELECT 1 FROM shops s JOIN sms_provision_jobs j ON j.shop_id=s.id::text
          WHERE j.shop_id=$1 AND j.routing_published_at IS NOT NULL
            AND (s.twilio_phone_sid IS NOT NULL OR s.twilio_phone_number IS NOT NULL OR s.twilio_messaging_service_sid IS NOT NULL)
            AND (s.twilio_sender_updated_at IS DISTINCT FROM j.routing_published_at OR s.twilio_sender_mode IS DISTINCT FROM 'managed')`, [job.shop_id]);
        if (replaced.rows.length) fail('CONFIG_DRIFT');
        const otherOwner = await c.query(`SELECT 1 FROM shops WHERE id::text != $1
          AND (twilio_phone_sid=$2 OR twilio_phone_number=$3)`, [job.shop_id,job.phone_sid,job.phone_number]);
        if (otherOwner.rows.length) fail('NUMBER_MISMATCH');
        // Never replace a subsequently manually assigned sender.
        if ((shop.twilio_phone_sid && shop.twilio_phone_sid !== job.phone_sid)
          || (shop.twilio_phone_number && shop.twilio_phone_number !== job.phone_number)
          || (shop.twilio_messaging_service_sid && shop.twilio_messaging_service_sid !== job.binding.service_sid)) fail('CONFIG_DRIFT');
        const published = await c.query(`UPDATE shops SET twilio_phone_number=$2,twilio_phone_sid=$3,
          twilio_messaging_service_sid=$4,twilio_sender_mode='managed',twilio_sender_updated_at=now()
          WHERE id::text=$1 RETURNING twilio_sender_updated_at::text AS published_at`, [job.shop_id,job.phone_number,job.phone_sid,job.binding.service_sid]);
        job.routing_published_at = published.rows[0].published_at;
        await save(job);
      },
    };
  }
  async alert(reason, shopId, notify) {
    const code = REASONS.has(reason) ? reason : 'QUEUE_FAILURE';
    // Global enum cooldown also bounds storms across thousands of shops.
    const { rows } = await this.pool.query(`INSERT INTO sms_provision_alerts(code,next_at)
      VALUES($1,now()+interval '1 hour') ON CONFLICT(code) DO UPDATE SET next_at=EXCLUDED.next_at
      WHERE sms_provision_alerts.next_at <= now() RETURNING code`, [code]);
    if (rows.length) await notify('high', `SMS_AUTO_${code}`, { shop_id: shopId });
  }
}

async function processJob(s, job, { env = process.env, provider = createProvider,
  callback = () => require('./smsWebhookConfig').inboundWebhookUrl(), now = () => Date.now() } = {}) {
  if (!enabled(env)) return job;
  const g = fn => s.guard(job, async shop => {
    if (!enabled(env)) fail('OFF');
    return fn(shop);
  });
  const call = fn => g(async shop => fn(await provider(job.shop_id, job.binding, {
    shop, env, registration: s.registration && ((sid, binding) => s.registration(job.shop_id, sid, binding)),
  }), shop));
  try {
    const mapping = await s.mapping(job.shop_id);
    if (!validMapping(mapping)) fail('MAPPING_REQUIRED');
    const binding = bindingOf(mapping, callback());
    if (!binding.callback) fail('CALLBACK_MISMATCH');
    if (!eventUrl(env) || binding.event_callback_url !== eventUrl(env)) fail('EVENT_SETUP_REQUIRED');
    if (job.binding && !sameBinding(job.binding, binding)) fail('CONFIG_DRIFT');
    job.binding = binding;
    await g(async () => s.save(job));
    await call(p => p.prerequisite(binding.callback));
    if (!job.phone_sid) {
      if (job.intent_id) {
        // Never reissue create, even if exact inventory is absent. This includes
        // crashes before request and timeouts whose request might still settle.
        const n = await call(p => p.inventory(job.candidate, job.intent_id));
        job.phone_sid = n.sid; job.phone_number = n.phoneNumber; job.reason = 'ACQUIRED';
        await g(() => s.save(job));
      } else {
        const existing = await g(async shop => {
          if (!!shop.twilio_phone_sid !== !!shop.twilio_phone_number) fail('CONFIG_DRIFT');
          return { sid: shop.twilio_phone_sid, number: shop.twilio_phone_number,
            service: shop.twilio_messaging_service_sid };
        });
        if (existing.sid) {
          if (existing.service && existing.service !== binding.service_sid) fail('CONFIG_DRIFT');
          const n = await call(p => p.number(existing.sid));
          if (n.phoneNumber !== existing.number) fail('NUMBER_MISMATCH');
          job.phone_sid = n.sid; job.phone_number = n.phoneNumber; job.reason = 'REUSED';
          await g(() => s.save(job));
        } else {
          const candidate = await call(p => p.candidate());
          // Reserve budget and exact intent in ONE committed transaction, before
          // create. A failed commit never reaches create.
          await g(async () => {
            job.intent_id = randomUUID(); job.candidate = candidate; job.reason = 'PURCHASE_INTENT';
            try { await s.reserve(job); } catch (e) {
              job.intent_id = null; job.candidate = null; job.run_id = null;
              throw e;
            }
          });
          try {
            await call(async p => {
              await p.prerequisite(binding.callback);
              if (!enabled(env)) fail('OFF');
              const n = await p.purchase(job.candidate, job.intent_id, binding.callback);
              if (n.phoneNumber !== job.candidate) fail('NUMBER_MISMATCH');
              job.phone_sid = n.sid; job.phone_number = n.phoneNumber; job.reason = 'ACQUIRED';
              await s.save(job);
            });
          } catch (e) {
            // Keep intent durable; next invocation reconciles before any progress.
            if (!['OFF','INELIGIBLE'].includes(e.reason)) {
              job.phone_sid = null; job.phone_number = null;
              throw Object.assign(new Error('PROVIDER_TRANSIENT'), { reason: 'PROVIDER_TRANSIENT' });
            }
            throw e;
          }
        }
      }
    }
    const number = await call(p => p.number(job.phone_sid));
    if (number.phoneNumber !== job.phone_number) fail('NUMBER_MISMATCH');
    if (!await call(p => p.attached(job.phone_sid))) await call(p => p.attach(job.phone_sid));
    if (!await call(p => p.attached(job.phone_sid))) fail('ATTACHMENT_MISMATCH');
    if (number.smsUrl !== binding.callback || number.smsMethod !== 'POST') {
      await call(p => p.callback(job.phone_sid, binding.callback));
    }
    const confirmed = await call(p => p.number(job.phone_sid));
    if (confirmed.smsUrl !== binding.callback || confirmed.smsMethod !== 'POST') fail('CALLBACK_MISMATCH');
    const registration = await call(p => p.registration(job.phone_sid));
    if (registration.status === 'FAILURE') fail('REGISTRATION_FAILED');
    if (registration.status === 'UNAVAILABLE') fail('REGISTRATION_SOURCE_REQUIRED');
    if (registration.status !== 'REGISTERED') fail('REGISTRATION_PENDING');
    if (!registration.source || registration.phone_sid !== job.phone_sid
        || !sameBinding(registration.binding, binding)) fail('REGISTRATION_SOURCE_REQUIRED');
    job.registration_source = registration.source;
    await call(async (p, shop) => {
      await p.prerequisite(binding.callback);
      if (!await p.attached(job.phone_sid)) fail('ATTACHMENT_MISMATCH');
      const finalNumber = await p.number(job.phone_sid);
      if (finalNumber.phoneNumber !== job.phone_number || finalNumber.smsUrl !== binding.callback
          || finalNumber.smsMethod !== 'POST') fail('CALLBACK_MISMATCH');
      const latest = await p.registration(job.phone_sid);
      if (latest.status !== 'REGISTERED' || !latest.source || latest.phone_sid !== job.phone_sid
          || !sameBinding(latest.binding, binding)) fail('REGISTRATION_PENDING');
      job.registration_source = latest.source;
      if (!enabled(env)) fail('OFF');
      job.state = 'active'; job.reason = 'ACTIVE'; job.attempts = 0; job.admin_attention = false;
      job.next_at = new Date(now() + CADENCE_MS);
      await s.publish(job, shop);
    });
  } catch (e) {
    if (e.reason === 'OFF' || !enabled(env)) return job;
    if (e.reason === 'STALE_JOB') return s.current(job.shop_id);
    const reason = reasonFor(e);
    job.reason = reason;
    job.state = 'pending';
    if (!DEFERRED.has(reason)) job.attempts += 1;
    if (TERMINAL.has(reason) || job.attempts >= MAX_ATTEMPTS) {
      job.state = 'failed';
      if (!TERMINAL.has(reason)) job.reason = 'RETRIES_EXHAUSTED';
    }
    job.admin_attention = true;
    job.next_at = new Date(now() + (DEFERRED.has(reason) ? CADENCE_MS : Math.min(3600000, CADENCE_MS * 2 ** job.attempts)));
    try { await s.save(job); }
    catch (saveError) {
      if (saveError.reason === 'OFF') return job;
      if (saveError.reason === 'STALE_JOB') return s.current(job.shop_id);
      throw saveError;
    }
  }
  return job;
}

async function tick({ store, env = process.env, provider, notify,
  entry = args => require('./smsProvisioning').provisionSmsSenderForShop(args) } = {}) {
  if (!enabled(env)) return;
  store ||= new PgStore(require('../db').pool, env);
  notify ||= require('./notifyOps').notifyOps;
  try {
    await store.configure();
    await store.discover();
    // Includes failed jobs revoked by the receiver and later entitlement changes.
    // Existing persisted per-enum cooldown bounds notifications across restarts.
    for (const job of await store.attention()) {
      if (!enabled(env)) break;
      await store.alert(job.reason, job.shop_id, notify);
    }
    for (const { shop_id: shopId } of await store.due()) {
      if (!enabled(env)) break;
      await store.claim(shopId, async (session, job) => {
        const result = await entry({ shopId, mode: 'automatic', automatic: { session, job, env, provider } });
        if (result?.admin_attention) await store.alert(result.reason, shopId, notify);
      });
    }
  } catch (_) {
    // Never serialize raw DB/provider errors. A DB outage cannot durably dedup an
    // alert; emit a local sanitized failure and retry on the next normal tick.
    console.error('[SMS_AUTO] QUEUE_FAILURE');
    try { await store.alert('QUEUE_FAILURE', undefined, notify); }
    catch (_) { console.error('[SMS_AUTO] ALERT_UNAVAILABLE'); }
  }
}
function start() {
  if (!enabled()) return null;
  void tick();
  const timer = setInterval(() => { void tick(); }, CADENCE_MS);
  timer.unref();
  return timer;
}
module.exports = { enabled, entitled, runConfig, reasonFor, PgStore, processJob, tick, start, MAX_ATTEMPTS };
