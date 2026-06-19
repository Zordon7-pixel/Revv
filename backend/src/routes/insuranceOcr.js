const router = require('express').Router();
const multer = require('multer');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const pdfParse = require('pdf-parse');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const auth = require('../middleware/auth');
const { dbGet } = require('../db');
const { notifyOps } = require('../services/notifyOps');

const MAX_ESTIMATE_UPLOAD_FILES = 12;
const allowedEstimateMimeTypes = new Set(['application/pdf']);
function isAllowedEstimateFile(file) {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  const filename = String(file?.originalname || '').toLowerCase();
  return mimeType.startsWith('image/') || allowedEstimateMimeTypes.has(mimeType) || filename.endsWith('.pdf');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_ESTIMATE_UPLOAD_FILES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedEstimateFile(file)) return cb(null, true);
    return cb(new Error('Unsupported estimate file type. Upload a PDF or image.'));
  },
});
function insuranceOcrLimiterKeyGenerator(req) {
  return req.user?.shop_id && req.user?.id
    ? `${req.user.shop_id}:${req.user.id}`
    : ipKeyGenerator(req.ip || 'unknown');
}

const insuranceOcrLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: insuranceOcrLimiterKeyGenerator,
  message: { error: 'Too many requests. Try again in 10 minutes.' },
});
const execFileAsync = promisify(execFile);
const PDF_TEXT_CHAR_LIMIT = 120000;
const PDF_IMAGE_PAGE_LIMIT = 12;
const AI_CONFIG_ERROR = 'AI estimate extraction is not configured correctly. Please contact support.';
const ANTHROPIC_ESTIMATE_MODEL = process.env.ANTHROPIC_ESTIMATE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are an insurance estimate parser for auto body shops. Extract all line items from this insurance estimate document.
Return ONLY valid JSON in this exact format:
{
  "insurance_company": "string or null",
  "claim_number": "string or null",
  "adjuster_name": "string or null",
  "adjuster_phone": "string or null",
  "adjuster_email": "string or null",
  "customer_name": "string or null",
  "customer_phone": "string or null",
  "vehicle": "string or null",
  "vin": "string or null",
  "vehicle_year": "string or null",
  "vehicle_make": "string or null",
  "vehicle_model": "string or null",
  "estimate_totals": {
    "parts": 0,
    "body_labor_hours": 0,
    "body_labor_rate": 0,
    "body_labor_cost": 0,
    "paint_labor_hours": 0,
    "paint_labor_rate": 0,
    "paint_labor_cost": 0,
    "mechanical_labor_hours": 0,
    "mechanical_labor_rate": 0,
    "mechanical_labor_cost": 0,
    "frame_labor_hours": 0,
    "frame_labor_rate": 0,
    "frame_labor_cost": 0,
    "glass_labor_hours": 0,
    "glass_labor_rate": 0,
    "glass_labor_cost": 0,
    "paint_supplies_hours": 0,
    "paint_supplies_rate": 0,
    "paint_supplies_cost": 0,
    "miscellaneous": 0,
    "other_charges": 0,
    "costs_total": 0,
    "subtotal": 0,
    "sales_tax_basis": 0,
    "sales_tax_rate": 0,
    "sales_tax_cost": 0,
    "county_tax_basis": 0,
    "county_tax_rate": 0,
    "county_tax_cost": 0,
    "other_tax_1_basis": 0,
    "other_tax_1_rate": 0,
    "other_tax_1_cost": 0,
    "total_cost_of_repairs": 0,
    "deductible": 0,
    "total_adjustments": 0,
    "net_cost_of_repairs": 0,
    "revenue": 0
  },
  "line_items": [
    {
      "type": "labor|parts|sublet|other",
      "description": "string",
      "quantity": 1,
      "unit_price": 0.00
    }
  ],
  "total_allowed": null
}
Classify each item: labor operations = "labor", parts/materials = "parts", sublet work = "sublet", everything else = "other".
Estimate totals rules:
- Map "Gross Total" to total_cost_of_repairs.
- Map "Net Estimate Total", "Net Cost of Repairs", or "Total Customer Responsibility" to net_cost_of_repairs.
- Return deductible as a positive dollar amount, even when the estimate prints it as a negative adjustment.
- Body Labor, Refinish Labor/Paint Labor, Glass Labor, Frame Labor, and Mechanical Labor are all labor. Do not classify paint/material/cost totals as labor.
- Paint Materials, Shop Materials, and Other Additional Costs belong in paint_supplies_cost/miscellaneous/other_charges or costs_total, not labor.
- Do not duplicate the Estimate Totals summary rows as line_items when detailed numbered rows are readable.
Important operation code mapping:
- RNI / R&I / Remove and Install = labor operation (do NOT treat as parts replacement)
- RPR = labor repair operation (do NOT treat as parts replacement)
- REPL / R&R / Replace = parts replacement (order/replace part)
Include all numbered estimate rows (exclude section headers) and include the estimate totals block.
Return only the JSON object, no markdown fences, no extra text.`;

const RELAXED_LINE_ITEM_PROMPT = `${SYSTEM_PROMPT}

