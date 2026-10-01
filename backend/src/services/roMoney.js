// Keep pure money helpers importable without loading dotenv or opening a database.
const dbGet = (...args) => require('../db').dbGet(...args);

function dollarsToCents(value) {
  const amount = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function centsToDollars(cents) {
  return Number(cents || 0) / 100;
}

function roundToIntCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount);
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
  roundToIntCents,
};

// Explicit-estimate arithmetic; legacy dollar helpers above retain their behavior.
const MAX_ESTIMATE_CENTS = 9999999999n; // Existing NUMERIC(10,2) dollar storage.
function scaledDecimal(value, places, label = 'number', max = MAX_ESTIMATE_CENTS) {
  if (!['string', 'number'].includes(typeof value) ||
      (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0)))) throw new TypeError(`Invalid ${label}`);
  const text = String(value);
  if (text.length > 32) throw new RangeError(`Invalid ${label}`);
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(text);
  if (!match || (match[2] || '').length > places) throw new TypeError(`Invalid ${label}`);
  const result = BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] || '').padEnd(places, '0') || '0');
  if (result > max) throw new RangeError(`Invalid ${label}`);
  return result;
}
function checkedCents(value) {
  if (value < -MAX_ESTIMATE_CENTS || value > MAX_ESTIMATE_CENTS) throw new RangeError('Estimate limit exceeded');
  return Number(value);
}
function roundHalfUp(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Invalid rounding input');
  return (numerator + denominator / 2n) / denominator;
}
module.exports.exactMoney = { scaledDecimal, checkedCents, roundHalfUp, MAX_ESTIMATE_CENTS };

// Positive adjustment is additional customer responsibility. Coverage + uncovered
// + adjustment must equal the total; paid/deposits never change payer allocation.
function allocateInsurance(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid insurance allocation');
  const keys = ['total_cents', 'covered_cents', 'deductible_cents', 'uncovered_cents', 'adjustment_cents', 'paid_cents'];
  const amounts = keys.map(key => input[key] == null ? null : scaledDecimal(input[key], 0, key));
  if (amounts.some(value => value === null)) {
    return { complete: false, carrier_cents: null, customer_cents: null, paid_cents: null, balance_cents: null };
  }
  const [total, covered, deductible, uncovered, adjustment, paid] = amounts;
  if (covered + uncovered + adjustment !== total || deductible > covered || paid > total) {
    throw new RangeError('Insurance allocation does not reconcile');
  }
  return {
    complete: true,
    carrier_cents: checkedCents(covered - deductible),
    customer_cents: checkedCents(deductible + uncovered + adjustment),
    paid_cents: checkedCents(paid),
    balance_cents: checkedCents(total - paid),
  };
}
module.exports.allocateInsurance = allocateInsurance;
