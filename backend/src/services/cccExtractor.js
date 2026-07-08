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
  if (!Number.isFinite(value)) return value;
  return Math.round(value) / 100;
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

function emptyParsed() {
  return {
    insurance_company: null,
    claim_number: null,
    adjuster_name: null,
    adjuster_phone: null,
    adjuster_email: null,
    customer_name: null,
    customer_phone: null,
    vehicle: null,
    vin: null,
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    estimate_totals: { ...EMPTY_TOTALS },
    line_items: [],
    total_allowed: null,
    detected_format: 'ccc',
    needs_review: false,
    review_reasons: [],
  };
}

function parseHeader(lines, parsed) {
  for (const line of lines) {
    const claim = line.match(/^Claim Number:\s*(.+)$/i);
    if (claim) parsed.claim_number = claim[1].trim();
    const insurance = line.match(/^Insurance Company:\s*(.+)$/i);
    if (insurance) parsed.insurance_company = insurance[1].trim();
    const customer = line.match(/^(?:Owner|Customer):\s*(.+)$/i);
    if (customer) parsed.customer_name = customer[1].trim();
    const vehicle = line.match(/^Vehicle:\s*(.+)$/i);
    if (vehicle) {
      parsed.vehicle = vehicle[1].trim();
      const parts = parsed.vehicle.match(/^(\d{4})\s+([A-Za-z]+)\s+(.+)$/);
      if (parts) {
        parsed.vehicle_year = parts[1];
        parsed.vehicle_make = parts[2];
        parsed.vehicle_model = parts[3];
      }
    }
    const vin = line.match(/^VIN:\s*([A-HJ-NPR-Z0-9]{11,17})/i);
    if (vin) parsed.vin = vin[1].toUpperCase();
  }
}

function normalizeOperation(op) {
  const value = String(op || '').toUpperCase().replace(/[&/]/g, '').trim();
  if (['RI', 'RNI'].includes(value)) return 'R&I';
  if (['RPR', 'REPAIR'].includes(value)) return 'RPR';
  if (['REPL', 'RR', 'REPLACE'].includes(value)) return 'Repl';
  if (['REFN', 'REFINISH'].includes(value)) return 'Refn';
  if (value === 'BLEND') return 'Blend';
  if (['SUBL', 'SUBLET'].includes(value)) return 'Subl';
  return op ? String(op).trim() : null;
}

function itemTypeFor(operation, priceCents) {
  if (operation === 'Subl') return 'sublet';
  if (operation === 'Repl') return 'parts';
  if (['R&I', 'RPR', 'Refn', 'Blend'].includes(operation)) return 'labor';
  if (priceCents > 0) return 'parts';
  return 'other';
}

function laborTypeFor(operation, bodyHours, paintHours, description) {
  const text = String(description || '').toLowerCase();
  if (text.includes('glass')) return 'glass';
  if (text.includes('frame')) return 'frame';
  if (text.includes('radar') || text.includes('mechanical') || text.includes('calibration')) return 'mechanical';
  if (operation === 'Refn' || operation === 'Blend' || paintHours > 0) return 'paint';
  if (bodyHours > 0) return 'body';
  return null;
}

function partTypeFor(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'oem') return 'OEM';
  if (['am', 'a/m', 'aftermarket'].includes(text)) return 'aftermarket';
  if (['recy', 'recycled', 'lkq', 'used'].includes(text)) return 'recycled';
  if (['recond', 'reconditioned', 'reman'].includes(text)) return 'reconditioned';
  return value ? String(value).trim() : null;
}

