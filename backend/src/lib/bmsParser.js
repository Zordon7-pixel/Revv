const { XMLParser } = require('fast-xml-parser');

const ESTIMATE_TOTAL_FIELDS = [
  'parts',
  'body_labor_hours',
  'body_labor_rate',
  'body_labor_cost',
  'paint_labor_hours',
  'paint_labor_rate',
  'paint_labor_cost',
  'paint_supplies_hours',
  'paint_supplies_rate',
  'paint_supplies_cost',
  'miscellaneous',
  'other_charges',
  'subtotal',
  'sales_tax_basis',
  'sales_tax_rate',
  'sales_tax_cost',
  'county_tax_basis',
  'county_tax_rate',
  'county_tax_cost',
  'other_tax_1_basis',
  'other_tax_1_rate',
  'other_tax_1_cost',
  'total_cost_of_repairs',
  'deductible',
  'total_adjustments',
  'net_cost_of_repairs',
];

function stripDoctype(xml) {
  let out = '';
  for (let i = 0; i < xml.length; i++) {
    if (xml.slice(i, i + 9).toUpperCase() !== '<!DOCTYPE') {
      out += xml[i];
      continue;
    }

    let quote = null;
    let bracketDepth = 0;
    for (i += 9; i < xml.length; i++) {
      const ch = xml[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '[') {
        bracketDepth += 1;
      } else if (ch === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (ch === '>' && bracketDepth === 0) {
        break;
      }
    }
  }
  return out;
}

function normalizeKey(key) {
  return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const trimmed = String(value).trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const next = textValue(item);
      if (next !== null) return next;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['#text', 'Text', 'Value', 'DisplayValue', 'Name']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const next = textValue(value[key]);
        if (next !== null) return next;
      }
    }
  }
  return null;
}

function findFirst(node, names) {
  const wanted = new Set(names.map(normalizeKey));
  const stack = [node];

  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      stack.unshift(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key))) {
        const next = textValue(value);
        if (next !== null) return next;
      }
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return null;
}

function findInObject(node, names) {
  if (!node || typeof node !== 'object') return null;
  const wanted = new Set(names.map(normalizeKey));
  for (const [key, value] of Object.entries(node)) {
    if (wanted.has(normalizeKey(key))) return textValue(value);
  }
  return null;
}

function findObjectByKey(root, names) {
  const wanted = new Set(names.map(normalizeKey));
  const stack = [root];

  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      stack.unshift(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key)) && value && typeof value === 'object') return value;
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/[$,%]/g, '').replace(/,/g, '').trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function toNumber(value, fallback) {
  const num = toNumberOrNull(value);
  return num === null ? fallback : num;
}

function normalizeItemType(type) {
  const next = String(type || '').trim().toLowerCase();
  if (/sublet|subcontract|outside/.test(next)) return 'sublet';
  if (/part|material|repl|replace|r\s*&\s*r|r\/r/.test(next)) return 'parts';
  if (/labor|labour|body|paint|refinish|rpr|repair|rni|r\s*&\s*i|r\/i/.test(next)) return 'labor';
  return 'other';
}

function classifyByOperationCodes(description, currentType) {
  const text = String(description || '').toLowerCase();

  // Replace codes mean a part needs to be replaced/ordered.
  const hasReplaceCode = /\b(repl|replace|r\s*&\s*r|r\/r|r\s+and\s+r|remove\s*(?:and|&|\/)?\s*replace)\b/.test(text);
  if (hasReplaceCode) return 'parts';

  // RNI / R&I / remove-install are labor operations.
  const hasRemoveInstallCode = /\b(rni|r\s*&\s*i|r\/i|r\s+and\s+i|remove\s*(?:and|&|\/)?\s*install)\b/.test(text);
  if (hasRemoveInstallCode) return 'labor';

  // RPR / repair indicates labor repair operation.
  const hasRepairCode = /\b(rpr|repair)\b/.test(text);
  if (hasRepairCode) return 'labor';

  return currentType;
}

function operationType(operationCode, lineType, description) {
  const code = String(operationCode || '').trim();
  const fromCode = normalizeItemType(code);
  const base = fromCode === 'other' ? normalizeItemType(lineType) : fromCode;
  return classifyByOperationCodes([code, description].filter(Boolean).join(' '), base);
}

