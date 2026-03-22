const router = require('express').Router();
const multer = require('multer');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const auth = require('../middleware/auth');
const { dbGet } = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const execFileAsync = promisify(execFile);
const PDF_TEXT_CHAR_LIMIT = 120000;
const PDF_IMAGE_PAGE_LIMIT = 3;

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
  "vehicle_year": "string or null",
  "vehicle_make": "string or null",
  "vehicle_model": "string or null",
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
Return only the JSON object, no markdown fences, no extra text.`;

function isOpenAiJsonBodyParseError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('could not parse the json body');
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

async function parseEstimateTextWithOpenAI(openai, extractedText) {
  const callParser = async (cleanedText) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${SYSTEM_PROMPT}\n\nEstimate document text:\n${cleanedText.slice(0, PDF_TEXT_CHAR_LIMIT)}`,
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
router.post('/parse', auth, upload.single('estimate_image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Use field name: estimate_image' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'OpenAI API key not configured on this server' });
    }

    const openai = new OpenAI({ apiKey });
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const filename = String(req.file.originalname || '').toLowerCase();
    const isPdf = mimeType === 'application/pdf' || filename.endsWith('.pdf');
    let raw = '';

    if (isPdf) {
      let extractedText = '';
      try {
        extractedText = await extractPdfText(req.file.buffer);
      } catch (pdfErr) {
        console.error('[InsuranceOCR] PDF text extraction failed:', pdfErr);
      }

      if (extractedText) {
        try {
          raw = await parseEstimateTextWithOpenAI(openai, extractedText);
        } catch (parseErr) {
          if (isOpenAiJsonBodyParseError(parseErr)) {
            console.warn('[InsuranceOCR] OpenAI rejected PDF-text payload; falling back to PDF image OCR.');
          } else {
            throw parseErr;
          }
        }
      }

      if (!raw) {
        let images = [];
        try {
          images = await extractPdfPageImages(req.file.buffer, PDF_IMAGE_PAGE_LIMIT);
        } catch (imgErr) {
          console.error('[InsuranceOCR] PDF image conversion failed:', imgErr);
          return res.status(500).json({
            success: false,
            error: 'PDF parsing is temporarily unavailable on this server. Try again or upload an image.',
          });
        }

        if (!images.length) {
          return res.status(422).json({
            success: false,
            error: 'Could not read pages from this PDF. Please upload a clearer PDF or a photo/screenshot.',
          });
        }

        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: SYSTEM_PROMPT },
                ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
              ],
            },
          ],
        });
        raw = response.choices?.[0]?.message?.content || '';
      }
    } else {
      const base64 = req.file.buffer.toString('base64');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: SYSTEM_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' },
              },
            ],
          },
        ],
      });
      raw = response.choices?.[0]?.message?.content || '';
    }

    let parsed;
    try {
      // Strip markdown fences if present
      let cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim();
      // If still not parseable, try to find the first {...} block in the response
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          throw new Error('no JSON object found');
        }
      }
    } catch {
      console.error('[InsuranceOCR] Failed to parse OpenAI response. raw length:', raw?.length, '| preview:', raw?.slice(0, 300));
      return res.status(422).json({ success: false, error: 'Could not extract estimate data from file. Try a clearer upload.' });
    }

    const ALLOWED_TYPES = new Set(['labor', 'parts', 'sublet', 'other']);
    const items = (parsed.line_items || []).map((item) => ({
      type: ALLOWED_TYPES.has(String(item.type || '').toLowerCase()) ? String(item.type).toLowerCase() : 'other',
      description: String(item.description || '').trim(),
      quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1,
      unit_price: Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : 0,
    }));

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
        vehicle_year: parsed.vehicle_year || null,
        vehicle_make: parsed.vehicle_make || null,
        vehicle_model: parsed.vehicle_model || null,
        total_allowed: parsed.total_allowed || null,
        line_items: items,
      },
    });
  } catch (err) {
    console.error('[InsuranceOCR] Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

// ── Phase 2: Rate analysis ───────────────────────────────────────────────────
// POST /api/insurance-ocr/analyze
// Body: { line_items: [...] }  (same shape as /parse output)
// Returns: { flags: [...], summary: { ... } }
router.post('/analyze', auth, async (req, res) => {
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
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

module.exports = router;
