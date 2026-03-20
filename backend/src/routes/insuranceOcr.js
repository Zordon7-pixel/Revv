const router = require('express').Router();
const multer = require('multer');
const OpenAI = require('openai');
const auth = require('../middleware/auth');

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
      // Strip markdown fences if model added them anyway
      const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('[InsuranceOCR] Failed to parse OpenAI response:', raw);
      return res.status(422).json({ success: false, error: 'Could not parse estimate from image. Try a clearer photo.' });
    }

    // Normalize line items
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

module.exports = router;
