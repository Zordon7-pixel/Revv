'use strict';
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const n = require('./panelEstimatorStore');
const { canonical, hashInputs } = require('./panelEstimatorDraft');
const Sentry = require('@sentry/node');
const rateLimit = require('express-rate-limit');
const { sendQuotePdf } = require('./panelEstimatorQuotePdf');

// Pure filter for bearer-bearing telemetry copies. Request suppression below
// is scoped before parsing, never registered as a global event processor.
function approvalTelemetry(event) {
  const seen = new WeakSet();
  function sensitive(value) {
    if (typeof value === 'string') {
      let decoded = value;
      try { decoded = decodeURIComponent(value); } catch { /* Also check undecodable raw values. */ }
      return /pe_[a-f0-9]{64}/i.test(decoded) || /\/(?:api\/(?:ros\/|repair-orders\/)?approval|approve)\/pe_/i.test(decoded);
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some(sensitive);
  }
  return sensitive(event) ? null : event;
}
// Suppression is installed on the request scope below, never the global scope.

const DISCLOSURE = Object.freeze({ version: 'panel-quote-v1',
  text: 'Your decision applies only to the displayed repair scope and price in this quote revision. Customer approval does not establish insurance carrier approval, authorize a payment, or provide SMS consent or an agreement signature. Changes require a new quote and approval.' });
const fail = (code, status = 409) => { throw n.error(code, status); };
const author = input => { if (!['owner', 'admin', 'assistant'].includes(input.role)) fail('FORBIDDEN', 403); };
const binding = body => {
  n.object(body);
  const revisionId = n.requiredText(body.revision_id, 255);
  if (typeof body.quote_hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.quote_hash)) n.invalid();
  return { revisionId, quoteHash: body.quote_hash };
};
const digest = token => createHash('sha256').update(token).digest('hex');
async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { err.rollbackError = rollbackError; }
    throw err;
  } finally { client.release(); }
}
async function lockParent(client, shopId, roId, legacy = false) {
  const fields = legacy ? 'id,shop_id,status,ro_number,assigned_to' : 'id';
  const row = (await client.query(`SELECT ${fields} FROM repair_orders WHERE shop_id=$1 AND id=$2 FOR UPDATE`, [shopId, roId])).rows[0];
  if (!row) fail('NOT_FOUND', 404);
  return row;
}
async function currentQuote(client, shopId, roId, revisionId, quoteHash) {
  const row = (await client.query(`SELECT r.id,r.version,r.quote_hash,r.public_snapshot
    FROM ro_panel_estimator_drafts d JOIN ro_panel_estimator_revisions r
      ON r.shop_id=d.shop_id AND r.ro_id=d.ro_id AND r.id=d.active_revision_id
    WHERE d.shop_id=$1 AND d.ro_id=$2`, [shopId, roId])).rows[0];
  if (!row || row.id !== revisionId || row.quote_hash !== quoteHash) fail('APPROVAL_REVISION_CONFLICT');
  const { quote_hash, ...snapshot } = row.public_snapshot;
  if (quote_hash !== quoteHash || hashInputs(snapshot) !== quoteHash) fail('APPROVAL_REVISION_CONFLICT');
  return row;
}
async function recordEvent(client, link, kind, actorId = null, body = {}) {
  return (await client.query(`INSERT INTO ro_panel_estimator_approval_events
    (shop_id,ro_id,id,link_id,revision_id,quote_hash,disclosure_version,kind,actor_id,decision,actor_name,acknowledged,reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
  [link.shop_id,link.ro_id,randomUUID(),link.id,link.revision_id,link.quote_hash,link.disclosure_version,kind,actorId,
    body.decision ?? null,body.actor_name ?? null,body.acknowledged ?? null,body.reason ?? null])).rows[0];
}
const receipt = event => event ? { id: event.id, revision_id: event.revision_id, quote_hash: event.quote_hash,
  disclosure_version: event.disclosure_version, decision: event.decision, actor_name: event.actor_name,
  acknowledged: event.acknowledged, reason: event.reason, responded_at: event.occurred_at } : null;
async function decisionFor(client, link) {
  return (await client.query(`SELECT * FROM ro_panel_estimator_approval_events
    WHERE shop_id=$1 AND ro_id=$2 AND revision_id=$3 AND kind='decision'`,
  [link.shop_id,link.ro_id,link.revision_id])).rows[0];
}
// Caller holds the same parent lock used by commit, link issuance and decisions.
async function revokePendingApprovalLinks(client, shopId, roId, selectedRevisionId) {
  const links = (await client.query(`UPDATE ro_panel_estimator_approval_links l SET revoked_at=clock_timestamp()
    WHERE l.shop_id=$1 AND l.ro_id=$2 AND l.revision_id<>$3 AND l.revoked_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM ro_panel_estimator_approval_events e
      WHERE e.shop_id=l.shop_id AND e.ro_id=l.ro_id AND e.revision_id=l.revision_id AND e.kind='decision')
    RETURNING l.*`, [shopId,roId,selectedRevisionId])).rows;
  for (const link of links) await recordEvent(client, link, 'revoked');
}
function createPanelEstimatorApproval(database) {
  const pool = database.pool ?? database;
  async function issue(input) {
    author(input); n.keys(input.body, ['revision_id','quote_hash']);
    const { revisionId, quoteHash } = binding(input.body);
    return transaction(pool, async client => {
      await lockParent(client, input.shopId, input.roId);
      await currentQuote(client, input.shopId, input.roId, revisionId, quoteHash);
      const token = `pe_${randomBytes(32).toString('hex')}`;
      const link = (await client.query(`INSERT INTO ro_panel_estimator_approval_links
        (shop_id,ro_id,id,revision_id,quote_hash,token_hash,disclosure_version,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [input.shopId,input.roId,randomUUID(),revisionId,quoteHash,digest(token),DISCLOSURE.version,n.requiredText(input.actorId,255)])).rows[0];
      await recordEvent(client, link, 'issued', input.actorId);
      return { link_id: link.id, revision_id: revisionId, quote_hash: quoteHash,
        disclosure_version: DISCLOSURE.version, expires_at: link.expires_at, link: `/approve/${token}` };
    });
  }
  async function revoke(input) {
    author(input);
    const linkId = n.requiredText(input.linkId, 255);
    return transaction(pool, async client => {
      await lockParent(client, input.shopId, input.roId);
      let link = (await client.query(`SELECT * FROM ro_panel_estimator_approval_links
        WHERE shop_id=$1 AND ro_id=$2 AND id=$3`, [input.shopId,input.roId,linkId])).rows[0];
      if (!link) fail('NOT_FOUND',404);
      if (!link.revoked_at) {
        link = (await client.query(`UPDATE ro_panel_estimator_approval_links SET revoked_at=clock_timestamp()
          WHERE shop_id=$1 AND ro_id=$2 AND id=$3 RETURNING *`, [input.shopId,input.roId,linkId])).rows[0];
        await recordEvent(client, link, 'revoked', n.requiredText(input.actorId,255));
      }
      return { link_id: link.id, revoked_at: link.revoked_at };
    });
  }
  async function access(token, body) {
    if (typeof token !== 'string' || !/^pe_[a-f0-9]{64}$/.test(token)) fail('NOT_FOUND',404);
    return transaction(pool, async client => {
      // Lookup only locates the parent. Re-read all bearer state after locking it.
      const located = (await client.query('SELECT shop_id,ro_id FROM ro_panel_estimator_approval_links WHERE token_hash=$1', [digest(token)])).rows[0];
      if (!located) fail('NOT_FOUND',404);
      await lockParent(client, located.shop_id, located.ro_id);
      const link = (await client.query(`SELECT *, expires_at<=clock_timestamp() AS expired
        FROM ro_panel_estimator_approval_links WHERE token_hash=$1`, [digest(token)])).rows[0];
      if (!link) fail('NOT_FOUND',404);
      if (link.revoked_at) fail('APPROVAL_REVOKED',410);
      if (link.expired) fail('APPROVAL_EXPIRED',410);
      const quote = await currentQuote(client,link.shop_id,link.ro_id,link.revision_id,link.quote_hash);
      let event = await decisionFor(client,link);
      if (body !== undefined) {
        n.keys(body, ['revision_id','quote_hash','disclosure_version','decision','actor_name','acknowledged','reason']);
        const requested = binding(body);
        if (requested.revisionId !== link.revision_id || requested.quoteHash !== link.quote_hash) fail('APPROVAL_REVISION_CONFLICT');
        if (body.disclosure_version !== DISCLOSURE.version) fail('APPROVAL_DISCLOSURE_CONFLICT');
        if (!['approve','decline'].includes(body.decision) || body.acknowledged !== true) n.invalid();
        const value = { decision: body.decision, actor_name: n.requiredText(body.actor_name,200).trim(),
          acknowledged: true, reason: body.decision === 'decline' ? n.requiredText(body.reason,4000).trim() : null };
        if (!value.actor_name || (value.decision === 'decline' && !value.reason) ||
          (value.decision === 'approve' && body.reason != null) || /[\x00-\x1f\x7f]/.test(value.actor_name)) n.invalid();
        if (event) {
          const existing = { decision: event.decision, actor_name: event.actor_name, acknowledged: event.acknowledged, reason: event.reason };
          if (canonical(existing) !== canonical(value)) fail('APPROVAL_DECISION_CONFLICT');
        } else event = await recordEvent(client,link,'decision',null,value);
      }
      return { kind: 'panel_estimator', revision_id: quote.id, quote_hash: quote.quote_hash,
        version: Number(quote.version), quote: quote.public_snapshot, disclosure: DISCLOSURE,
        expires_at: link.expires_at, receipt: receipt(event) };
    });
  }
  return { issue, revoke, get: token => access(token), respond: (token, body) => access(token, n.object(body)) };
}