function parseLineItems(lines, reviewReasons) {
  const items = [];
  const start = lines.findIndex((line) => /^Line\s+Op\b/i.test(line));
  const end = lines.findIndex((line, index) => index > start && /^ESTIMATE TOTALS$/i.test(line));
  if (start < 0 || end < 0) {
    reviewReasons.push('ccc_line_grid_missing');
    return items;
  }

  const rowPattern = /^(\d+)\s+(R&I|R\/I|RNI|RPR|REPL|R&R|REFN|BLEND|SUBL|-)\s+(.+?)\s+(\S+|-)\s+(OEM|AM|A\/M|Aftermarket|Recy|Recycled|LKQ|Recond|Reconditioned|-)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s+(-?\$?[0-9][0-9,]*\.[0-9]{2})\s+(-?\$?[0-9][0-9,]*\.[0-9]{2})$/i;
  for (const line of lines.slice(start + 1, end)) {
    const match = line.match(rowPattern);
    if (!match) {
      if (/^\d+\s+/.test(line)) reviewReasons.push(`low_confidence_line_${line.split(' ')[0]}`);
      continue;
    }
    const operation = normalizeOperation(match[2] === '-' ? '' : match[2]);
    const bodyHours = numberOrNull(match[6]) ?? 0;
    const paintHours = numberOrNull(match[7]) ?? 0;
    const priceCents = moneyToCents(match[8]) ?? 0;
    const extendedCents = moneyToCents(match[9]) ?? 0;
    const laborUnits = Number((bodyHours + paintHours).toFixed(2));
    const description = match[3].trim();

    items.push({
      type: itemTypeFor(operation, priceCents),
      description,
      quantity: laborUnits > 0 ? laborUnits : 1,
      unit_price: centsToDollars(priceCents),
      operation_code: operation,
      operation,
      part_number: match[4] === '-' ? null : match[4],
      part_type: match[5] === '-' ? null : partTypeFor(match[5]),
      labor_units: laborUnits || null,
      labor_type: laborTypeFor(operation, bodyHours, paintHours, description),
      extended: centsToDollars(extendedCents),
    });
  }
  return items;
}

function parseLaborTotal(line) {
  const compact = String(line || '').replace(/\s+/g, ' ');
  const match = compact.match(/([0-9]+(?:\.[0-9]+)?)\s*hrs\s*@\s*\$?\s*([0-9,]+(?:\.[0-9]+)?)\s*\/\s*hr\s*(-?\$?\s*[0-9][0-9,]*\.[0-9]{2})/i);
  if (!match) return null;
  return {
    hours: numberOrNull(match[1]),
    rate: moneyToCents(match[2]),
    cost: moneyToCents(match[3]),
  };
}

function parseTaxTotal(line) {
  const match = String(line || '').match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*@\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*(-?\$?\s*[0-9][0-9,]*\.[0-9]{2})/i);
  if (!match) return null;
  return {
    basis: moneyToCents(match[1]),
    rate: numberOrNull(match[2]),
    cost: moneyToCents(match[3]),
  };
}

function assignLabor(totals, prefix, parsed) {
  if (!parsed) return false;
  totals[`${prefix}_labor_hours`] = parsed.hours ?? 0;
  totals[`${prefix}_labor_rate`] = parsed.rate ?? 0;
  totals[`${prefix}_labor_cost`] = parsed.cost ?? 0;
  return true;
}