Second-pass instructions:
- The first extraction returned zero line items. Re-read the document more aggressively.
- Extract any visible estimate row, even if the photo is angled, partially blurry, or columns are imperfect.
- Do not require perfect confidence. If the description is partially visible, preserve the visible words.
- If a row has hours and rate, set quantity to hours and unit_price to rate.
- If a row has only a line total, set quantity to 1 and unit_price to the line total.
- Include summary/totals-derived rows when the detailed table is unreadable, using descriptions like "Estimate totals - parts" or "Estimate totals - body labor".
- Return ONLY valid JSON with the same schema.`;

function normalizeItemType(type) {
  const next = String(type || '').trim().toLowerCase();
  return ['labor', 'parts', 'sublet', 'other'].includes(next) ? next : 'other';
}

function isAiProviderConfigError(err) {
  const status = Number(err?.status || err?.response?.status || err?.code);
  const code = String(err?.code || err?.error?.code || err?.type || '').toLowerCase();
  const message = String(err?.message || '').toLowerCase();
  return (
    status === 401 ||
    code.includes('invalid_api_key') ||
    message.includes('incorrect api key') ||
    message.includes('invalid api key') ||
    /platform\.[a-z]+\.com\/account\/api-keys/i.test(message)
  );
}

function safeInsuranceOcrError(err) {
  if (isAiProviderConfigError(err)) return AI_CONFIG_ERROR;
  const message = String(err?.message || '').trim();
  if (!message) return 'Could not parse estimate file. Try again or upload a clearer file.';
  if (/sk-(?:proj-)?[A-Za-z0-9_-]+/.test(message) || /openai|api key|platform\.[a-z]+\.com/i.test(message)) {
    return AI_CONFIG_ERROR;
  }
  return message.replace(/sk-(?:proj-)?[A-Za-z0-9_-]+/g, '[redacted]');
}

function logInsuranceOcrError(err) {
  console.error('[InsuranceOCR] Error:', {
    status: err?.status || err?.response?.status || null,
    code: err?.code || err?.error?.code || null,
    type: err?.type || err?.error?.type || null,
    request_id: err?.request_id || err?.headers?.['x-request-id'] || null,
  });
}

function classifyAiProviderError(err) {
  const status = Number(err?.status || err?.response?.status || err?.code);
  if (status === 401 || status === 403) return 'invalid_api_key';
  if (status === 429) return 'rate_limit_exceeded';
  if (status >= 500 && status <= 599) return 'provider_5xx';
  return null;
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

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/[$,]/g, '').trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function parseEstimateTotalsFromPdfText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const startIdx = lines.findIndex((line) => /ESTIMATE\s+TOTALS/i.test(line));
  if (startIdx < 0) return null;

  const endIdx = lines.findIndex((line, idx) => idx > startIdx && /This is not an authorization to repair\./i.test(line));
  const totalLines = lines
    .slice(startIdx, endIdx > startIdx ? endIdx : startIdx + 80)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const takeTrailingMoney = (line) => {
    const m = line.match(/(-?\$?\s*[0-9,]+\.[0-9]{2})\s*$/);
    return m ? toNumberOrNull(m[1]) : null;
  };

  const startsWithValueLabel = (label) => new RegExp(`^${label}\\s*(?=[-$0-9])`, 'i');

  const parseHourRateLine = (labelRegex) => {
    const line = totalLines.find((row) => labelRegex.test(row));
    if (!line) return { hours: null, rate: null, cost: null };
    const m = line.match(/([0-9]+(?:\.[0-9]+)?)\s*hrs\s*@\s*\$?\s*([0-9,]+(?:\.[0-9]+)?)\s*\/\s*hr\s*(-?\$?\s*[0-9,]+\.[0-9]{2})/i)
      || line.match(/[A-Za-z ]+\s+([0-9]+(?:\.[0-9]+)?)\s+\$?\s*([0-9,]+(?:\.[0-9]+)?)\s+\$?\s*([0-9,]+\.[0-9]{2})\s*$/i);
    if (!m) return { hours: null, rate: null, cost: takeTrailingMoney(line) };
    return {
      hours: toNumberOrNull(m[1]),
      rate: toNumberOrNull(m[2]),
      cost: toNumberOrNull(m[3]),
    };
  };

  const parseTaxLine = (labelRegex) => {
    const line = totalLines.find((row) => labelRegex.test(row));
    if (!line) return { basis: null, rate: null, cost: null };
    const m = line.match(/\$?\s*([0-9,]+(?:\.[0-9]+)?)\s*@\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*(-?\$?\s*[0-9,]+\.[0-9]{2})/i);
    if (!m) return { basis: null, rate: null, cost: takeTrailingMoney(line) };
    return {
      basis: toNumberOrNull(m[1]),
      rate: toNumberOrNull(m[2]),
      cost: toNumberOrNull(m[3]),
    };
  };

  const bodyLabor = parseHourRateLine(startsWithValueLabel('Body Labor'));
  const paintLabor = parseHourRateLine(/^(?:Paint|Refinish)\s+Labor\s*(?=[-$0-9])/i);
  const frameLabor = parseHourRateLine(startsWithValueLabel('Frame Labor'));
  const glassLabor = parseHourRateLine(startsWithValueLabel('Glass Labor'));
  const mechanicalLabor = parseHourRateLine(startsWithValueLabel('Mechanical Labor'));
  const paintSupplies = parseHourRateLine(startsWithValueLabel('Paint Supplies'));
  const salesTax = parseTaxLine(startsWithValueLabel('Sales Tax'));
  const countyTax = parseTaxLine(startsWithValueLabel('County Tax'));
  const otherTax1 = parseTaxLine(startsWithValueLabel('Other Tax 1'));

  const byLabelMoney = (labelRegex) => {
    const line = totalLines.find((row) => labelRegex.test(row));
    return line ? takeTrailingMoney(line) : null;
  };

  const totals = {
    parts: byLabelMoney(/^(?:Parts|Taxable Parts)\s*(?=[-$0-9])/i),
    body_labor_hours: bodyLabor.hours,
    body_labor_rate: bodyLabor.rate,
    body_labor_cost: bodyLabor.cost,
    paint_labor_hours: paintLabor.hours,
    paint_labor_rate: paintLabor.rate,
    paint_labor_cost: paintLabor.cost,
    mechanical_labor_hours: mechanicalLabor.hours,
    mechanical_labor_rate: mechanicalLabor.rate,
    mechanical_labor_cost: mechanicalLabor.cost,
    frame_labor_hours: frameLabor.hours,
    frame_labor_rate: frameLabor.rate,
    frame_labor_cost: frameLabor.cost,
    glass_labor_hours: glassLabor.hours,
    glass_labor_rate: glassLabor.rate,
    glass_labor_cost: glassLabor.cost,
    paint_supplies_hours: paintSupplies.hours,
    paint_supplies_rate: paintSupplies.rate,
    paint_supplies_cost: paintSupplies.cost ?? byLabelMoney(/^(?:Paint Materials|Paint Supplies)\s*(?=[-$0-9])/i),
    miscellaneous: byLabelMoney(startsWithValueLabel('Miscellaneous')),
    other_charges: byLabelMoney(/^(?:Other Charges|Other Additional Costs)\s*(?=[-$0-9])/i),
    costs_total: byLabelMoney(startsWithValueLabel('Costs Total')),
    subtotal: byLabelMoney(startsWithValueLabel('Subtotal')),
    sales_tax_basis: salesTax.basis,
    sales_tax_rate: salesTax.rate,
    sales_tax_cost: salesTax.cost,
    county_tax_basis: countyTax.basis,
    county_tax_rate: countyTax.rate,
    county_tax_cost: countyTax.cost,
    other_tax_1_basis: otherTax1.basis,
    other_tax_1_rate: otherTax1.rate,
    other_tax_1_cost: otherTax1.cost,
    total_cost_of_repairs: byLabelMoney(/^(?:Total Cost of Repairs|Gross Total)\s*(?=[-$0-9])/i),
    deductible: byLabelMoney(startsWithValueLabel('Deductible')),
    total_adjustments: byLabelMoney(startsWithValueLabel('Total Adjustments')),
    net_cost_of_repairs: byLabelMoney(/^(?:Net Cost of Repairs|Net Estimate Total|Total Customer Responsibility)\s*(?=[-$0-9])/i),
  };
  if (totals.deductible !== null) totals.deductible = Math.abs(totals.deductible);
  totals.revenue = totals.net_cost_of_repairs ?? totals.total_cost_of_repairs;

  const hasAnyValue = Object.values(totals).some((value) => value !== null);
  return hasAnyValue ? totals : null;
}

function normalizeEstimateTotals(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fields = [
    'parts',
    'body_labor_hours',
    'body_labor_rate',
    'body_labor_cost',
    'paint_labor_hours',
    'paint_labor_rate',
    'paint_labor_cost',
    'mechanical_labor_hours',
    'mechanical_labor_rate',
    'mechanical_labor_cost',
    'frame_labor_hours',
    'frame_labor_rate',
    'frame_labor_cost',
    'glass_labor_hours',
    'glass_labor_rate',
    'glass_labor_cost',
    'paint_supplies_hours',
    'paint_supplies_rate',
    'paint_supplies_cost',
    'miscellaneous',
    'other_charges',
    'costs_total',
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
    'revenue',
  ];

  const normalized = {};
  for (const key of fields) {
    normalized[key] = toNumberOrNull(raw[key]);
  }
  normalized.total_cost_of_repairs = normalized.total_cost_of_repairs
    ?? toNumberOrNull(raw.gross_total)
    ?? toNumberOrNull(raw.estimate_gross_total);
  normalized.net_cost_of_repairs = normalized.net_cost_of_repairs
    ?? toNumberOrNull(raw.net_estimate_total)
    ?? toNumberOrNull(raw.total_customer_responsibility);
  if (normalized.deductible !== null) normalized.deductible = Math.abs(normalized.deductible);
  if (normalized.deductible === null && normalized.total_cost_of_repairs !== null && normalized.net_cost_of_repairs !== null) {
    const implied = normalized.total_cost_of_repairs - normalized.net_cost_of_repairs;
    if (implied > 0) normalized.deductible = Number(implied.toFixed(2));
  }
  normalized.revenue = normalized.revenue ?? normalized.net_cost_of_repairs ?? normalized.total_cost_of_repairs;
  const hasAny = Object.values(normalized).some((value) => value !== null);
  return hasAny ? normalized : null;
}

function isOpenAiJsonBodyParseError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('could not parse the json body');
}

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function getAnthropicText(response) {
  return (response?.content || [])
    .filter((part) => part?.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function isAnthropicProviderConfigError(err) {
  const status = Number(err?.status || err?.response?.status || err?.code);
  const type = String(err?.error?.type || err?.type || err?.code || '').toLowerCase();
  const message = String(err?.message || err?.error?.message || '').toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    type.includes('authentication') ||
    type.includes('permission') ||
    message.includes('api key') ||
    message.includes('x-api-key')
  );
}

function toAnthropicImageSource(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return {
    type: 'base64',
    media_type: match[1],
    data: match[2],
  };
}

function mediaTypeForUpload(mimeType, filename = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.startsWith('image/')) return normalized;
  const lowerName = String(filename || '').toLowerCase();
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function collectEstimateUploadFiles(req) {
  if (req.file) return [req.file];
  if (!req.files) return [];
  if (Array.isArray(req.files)) return req.files.slice(0, MAX_ESTIMATE_UPLOAD_FILES);
  return [
    ...(Array.isArray(req.files.estimate_image) ? req.files.estimate_image : []),
    ...(Array.isArray(req.files.estimate_images) ? req.files.estimate_images : []),
  ].slice(0, MAX_ESTIMATE_UPLOAD_FILES);
}

function uploadFileToDataUrl(file) {
  const mediaType = mediaTypeForUpload(file?.mimetype, file?.originalname);
  return `data:${mediaType};base64,${file.buffer.toString('base64')}`;
}

function parseModelJson(raw) {
  let cleaned = String(raw || '').replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('no JSON object found');
  }
}

function normalizeLineItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      const description = String(item?.description || '').trim();
      return {
        description,
        type: classifyByOperationCodes(description, normalizeItemType(item?.type)),
        quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : 1,
        unit_price: Number.isFinite(Number(item?.unit_price)) ? Number(item.unit_price) : 0,
      };
    })
    .filter((item) => item.description);
}

function addTotalsLine(items, description, type, quantity, rate, fallbackTotal) {
  const qty = toNumberOrNull(quantity);
  const unit = toNumberOrNull(rate);
  const total = toNumberOrNull(fallbackTotal);
  if (qty !== null && unit !== null && qty > 0 && unit > 0) {
    items.push({ description, type, quantity: qty, unit_price: unit });
    return;
  }
  if (total !== null && total > 0) {
    items.push({ description, type, quantity: 1, unit_price: total });
  }
}

function buildLineItemsFromTotals(totals) {
  if (!totals) return [];
  const items = [];
  addTotalsLine(items, 'Estimate totals - parts', 'parts', 1, totals.parts, totals.parts);
  addTotalsLine(items, 'Estimate totals - body labor', 'labor', totals.body_labor_hours, totals.body_labor_rate, totals.body_labor_cost);
  addTotalsLine(items, 'Estimate totals - paint labor', 'labor', totals.paint_labor_hours, totals.paint_labor_rate, totals.paint_labor_cost);
  addTotalsLine(items, 'Estimate totals - mechanical labor', 'labor', totals.mechanical_labor_hours, totals.mechanical_labor_rate, totals.mechanical_labor_cost);
  addTotalsLine(items, 'Estimate totals - frame labor', 'labor', totals.frame_labor_hours, totals.frame_labor_rate, totals.frame_labor_cost);
  addTotalsLine(items, 'Estimate totals - glass labor', 'labor', totals.glass_labor_hours, totals.glass_labor_rate, totals.glass_labor_cost);
  addTotalsLine(items, 'Estimate totals - paint supplies', 'other', totals.paint_supplies_hours, totals.paint_supplies_rate, totals.paint_supplies_cost);
  addTotalsLine(items, 'Estimate totals - miscellaneous', 'other', 1, totals.miscellaneous, totals.miscellaneous);
  addTotalsLine(items, 'Estimate totals - other charges', 'other', 1, totals.other_charges, totals.other_charges);
  return items;
}

function sanitizeTextForOpenAI(input, { aggressive = false } = {}) {
  const str = String(input || '');
  const out = [];

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);

    // Preserve valid surrogate pairs, drop orphan surrogates.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out.push(str[i], str[i + 1]);
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;

    // Remove unsafe control characters.
    if (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      out.push(' ');
      continue;
    }

    out.push(str[i]);
  }

  let cleaned = out.join('').replace(/\u0000/g, '').trim();
  if (aggressive) {
    cleaned = cleaned.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ');
  }
  return cleaned;
}

async function parseEstimateTextWithOpenAI(openai, extractedText, prompt = SYSTEM_PROMPT) {
  const callParser = async (cleanedText) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nEstimate document text:\n${cleanedText.slice(0, PDF_TEXT_CHAR_LIMIT)}`,
        },
      ],
    });
    return response.choices?.[0]?.message?.content || '';
  };

  const cleaned = sanitizeTextForOpenAI(extractedText);
  if (!cleaned) return '';

  try {
    return await callParser(cleaned);
  } catch (err) {
    if (!isOpenAiJsonBodyParseError(err)) throw err;
    // Some PDFs contain invalid Unicode bytes that can break strict JSON parsing.
    const aggressive = sanitizeTextForOpenAI(extractedText, { aggressive: true });
    if (!aggressive) throw err;
    return callParser(aggressive);
  }
}

