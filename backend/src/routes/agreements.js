const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const auth = require('../middleware/auth');
const { pool } = require('../db');
const {
  MAX_PDF_BYTES, CONSENT_VERSION, CONSENT_TEXT, SHOP_CONSENT_TEXT, schemaSql,
  hash, newToken, inputError, requiredText, parseSections, validatePdf, signatureInput, buildSignedPdf,
} = require('../services/agreements');

// Factory also lets integration tests use a disposable database without touching production.
function createAgreementsRouter(database = pool) {
  const router = express.Router();
  let ready;
  const ensureSchema = () => {
    if (!ready) ready = database.query(schemaSql).catch((err) => { ready = null; throw err; });
    return ready;
  };
  const query = (sql, params = []) => database.query(sql, params);
  const one = async (sql, params) => (await query(sql, params)).rows[0];
  const handle = (fn) => async (req, res) => {
    try { await ensureSchema(); await fn(req, res); }
    catch (err) {
      if (err.code === '23505') err = inputError('An unsigned request already exists for this agreement. Use its signing link or void it before creating another.', 409);
      if (!err.status) console.error('[Agreements]', err.code || err.name);
      if (!res.headersSent) res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not complete the agreement action. Please try again.' });
    }
  };
  const staff = (req, res, next) => {
    if (!req.user?.shop_id || !['owner', 'admin', 'assistant', 'employee', 'staff', 'technician'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Shop staff access required.' });
    }
    next();
  };
  const manager = (req, res, next) => ['owner', 'admin'].includes(req.user.role)
    ? next() : res.status(403).json({ error: 'Owner or admin access required.' });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 5 } }).single('agreement');
  const uploadPdf = (req, res, next) => upload(req, res, (err) => err
    ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Upload a PDF under 10MB.' : 'Could not upload this agreement. Choose one PDF.' }) : next());
  const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many signing requests. Please try again later.' } });
  const createLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many agreement changes. Please try again later.' } });

  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });
  const event = async (client, requestId, type, req, details = {}) => client.query(
    `INSERT INTO agreement_events (id, request_id, event_type, actor_id, ip, user_agent, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [randomUUID(), requestId, type, req.user?.id || null, String(req.ip || '').slice(0, 100),
      String(req.get('user-agent') || '').slice(0, 500), JSON.stringify(details)]);
  async function transaction(fn) {
    const client = await database.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }
  function active(row) {
    if (!row) throw inputError('Agreement link not found.', 404);
    if (row.status === 'voided') throw inputError('This agreement request has been voided. Contact the shop.', 410);
    if (new Date(row.expires_at) <= new Date()) throw inputError('This agreement link has expired. Contact the shop for a new link.', 410);
    return row;
  }
  async function tokenRequest(req, client = database, lock = false) {
    if (!/^[a-f0-9]{64}$/.test(String(req.get('authorization') || '').replace(/^Bearer /, ''))) throw inputError('Agreement link not found.', 404);
    const result = await client.query(`SELECT * FROM agreement_requests WHERE token_hash = $1${lock ? ' FOR UPDATE' : ''}`, [hash(String(req.get('authorization') || '').replace(/^Bearer /, ''))]);
    return active(result.rows[0]);
  }
  const metadata = (row) => ({ id: row.id, title: row.title, shop_name: row.shop_name, ro_number: row.ro_number,
    recipient_name: row.recipient_name, recipient_email: row.recipient_email, status: row.status,
    expires_at: row.expires_at, created_at: row.created_at, completed_at: row.completed_at,
    document_sha256: row.document_sha256, requires_shop_signature: row.requires_shop_signature,
    initial_sections: row.initial_sections, customer_signed_at: row.customer_signature?.signed_at || null, customer_signed_name: row.customer_signature?.name || null,
    shop_signed_at: row.shop_signature?.signed_at || null, signed_sha256: row.signed_sha256,
  });
  const pdfResponse = (res, buffer, filename, inline = false) => res.set({
    'Content-Type': 'application/pdf', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
  }).send(buffer);
  async function sourceFor(client, row) {
    const template = (await client.query('SELECT original_pdf FROM agreement_templates WHERE id = $1 AND shop_id = $2', [row.template_id, row.shop_id])).rows[0];
    if (!template || hash(template.original_pdf) !== row.document_sha256) throw inputError('Agreement integrity check failed. Contact the shop.', 409);
    return template.original_pdf;
  }

  router.get('/public/session', publicLimiter, handle(async (req, res) => {
    const row = await tokenRequest(req);
    res.json({ agreement: metadata(row), consent_text: CONSENT_TEXT, consent_version: CONSENT_VERSION });
  }));
  router.get('/public/session/document', publicLimiter, handle(async (req, res) => {
    const row = await tokenRequest(req);
    const source = await sourceFor(database, row);
    await transaction(async (client) => {
      const changed = await client.query('UPDATE agreement_requests SET viewed_at = NOW() WHERE id = $1 AND viewed_at IS NULL RETURNING id', [row.id]);
      if (changed.rowCount) await event(client, row.id, 'document_opened', req);
    });
    pdfResponse(res, source, 'agreement.pdf', true);
  }));
  router.post('/public/session/sign', publicLimiter, handle(async (req, res) => {
    const row = await transaction(async (client) => {
      const current = await tokenRequest(req, client, true);
      if (current.status !== 'pending') throw inputError('This agreement has already been signed.', 409);
      if (!current.viewed_at) throw inputError('Open and review the agreement before signing.', 409);
      const signature = signatureInput(req.body, current, 'customer', req);
      const source = await sourceFor(client, current);
      const next = { ...current, customer_signature: signature };
      const signed = current.requires_shop_signature ? null : await buildSignedPdf(source, next);
      const updated = (await client.query(`UPDATE agreement_requests SET customer_signature=$2::jsonb, status=$3,
        signed_pdf=$4, signed_sha256=$5, completed_at=$6 WHERE id=$1 RETURNING *`,
      [current.id, JSON.stringify(signature), signed ? 'signed' : 'awaiting_shop', signed, signed ? hash(signed) : null, signed ? signature.signed_at : null])).rows[0];
      await event(client, current.id, 'customer_signed', req, { document_sha256: current.document_sha256, consent_version: CONSENT_VERSION });
      return updated;
    });
    res.json({ agreement: metadata(row) });
  }));
  router.get('/public/session/signed', publicLimiter, handle(async (req, res) => {
    const row = await tokenRequest(req);
    if (row.status !== 'signed' || !row.signed_pdf) throw inputError('The signed copy is not ready yet.', 409);
    if (hash(row.signed_pdf) !== row.signed_sha256) throw inputError('Signed document integrity check failed.', 409);
    pdfResponse(res, row.signed_pdf, 'signed-agreement.pdf');
  }));

  router.use(auth, staff);
  router.get('/archive', manager, handle(async (req, res) => {
    const search = String(req.query.q || '').trim().slice(0, 120);
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw inputError('Invalid archive page.');
    const rows = await query(`SELECT id,ro_id,title,ro_number,recipient_name,status,created_at,completed_at
      FROM agreement_requests WHERE shop_id=$1
      AND ($2='' OR title ILIKE $3 OR ro_number ILIKE $3 OR recipient_name ILIKE $3)
      ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $4`, [req.user.shop_id, search, `%${search}%`, offset]);
    res.json({ agreements: rows.rows.slice(0, 50), has_more: rows.rows.length > 50 });
  }));
  router.get('/templates', handle(async (req, res) => {
    const result = await query(`SELECT id,title,document_sha256,page_count,requires_shop_signature,initial_sections,created_at
      FROM agreement_templates WHERE shop_id=$1 AND archived=FALSE ORDER BY created_at DESC`, [req.user.shop_id]);
    res.json({ templates: result.rows });
  }));
  router.post('/templates', manager, createLimiter, uploadPdf, handle(async (req, res) => {
    const title = requiredText(req.body.title, 'Agreement title');
    const sections = parseSections(req.body.initial_sections);
    const pages = await validatePdf(req.file?.buffer);
    const id = randomUUID();
    await query(`INSERT INTO agreement_templates
      (id,shop_id,title,original_pdf,document_sha256,page_count,requires_shop_signature,initial_sections,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [id, req.user.shop_id, title, req.file.buffer, hash(req.file.buffer), pages,
      req.body.requires_shop_signature === 'true', JSON.stringify(sections), req.user.id]);
    res.status(201).json({ id });
  }));
  router.get('/templates/:id/document', handle(async (req, res) => {
    const row = await one('SELECT original_pdf FROM agreement_templates WHERE id::text=$1 AND shop_id=$2', [req.params.id, req.user.shop_id]);
    if (!row) throw inputError('Agreement not found.', 404);
    pdfResponse(res, row.original_pdf, 'agreement-template.pdf');
  }));
  router.post('/templates/:id/archive', manager, handle(async (req, res) => {
    const changed = await query('UPDATE agreement_templates SET archived=TRUE WHERE id::text=$1 AND shop_id=$2', [req.params.id, req.user.shop_id]);
    if (!changed.rowCount) throw inputError('Agreement not found.', 404);
    res.json({ success: true });
  }));
  router.get('/ro/:roId', handle(async (req, res) => {
    const rows = await query(`SELECT id,title,shop_name,ro_number,recipient_name,recipient_email,status,expires_at,created_at,
      completed_at,document_sha256,requires_shop_signature,initial_sections,
      customer_signature,shop_signature,signed_sha256 FROM agreement_requests
      WHERE shop_id=$1 AND ro_id=$2 ORDER BY created_at DESC`, [req.user.shop_id, req.params.roId]);
    res.json({ agreements: rows.rows.map(metadata), consent_version: CONSENT_VERSION, shop_consent_text: SHOP_CONSENT_TEXT });
  }));
  router.post('/ro/:roId', createLimiter, handle(async (req, res) => {
    const token = newToken();
    const id = randomUUID();
    await transaction(async (client) => {
      const ro = (await client.query(`SELECT ro.ro_number,c.name AS customer_name,c.email AS customer_email,s.name AS shop_name
        FROM repair_orders ro JOIN shops s ON s.id=ro.shop_id
        LEFT JOIN customers c ON c.id=ro.customer_id AND c.shop_id=ro.shop_id
        WHERE ro.id::text=$1 AND ro.shop_id::text=$2`, [req.params.roId, req.user.shop_id])).rows[0];
      if (!ro) throw inputError('Repair order not found.', 404);
      const template = (await client.query(`SELECT * FROM agreement_templates
        WHERE id::text=$1 AND shop_id=$2 AND archived=FALSE FOR SHARE`, [req.body.template_id, req.user.shop_id])).rows[0];
      if (!template) throw inputError('Choose an active shop agreement.', 400);
      const name = requiredText(req.body.recipient_name || ro.customer_name, 'Customer name', 120);
      const email = String(req.body.recipient_email || ro.customer_email || '').trim();
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw inputError('Enter a valid customer email.');
      await client.query(`INSERT INTO agreement_requests (id,shop_id,ro_id,template_id,title,shop_name,ro_number,
        recipient_name,recipient_email,token_hash,expires_at,document_sha256,requires_shop_signature,initial_sections,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()+INTERVAL '30 days',$11,$12,$13::jsonb,$14)`,
      [id, req.user.shop_id, req.params.roId, template.id, template.title, ro.shop_name, String(ro.ro_number),
        name, email || null, hash(token), template.document_sha256, template.requires_shop_signature, JSON.stringify(template.initial_sections), req.user.id]);
      await event(client, id, 'created', req, { document_sha256: template.document_sha256 });
    });
    res.status(201).json({ id, signing_path: `/sign#${token}` });
  }));
  router.post('/:id/link', createLimiter, handle(async (req, res) => {
    const token = newToken();
    await transaction(async (client) => {
      const row = (await client.query('SELECT * FROM agreement_requests WHERE id::text=$1 AND shop_id=$2 FOR UPDATE', [req.params.id, req.user.shop_id])).rows[0];
      if (!row || row.status === 'voided') throw inputError('Agreement not found.', 404);
      // Rotating the link never changes the document or any signature.
      await client.query(`UPDATE agreement_requests SET token_hash=$2,expires_at=NOW()+INTERVAL '30 days',
        viewed_at=CASE WHEN status='pending' THEN NULL ELSE viewed_at END WHERE id=$1`, [row.id, hash(token)]);
      await event(client, row.id, 'link_replaced', req);
    });
    res.json({ signing_path: `/sign#${token}` });
  }));
  router.post('/:id/void', handle(async (req, res) => {
    await transaction(async (client) => {
      const row = (await client.query(`UPDATE agreement_requests SET status='voided'
        WHERE id::text=$1 AND shop_id=$2 AND status='pending' RETURNING id`, [req.params.id, req.user.shop_id])).rows[0];
      if (!row) throw inputError('Only an unsigned agreement can be voided.', 409);
      await event(client, row.id, 'voided', req);
    });
    res.json({ success: true });
  }));
  router.post('/:id/countersign', manager, handle(async (req, res) => {
    const row = await transaction(async (client) => {
      const current = (await client.query('SELECT * FROM agreement_requests WHERE id::text=$1 AND shop_id=$2 FOR UPDATE', [req.params.id, req.user.shop_id])).rows[0];
      if (!current) throw inputError('Agreement not found.', 404);
      if (current.status !== 'awaiting_shop') throw inputError('This agreement is not waiting for a shop signature.', 409);
      const signature = signatureInput(req.body, current, 'shop', req);
      const signed = await buildSignedPdf(await sourceFor(client, current), { ...current, shop_signature: signature });
      const updated = (await client.query(`UPDATE agreement_requests SET shop_signature=$2::jsonb,status='signed',
        signed_pdf=$3,signed_sha256=$4,completed_at=$5 WHERE id=$1 RETURNING *`,
      [current.id, JSON.stringify(signature), signed, hash(signed), signature.signed_at])).rows[0];
      await event(client, current.id, 'shop_signed', req, { document_sha256: current.document_sha256, consent_version: CONSENT_VERSION });
      return updated;
    });
    res.json({ agreement: metadata(row) });
  }));
  router.get('/:id/document', handle(async (req, res) => {
    const row = await one('SELECT * FROM agreement_requests WHERE id::text=$1 AND shop_id=$2', [req.params.id, req.user.shop_id]);
    if (!row) throw inputError('Agreement not found.', 404);
    pdfResponse(res, await sourceFor(database, row), 'agreement-original.pdf');
  }));
  router.get('/:id/signed', handle(async (req, res) => {
    const row = await one('SELECT status,signed_pdf,signed_sha256 FROM agreement_requests WHERE id::text=$1 AND shop_id=$2', [req.params.id, req.user.shop_id]);
    if (!row) throw inputError('Agreement not found.', 404);
    if (row.status !== 'signed' || !row.signed_pdf) throw inputError('The signed copy is not ready yet.', 409);
    if (hash(row.signed_pdf) !== row.signed_sha256) throw inputError('Signed document integrity check failed.', 409);
    pdfResponse(res, row.signed_pdf, 'signed-agreement.pdf');
  }));
  router.get('/:id/audit', handle(async (req, res) => {
    const row = await one('SELECT id,document_sha256,signed_sha256,customer_signature,shop_signature FROM agreement_requests WHERE id::text=$1 AND shop_id=$2', [req.params.id, req.user.shop_id]);
    if (!row) throw inputError('Agreement not found.', 404);
    const events = (await query('SELECT event_type,actor_id,ip,user_agent,details,created_at FROM agreement_events WHERE request_id=$1 ORDER BY created_at,id', [row.id])).rows;
    res.set('Content-Disposition', 'attachment; filename="agreement-signing-record.json"').json({ ...row, events });
  }));
  return router;
}
module.exports = createAgreementsRouter();
module.exports.createAgreementsRouter = createAgreementsRouter;
