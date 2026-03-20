const router = require('express').Router();
const multer = require('multer');
const OpenAI = require('openai');
const auth = require('../middleware/auth');
const { dbGet } = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const SYSTEM_PROMPT = `You are an insurance estimate parser for auto body shops. Extract all line items from this insurance estimate document.
Return ONLY valid JSON in this exact format:
{
  "insurance_company": "string or null",
  "claim_number": "string or null",
  "vehicle": "string or null",
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

// ── Phase 1: OCR parse ───────────────────────────────────────────────────────
router.post('/parse', auth, upload.single('estimate_image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Use field name: estimate_image' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'OpenAI API key not configured' });
    }

    const openai = new OpenAI({ apiKey });

    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2000,
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

    const raw = response.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('[InsuranceOCR] Failed to parse OpenAI response:', raw);
      return res.status(422).json({ success: false, error: 'Could not parse estimate from image. Try a clearer photo.' });
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
        vehicle: parsed.vehicle || null,
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
    const shop = await dbGet(
      'SELECT labor_rate, paint_rate, parts_markup FROM shops WHERE id = $1',
      [req.user.shop_id]
    );

    const shopLaborRate  = Number(shop?.labor_rate  || 0);
    const shopPaintRate  = Number(shop?.paint_rate  || 0);
    const shopPartsMarkup = Number(shop?.parts_markup || 0); // e.g. 0.30 = 30%

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
        // Compare labor line unit_price (per-hour rate) vs shop rate
        // Some estimates express labor as (hours × rate) bundled in unit_price;
        // we compare the effective hourly rate when qty looks like hours.
        const effectiveRate = qty > 0 ? unitPrice / qty : unitPrice;
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
            message: `Insurance allows $${unitPrice.toFixed(2)}/hr — your rate is $${shopRate.toFixed(2)}/hr. Supplement opportunity: $${supplementAmt.toFixed(2)}.`,
          };
        } else {
          totalShopValue += insTotal;
        }
      } else if (item.type === 'parts') {
        // Check parts markup: if shop applies a markup, is the insurance paying list price?
        const shopRate = shopPartsMarkup > 0 ? shopLaborRate : null; // use markup flag only
        totalShopValue += insTotal;
        // Flag if unit_price is suspiciously low (below $10 for a parts line — likely missing markup)
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
            message: `Parts line "${item.description}" has a very low unit price ($${unitPrice.toFixed(2)}). Verify markup and actual cost.`,
          };
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