async function parseEstimateTextWithAnthropic(extractedText, prompt = SYSTEM_PROMPT) {
  const client = getAnthropicClient();
  if (!client) return '';

  const cleaned = sanitizeTextForOpenAI(extractedText);
  if (!cleaned) return '';

  const response = await client.messages.create({
    model: ANTHROPIC_ESTIMATE_MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `${prompt}\n\nEstimate document text:\n${cleaned.slice(0, PDF_TEXT_CHAR_LIMIT)}`,
    }],
  });
  return getAnthropicText(response);
}

async function parseEstimateImagesWithAnthropic(imageDataUrls, prompt = SYSTEM_PROMPT) {
  const client = getAnthropicClient();
  if (!client) return '';

  const imageBlocks = imageDataUrls
    .map(toAnthropicImageSource)
    .filter(Boolean)
    .map((source) => ({ type: 'image', source }));

  if (!imageBlocks.length) return '';

  const response = await client.messages.create({
    model: ANTHROPIC_ESTIMATE_MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        ...imageBlocks,
        { type: 'text', text: prompt },
      ],
    }],
  });
  return getAnthropicText(response);
}

async function parseEstimateUploadImageWithAnthropic(file, mimeType, prompt = SYSTEM_PROMPT) {
  const mediaType = mediaTypeForUpload(mimeType, file?.originalname);
  const dataUrl = `data:${mediaType};base64,${file.buffer.toString('base64')}`;
  return parseEstimateImagesWithAnthropic([dataUrl], prompt);
}