function publicError(res, err) {
  const codes = new Set(['INVALID_INPUT','NOT_FOUND','APPROVAL_REVOKED','APPROVAL_EXPIRED',
    'APPROVAL_REVISION_CONFLICT','APPROVAL_DISCLOSURE_CONFLICT','APPROVAL_DECISION_CONFLICT',
    'PANEL_REVISION_CONFLICT','RESPONSE_ALREADY_SUBMITTED']);
  if (codes.has(err.code)) return res.status(err.status ?? 400).json({ error: err.code });
  if (['40P01','40001'].includes(err.code) || (err.code === 'P0001' && err.message === 'PANEL_REVISION_CONFLICT'))
    return res.status(409).json({ error: 'PANEL_REVISION_CONFLICT' });
  return res.status(500).json({ error: 'APPROVAL_UNAVAILABLE' });
}
const noStore = (req,res,next) => { res.set('Cache-Control','no-store'); res.set('Referrer-Policy','no-referrer'); next(); };
function isPanelBearerRequest(req) {
  const match = /^(?:\/api\/(?:ros\/|repair-orders\/)?approval|\/approve)\/([^/?#]+)/i.exec(req.originalUrl || req.url || '');
  if (!match) return false;
  // Decode ASCII escapes even if a later escape is malformed: Express will
  // reject that parameter, but its bearer URL still needs privacy protection.
  return /^pe_/i.test(match[1].replace(/%([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex,16))));
}
// Mount after Sentry's requestHandler (which isolates scopes), before parsers.
function panelBearerRequest(req,res,next) {
  if (!isPanelBearerRequest(req)) return next();
  Sentry.configureScope(scope => scope.addEventProcessor(() => null));
  return noStore(req,res,next);
}
// Router mounts handle parameter decoding errors; the app-level mount below
// handles parser errors, which cannot reach a nested router's error handlers.
function publicRequestError(limiter) {
  return (err,req,res,next) => {
    noStore(req,res,() => {});
    const send = () => {
      if (res.headersSent) return;
      if (err.type === 'entity.too.large') return res.status(413).json({ error: 'INVALID_INPUT' });
      if (['charset.unsupported','encoding.unsupported'].includes(err.type))
        return res.status(415).json({ error: 'INVALID_INPUT' });
      if (['entity.parse.failed','request.aborted','request.size.invalid'].includes(err.type) || err instanceof URIError)
        return res.status(400).json({ error: 'INVALID_INPUT' });
      return publicError(res,err);
    };
    try {
      return Promise.resolve(limiter(req,res,send)).catch(() => {
        if (!res.headersSent) res.status(500).json({ error: 'APPROVAL_UNAVAILABLE' });
      });
    } catch { if (!res.headersSent) res.status(500).json({ error: 'APPROVAL_UNAVAILABLE' }); }
  };
}
const bearerInputError = publicRequestError(rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
}));
function panelBearerParserError(err,req,res,next) {
  if (!isPanelBearerRequest(req)) return next(err);
  return bearerInputError(err,req,res,next);
}
function panelPublicHandler(database, method) {
  const service = createPanelEstimatorApproval(database);
  return async (req,res,next) => {
    if (!req.params.token.startsWith('pe_')) return next();
    // The app's request-scoped Sentry handler precedes these routes. Do not send
    // bearer URLs, decision names or payloads to telemetry, even on later errors.
    Sentry.configureScope(scope => scope.addEventProcessor(() => null));
    try {
      const result = await (method === 'respond' ? service.respond(req.params.token,req.body) : service.get(req.params.token));
      if (method === 'pdf') return await sendQuotePdf(res, result);
      return res.json(result);
    }
    catch (err) { publicError(res,err); }
  };
}

