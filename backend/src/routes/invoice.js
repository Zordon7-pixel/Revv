const router = require('express').Router();
const PDFDocument = require('pdfkit');
const auth = require('../middleware/auth');
const { dbGet, dbAll } = require('../db');

function money(value) {
  const n = Number(value || 0);
  return `$${n.toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function drawSectionTitle(doc, title) {
  doc.moveDown(0.7);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(title);
  doc.moveDown(0.2);
}

function addRow(doc, label, value) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(`${label}: `, { continued: true });
  doc.font('Helvetica').fillColor('#111827').text(value || 'N/A');
}

function ensureRoom(doc, heightNeeded = 24) {
  if (doc.y + heightNeeded > doc.page.height - 60) {
    doc.addPage();
  }
}

function drawTableHeader(doc, col, y) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
  doc.text('DESCRIPTION', col.item, y);
  doc.text('QTY', col.qty, y, { width: 40, align: 'right' });
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
  return ro?.payment_received ? 'succeeded' : 'unpaid';
}

async function loadInvoiceContext(roId, shopId) {
  const ro = await dbGet(
    'SELECT * FROM repair_orders WHERE id = $1 AND shop_id = $2',
    [roId, shopId]
  );
  if (!ro) return null;

  const [shop, customer, vehicle, parts] = await Promise.all([
    dbGet('SELECT * FROM shops WHERE id = $1', [ro.shop_id]),
    ro.customer_id ? dbGet('SELECT * FROM customers WHERE id = $1 AND shop_id = $2', [ro.customer_id, ro.shop_id]) : null,
    ro.vehicle_id ? dbGet('SELECT * FROM vehicles WHERE id = $1 AND shop_id = $2', [ro.vehicle_id, ro.shop_id]) : null,
    dbAll(
      `SELECT id, part_name, part_number, quantity, unit_cost
       FROM parts_orders
       WHERE ro_id = $1 AND shop_id = $2
       ORDER BY created_at ASC`,
      [ro.id, ro.shop_id]
    ),
  ]);

  return { ro, shop, customer, vehicle, parts };
}

function streamInvoicePdf(res, context) {
  const { ro, shop, customer, vehicle, parts } = context;
  const partsItems = Array.isArray(parts) ? parts : [];
  const partsLineTotal = partsItems.reduce((sum, part) => {
    const qty = Number(part.quantity || 1);
    const unit = Number(part.unit_cost || 0);
    return sum + qty * unit;
  }, 0);

  const labor = Number(ro.labor_cost || 0);
  const sublet = Number(ro.sublet_cost || 0);
  const tax = Number(ro.tax || 0);
  const partsCost = Number(ro.parts_cost || 0);
  const subtotal = partsItems.length > 0
    ? (partsLineTotal + labor + sublet)
    : (partsCost + labor + sublet);
  const total = Number(ro.total || 0) > 0 ? Number(ro.total) : subtotal + tax;

  const safeRo = String(ro.ro_number || ro.id || 'invoice').replace(/[^a-zA-Z0-9-_]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${safeRo}.pdf"`);

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(24).fillColor('#111827').text(shop?.name || 'REVV Auto Body');
  doc.font('Helvetica').fontSize(10).fillColor('#4B5563');
  const addressLine = [shop?.address, shop?.city, shop?.state, shop?.zip].filter(Boolean).join(', ');
  if (addressLine) doc.text(addressLine);
  if (shop?.phone) doc.text(shop.phone);

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text('INVOICE', 400, 50, { align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(`RO #: ${ro.ro_number || 'N/A'}`, 400, 78, { align: 'right' });
  doc.text(`Date: ${formatDate(ro.created_at)}`, 400, 93, { align: 'right' });
  doc.text(`Status: ${ro.status || 'N/A'}`, 400, 108, { align: 'right' });

  doc.moveTo(50, 135).lineTo(562, 135).strokeColor('#D1D5DB').lineWidth(1).stroke();
  doc.y = 148;

  drawSectionTitle(doc, 'Customer');
  addRow(doc, 'Name', customer?.name || 'N/A');
  addRow(doc, 'Phone', customer?.phone || 'N/A');
  addRow(doc, 'Email', customer?.email || 'N/A');

  drawSectionTitle(doc, 'Vehicle');
  addRow(doc, 'Vehicle', [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'N/A');
  addRow(doc, 'VIN', vehicle?.vin || 'N/A');
  addRow(doc, 'Plate', vehicle?.plate || 'N/A');

  drawSectionTitle(doc, 'Line Items');

  const tableStartY = doc.y + 4;
  const col = { item: 52, qty: 350, unit: 410, total: 500 };
  let rowY = drawTableHeader(doc, col, tableStartY);

  for (const part of partsItems) {
    rowY = ensureTableRow(doc, rowY, col);
    const qty = Number(part.quantity || 1);
    const unit = Number(part.unit_cost || 0);
    const lineTotal = qty * unit;
    const title = part.part_number
      ? `${part.part_name || 'Part'} (${part.part_number})`
      : (part.part_name || 'Part');
    doc.text(title, col.item, rowY, { width: 290 });
    doc.text(String(qty), col.qty, rowY, { width: 40, align: 'right' });
    doc.text(money(unit), col.unit, rowY, { width: 70, align: 'right' });
    doc.text(money(lineTotal), col.total, rowY, { width: 60, align: 'right' });
    rowY += 18;
    doc.moveTo(50, rowY - 3).lineTo(562, rowY - 3).strokeColor('#F3F4F6').lineWidth(1).stroke();
  }

  const serviceItems = [
    { description: 'Labor', amount: labor },
    { description: 'Sublet Work', amount: sublet },
  ].filter((item) => item.amount > 0);

  if (!partsItems.length && partsCost > 0) {
    serviceItems.unshift({ description: 'Parts', amount: partsCost });
  }

  for (const item of serviceItems) {
    rowY = ensureTableRow(doc, rowY, col);
    doc.text(item.description, col.item, rowY, { width: 290 });
    doc.text('1', col.qty, rowY, { width: 40, align: 'right' });
    doc.text(money(item.amount), col.unit, rowY, { width: 70, align: 'right' });
    doc.text(money(item.amount), col.total, rowY, { width: 60, align: 'right' });
    rowY += 18;
    doc.moveTo(50, rowY - 3).lineTo(562, rowY - 3).strokeColor('#F3F4F6').lineWidth(1).stroke();
  }

  doc.y = rowY + 12;
  ensureRoom(doc, 120);

  const summaryX = 365;
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text('Subtotal', summaryX, doc.y, { width: 120 });
  doc.text(money(subtotal), 485, doc.y, { width: 75, align: 'right' });

  doc.text('Tax', summaryX, doc.y + 16, { width: 120 });
  doc.text(money(tax), 485, doc.y + 16, { width: 75, align: 'right' });

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827');
  doc.text('Total', summaryX, doc.y + 36, { width: 120 });
  doc.text(money(total), 485, doc.y + 36, { width: 75, align: 'right' });

  const paymentStatus = normalizedPaymentStatus(ro);
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text('Payment Status', 50, doc.y + 70, { width: 140 });
  doc.font('Helvetica-Bold').fillColor(paymentStatus === 'succeeded' ? '#047857' : '#B45309');
  doc.text(String(paymentStatus).toUpperCase(), 160, doc.y + 70);

  if (ro.notes) {
    ensureRoom(doc, 70);
    doc.moveDown(2);
    drawSectionTitle(doc, 'Notes');
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text(ro.notes, {
      width: 500,
    });
  }

  doc.font('Helvetica').fontSize(9).fillColor('#6B7280');
  doc.text('Thank you for your business.', 50, doc.page.height - 40);

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
    if (context.ro.status !== 'closed' || normalizedPaymentStatus(context.ro) !== 'succeeded') {
      return res.status(403).json({ error: 'Invoice is available after the repair order is closed and paid' });
    }

    return streamInvoicePdf(res, context);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:roId', auth, async (req, res) => {
  try {
    const context = await loadInvoiceContext(req.params.roId, req.user.shop_id);
    if (!context) return res.status(404).json({ error: 'Repair order not found' });
    return streamInvoicePdf(res, context);
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    return res.end();
  }
});

module.exports = router;