function collectLineItems(root) {
  const lines = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      stack.unshift(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      const normalized = normalizeKey(key);
      if (
        ['lineitem', 'estimateitem', 'repairline', 'damageline', 'estimateLine'].map(normalizeKey).includes(normalized)
      ) {
        for (const item of asArray(value)) {
          if (item && typeof item === 'object') lines.push(item);
        }
      } else if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return lines;
}

function parseLineItem(item) {
  const operationCode = findInObject(item, ['OperationCode', 'Operation', 'OperationType', 'OpCode']);
  const lineType = findInObject(item, ['LineType', 'ItemType', 'Category', 'Type']);
  const description = findInObject(item, [
    'Description',
    'LineDescription',
    'PartDescription',
    'LaborDescription',
    'OperationDescription',
  ]) || '';
  const laborUnits = toNumberOrNull(findInObject(item, ['LaborUnits', 'LaborHours', 'LaborTime', 'Hours', 'Units']));
  const partType = findInObject(item, ['PartType', 'PartSource', 'PartKind', 'OEMPartType']);
  const partNumber = findInObject(item, ['PartNumber', 'OEMPartNumber', 'PartNo', 'StockNumber']);
  const quantity = toNumber(findInObject(item, ['Quantity', 'Qty']), laborUnits || 1);
  const unitPrice = toNumber(findInObject(item, ['UnitPrice', 'Price', 'Rate', 'Amount', 'ExtendedPrice']), 0);

  return {
    description: String(description || '').trim(),
    type: operationType(operationCode, lineType, description),
    quantity,
    unit_price: unitPrice,
    operation_code: operationCode || null,
    labor_units: laborUnits,
    part_type: partType || null,
    part_number: partNumber || null,
  };
}

function parseEstimateTotals(root) {
  const totalsNode = findObjectByKey(root, ['EstimateTotals', 'Totals', 'EstimateTotal']);
  const source = totalsNode || root;
  const totals = {};

  for (const field of ESTIMATE_TOTAL_FIELDS) {
    totals[field] = toNumberOrNull(findFirst(source, [
      field,
      field.replace(/_/g, ''),
      field.replace(/(^|_)([a-z])/g, (_m, _sep, char) => char.toUpperCase()),
    ]));
  }

  return Object.values(totals).some((value) => value !== null) ? totals : null;
}

function parseBms(xmlBuffer) {
  const xml = stripDoctype(Buffer.isBuffer(xmlBuffer) ? xmlBuffer.toString('utf8') : String(xmlBuffer || ''));
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
    htmlEntities: false,
  });
  const doc = parser.parse(xml);

  const vehicleYear = findFirst(doc, ['VehicleYear', 'ModelYear', 'Year']);
  const vehicleMake = findFirst(doc, ['VehicleMake', 'Make']);
  const vehicleModel = findFirst(doc, ['VehicleModel', 'Model']);
  const vehicle = findFirst(doc, ['Vehicle'])
    || [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ').trim()
    || null;

  return {
    insurance_company: findFirst(doc, ['InsuranceCompany', 'InsuranceCompanyName', 'InsurerName', 'CarrierName']),
    claim_number: findFirst(doc, ['ClaimNumber', 'ClaimNo']),
    adjuster_name: findFirst(doc, ['AdjusterName', 'AppraiserName']),
    adjuster_phone: findFirst(doc, ['AdjusterPhone', 'AppraiserPhone']),
    adjuster_email: findFirst(doc, ['AdjusterEmail', 'AppraiserEmail']),
    customer_name: findFirst(doc, ['CustomerName', 'OwnerName', 'ClaimantName']),
    customer_phone: findFirst(doc, ['CustomerPhone', 'OwnerPhone', 'ClaimantPhone']),
    vehicle,
    vin: findFirst(doc, ['VIN', 'Vin', 'VehicleIdentificationNumber']),
    vehicle_year: vehicleYear,
    vehicle_make: vehicleMake,
    vehicle_model: vehicleModel,
    total_allowed: toNumberOrNull(findFirst(doc, ['TotalAllowed', 'NetCostOfRepairs', 'TotalCostOfRepairs'])),
    estimate_totals: parseEstimateTotals(doc),
    line_items: collectLineItems(doc).map(parseLineItem),
  };
}

module.exports = { parseBms };