async function parseEstimateTextWithFallback(openai, extractedText, prompt = SYSTEM_PROMPT) {
  if (!openai) return parseEstimateTextWithAnthropic(extractedText, prompt);
  try {
    return await parseEstimateTextWithOpenAI(openai, extractedText, prompt);
  } catch (err) {
    if (!isAiProviderConfigError(err)) throw err;
    console.warn('[InsuranceOCR] OpenAI estimate text parse unavailable; falling back to Anthropic.');
    try {
      return await parseEstimateTextWithAnthropic(extractedText, prompt);
    } catch (fallbackErr) {
      if (isAnthropicProviderConfigError(fallbackErr)) throw err;
      throw fallbackErr;
    }
  }
}

async function parseEstimateImageUrlsWithOpenAI(openai, imageDataUrls, prompt = SYSTEM_PROMPT) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
        ],
      },
    ],
  });
  return response.choices?.[0]?.message?.content || '';
}

async function parseEstimateImageUrlsWithFallback(openai, imageDataUrls, prompt = SYSTEM_PROMPT) {
  if (!openai) return parseEstimateImagesWithAnthropic(imageDataUrls, prompt);
  try {
    return await parseEstimateImageUrlsWithOpenAI(openai, imageDataUrls, prompt);
  } catch (err) {
    if (!isAiProviderConfigError(err)) throw err;
    console.warn('[InsuranceOCR] OpenAI estimate image parse unavailable; falling back to Anthropic.');
    try {
      return await parseEstimateImagesWithAnthropic(imageDataUrls, prompt);
    } catch (fallbackErr) {
      if (isAnthropicProviderConfigError(fallbackErr)) throw err;
      throw fallbackErr;
    }
  }
}

