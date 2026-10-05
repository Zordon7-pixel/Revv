'use strict';
const PDFDocument = require('pdfkit');
const path = require('node:path');
const n = require('./panelEstimatorStore');
const { quoteDTO } = require('./panelEstimatorDraft');

const money = value => Number.isSafeInteger(value) ? `$${(value / 100).toFixed(2)}` : 'Unknown';
const LABELS = { cash: 'Customer Pay', insurance: 'Insurance', body: 'Body labor', refinish: 'Refinish labor',
  parts: 'Parts', materials: 'Paint and materials', sublet: 'Sublet work', repair: 'Repair', replace: 'Replacement',
  'paint-only': 'Paint only', blend: 'Blend', 'inspection-required': 'Inspection required',
  shop_prepared: 'Shop-prepared estimate for insurance submission - not insurer-approved',
  imported_carrier: 'Imported carrier estimate - reviewed; approval status not implied',
  body_rate_cents: 'Body labor rate', refinish_rate_cents: 'Refinish labor rate', body_hours: 'Body labor hours',
  refinish_hours: 'Refinish labor hours', parts_sell_cents: 'Parts price', materials_sell_cents: 'Materials price',
  sublet_sell_cents: 'Sublet price', discount_cents: 'Discount', minimum_cents: 'Minimum charge',
  minimum_adjustment_cents: 'Minimum charge adjustment', net_cents: 'Net repair amount', total_cents: 'Repair total',
  subtotal_cents: 'Subtotal before discounts', tax_cents: 'Tax', tax_rate_bps: 'Tax rate',
  price_cents: 'Package price', unit_price_cents: 'Unit price', unit_rate_cents: 'Unit rate', amount_cents: 'Discount amount',
  covered_cents: 'Covered amount before deductible', deductible_cents: 'Applicable deductible',
  uncovered_cents: 'Uncovered charges', adjustment_cents: 'Coverage adjustment', carrier_cents: 'Estimated carrier contribution',
  customer_cents: 'Estimated customer responsibility', paid_cents: 'Posted payments', balance_cents: 'Remaining repair balance',
  scope: 'Repair scope', assessments: 'Panels', adjustments: 'Price adjustments', scenario: 'Payer scenario',
  totals: 'Totals', allocation: 'Payer allocation', discounts: 'Scoped discounts', extras: 'Additional operations' };
function humanLabel(value) {
  if (value == null) return 'Unknown';
  return Object.hasOwn(LABELS, value) ? LABELS[value] : String(value).replace(/^extra:/, '').replace(/[_:-]+/g, ' ').replace(/^./, c => c.toUpperCase());
}
function displayValue(value, field) {
  if (value == null) return 'Unknown';
  if (field.endsWith('_cents')) return money(value);
  if (field.endsWith('_bps')) return `${value / 100}%`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (['payer', 'provenance', 'operation', 'operation_id', 'category'].includes(field)) return humanLabel(value);
  return value;
}

// The existing draft projections are the sole allowlist for customer money and
// scope. Copy no accounting/private objects and never recurse into comparisons.
// Used only to create NEW snapshots: old persisted snapshots/hash are not rewritten.
function historicalQuote(row) {
  const source = row.public_snapshot;
  const input = n.publicSnapshot({ assessments: source.scope?.assessments,
    scenario: source.scenario, adjustments: source.adjustments });
  const safe = quoteDTO({ ...source, ...source.totals, flags: source.review_flags ?? [] });
  return { ...safe, revision_id: row.id, version: Number(row.version), quote_hash: row.quote_hash,
    scenario: input.scenario, scope: { panel_ids: input.assessments.map(p => p.panel_id), assessments: input.assessments },
    adjustments: input.adjustments, historical: true };
}
function lineLabel(quote, line) {
  return `${line.description || panelLabel(quote, line.panel_id)} - ${humanLabel(line.operation_id)}`;
}
function panelLabel(quote, id) {
  return quote.scope?.assessments?.find(p => p.panel_id === id)?.label || humanLabel(id);
}
function bucketLabel(quote, bucket) {
  const pkg = quote.packages?.find(p => p.id === (bucket.package_id ?? bucket.id));
  if (bucket.kind === 'package_allocation') return `${pkg?.name || 'Package'} - ${humanLabel(bucket.category)}`;
  if (bucket.kind === 'package') return pkg?.name || 'Package';
  if (bucket.kind === 'panel_minimum') return `${panelLabel(quote, bucket.panel_id)} - Minimum charge adjustment`;
  if (bucket.kind === 'minimum') return 'Minimum charge adjustment';
  const line = quote.lines?.find(l => l.id === bucket.id);
  return line ? lineLabel(quote, line) : 'Repair charge';
}
const filename = revision => `panel-quote-${String(revision ?? 'revision').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}.pdf`;

