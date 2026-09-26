const crypto = require('node:crypto');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fontBytes = require('node:fs').readFileSync(require('node:path').join(__dirname, '../assets/fonts/NotoSans-Regular.ttf'));
const fontCoverage = fontkit.create(fontBytes);

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const CONSENT_VERSION = 'revv-esign-v1';
const CONSENT_TEXT = 'I have reviewed this agreement and agree to its terms. I consent to use an electronic signature and intend my typed name to be my signature. I can download and retain a copy. I may choose to sign on paper instead by contacting the shop.';
const SHOP_CONSENT_TEXT = 'I have reviewed the agreement and the customer signature. I am authorized to sign for the shop and intend my typed name to be my electronic signature.';
const schemaSql = `
CREATE TABLE IF NOT EXISTS agreement_templates (
  id UUID PRIMARY KEY, shop_id TEXT NOT NULL, title TEXT NOT NULL,
  original_pdf BYTEA NOT NULL, document_sha256 TEXT NOT NULL, page_count INTEGER NOT NULL,
  requires_shop_signature BOOLEAN NOT NULL DEFAULT FALSE,
  initial_sections JSONB NOT NULL DEFAULT '[]', archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agreement_templates_shop ON agreement_templates(shop_id, created_at);
CREATE TABLE IF NOT EXISTS agreement_requests (
  id UUID PRIMARY KEY, shop_id TEXT NOT NULL, ro_id TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES agreement_templates(id),
  title TEXT NOT NULL, shop_name TEXT NOT NULL, ro_number TEXT NOT NULL,
  recipient_name TEXT NOT NULL, recipient_email TEXT,
  token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','awaiting_shop','signed','voided')),
  document_sha256 TEXT NOT NULL, requires_shop_signature BOOLEAN NOT NULL,
  initial_sections JSONB NOT NULL DEFAULT '[]',
  viewed_at TIMESTAMPTZ, customer_signature JSONB, shop_signature JSONB,
  signed_pdf BYTEA, signed_sha256 TEXT, completed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agreement_requests_ro ON agreement_requests(shop_id, ro_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS agreement_requests_one_pending ON agreement_requests(shop_id, ro_id, template_id) WHERE status IN ('pending', 'awaiting_shop');
CREATE TABLE IF NOT EXISTS agreement_events (
  id UUID PRIMARY KEY, request_id UUID NOT NULL REFERENCES agreement_requests(id),
  event_type TEXT NOT NULL, actor_id TEXT, ip TEXT, user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agreement_events_request ON agreement_events(request_id, created_at);
`;
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function inputError(message, status = 400) { const e = new Error(message); e.status = status; return e; }
function requiredText(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw inputError(`${label} is required and must be at most ${max} characters.`);
  }
  const normalized = value.trim().normalize('NFC');
  if ([...normalized].some((char) => !fontCoverage.hasGlyphForCodePoint(char.codePointAt(0)))) {
    throw inputError(`${label} contains characters this signing record cannot render. Please contact the shop to use a paper agreement.`);
  }
  return normalized;
}
function parseSections(value) {
  let items = value || [];
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch { throw inputError('Initial sections must be a list.'); } }
  if (!Array.isArray(items) || items.length > 12) throw inputError('Use up to 12 sections for customer initials.');
  const sections = items.map((item) => requiredText(item, 'Section name', 120));
  if (new Set(sections).size !== sections.length) throw inputError('Section names must be unique.');
  return sections;
}
async function validatePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_PDF_BYTES || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw inputError('Upload a PDF under 10MB.');
  }
  try {
    const pdf = await PDFDocument.load(buffer);
    if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 50) throw new Error('unsupported');
    // Agreements must be static PDFs; existing signatures/interactive forms cannot be rewritten safely.
    if (pdf.getForm().getFields().length) throw inputError('Upload a static PDF without form fields or existing digital signatures.');
    return pdf.getPageCount();
  } catch (error) {
    if (error.status) throw error;
    throw inputError('This PDF cannot be read. Upload an unencrypted PDF with 1 to 50 pages.');
  }
}
function signatureInput(body, request, role, req) {
  const consent = role === 'shop' ? SHOP_CONSENT_TEXT : CONSENT_TEXT;
  if (body?.consent !== true || body?.consent_version !== CONSENT_VERSION) throw inputError('Confirm the electronic signature consent.');
  if (body?.document_sha256 !== request.document_sha256) throw inputError('The agreement changed. Reload and review it before signing.', 409);
  const name = requiredText(body?.name, 'Full legal name', 120);
  const initials = Object.create(null);
  if (role === 'customer') {
    for (const section of request.initial_sections || []) {
      const value = requiredText(body?.initials?.[section], `Initials for ${section}`, 10);
      initials[section] = value;
    }
  }
  return { name, initials, role, method: 'typed', signed_at: new Date().toISOString(),
    consent_version: CONSENT_VERSION, consent_text: consent,
    ip: String(req.ip || '').slice(0, 100), user_agent: String(req.get('user-agent') || '').slice(0, 500),
    ...(role === 'shop' ? { user_id: req.user.id } : {}),
  };
}
// This is an electronic-signature record appended to the original pages, not a certificate-based PDF digital signature.
async function buildSignedPdf(original, request) {
  const source = await PDFDocument.load(original);
  const result = await PDFDocument.create();
  for (const page of await result.copyPages(source, source.getPageIndices())) result.addPage(page);
  result.registerFontkit(fontkit);
  const font = await result.embedFont(fontBytes, { subset: true });
  const bold = font;
  let page; let y;
  const safe = (value) => String(value ?? '').normalize('NFC');
  function addPage() {
    page = result.addPage([612, 792]); y = 736;
    page.drawText('REVV | ELECTRONIC SIGNATURE RECORD', { x: 48, y, size: 15, font: bold, color: rgb(.12, .18, .25) }); y -= 30;
  }
  function line(label, value) {
    const text = safe(label ? `${label}: ${value}` : value);
    const words = text.split(/\s+/); let row = '';
    const rows = [];
    for (const word of words) {
      if (row && font.widthOfTextAtSize(`${row} ${word}`, 10) > 510) { rows.push(row); row = ''; }
      // Hashes and other long identifiers must wrap too.
      for (const char of (row ? ' ' : '') + word) {
        if (font.widthOfTextAtSize(row + char, 10) > 510) { rows.push(row); row = ''; }
        row += char;
      }
    }
    if (row) rows.push(row);
    for (const rowText of rows) {
      if (y < 65) addPage();
      page.drawText(rowText, { x: 48, y, size: 10, font }); y -= 15;
    }
    y -= 6;
  }
  addPage();
  line('Agreement', request.title); line('Shop', request.shop_name);
  line('Repair order', request.ro_number); line('Agreement ID', request.id);
  line('Original document SHA-256', request.document_sha256);
  line('Original pages', source.getPageCount());
  if (request.requires_shop_signature && !request.shop_signature) line('Status', 'Customer signed; shop signature still required.');
  for (const [label, signature] of [['Customer', request.customer_signature], ['Shop representative', request.shop_signature]]) {
    if (!signature) continue;
    y -= 8;
    line(`${label} electronic signature`, signature.name);
    line('Signed at (UTC)', signature.signed_at); line('Signature method', 'Typed name with explicit consent');
    for (const [section, initials] of Object.entries(signature.initials || {})) line(`Initials - ${section}`, initials);
    line('Consent', signature.consent_text); line('Consent version', signature.consent_version);
    line('IP address', signature.ip || 'Unavailable');
    if (signature.user_id) line('Authenticated shop user', signature.user_id);
  }
  line('', 'This record accompanies the preceding agreement pages. The original PDF is retained separately. Signing-link possession and signer-entered names are recorded; REVV does not independently verify the customer identity.');
  const pages = result.getPages();
  pages.forEach((p, index) => {
    if (index >= source.getPageCount()) p.drawText(`Signature record | Page ${index + 1} of ${pages.length}`, { x: 48, y: 32, size: 8, font });
  });
  result.setTitle(request.title); result.setProducer('REVV');
  return Buffer.from(await result.save());
}
module.exports = { MAX_PDF_BYTES, CONSENT_VERSION, CONSENT_TEXT, SHOP_CONSENT_TEXT, schemaSql, hash, newToken, inputError, requiredText, parseSections, validatePdf, signatureInput, buildSignedPdf };
