const { dbGet } = require('../db');

function dollarsToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function centsToDollars(cents) {
  return Number(cents || 0) / 100;
}

function normalizePaymentStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isPaidStatus(status) {
  return ['paid', 'succeeded'].includes(normalizePaymentStatus(status));
}

async function getRoMoneySummary(roId, shopId) {
  const summary = await dbGet(
    `SELECT
       COALESCE(SUM(total), 0) AS subtotal,
       COALESCE(SUM(CASE WHEN type = 'labor' THEN total ELSE 0 END), 0) AS labor_total,
       COALESCE(SUM(CASE WHEN type = 'parts' THEN total ELSE 0 END), 0) AS parts_total,
       COALESCE(SUM(CASE WHEN type = 'sublet' THEN total ELSE 0 END), 0) AS sublet_total,
       COALESCE(SUM(CASE WHEN type = 'other' THEN total ELSE 0 END), 0) AS other_total,
       COALESCE(SUM(CASE WHEN taxable THEN total ELSE 0 END), 0) AS taxable_subtotal,
       COUNT(*)::int AS line_count
     FROM estimate_line_items
     WHERE ro_id = $1 AND shop_id = $2`,
    [roId, shopId]
  );

  const shop = await dbGet('SELECT COALESCE(tax_rate, 0) AS tax_rate FROM shops WHERE id = $1', [shopId]);
  const taxRate = Number(shop?.tax_rate || 0);
  const subtotalCents = dollarsToCents(summary?.subtotal);
  const taxableSubtotalCents = dollarsToCents(summary?.taxable_subtotal);
  const taxCents = Math.round(taxableSubtotalCents * taxRate);

  return {
    lineCount: Number.parseInt(summary?.line_count || 0, 10) || 0,
    taxRate,
    subtotalCents,
    laborCents: dollarsToCents(summary?.labor_total),
    partsCents: dollarsToCents(summary?.parts_total),
    subletCents: dollarsToCents(summary?.sublet_total),
    otherCents: dollarsToCents(summary?.other_total),
    taxableSubtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

async function getPaidCents(roId, shopId) {
  const row = await dbGet(
    `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS paid_cents
     FROM ro_payments
     WHERE ro_id = $1
       AND shop_id = $2
       AND LOWER(COALESCE(status, '')) IN ('succeeded', 'paid')`,
    [roId, shopId]
  );
  return Number(row?.paid_cents || 0);
}

function reconcilePaymentStatus({ paidCents, owedCents }) {
  if (owedCents <= 0) return 'unpaid';
  if (paidCents >= owedCents) return 'paid';
  if (paidCents > 0) return 'partial';
  return 'unpaid';
}

module.exports = {
  centsToDollars,
  dollarsToCents,
  getPaidCents,
  getRoMoneySummary,
  isPaidStatus,
  reconcilePaymentStatus,
};