// No database, mutable RO fields, network/logo fetches, or calculator calls.
// Bound total work and fail explicitly instead of silently truncating user text.
async function renderQuotePdf(dto) {
  const quote = dto.quote;
  if (!quote || !dto.revision_id) throw new TypeError('A saved quote revision is required');
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 48, bottom: 48, left: 48, right: 48 },
    info: { Title: 'Reviewed repair quote', Author: 'REVV', CreationDate: new Date(quote.reviewed_at || '2000-01-01') } });
  doc.registerFont('Quote', path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf'));
  doc.font('Quote');
  const chunks = [];
  let bytes = 0, characters = 0, pages = 0, fontSize = 10;
  const result = new Promise((resolve, reject) => {
    doc.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) doc.destroy(new RangeError('Quote PDF is too large'));
      else chunks.push(chunk);
    });
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  function pageHeader() {
    if (++pages > 300) throw new RangeError('Quote PDF has too many pages');
    doc.fontSize(8).fillColor('#526070').text(`REVV | Reviewed repair quote | Page ${pages}`, 48, 24, { lineBreak: false });
    doc.fontSize(fontSize).fillColor('#172436');
    doc.x = 48; doc.y = 48;
  }
  doc.on('pageAdded', pageHeader);
  function text(value, size = 10) {
    // Newlines remain meaningful; controls cannot inject PDF drawing commands.
    const content = String(value ?? 'Unknown').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    characters += content.length;
    if (content.length > 20000 || characters > 1000000) throw new RangeError('Quote text is too large');
    fontSize = size;
    doc.fontSize(size).fillColor('#172436').text(content, 48, doc.y, { width: 516, lineGap: 2 });
    doc.moveDown(0.35);
  }
  function heading(value) {
    if (doc.y > doc.page.height - 115) doc.addPage();
    text(value, 14);
  }
  function allocation(value = {}) {
    for (const key of ['carrier_cents', 'customer_cents', 'paid_cents', 'balance_cents']) text(`${humanLabel(key)}: ${money(value[key])}`);
    if (value.complete !== true) text('Allocation is incomplete. Unknown responsibility is not zero.');
    text('Posted payments are frozen at review. Pending carrier contributions are not received payments.');
  }
  function scenario(value = {}) {
    text(`Payer: ${humanLabel(value.payer)}`);
    text(value.payer === 'cash' ? 'Customer Pay estimate' : humanLabel(value.provenance));
    if (value.payer === 'insurance') for (const key of ['covered_cents','deductible_cents','uncovered_cents','adjustment_cents'])
      text(`${humanLabel(key)}: ${money(value.allocation?.[key])}`);
  }
  function scope(value = {}) {
    for (const panel of value.assessments ?? []) {
      text(`${panel.label || humanLabel(panel.panel_id)} - ${humanLabel(panel.operation)}${panel.deferral ? ' | DEFERRED - excluded from this repair total' : ''}`);
      if (panel.customer_notes) text(`Customer notes: ${panel.customer_notes}`);
      if (panel.deferral) {
        text(`Optional cosmetic work retained in scope. Reason: ${panel.deferral.reason}`);
        text(`Estimator acknowledged: ${displayValue(panel.deferral.estimator_acknowledged, '')}; Customer acknowledged: ${displayValue(panel.deferral.customer_acknowledged, '')}`);
        text(`Customer acknowledgement reference: ${panel.deferral.customer_acknowledgement_reference}`);
      }
    }
    if (!(value.assessments?.length)) text((value.panel_ids ?? []).map(humanLabel).join(', ') || 'Scope unknown');
  }
  try {
    pageHeader(); heading('Reviewed repair quote');
    text(`Revision: ${dto.revision_id} | Version: ${dto.version ?? 'Unknown'}`);
    text(`Quote hash: ${dto.quote_hash ?? quote.quote_hash ?? 'Unknown'}`, 8);
    text(`Estimator reviewed: ${quote.reviewed === true ? 'Yes' : 'Unknown'} | Reviewed at: ${quote.reviewed_at ?? 'Unknown'}`);
    const receipt = dto.receipt;
    if (receipt && receipt.revision_id === dto.revision_id && receipt.quote_hash === dto.quote_hash) {
      text(`Customer decision: ${receipt.decision === 'approve' ? 'Approved' : 'Declined'} | ${receipt.responded_at ?? 'Unknown'}`);
      text(`Customer: ${receipt.actor_name}`);
      if (receipt.reason) text(`Requested change: ${receipt.reason}`);
    } else text('Customer approval: not established by this reviewed quote.');
    text('Estimator review is not customer authorization or carrier approval. Vehicle inspection may change the required work.');
    if (dto.disclosure?.text) text(dto.disclosure.text);
    heading('Repair scope'); scope(quote.scope);
    heading('Repair charges');
    text('Billing amounts below already include allocated discounts. Package inclusions are listed without an additional charge.');
    for (const bucket of quote.buckets ?? []) {
      text(bucketLabel(quote, bucket));
      const line = quote.lines?.find(l => l.id === bucket.id);
      if (line) text(`Quantity: ${line.quantity ?? 'Unknown'} | Unit price: ${money(line.unit_price_cents)}`, 9);
      text(`Before discount: ${money(bucket.gross_cents)} | Discount: ${money(bucket.discount_cents)} | Net: ${money(bucket.net_cents)} | Tax: ${money(bucket.tax_cents)}`, 9);
    }
    if (!quote.buckets?.length) text('No active billable operations.');
    for (const pkg of quote.packages ?? []) {
      text(`Included in ${pkg.name} (no additional charge):`);
      for (const operation of pkg.included_operations ?? []) text(`${panelLabel(quote, operation.panel_id)} - ${humanLabel(operation.operation_id)}`, 9);
    }
    heading('Discounts and minimum charges');
    text(`Quote-wide discount: ${money(quote.adjustments?.discount_cents)} (already allocated)`);
    for (const discount of quote.adjustments?.discounts ?? []) {
      text(`Scoped discount ${discount.id}: ${money(discount.amount_cents)} (already allocated)`);
      for (const id of discount.line_ids ?? []) {
        const line = quote.lines?.find(l => l.id === id); text(`Applies to: ${line ? lineLabel(quote, line) : humanLabel(id)}`, 9);
      }
      for (const id of discount.package_ids ?? []) text(`Applies to package: ${quote.packages?.find(p => p.id === id)?.name || humanLabel(id)}`, 9);
    }
    text(`Quote minimum: ${money(quote.adjustments?.minimum_cents)}`);
    for (const panel of quote.scope?.assessments ?? []) if (panel.application_snapshot?.sell_settings?.minimum_cents != null)
      text(`${panelLabel(quote, panel.panel_id)} minimum: ${money(panel.application_snapshot.sell_settings.minimum_cents)}${panel.deferral ? ' (deferred; not charged)' : ''}`);
    if (doc.y > doc.page.height - 250) doc.addPage();
    heading('Quote totals');
    for (const key of ['subtotal_cents','discount_cents','minimum_adjustment_cents','net_cents','tax_rate_bps','tax_cents','total_cents'])
      text(`${humanLabel(key)}: ${displayValue(quote.totals?.[key], key)}`);
    heading('Payer allocation'); scenario(quote.scenario); allocation(quote.allocation);
    if (quote.comparisons?.length) {
      heading('Historical alternatives');
      text('Historical revisions are comparison only, not current executable work. Do not add these totals to this quote. Changes below read historical value -> this revision. No equivalence, savings or carrier approval is implied.');
      for (const old of quote.comparisons) {
        heading(`Historical revision ${old.version ?? 'Unknown'}`);
        text(`Revision: ${old.revision_id}`); text(`Quote hash: ${old.quote_hash ?? 'Unknown'}`, 8);
        scenario(old.scenario); scope(old.scope);
        text(`Historical repair total: ${money(old.totals?.total_cents)}`); allocation(old.allocation);
        for (const change of old.differences ?? []) {
          // Old immutable comparisons contained objects/arrays. Never dump them.
          const scalar = value => value == null ? 'Unknown' : ['string','number','boolean'].includes(typeof value) ? String(value) : 'Legacy detail unavailable';
          text(`${change.label || humanLabel(change.path)}: ${scalar(change.before)} -> ${scalar(change.after)}`, 9);
        }
        if (!old.differences?.length) text('No recorded differences. Equivalence is not implied.');
      }
    }
    doc.end();
  } catch (err) { doc.destroy(err); }
  return result;
}
async function sendQuotePdf(res, dto) {
  const buffer = await renderQuotePdf(dto);
  res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff'); res.type('application/pdf');
  res.set('Content-Disposition', `attachment; filename="${filename(dto.revision_id)}"`);
  return res.send(buffer);
}
module.exports = { renderQuotePdf, sendQuotePdf, historicalQuote, humanLabel, displayValue, bucketLabel, filename };
