const MONEY_FIELDS = new Set([
  'parts',
  'body_labor_rate',
  'body_labor_cost',
  'paint_labor_rate',
  'paint_labor_cost',
  'mechanical_labor_rate',
  'mechanical_labor_cost',
  'frame_labor_rate',
  'frame_labor_cost',
  'glass_labor_rate',
  'glass_labor_cost',
  'paint_supplies_rate',
  'paint_supplies_cost',
  'miscellaneous',
  'other_charges',
  'costs_total',
  'subtotal',
  'sales_tax_basis',
  'sales_tax_cost',
  'county_tax_basis',
  'county_tax_cost',
  'other_tax_1_basis',
  'other_tax_1_cost',
  'total_cost_of_repairs',
  'deductible',
  'total_adjustments',
  'net_cost_of_repairs',
  'revenue',
]);

const EMPTY_TOTALS = Object.freeze({
  parts: 0,
  body_labor_hours: 0,
  body_labor_rate: 0,
  body_labor_cost: 0,
  paint_labor_hours: 0,
  paint_labor_rate: 0,
  paint_labor_cost: 0,
  mechanical_labor_hours: 0,
  mechanical_labor_rate: 0,
  mechanical_labor_cost: 0,
  frame_labor_hours: 0,
  frame_labor_rate: 0,
  frame_labor_cost: 0,
  glass_labor_hours: 0,
  glass_labor_rate: 0,
  glass_labor_cost: 0,
  paint_supplies_hours: 0,
  paint_supplies_rate: 0,
  paint_supplies_cost: 0,
  miscellaneous: 0,
  other_charges: 0,
  costs_total: 0,
  subtotal: 0,
  sales_tax_basis: 0,
  sales_tax_rate: 0,
  sales_tax_cost: 0,
  county_tax_basis: 0,
  county_tax_rate: 0,
  county_tax_cost: 0,
  other_tax_1_basis: 0,
  other_tax_1_rate: 0,
  other_tax_1_cost: 0,
  total_cost_of_repairs: 0,
  deductible: 0,
  total_adjustments: 0,
  net_cost_of_repairs: 0,
  revenue: 0,
});

function normalizeLines(text) {
  return String(text || '')
    .replace(/\u0000/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function moneyToCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(String(value).replace(/[$,\s]/g, '').trim());
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function centsToDollars(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount) / 100;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(/[$,%]/g, '').trim());
  return Number.isFinite(num) ? num : null;
}

function trailingMoneyCents(line) {
  const match = String(line || '').match(/(-?\$?\s*[0-9][0-9,]*\.[0-9]{2})\s*$/);
  return match ? moneyToCents(match[1]) : null;
}

function normalizeTotalsMoneyToDollars(totals) {
  for (const [key, value] of Object.entries(totals)) {
    if (!MONEY_FIELDS.has(key)) continue;
    totals[key] = centsToDollars(value);
  }
}

function normalizeLineItemMoneyToDollars(items) {
  for (const item of items) {
    for (const key of ['unit_price', 'price', 'extended']) {
      if (item[key] !== undefined) item[key] = centsToDollars(item[key]);
    }
    delete item.total;
    for (const key of Object.keys(item)) {
      if (/_cents$/i.test(key)) delete item[key];
    }
  }
}

function normalizeReturnedMoneyToDollars(parsed) {
  normalizeTotalsMoneyToDollars(parsed.estimate_totals);
  normalizeLineItemMoneyToDollars(parsed.line_items);
}

function assertDollarsShape(parsed, extractorName = 'estimate') {
  for (const [key, value] of Object.entries(parsed.estimate_totals)) {
    if (!MONEY_FIELDS.has(key)) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${extractorName} extractor emitted invalid dollar money field: ${key}`);
    }
  }

  for (const item of parsed.line_items) {
    for (const [key, value] of Object.entries(item)) {
      if (!['unit_price', 'price', 'extended'].includes(key)) continue;
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${extractorName} extractor emitted invalid dollar line item money field: ${key}`);
      }
    }
  }
}

module.exports = {
  EMPTY_TOTALS,
  MONEY_FIELDS,
  assertDollarsShape,
  centsToDollars,
  moneyToCents,
  normalizeLines,
  normalizeReturnedMoneyToDollars,
  numberOrNull,
  trailingMoneyCents,
};
