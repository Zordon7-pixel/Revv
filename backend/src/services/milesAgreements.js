const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('node:fs');
const path = require('node:path');
const { hash, inputError, requiredText } = require('./agreements');

// Verified production tenant, never a shop-name or email match at request time.
const MILES_SHOP_ID = '0cf5d764-af91-4b6f-b70d-23d0fc74edef';
const profiles = {
  miles_insurance_v1: { title: 'Repair authorization and direction of pay', hash: '623316aa700e8383a835325c7ea9100ca5c16e802525559a594e4c2385914144' },
  miles_removal_v1: { title: 'Vehicle removal after insurance denial', hash: 'fdca00ac1c0f218533917b7bdf0e354bdac1661e6c50049f7bbff0863500a0d7' },
  miles_cash_v1: { title: 'Repair authorization and cash agreement', hash: '7064f9a26ebe6da332493a9989e6aa9d2bf215a6714c2d859f522dc89ad8999c' },
};
function canUseProfile(template, shopId) {
  return shopId === MILES_SHOP_ID && template.shop_id === shopId && profiles[template.preparation_kind]
    && template.document_sha256 === profiles[template.preparation_kind].hash;
}
function money(value, label) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(String(value ?? ''))) throw inputError(`${label} must be a dollar amount with up to two decimal places.`);
  return Number(value).toFixed(2);
}
function prepareDetails(template, shopId, ro, name, input = {}) {
  if (!canUseProfile(template, shopId)) throw inputError('This authorization is not available for this shop.', 403);
  const removal = template.preparation_kind === 'miles_removal_v1';
  const stage = input.stage || (removal ? 'removal' : 'intake');
  if (!(removal ? ['removal'] : ['intake', 'completion']).includes(stage)) throw inputError('Choose a valid signing stage.');
  const details = { stage, name: requiredText(name, 'Customer name', 120),
    vehicle: requiredText([ro.vehicle_year, ro.vehicle_make, ro.vehicle_model].filter(Boolean).join(' '), 'Vehicle description', 100),
    vin: requiredText(ro.vin, 'Vehicle VIN', 30), claim: ro.claim_number ? requiredText(ro.claim_number, 'Claim number', 100) : '',
    phone: ro.customer_phone ? requiredText(ro.customer_phone, 'Phone', 40) : '', email: ro.customer_email ? requiredText(ro.customer_email, 'Email', 254) : '',
  };
  if (stage === 'intake') {
    details.estimate = requiredText(input.estimate, 'Estimate reference/version', 100);
    details.amount = money(input.amount, 'Authorized total');
    if (template.preparation_kind === 'miles_insurance_v1') {
      details.claim = requiredText(ro.claim_number, 'Claim number', 100);
      details.deductible = money(input.deductible, 'Deductible');
      details.loss_date = requiredText(input.loss_date, 'Date of loss', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(details.loss_date) || !Number.isFinite(Date.parse(details.loss_date)) || new Date(details.loss_date).toISOString().slice(0, 10) !== details.loss_date) throw inputError('Enter a valid date of loss.');
    }
  }
  if (stage === 'removal') {
    if (input.insurance_denied !== true) throw inputError('This form is for removal after an insurance claim denial.');
    details.condition = requiredText(input.condition, 'Unrepaired conditions and transport arrangements', 600);
  }
  if (stage === 'completion') {
    if (input.repairs_complete !== true) throw inputError('Confirm the repairs are complete before preparing the completion acknowledgment.');
    details.invoice = requiredText(input.invoice, 'Final invoice reference', 100);
  }
  if (input.reviewed !== true) throw inputError('Review the authorization details before preparing it.');
  return details;
}