async function parseEstimateUploadImageWithOpenAI(openai, file, mimeType, prompt = SYSTEM_PROMPT) {
  const base64 = file.buffer.toString('base64');
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' },
          },
        ],
      },
    ],
  });
  return response.choices?.[0]?.message?.content || '';
}

async function parseEstimateUploadImageWithFallback(openai, file, mimeType, prompt = SYSTEM_PROMPT) {
  if (!openai) return parseEstimateUploadImageWithAnthropic(file, mimeType, prompt);
  try {
    return await parseEstimateUploadImageWithOpenAI(openai, file, mimeType, prompt);
  } catch (err) {
    if (!isAiProviderConfigError(err)) throw err;
    console.warn('[InsuranceOCR] OpenAI estimate upload image parse unavailable; falling back to Anthropic.');
    try {
      return await parseEstimateUploadImageWithAnthropic(file, mimeType, prompt);
    } catch (fallbackErr) {
      if (isAnthropicProviderConfigError(fallbackErr)) throw err;
      throw fallbackErr;
    }
  }
}

async function extractPdfText(buffer) {
  // Primary parser for hosted environments (Railway) where poppler binaries
  // may not be present.
  try {
    const parsed = await pdfParse(buffer);
    const text = String(parsed?.text || '').replace(/\u0000/g, '').trim();
    if (text) return text;
  } catch (err) {
    console.warn('[InsuranceOCR] pdf-parse failed, falling back to pdftotext:', err?.message || err);
  }

  const tmpPath = path.join(os.tmpdir(), `revv-estimate-${crypto.randomBytes(8).toString('hex')}.pdf`);
  try {
    await fs.writeFile(tmpPath, buffer);
    const { stdout } = await execFileAsync(process.env.PDFTOTEXT_BIN || 'pdftotext', [
      '-layout',
      '-nopgbrk',
      '-enc',
      'UTF-8',
      tmpPath,
      '-',
    ], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return String(stdout || '').replace(/\u0000/g, '').trim();
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

async function extractPdfPageImages(buffer, maxPages = PDF_IMAGE_PAGE_LIMIT) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'revv-estimate-'));
  const pdfPath = path.join(tmpDir, 'input.pdf');
  const prefix = path.join(tmpDir, 'page');
  try {
    await fs.writeFile(pdfPath, buffer);
    await execFileAsync(process.env.PDFTOPPM_BIN || 'pdftoppm', [
      '-png',
      '-f',
      '1',
      '-l',
      String(maxPages),
      pdfPath,
      prefix,
    ], {
      maxBuffer: 16 * 1024 * 1024,
    });

    const names = (await fs.readdir(tmpDir))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => {
        const aNum = Number((a.match(/-(\d+)\.png$/i) || [])[1] || 0);
        const bNum = Number((b.match(/-(\d+)\.png$/i) || [])[1] || 0);
        return aNum - bNum;
      })
      .slice(0, maxPages);

    const images = [];
    for (const name of names) {
      const img = await fs.readFile(path.join(tmpDir, name));
      images.push(`data:image/png;base64,${img.toString('base64')}`);
    }
    return images;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Phase 1: OCR parse ───────────────────────────────────────────────────────
router.post('/parse', auth, insuranceOcrLimiter, upload.fields([
  { name: 'estimate_image', maxCount: MAX_ESTIMATE_UPLOAD_FILES },
  { name: 'estimate_images', maxCount: MAX_ESTIMATE_UPLOAD_FILES },
]), async (req, res) => {
  try {
    const files = collectEstimateUploadFiles(req);
    if (!files.length) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Use field name: estimate_image' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ success: false, error: AI_CONFIG_ERROR });
    }

    const openai = apiKey ? new OpenAI({ apiKey }) : null;
    let raw = '';
    let extractedTextForTotals = '';
    let retryWithRelaxedPrompt = null;
    const imageDataUrls = [];
    const pdfTextParts = [];

    for (const file of files) {
      const mimeType = file.mimetype || 'application/octet-stream';
      const filename = String(file.originalname || '').toLowerCase();
      const isPdf = mimeType === 'application/pdf' || filename.endsWith('.pdf');
      if (!isPdf) {
        imageDataUrls.push(uploadFileToDataUrl(file));
        continue;
      }

      let extractedText = '';
      try {
        extractedText = await extractPdfText(file.buffer);
      } catch (pdfErr) {
        console.error('[InsuranceOCR] PDF text extraction failed:', pdfErr);
      }

      if (extractedText) {
        pdfTextParts.push(extractedText);
        continue;
      }

      try {
        imageDataUrls.push(...await extractPdfPageImages(file.buffer, PDF_IMAGE_PAGE_LIMIT));
      } catch (imgErr) {
        console.error('[InsuranceOCR] PDF image conversion failed:', imgErr);
      }
    }

    extractedTextForTotals = pdfTextParts.join('\n\n');

    if (imageDataUrls.length) {
      retryWithRelaxedPrompt = () => parseEstimateImageUrlsWithFallback(openai, imageDataUrls, RELAXED_LINE_ITEM_PROMPT);
      raw = await parseEstimateImageUrlsWithFallback(openai, imageDataUrls);
    } else if (extractedTextForTotals) {
      retryWithRelaxedPrompt = () => parseEstimateTextWithFallback(openai, extractedTextForTotals, RELAXED_LINE_ITEM_PROMPT);
      try {
        raw = await parseEstimateTextWithFallback(openai, extractedTextForTotals);
      } catch (parseErr) {
        if (isOpenAiJsonBodyParseError(parseErr)) {
          console.warn('[InsuranceOCR] OpenAI rejected PDF-text payload; falling back to PDF image OCR.');
        } else {
          throw parseErr;
        }
      }

      if (!raw) {
        for (const file of files) {
          const mimeType = file.mimetype || 'application/octet-stream';
          const filename = String(file.originalname || '').toLowerCase();
          const isPdf = mimeType === 'application/pdf' || filename.endsWith('.pdf');
          if (!isPdf) continue;
          try {
            imageDataUrls.push(...await extractPdfPageImages(file.buffer, PDF_IMAGE_PAGE_LIMIT));
          } catch (imgErr) {
            console.error('[InsuranceOCR] PDF image conversion failed:', imgErr);
          }
        }

        if (!imageDataUrls.length) {
          return res.status(422).json({
            success: false,
            error: 'Could not read pages from this PDF. Please upload a clearer PDF or a photo/screenshot.',
          });
        }

        retryWithRelaxedPrompt = () => parseEstimateImageUrlsWithFallback(openai, imageDataUrls, RELAXED_LINE_ITEM_PROMPT);
        raw = await parseEstimateImageUrlsWithFallback(openai, imageDataUrls);
      }
    } else {
      return res.status(422).json({
        success: false,
        error: 'Could not read estimate pages. Please upload a clearer PDF or photo.',
      });
    }

    let parsed;
    try {
      parsed = parseModelJson(raw);
    } catch {
      console.error('[InsuranceOCR] Failed to parse OpenAI response. raw length:', raw?.length, '| preview:', raw?.slice(0, 300));
      return res.status(422).json({ success: false, error: 'Could not extract estimate data from file. Try a clearer upload.' });
    }

    let items = normalizeLineItems(parsed.line_items);
    let modelTotals = normalizeEstimateTotals(parsed.estimate_totals);
    const textTotals = extractedTextForTotals ? parseEstimateTotalsFromPdfText(extractedTextForTotals) : null;
    let estimateTotals = textTotals || modelTotals || null;

    if (!items.length && retryWithRelaxedPrompt) {
      try {
        console.warn('[InsuranceOCR] No line items extracted; retrying with relaxed line-item prompt.');
        const retryRaw = await retryWithRelaxedPrompt();
        const retryParsed = parseModelJson(retryRaw);
        const retryItems = normalizeLineItems(retryParsed.line_items);
        if (retryItems.length) {
          parsed = { ...parsed, ...retryParsed };
          items = retryItems;
        }
        modelTotals = normalizeEstimateTotals(retryParsed.estimate_totals) || modelTotals;
        estimateTotals = textTotals || modelTotals || estimateTotals;
      } catch (retryErr) {
        console.warn('[InsuranceOCR] Relaxed line-item retry failed:', retryErr?.message || retryErr);
      }
    }

    if (!items.length && estimateTotals) {
      items = buildLineItemsFromTotals(estimateTotals);
      if (items.length) {
        console.warn('[InsuranceOCR] Built estimate line items from totals because detailed rows were unreadable.');
      }
    }

    return res.json({
      success: true,
      parsed: {
        insurance_company: parsed.insurance_company || null,
        claim_number: parsed.claim_number || null,
        adjuster_name: parsed.adjuster_name || null,
        adjuster_phone: parsed.adjuster_phone || null,
        adjuster_email: parsed.adjuster_email || null,
        customer_name: parsed.customer_name || null,
        customer_phone: parsed.customer_phone || null,
        vehicle: parsed.vehicle || null,
        vin: parsed.vin || null,
        vehicle_year: parsed.vehicle_year || null,
        vehicle_make: parsed.vehicle_make || null,
        vehicle_model: parsed.vehicle_model || null,
        total_allowed: parsed.total_allowed || null,
        estimate_totals: estimateTotals,
        line_items: items,
      },
    });
  } catch (err) {
    logInsuranceOcrError(err);
    const providerCode = classifyAiProviderError(err);
    if (providerCode) {
      await notifyOps('high', providerCode, {
        shop_id: req.user.shop_id,
        ro_id: req.body?.ro_id || req.body?.roId || 'n/a',
      });
      return res.status(503).json({ success: false, error: AI_CONFIG_ERROR });
    }
    const status = isAiProviderConfigError(err) ? 503 : 500;
    return res.status(status).json({ success: false, error: safeInsuranceOcrError(err) });
  }
});