function parseTotals(lines, reviewReasons) {
  const totals = { ...EMPTY_TOTALS };
  const start = lines.findIndex((line) => /^ESTIMATE TOTALS$/i.test(line));
  if (start < 0) {
    reviewReasons.push('ccc_totals_missing');
    return totals;
  }

  for (const line of lines.slice(start + 1)) {
    if (/^This is not an authorization to repair/i.test(line)) break;
    if (/^Parts/i.test(line)) totals.parts = trailingMoneyCents(line) ?? totals.parts;
    else if (/^Body Labor/i.test(line)) assignLabor(totals, 'body', parseLaborTotal(line)) || reviewReasons.push('body_labor_total_unreadable');
    else if (/^(?:Paint|Refinish) Labor/i.test(line)) assignLabor(totals, 'paint', parseLaborTotal(line)) || reviewReasons.push('paint_labor_total_unreadable');
    else if (/^Mechanical Labor/i.test(line)) assignLabor(totals, 'mechanical', parseLaborTotal(line)) || reviewReasons.push('mechanical_labor_total_unreadable');
    else if (/^Frame Labor/i.test(line)) assignLabor(totals, 'frame', parseLaborTotal(line)) || reviewReasons.push('frame_labor_total_unreadable');
    else if (/^Glass Labor/i.test(line)) assignLabor(totals, 'glass', parseLaborTotal(line)) || reviewReasons.push('glass_labor_total_unreadable');
    else if (/^Paint Supplies/i.test(line)) {
      const parsed = parseLaborTotal(line);
      if (parsed) {
        totals.paint_supplies_hours = parsed.hours ?? 0;
        totals.paint_supplies_rate = parsed.rate ?? 0;
        totals.paint_supplies_cost = parsed.cost ?? 0;
      } else {
        totals.paint_supplies_cost = trailingMoneyCents(line) ?? totals.paint_supplies_cost;
      }
    } else if (/^Miscellaneous/i.test(line)) totals.miscellaneous = trailingMoneyCents(line) ?? totals.miscellaneous;
    else if (/^(?:Other Charges|Other Additional Costs)/i.test(line)) totals.other_charges = trailingMoneyCents(line) ?? totals.other_charges;
    else if (/^Costs Total/i.test(line)) totals.costs_total = trailingMoneyCents(line) ?? totals.costs_total;
    else if (/^Subtotal/i.test(line)) totals.subtotal = trailingMoneyCents(line) ?? totals.subtotal;
    else if (/^Sales Tax/i.test(line)) {
      const parsed = parseTaxTotal(line);
      if (parsed) {
        totals.sales_tax_basis = parsed.basis ?? 0;
        totals.sales_tax_rate = parsed.rate ?? 0;
        totals.sales_tax_cost = parsed.cost ?? 0;
      } else {
        reviewReasons.push('sales_tax_total_unreadable');
      }
    } else if (/^Total Cost of Repairs/i.test(line)) totals.total_cost_of_repairs = trailingMoneyCents(line) ?? totals.total_cost_of_repairs;
    else if (/^Deductible/i.test(line)) totals.deductible = Math.abs(trailingMoneyCents(line) ?? totals.deductible);
    else if (/^Total Adjustments/i.test(line)) totals.total_adjustments = trailingMoneyCents(line) ?? totals.total_adjustments;
    else if (/^Net Cost of Repairs/i.test(line)) totals.net_cost_of_repairs = trailingMoneyCents(line) ?? totals.net_cost_of_repairs;
  }

  totals.revenue = totals.net_cost_of_repairs || totals.total_cost_of_repairs;
  return totals;
}

function reconcileTotals(totals, reviewReasons) {
  const labor = totals.body_labor_cost + totals.paint_labor_cost + totals.mechanical_labor_cost + totals.frame_labor_cost + totals.glass_labor_cost;
  const buckets = totals.parts + labor + totals.paint_supplies_cost + totals.miscellaneous + totals.other_charges + totals.costs_total;
  const expectedSubtotal = buckets;
  if (totals.subtotal && Math.abs(totals.subtotal - expectedSubtotal) > 2) {
    reviewReasons.push('subtotal_does_not_reconcile');
  }

  const expectedGross = totals.subtotal + totals.sales_tax_cost + totals.county_tax_cost + totals.other_tax_1_cost;
  if (totals.total_cost_of_repairs && Math.abs(totals.total_cost_of_repairs - expectedGross) > 2) {
    reviewReasons.push('total_cost_does_not_reconcile');
  }

  const expectedNet = totals.total_cost_of_repairs - totals.deductible + totals.total_adjustments;
  if (totals.net_cost_of_repairs && Math.abs(totals.net_cost_of_repairs - expectedNet) > 2) {
    reviewReasons.push('net_cost_does_not_reconcile');
  }
}

function totalsToDollars(totals) {
  const normalized = { ...totals };
  for (const key of MONEY_FIELDS) {
    normalized[key] = centsToDollars(normalized[key] ?? 0);
  }
  return normalized;
}

function assertDollarsShape(totals) {
  for (const [key, value] of Object.entries(totals)) {
    if (!MONEY_FIELDS.has(key)) continue;
    if (!Number.isFinite(value) || value < 0) throw new Error(`CCC extractor emitted invalid dollar money field: ${key}`);
  }
}

function parseCccEstimate(text) {
  const lines = normalizeLines(text);
  const parsed = emptyParsed();
  parseHeader(lines, parsed);
  parsed.line_items = parseLineItems(lines, parsed.review_reasons);
  parsed.estimate_totals = parseTotals(lines, parsed.review_reasons);
  reconcileTotals(parsed.estimate_totals, parsed.review_reasons);
  parsed.estimate_totals = totalsToDollars(parsed.estimate_totals);

  if (!parsed.line_items.length) parsed.review_reasons.push('ccc_line_items_missing');
  parsed.needs_review = parsed.review_reasons.length > 0;
  assertDollarsShape(parsed.estimate_totals);
  return parsed;
}

module.exports = {
  parseCccEstimate,
};