async function buildPreparedPdf(template, details, roNumber, parentId) {
  if (hash(template.original_pdf) !== profiles[template.preparation_kind]?.hash) throw inputError('Authorization source integrity check failed.', 409);
  let source = template.original_pdf;
  if (details.stage !== 'removal') {
    const stage = template.stage_documents?.[details.stage];
    source = stage?.pdf ? Buffer.from(stage.pdf, 'base64') : null;
    if (!source || hash(source) !== stage.sha256) throw inputError('The scoped authorization is unavailable. Contact the shop.', 409);
  }
  const doc = await PDFDocument.load(source);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf')), { subset: true });
  const page = doc.getPage(0);
  const ink = rgb(.05, .12, .23);
  function text(value, x, y, width, size = 9) {
    value = String(value || '');
    while (font.widthOfTextAtSize(value, size) > width && size > 6) size -= .25;
    if (font.widthOfTextAtSize(value, size) > width) throw inputError('An authorization field is too long for this form. Shorten it before preparing.');
    page.drawText(value, { x, y, size, font, color: ink });
  }
  const kind = template.preparation_kind;
  const insurance = kind === 'miles_insurance_v1';
  const removal = kind === 'miles_removal_v1';
  const completion = details.stage === 'completion';
  const signature = 'See electronic signature record';
  // The customer's original header/logo is untouched. A prepared copy scopes each event;
  // the uploaded original remains independently downloadable and immutable.
  if (!removal) {
    const cutoff = insurance ? 133 : 283;
    if (completion) {
      // The stored stage PDF has excluded text truly redacted, including accessibility text.
      text('COMPLETION ACKNOWLEDGMENT ONLY', 40, 550, 520, 13);
      text(`Prior signed intake: ${parentId}`, 40, 528, 520);
      text(`Final invoice: ${details.invoice}`, 40, 508, 520);
      text('The prior intake authorization is retained separately and is not re-signed here.', 40, 486, 520);
    } else {
      text('INTAKE ONLY - completion acknowledgment is signed separately after repairs.', 40, cutoff - 22, 520, 10);
    }
    text(details.name, 195, insurance ? 679 : 668, 365);
    text(details.vehicle, 253, insurance ? 656 : 645, 305);
    text(details.vin, 65, insurance ? 632 : 623, 175);
    text(details.claim || 'Not applicable', 291, insurance ? 632 : 623, 265);
    if (insurance) {
      if (!completion) text(details.loss_date, 65, 609, 172);
      text(details.email || 'Not provided', 292, 609, 263);
      text(details.phone || 'Not provided', 130, 586, 170);
      text(details.phone || 'Not provided', 350, 586, 205);
      if (!completion) { text(`$${details.deductible}`, 330, 548, 230); text(signature, 178, 533, 221, 8); text(signature, 42, 209, 490, 8); text(signature, 42, 154, 490, 8); }
    } else {
      text(details.email || 'Not provided', 81, 599, 208);
      text(details.phone || 'Not provided', 401, 599, 157);
      if (!completion) { text(`$${details.amount}`, 174, 547, 253); text(signature, 179, 532, 216, 8); }
    }
    if (completion) text(signature, 45, insurance ? 45 : 92, 380, 8);
  } else {
    text(details.name, 45, 551, 260, 9);
    text(`${details.vehicle} / ${details.vin}`, 42, 537, 243, 8);
    text(details.name, 130, 439, 430, 10);
    text(signature, 250, 416, 312, 9);
  }
  const record = doc.addPage([612, 792]);
  let y = 744;
  function line(label, value) {
    let row = '';
    const flush = () => { record.drawText(row, { x: 48, y, font, size: 10 }); y -= 16; row = ''; };
    for (const word of `${label}: ${value}`.split(/\s+/)) {
      if (row && font.widthOfTextAtSize(`${row} ${word}`, 10) > 516) flush();
      for (const char of (row ? ' ' : '') + word) {
        if (font.widthOfTextAtSize(row + char, 10) > 516) flush();
        row += char;
      }
    }
    record.drawText(row, { x: 48, y, font, size: 10 }); y -= 26;
  }
  line('Miles Automotive authorization', details.stage.toUpperCase());
  line('Repair order', roNumber); line('Customer', details.name); line('Vehicle', `${details.vehicle} / ${details.vin}`);
  if (details.estimate) { line('Estimate reference/version', details.estimate); line('Authorized total', `$${details.amount}`); }
  if (details.deductible) line('Deductible', `$${details.deductible}`);
  if (details.condition) line('Unrepaired conditions and transport arrangements', details.condition);
  if (details.invoice) line('Final invoice', details.invoice);
  if (parentId) line('Prior signed intake record', parentId);
  line('Signature scope', completion ? 'Completion acknowledgment only; prior repair authorization remains unchanged.' : removal ? 'Vehicle removal after insurance denial only.' : 'Intake authorization only; the completion acknowledgment is excluded and requires a separate signature after repairs.');
  line('Original template SHA-256', template.document_sha256);
  line('Signing dates', 'Recorded at the time each electronic signature is actually submitted.');
  return Buffer.from(await doc.save());
}
module.exports = { MILES_SHOP_ID, profiles, canUseProfile, prepareDetails, buildPreparedPdf };
