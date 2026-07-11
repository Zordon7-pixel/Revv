const router = require('express').Router();
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const { dbGet, dbAll } = require('../db');
const { calculateDeliveryFeeBreakdown } = require('../services/deliveryFees');
const { dollarsToCents, getRoMoneySummary } = require('../services/roMoney');

function moneyCents(value) {
  const normalized = String(value ?? '').trim();
  const cents = /^-?\d+$/.test(normalized) ? BigInt(normalized) : 0n;
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const dollars = absolute / 100n;
  const remainder = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars.toLocaleString('en-US')}.${remainder}`;
}

function formatDate(value) {
  if (!value) return 'N/A';
  const raw = String(value).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function drawSectionTitle(doc, title) {
  doc.moveDown(0.7);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(title, 50, doc.y, { width: 512 });
  doc.moveDown(0.2);
}

function drawInfoColumn(doc, title, rows, x, y, width = 150) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(title, x, y, { width });
  let rowY = y + 19;
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#6B7280').text(String(label).toUpperCase(), x, rowY, { width });
    doc.font('Helvetica').fontSize(9).fillColor('#111827').text(value || 'N/A', x, rowY + 9, { width, ellipsis: true });
    rowY += 25;
  }
  return rowY;
}

function ensureRoom(doc, heightNeeded = 24) {
  if (doc.y + heightNeeded > doc.page.height - 60) {
    doc.addPage();
  }
}

function drawTableHeader(doc, col, y) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
  doc.text('DESCRIPTION', col.item, y, { width: 290 });
  doc.text('QTY', col.qty, y, { width: 40, align: 'center' });
  doc.text('UNIT', col.unit, y, { width: 70, align: 'right' });
  doc.text('TOTAL', col.total, y, { width: 60, align: 'right' });
  const nextRowY = y + 16;
  doc.moveTo(50, nextRowY - 4).lineTo(562, nextRowY - 4).strokeColor('#E5E7EB').lineWidth(1).stroke();
  doc.font('Helvetica').fontSize(10).fillColor('#111827');
  return nextRowY;
}

function ensureTableRow(doc, rowY, col) {
  if (rowY + 20 <= doc.page.height - 120) return rowY;
  doc.addPage();
  return drawTableHeader(doc, col, 60);
}

function normalizedPaymentStatus(ro) {
  const explicit = String(ro?.payment_status || '').trim().toLowerCase();
  if (explicit) return explicit;
  return ro?.payment_received ? 'paid' : 'unpaid';
}

function decodeDataUrlImage(dataUrl) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:(image\/(?:png|jpe?g));base64,(.+)$/i);
  if (!match) return null;
  try {
    return Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
}

function resolveShopLogoImage(logoUrl) {
  const embedded = decodeDataUrlImage(logoUrl);
  if (embedded) return embedded;

  const raw = String(logoUrl || '').trim();
  if (!raw.startsWith('/uploads/shop-logos/')) return null;
  const uploadRoot = path.resolve(__dirname, '../../uploads/shop-logos');
  const candidate = path.resolve(uploadRoot, path.basename(raw));
  if (path.dirname(candidate) !== uploadRoot || !fs.existsSync(candidate)) return null;
  return candidate;
}

async function loadInvoiceContext(roId, shopId) {
  const ro = await dbGet(
    'SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2',
    [roId, shopId]
  );
  if (!ro) return null;

  const [shop, customer, vehicle, lineItems, moneySummary] = await Promise.all([
    dbGet('SELECT * FROM shops WHERE id = $1', [ro.shop_id]),
    ro.customer_id ? dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [ro.customer_id, ro.shop_id]) : null,
    ro.vehicle_id ? dbGet('SELECT * FROM vehicles WHERE id = $1 AND shop_id = $2', [ro.vehicle_id, ro.shop_id]) : null,
    dbAll(
      `SELECT id, type, description, quantity, unit_price, total, taxable, sort_order
       FROM estimate_line_items
       WHERE ro_id = $1 AND shop_id = $2
       ORDER BY sort_order ASC, created_at ASC`,
      [ro.id, ro.shop_id]
    ),
    getRoMoneySummary(ro.id, ro.shop_id),
  ]);

  const deliveryFeeBreakdown = await calculateDeliveryFeeBreakdown(ro);
  return { ro, shop, customer, vehicle, lineItems, moneySummary, deliveryFeeBreakdown };
}

function streamDocumentPdf(res, context, { documentType = 'invoice' } = {}) {
  const { ro, shop, customer, vehicle, lineItems, moneySummary, deliveryFeeBreakdown } = context;
  const estimateItems = Array.isArray(lineItems) ? lineItems : [];
  const estimateSubtotalCents = Number(moneySummary?.subtotalCents || 0);
  const taxCents = Number(moneySummary?.taxCents || 0);
  const deliveryFeeCents = dollarsToCents(deliveryFeeBreakdown?.total_fee || 0);
  const subtotalCents = estimateSubtotalCents + deliveryFeeCents;
  const totalCents = Number(moneySummary?.totalCents || 0) + deliveryFeeCents;
  const isRepairOrder = documentType === 'repair-order';

  const safeRo = String(ro.ro_number || ro.id || documentType).replace(/[^a-zA-Z0-9-_]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${isRepairOrder ? 'repair-order' : 'invoice'}-${safeRo}.pdf"`);

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  doc.pipe(res);

  const shopLogo = resolveShopLogoImage(shop?.logo_url);
  const revvLogoPath = path.join(__dirname, '../../../frontend/public/revv-mark-transparent.png');
  const hasRevvLogo = fs.existsSync(revvLogoPath);
  let headerLeft = 50;
  if (shopLogo) {
    try {
      doc.image(shopLogo, 50, 45, { fit: [82, 82] });
      headerLeft = 144;
    } catch {
      headerLeft = 50;
    }
  }

  doc.font('Helvetica-Bold').fontSize(24).fillColor('#111827').text(shop?.name || 'REVV Auto Body', headerLeft, 50, { width: 240 });
  doc.font('Helvetica').fontSize(10).fillColor('#4B5563');
  const addressLine = [shop?.address, shop?.city, shop?.state, shop?.zip].filter(Boolean).join(', ');
  let contactY = 84;
  if (addressLine) {
    doc.text(addressLine, headerLeft, contactY, { width: 240 });
    contactY += 14;
  }
  if (shop?.phone) doc.text(shop.phone, headerLeft, contactY, { width: 240 });

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text(isRepairOrder ? 'REPAIR ORDER' : 'INVOICE', 360, 50, { width: 202, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(`RO #: ${ro.ro_number || 'N/A'}`, 400, 78, { align: 'right' });
  doc.text(`Date: ${formatDate(ro.created_at)}`, 400, 93, { align: 'right' });
  doc.text(`Status: ${ro.status || 'N/A'}`, 400, 108, { align: 'right' });

  doc.moveTo(50, 135).lineTo(470, 135).strokeColor('#4F46E5').lineWidth(2).stroke();
  doc.moveTo(470, 135).lineTo(562, 135).strokeColor('#EAB308').lineWidth(2).stroke();
  doc.y = 148;

  const infoY = 154;
  const customerEndY = drawInfoColumn(doc, 'Customer', [
    ['Name', customer?.name || 'N/A'],
    ['Phone', customer?.phone || 'N/A'],
    ['Email', customer?.email || 'N/A'],
  ], 50, infoY, 154);
  const vehicleEndY = drawInfoColumn(doc, 'Vehicle', [
    ['Vehicle', [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'N/A'],
    ['VIN', vehicle?.vin || 'N/A'],
    ['Plate', vehicle?.plate || 'N/A'],
  ], 224, infoY, 154);
  const insuranceEndY = drawInfoColumn(doc, 'Insurance', [
    ['Insurer', ro.insurance_company || ro.insurer || customer?.insurance_company || 'N/A'],
    ['Claim #', ro.claim_number || ro.insurance_claim_number || 'N/A'],
    ['Policy #', ro.policy_number || customer?.policy_number || 'N/A'],
    ['Adjuster', ro.adjuster_name || 'N/A'],
    ['Deductible', moneyCents(dollarsToCents(ro.deductible || 0))],
  ], 398, infoY, 164);
  doc.y = Math.max(customerEndY, vehicleEndY, insuranceEndY) + 2;

  drawSectionTitle(doc, 'Line Items');

  const tableStartY = doc.y + 4;
  const col = { item: 52, qty: 350, unit: 410, total: 500 };
  let rowY = drawTableHeader(doc, col, tableStartY);

  for (const item of estimateItems) {
    rowY = ensureTableRow(doc, rowY, col);
    const qty = Number(item.quantity || 1);
    const unitCents = dollarsToCents(item.unit_price || 0);
    const lineTotalCents = dollarsToCents(item.total || 0);
    const typeLabel = String(item.type || 'line').toUpperCase();
    const title = `${typeLabel}: ${item.description || 'Estimate line item'}`;
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    doc.text(title, col.item, rowY, { width: 290 });
    doc.text(String(qty), col.qty, rowY, { width: 40, align: 'center' });
    doc.text(moneyCents(unitCents), col.unit, rowY, { width: 70, align: 'right' });
    doc.text(moneyCents(lineTotalCents), col.total, rowY, { width: 60, align: 'right' });
    rowY += 18;
    doc.moveTo(50, rowY - 3).lineTo(562, rowY - 3).strokeColor('#F3F4F6').lineWidth(1).stroke();
  }

  if (!estimateItems.length) {
    rowY = ensureTableRow(doc, rowY, col);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6B7280');
    doc.text('No estimate line items are available for this invoice.', col.item, rowY, { width: 430 });
    rowY += 18;
    doc.moveTo(50, rowY - 3).lineTo(562, rowY - 3).strokeColor('#F3F4F6').lineWidth(1).stroke();
  }

  const serviceItems = [];

  const deliveryLeg = deliveryFeeBreakdown?.delivery;
  const pickupLeg = deliveryFeeBreakdown?.pickup;
  if (deliveryLeg?.enabled && Number(deliveryLeg.amount || 0) > 0) {
    let detail = '';
    if (deliveryLeg.method === 'per_mile') detail = ` (${Number(deliveryLeg.miles || 0).toFixed(1)} mi)`;
    if (deliveryLeg.method === 'zone' && deliveryLeg.applied_zone) detail = ` (${deliveryLeg.applied_zone})`;
    serviceItems.push({ description: `Delivery Fee${detail}`, amountCents: dollarsToCents(deliveryLeg.amount || 0) });
  }
  if (pickupLeg?.enabled && Number(pickupLeg.amount || 0) > 0) {
    let detail = '';
    if (pickupLeg.method === 'per_mile') detail = ` (${Number(pickupLeg.miles || 0).toFixed(1)} mi)`;
    if (pickupLeg.method === 'zone' && pickupLeg.applied_zone) detail = ` (${pickupLeg.applied_zone})`;
    serviceItems.push({ description: `Pickup Fee${detail}`, amountCents: dollarsToCents(pickupLeg.amount || 0) });
  }

  for (const item of serviceItems) {
    rowY = ensureTableRow(doc, rowY, col);
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    doc.text(item.description, col.item, rowY, { width: 290 });
    doc.text('1', col.qty, rowY, { width: 40, align: 'center' });
    doc.text(moneyCents(item.amountCents), col.unit, rowY, { width: 70, align: 'right' });
    doc.text(moneyCents(item.amountCents), col.total, rowY, { width: 60, align: 'right' });
    rowY += 18;
    doc.moveTo(50, rowY - 3).lineTo(562, rowY - 3).strokeColor('#F3F4F6').lineWidth(1).stroke();
  }

  doc.y = rowY + 20;
  ensureRoom(doc, 120);

  // Summary section
  doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor('#D1D5DB').lineWidth(1.5).stroke();
  doc.moveDown(0.4);

  const summaryX = 360;
  const summaryValueX = 472;
  doc.font('Helvetica').fontSize(11).fillColor('#374151');
  doc.text('Subtotal', summaryX, doc.y, { width: 130 });
  doc.text(moneyCents(subtotalCents), summaryValueX, doc.y, { width: 90, align: 'right' });

  doc.moveDown(0.6);
  doc.text('Tax', summaryX, doc.y, { width: 130 });
  doc.text(moneyCents(taxCents), summaryValueX, doc.y, { width: 90, align: 'right' });

  if (deliveryFeeCents > 0) {
    doc.moveDown(0.6);
    doc.text('Delivery/Pickup Fee', summaryX, doc.y, { width: 130 });
    doc.text(moneyCents(deliveryFeeCents), summaryValueX, doc.y, { width: 90, align: 'right' });
  }

  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827');
  doc.text('Total', summaryX, doc.y, { width: 130 });
  doc.text(moneyCents(totalCents), summaryValueX, doc.y, { width: 90, align: 'right' });

  doc.moveDown(1.2);
  const paymentStatus = normalizedPaymentStatus(ro);
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text('Payment Status', 50, doc.y, { width: 140 });
  doc.font('Helvetica-Bold').fillColor(paymentStatus === 'paid' ? '#047857' : '#B45309');
  doc.text(String(paymentStatus).toUpperCase(), 195, doc.y, { width: 100 });

  if (ro.notes) {
    ensureRoom(doc, 70);
    doc.moveDown(2);
    drawSectionTitle(doc, 'Notes');
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text(ro.notes, {
      width: 500,
    });
  }

  if (isRepairOrder) {
    ensureRoom(doc, 110);
    doc.moveDown(1.5);
    drawSectionTitle(doc, 'Repair Authorization');
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text(
      'I authorize the repair facility to perform the work described on this repair order and to operate the vehicle for inspection, testing, and delivery purposes.',
      { width: 500 }
    );
    const signatureY = doc.y + 30;
    doc.moveTo(50, signatureY).lineTo(340, signatureY).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    doc.moveTo(380, signatureY).lineTo(562, signatureY).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#6B7280');
    doc.text('Customer authorization signature', 50, signatureY + 5, { width: 290 });
    doc.text('Date', 380, signatureY + 5, { width: 182 });
  }

  const footerY = doc.page.height - 70;
  doc.font('Helvetica').fontSize(9).fillColor('#6B7280');
  if (hasRevvLogo) {
    try {
      doc.image(revvLogoPath, 171, footerY - 3, { fit: [12, 12] });
    } catch {
      // Non-blocking branding asset.
    }
  }
  doc.font('Helvetica').fontSize(8).fillColor('#64748B');
  doc.text('Estimated & tracked with REVV · revvshop.app', 188, footerY, { width: 250, align: 'center' });

  doc.end();
}

router.get('/public/:token', async (req, res) => {
  try {
    const tokenRecord = await dbGet(
      'SELECT ro_id, shop_id, expires_at FROM portal_tokens WHERE token = $1',
      [req.params.token]
    );
    if (!tokenRecord) return res.status(404).json({ error: 'Invoice link not found' });
    if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invoice link has expired' });
    }

    const context = await loadInvoiceContext(tokenRecord.ro_id, tokenRecord.shop_id);
    if (!context) return res.status(404).json({ error: 'Repair order not found' });
    if (context.ro.status !== 'closed' || normalizedPaymentStatus(context.ro) !== 'paid') {
      return res.status(403).json({ error: 'Invoice is available after the repair order is closed and paid' });
    }

    return streamDocumentPdf(res, context);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:roId/repair-order', auth, async (req, res) => {
  try {
    const context = await loadInvoiceContext(req.params.roId, req.user.shop_id);
    if (!context) return res.status(404).json({ error: 'Repair order not found' });
    return streamDocumentPdf(res, context, { documentType: 'repair-order' });
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    return res.end();
  }
});

router.get('/:roId', auth, async (req, res) => {
  try {
    const context = await loadInvoiceContext(req.params.roId, req.user.shop_id);
    if (!context) return res.status(404).json({ error: 'Repair order not found' });
    return streamDocumentPdf(res, context);
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    return res.end();
  }
});

module.exports = router;
module.exports._test = {
  loadInvoiceContext,
  moneyCents,
  resolveShopLogoImage,
  streamDocumentPdf,
};