// Legacy writes share commit's parent lock. No communications/status writes occur
// until selection is checked, and every database write uses this transaction.
async function respondLegacyApproval(database, token, body, notificationKind) {
  const pool = database.pool ?? database;
  return transaction(pool, async client => {
    const located = (await client.query('SELECT shop_id,ro_id FROM estimate_approval_links WHERE token=$1', [token])).rows[0];
    if (!located) fail('NOT_FOUND',404);
    const ro = await lockParent(client,located.shop_id,located.ro_id,true);
    // to_regclass preserves ordinary legacy use before the additive initializer.
    const installed = (await client.query("SELECT to_regclass('ro_panel_estimator_drafts') AS table_name")).rows[0].table_name;
    if (installed && (await client.query(`SELECT 1 FROM ro_panel_estimator_drafts
      WHERE shop_id=$1 AND ro_id=$2 AND active_revision_id IS NOT NULL`, [ro.shop_id,ro.id])).rowCount) fail('PANEL_REVISION_CONFLICT');
    const link = (await client.query(`SELECT * FROM estimate_approval_links
      WHERE token=$1 AND shop_id=$2 AND ro_id=$3 FOR UPDATE`, [token,ro.shop_id,ro.id])).rows[0];
    if (!link) fail('NOT_FOUND',404);
    if (link.responded_at) fail('RESPONSE_ALREADY_SUBMITTED',400);
    const { decision, reason } = n.object(body);
    if (!['approve','decline'].includes(decision)) n.invalid();
    const declineReason = decision === 'decline' ? n.requiredText(reason,4000).trim() : null;
    if (decision === 'decline' && !declineReason) n.invalid();
    const now = new Date().toISOString();
    if (decision === 'approve') {
      await client.query(`UPDATE repair_orders SET status='approval',estimate_approved_at=$1,updated_at=$2
        WHERE id=$3 AND shop_id=$4`, [now,now,ro.id,ro.shop_id]);
      await client.query(`INSERT INTO job_status_log (id,ro_id,from_status,to_status,changed_by,note)
        VALUES ($1,$2,$3,'approval',NULL,'Estimate approved by customer via public approval link')`, [randomUUID(),ro.id,ro.status]);
    } else {
      await client.query(`INSERT INTO ro_comms (id,ro_id,shop_id,user_id,channel,direction,summary)
        VALUES ($1,$2,$3,NULL,'email','inbound',$4)`, [randomUUID(),ro.id,ro.shop_id,`Estimate change request: ${declineReason}`]);
    }
    await client.query(`UPDATE estimate_approval_links SET responded_at=$1,decline_reason=$2
      WHERE id=$3 AND shop_id=$4 AND ro_id=$5`, [now,declineReason,link.id,ro.shop_id,ro.id]);
    if (notificationKind === 'approval' || (notificationKind === 'status' && decision === 'approve')) {
      const roles = notificationKind === 'approval' ? ['owner','admin'] : ['owner'];
      const recipients = (await client.query('SELECT id FROM users WHERE shop_id=$1 AND role=ANY($2::text[])', [ro.shop_id,roles])).rows.map(row => row.id);
      if (notificationKind === 'status' && ro.assigned_to) {
        // Keep assigned-user delivery tenant scoped, just like role recipients.
        const assigned = (await client.query('SELECT id FROM users WHERE shop_id=$1 AND id=$2', [ro.shop_id,ro.assigned_to])).rows[0];
        if (assigned) recipients.push(assigned.id);
      }
      const title = notificationKind === 'status' ? 'RO Status Updated' : decision === 'approve' ? 'Estimate Approved' : 'Estimate Declined';
      const message = notificationKind === 'status' ? `RO #${ro.ro_number || 'N/A'} status changed to "approval"` :
        decision === 'approve' ? `Customer approved estimate for RO #${ro.ro_number || 'N/A'}.` :
          `Customer declined estimate for RO #${ro.ro_number || 'N/A'}: ${declineReason}`;
      for (const userId of new Set(recipients)) await client.query(`INSERT INTO notifications
        (id,shop_id,user_id,type,title,body,message,ro_id,read) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,FALSE)`,
      [randomUUID(),ro.shop_id,userId,notificationKind === 'status' ? 'status_change' : 'approval',title,message,ro.id]);
    }
    return { ro, decision, reason: declineReason };
  });
}
module.exports = { createPanelEstimatorApproval, revokePendingApprovalLinks, panelPublicHandler,
  noStore, publicError, publicRequestError, panelBearerRequest, panelBearerParserError,
  respondLegacyApproval, approvalTelemetry, DISCLOSURE };