// ── Phase 2: Rate analysis ───────────────────────────────────────────────────
// POST /api/insurance-ocr/analyze
// Body: { line_items: [...] }  (same shape as /parse output)
// Returns: { flags: [...], summary: { ... } }
router.post('/analyze', auth, insuranceOcrLimiter, async (req, res) => {
  try {
    // FIX: guard against shop not found — return error instead of silently zeroing rates
    const shop = await dbGet(
      'SELECT labor_rate, paint_rate, parts_markup FROM shops WHERE id = $1',
      [req.user.shop_id]
    );
    if (!shop) {
      return res.status(404).json({ success: false, error: 'Shop not found. Configure your shop rates first.' });
    }

    const shopLaborRate   = Number(shop.labor_rate   || 0);
    const shopPaintRate   = Number(shop.paint_rate   || 0);
    const shopPartsMarkup = Number(shop.parts_markup || 0); // e.g. 0.30 = 30%

    const lineItems = Array.isArray(req.body?.line_items) ? req.body.line_items : [];

    let totalInsurance  = 0;
    let totalShopValue  = 0;
    let supplementTotal = 0;
    const flags = [];

    for (const item of lineItems) {
      const qty       = Number(item.quantity  || 1);
      const unitPrice = Number(item.unit_price || 0);
      const insTotal  = qty * unitPrice;
      totalInsurance += insTotal;

      let flag = null;

      if (item.type === 'labor') {
        // FIX: insurance estimates express labor as (hours × shop_rate) per line.
        // unit_price on a labor line = rate per hour (not total).
        // qty = number of hours.
        // Compare unit_price directly to shop labor rate.
        const shopRate = shopLaborRate > 0 ? shopLaborRate : null;
        const shopLineTotal = shopRate ? qty * shopRate : null;

        if (shopRate && shopRate > unitPrice) {
          const gap = shopRate - unitPrice;
          const supplementAmt = gap * qty;
          supplementTotal += supplementAmt;
          totalShopValue += shopLineTotal;
          flag = {
            type: 'undervalue',
            severity: supplementAmt >= 100 ? 'high' : 'medium',
            description: item.description,
            item_type: 'labor',
            insurance_rate: unitPrice,
            shop_rate: shopRate,
            gap_per_unit: gap,
            supplement_opportunity: supplementAmt,
            message: `Insurance allows $${unitPrice.toFixed(2)}/hr (${qty}h) — your rate is $${shopRate.toFixed(2)}/hr. Supplement opportunity: $${supplementAmt.toFixed(2)}.`,
          };
        } else {
          totalShopValue += insTotal;
        }
      } else if (item.type === 'parts') {
        // Check if parts markup is configured and flag low-priced parts lines
        totalShopValue += insTotal;
        if (unitPrice > 0 && unitPrice < 15 && qty >= 1) {
          flag = {
            type: 'review',
            severity: 'low',
            description: item.description,
            item_type: 'parts',
            insurance_rate: unitPrice,
            shop_rate: null,
            gap_per_unit: null,
            supplement_opportunity: null,
            message: `Parts line "${item.description}" has a very low unit price ($${unitPrice.toFixed(2)}). Verify markup and actual part cost.`,
          };
        } else if (shopPartsMarkup > 0) {
          // Flag if insurance is likely paying below marked-up cost
          const expectedMin = unitPrice * (1 + shopPartsMarkup);
          // We can't know the cost without a catalog, so just annotate with markup info
          // as an informational flag rather than undervalue
        }
      } else {
        totalShopValue += insTotal;
      }

      flags.push(flag || {
        type: 'ok',
        severity: 'none',
        description: item.description,
        item_type: item.type,
        insurance_rate: unitPrice,
        shop_rate: null,
        gap_per_unit: null,
        supplement_opportunity: null,
        message: null,
      });
    }

    const totalGap = totalShopValue - totalInsurance;

    return res.json({
      success: true,
      shop_rates: {
        labor_rate: shopLaborRate,
        paint_rate: shopPaintRate,
        parts_markup: shopPartsMarkup,
      },
      flags,
      summary: {
        total_insurance_allowed: totalInsurance,
        total_shop_value: totalShopValue,
        total_supplement_opportunity: supplementTotal,
        total_gap: totalGap,
        undervalue_count: flags.filter((f) => f.type === 'undervalue').length,
        review_count: flags.filter((f) => f.type === 'review').length,
        ok_count: flags.filter((f) => f.type === 'ok').length,
      },
    });
  } catch (err) {
    console.error('[InsuranceOCR/analyze] Error:', err);
    return res.status(500).json({ success: false, error: safeInsuranceOcrError(err) });
  }
});

module.exports = router;
module.exports.insuranceOcrLimiter = insuranceOcrLimiter;
module.exports.insuranceOcrLimiterKeyGenerator = insuranceOcrLimiterKeyGenerator;
module.exports.parseEstimateTotalsFromPdfText = parseEstimateTotalsFromPdfText;
