const router = require('express').Router();
const auth = require('../middleware/auth');
const suggestionMatrix = require('../data/estimate-suggestions.json');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

// ── Multer setup for scan-photo endpoint ──────────────────────────────────────
const SCAN_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const scanUploadDir = path.join(__dirname, '../../uploads/scan-tmp');
fs.mkdirSync(scanUploadDir, { recursive: true });

const scanStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, scanUploadDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const scanUpload = multer({
  storage: scanStorage,
  limits: { fileSize: SCAN_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

// ── Claude Haiku Vision: analyse damage photo (cheapest effective option) ─────
async function analyzeDamagePhoto(filePath) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const imageData = fs.readFileSync(filePath);
  const base64 = imageData.toString('base64');
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: 'You are an auto body damage assessor. Analyze this vehicle damage photo. Respond with JSON only, no markdown: {"severity":"minor|moderate|severe","zones":["list of affected body parts, e.g. front bumper, hood, left front fender"],"description":"one sentence summary of the damage"}',
        },
      ],
    }],
  });

  const text = (response.content[0]?.text || '').trim();
  const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  return JSON.parse(clean);
}

// ── Zone → damage type + panel id mapping ─────────────────────────────────────
const ZONE_TO_PANEL = {
  'front bumper': 'front_bumper',
  'bumper': 'front_bumper',
  'fascia': 'front_bumper',
  'grille': 'front_bumper',
  'valance': 'front_bumper',
  'hood': 'hood',
  'windshield': 'windshield',
  'glass': 'windshield',
  'roof': 'roof',
  'hail': 'roof',
  'rear bumper': 'rear_bumper',
  'rear body': 'rear_bumper',
  'trunk': 'trunk',
  'decklid': 'trunk',
  'liftgate': 'trunk',
  'tailgate': 'trunk',
  'rear glass': 'rear_glass',
  'back glass': 'rear_glass',
  'liftgate glass': 'rear_glass',
  'left front fender': 'left_front_fender',
  'left fender': 'left_front_fender',
  'fender': 'left_front_fender',
  'left front door': 'left_front_door',
  'left rear door': 'left_rear_door',
  'left quarter': 'left_rear_quarter',
  'left rear quarter': 'left_rear_quarter',
  'quarter panel': 'left_rear_quarter',
  'rocker': 'left_rear_quarter',
  'right front fender': 'right_front_fender',
  'right fender': 'right_front_fender',
  'right front door': 'right_front_door',
  'right rear door': 'right_rear_door',
  'right quarter': 'right_rear_quarter',
  'right rear quarter': 'right_rear_quarter',
  'undercarriage': 'undercarriage',
  'underbody': 'undercarriage',
  'subframe': 'undercarriage',
  'frame rail': 'undercarriage',
  'left front tire': 'left_front_tire',
  'right front tire': 'right_front_tire',
  'left rear tire': 'left_rear_tire',
  'right rear tire': 'right_rear_tire',
  'left front rim': 'left_front_rim',
  'right front rim': 'right_front_rim',
  'left rear rim': 'left_rear_rim',
  'right rear rim': 'right_rear_rim',
  'left front wheel': 'left_front_rim',
  'right front wheel': 'right_front_rim',
  'left rear wheel': 'left_rear_rim',
  'right rear wheel': 'right_rear_rim',
  'dashboard': 'interior_dashboard',
  'dash': 'interior_dashboard',
  'steering column': 'interior_steering_column',
  'steering wheel': 'interior_steering_column',
  'ignition switch': 'interior_ignition_switch',
  'ignition lock': 'interior_ignition_switch',
  'center console': 'interior_center_console',
  'console': 'interior_center_console',
  'driver seat': 'interior_front_left_seat',
  'front left seat': 'interior_front_left_seat',
  'passenger seat': 'interior_front_right_seat',
  'front right seat': 'interior_front_right_seat',
  'rear seat': 'interior_rear_seats',
  'rear seats': 'interior_rear_seats',
  'headliner': 'interior_headliner',
  'driver door panel': 'interior_driver_door_trim',
  'passenger door panel': 'interior_passenger_door_trim',
};

const ZONE_TO_DAMAGE_TYPE = {
  'front bumper': 'front_impact',
  'bumper': 'front_impact',
  'fascia': 'front_impact',
  'grille': 'front_impact',
  'valance': 'front_impact',
  'hood': 'front_impact',
  'windshield': 'glass',
  'glass': 'glass',
  'rear glass': 'glass',
  'back glass': 'glass',
  'liftgate glass': 'glass',
  'roof': 'hail',
  'hail': 'hail',
  'rear bumper': 'rear_impact',
  'rear body': 'rear_impact',
  'trunk': 'rear_impact',
  'decklid': 'rear_impact',
  'liftgate': 'rear_impact',
  'tailgate': 'rear_impact',
  'left front fender': 'side_damage',
  'left fender': 'side_damage',
  'fender': 'side_damage',
  'left front door': 'side_damage',
  'left rear door': 'side_damage',
  'left quarter': 'side_damage',
  'left rear quarter': 'side_damage',
  'quarter panel': 'side_damage',
  'rocker': 'side_damage',
  'right front fender': 'side_damage',
  'right fender': 'side_damage',
  'right front door': 'side_damage',
  'right rear door': 'side_damage',
  'right quarter': 'side_damage',
  'right rear quarter': 'side_damage',
  'undercarriage': 'side_damage',
  'underbody': 'side_damage',
  'subframe': 'side_damage',
  'frame rail': 'side_damage',
  'left front tire': 'side_damage',
  'right front tire': 'side_damage',
  'left rear tire': 'side_damage',
  'right rear tire': 'side_damage',
  'left front rim': 'side_damage',
  'right front rim': 'side_damage',
  'left rear rim': 'side_damage',
  'right rear rim': 'side_damage',
  'left front wheel': 'side_damage',
  'right front wheel': 'side_damage',
  'left rear wheel': 'side_damage',
  'right rear wheel': 'side_damage',
  'dashboard': 'side_damage',
  'dash': 'side_damage',
  'steering column': 'side_damage',
  'steering wheel': 'side_damage',
  'ignition switch': 'side_damage',
  'ignition lock': 'side_damage',
  'center console': 'side_damage',
  'console': 'side_damage',
  'driver seat': 'side_damage',
  'front left seat': 'side_damage',
  'passenger seat': 'side_damage',
  'front right seat': 'side_damage',
  'rear seat': 'side_damage',
  'rear seats': 'side_damage',
  'headliner': 'side_damage',
  'driver door panel': 'side_damage',
  'passenger door panel': 'side_damage',
};

function inferFromZones(zones) {
  const damageTypeCounts = {};
  const panelSet = new Set();

  zones.forEach((zone) => {
    const z = String(zone).toLowerCase().trim();
    // Exact match first, then partial
    let matchedDT = ZONE_TO_DAMAGE_TYPE[z];
    let matchedPanel = ZONE_TO_PANEL[z];

    if (!matchedDT) {
      const key = Object.keys(ZONE_TO_DAMAGE_TYPE).find((k) => z.includes(k) || k.includes(z));
      if (key) matchedDT = ZONE_TO_DAMAGE_TYPE[key];
    }
    if (!matchedPanel) {
      const key = Object.keys(ZONE_TO_PANEL).find((k) => z.includes(k) || k.includes(z));
      if (key) matchedPanel = ZONE_TO_PANEL[key];
    }

    if (matchedDT) damageTypeCounts[matchedDT] = (damageTypeCounts[matchedDT] || 0) + 1;
    if (matchedPanel) panelSet.add(matchedPanel);
  });

  // Pick the most-voted damage type; fallback to front_impact
  const inferred_damage_type = Object.entries(damageTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'front_impact';
  return { inferred_damage_type, inferred_panels: Array.from(panelSet) };
}

const DAMAGE_TYPES = ['front_impact', 'rear_impact', 'side_damage', 'hail', 'glass'];
const TRUCK_MAKES = ['ford', 'chevrolet', 'gmc', 'ram', 'toyota', 'nissan'];
const SUV_MODELS = ['rav4', 'cr-v', 'explorer', 'pilot', 'highlander', 'x5', 'model y'];
const ADAS_KEYWORDS = ['radar', 'camera', 'calibration', 'sensor', 'relearn'];
const PANEL_KEYWORDS = {
  front_bumper: ['front bumper', 'bumper', 'fascia', 'grille', 'valance'],
  hood: ['hood'],
  windshield: ['windshield', 'glass', 'camera'],
  roof: ['roof', 'hail', 'pdr'],
  rear_glass: ['rear glass', 'glass', 'liftgate glass', 'back glass'],
  trunk: ['trunk', 'decklid', 'liftgate', 'tailgate'],
  rear_bumper: ['rear bumper', 'bumper', 'rear body'],
  left_front_fender: ['fender', 'front fender', 'flare'],
  left_front_door: ['front door', 'door shell', 'door'],
  left_rear_door: ['rear door', 'door', 'blend'],
  left_rear_quarter: ['quarter', 'rocker', 'bedside', 'cab corner'],
  right_front_fender: ['fender', 'front fender', 'flare'],
  right_front_door: ['front door', 'door shell', 'door'],
  right_rear_door: ['rear door', 'door', 'blend'],
  right_rear_quarter: ['quarter', 'rocker', 'bedside', 'cab corner'],
  undercarriage: ['undercarriage', 'underbody', 'subframe', 'frame rail', 'splash shield'],
  left_front_tire: ['left front tire', 'lf tire', 'front tire', 'tire'],
  right_front_tire: ['right front tire', 'rf tire', 'front tire', 'tire'],
  left_rear_tire: ['left rear tire', 'lr tire', 'rear tire', 'tire'],
  right_rear_tire: ['right rear tire', 'rr tire', 'rear tire', 'tire'],
  left_front_rim: ['left front rim', 'left front wheel', 'lf rim', 'alloy wheel'],
  right_front_rim: ['right front rim', 'right front wheel', 'rf rim', 'alloy wheel'],
  left_rear_rim: ['left rear rim', 'left rear wheel', 'lr rim', 'alloy wheel'],
  right_rear_rim: ['right rear rim', 'right rear wheel', 'rr rim', 'alloy wheel'],
  interior_dashboard: ['dashboard', 'dash', 'instrument panel'],
  interior_steering_column: ['steering column', 'steering wheel', 'column trim'],
  interior_ignition_switch: ['ignition switch', 'ignition lock', 'key cylinder'],
  interior_center_console: ['center console', 'console', 'shifter trim'],
  interior_front_left_seat: ['driver seat', 'front left seat', 'seat track'],
  interior_front_right_seat: ['passenger seat', 'front right seat', 'seat track'],
  interior_rear_seats: ['rear seat', 'rear seats', 'bench seat'],
  interior_headliner: ['headliner', 'roof liner', 'upper trim'],
  interior_driver_door_trim: ['driver door panel', 'driver door trim', 'left door trim'],
  interior_passenger_door_trim: ['passenger door panel', 'passenger door trim', 'right door trim'],
};

function classifyVehicleType(make, model) {
  const mk = String(make || '').toLowerCase();
  const md = String(model || '').toLowerCase();

  if (mk === 'tesla' || md.includes('ev') || md.includes('model 3') || md.includes('model y')) {
    return 'ev';
  }

  if (SUV_MODELS.some((item) => md.includes(item))) {
    return 'suv';
  }

  if (TRUCK_MAKES.includes(mk) && (md.includes('150') || md.includes('silverado') || md.includes('ram') || md.includes('tundra') || md.includes('truck'))) {
    return 'truck';
  }

  return 'sedan';
}

function normalizePanelIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreSuggestionAgainstPanels(description, panelIds) {
  const text = String(description || '').toLowerCase();
  if (!panelIds.length) return { score: 0, hits: [] };

  const hits = new Set();
  panelIds.forEach((panelId) => {
    const keywords = PANEL_KEYWORDS[panelId] || [];
    keywords.forEach((keyword) => {
      if (text.includes(keyword)) hits.add(panelId);
    });
  });

  return { score: hits.size, hits: Array.from(hits) };
}

function shouldKeepForYear(item, yearNumber) {
  if (!Number.isFinite(yearNumber)) return true;
  const text = String(item.description || '').toLowerCase();
  const hasAdasKeyword = ADAS_KEYWORDS.some((keyword) => text.includes(keyword));
  if (yearNumber < 2016 && hasAdasKeyword) return false;
  return true;
}

router.get('/suggestions', auth, (req, res) => {
  const { make, model, damageType, year, damagedPanels } = req.query || {};

  if (!make || !model || !damageType) {
    return res.status(400).json({ error: 'make, model, and damageType are required' });
  }

  if (!DAMAGE_TYPES.includes(damageType)) {
    return res.status(400).json({ error: `damageType must be one of: ${DAMAGE_TYPES.join(', ')}` });
  }

  const vehicleType = classifyVehicleType(make, model);
  const panelIds = normalizePanelIds(damagedPanels);
  const yearNumber = Number(year);
  const baseSuggestions = suggestionMatrix[vehicleType]?.[damageType] || [];

  const rankedSuggestions = baseSuggestions
    .filter((item) => shouldKeepForYear(item, yearNumber))
    .map((item) => {
      const panelMatch = scoreSuggestionAgainstPanels(item.description, panelIds);
      return {
        ...item,
        relevance_score: panelMatch.score,
        matched_panels: panelMatch.hits,
      };
    })
    .sort((a, b) => b.relevance_score - a.relevance_score || a.code.localeCompare(b.code));

  const suggestions = panelIds.length
    ? rankedSuggestions.filter((item) => item.relevance_score > 0)
    : rankedSuggestions;

  const summary = suggestions.reduce((acc, item) => {
    acc.estimated_labor_hours += Number(item.labor_hours || 0);
    acc.estimated_parts_cost += Number(item.parts_estimate || 0);
    return acc;
  }, { estimated_labor_hours: 0, estimated_parts_cost: 0 });

  return res.json({
    vehicleType,
    damageType,
    year: Number.isFinite(yearNumber) ? yearNumber : null,
    selectedPanels: panelIds,
    panelFilterApplied: panelIds.length > 0,
    suggestions,
    summary,
  });
});

// ── POST /estimate-assistant/scan-photo ───────────────────────────────────────
// Upload a damage photo → GPT-4o Vision infers damage type + panels → returns
// AI assessment + estimate suggestions. No DB writes (scan-only).
router.post('/scan-photo', auth, scanUpload.single('photo'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'AI scan not available' });
    }

    let ai;
    try {
      ai = await analyzeDamagePhoto(tmpPath);
    } catch (err) {
      console.error('[EstimateAssistant] GPT-4o vision error:', err.message);
      return res.status(502).json({ error: 'AI scan failed — select damage manually' });
    }

    if (!ai || !ai.zones || !Array.isArray(ai.zones)) {
      return res.status(502).json({ error: 'AI scan returned no usable data' });
    }

    const { inferred_damage_type, inferred_panels } = inferFromZones(ai.zones);
    const { make, model, year } = req.body || {};
    const vehicleType = classifyVehicleType(make, model);
    const yearNumber = Number(year);
    const baseSuggestions = suggestionMatrix[vehicleType]?.[inferred_damage_type] || [];

    const rankedSuggestions = baseSuggestions
      .filter((item) => shouldKeepForYear(item, yearNumber))
      .map((item) => {
        const panelMatch = scoreSuggestionAgainstPanels(item.description, inferred_panels);
        return { ...item, relevance_score: panelMatch.score, matched_panels: panelMatch.hits };
      })
      .sort((a, b) => b.relevance_score - a.relevance_score || a.code.localeCompare(b.code));

    const suggestions = inferred_panels.length
      ? rankedSuggestions.filter((item) => item.relevance_score > 0)
      : rankedSuggestions;

    const summary = suggestions.reduce((acc, item) => {
      acc.estimated_labor_hours += Number(item.labor_hours || 0);
      acc.estimated_parts_cost += Number(item.parts_estimate || 0);
      return acc;
    }, { estimated_labor_hours: 0, estimated_parts_cost: 0 });

    return res.json({
      severity: ai.severity,
      zones: ai.zones,
      description: ai.description,
      inferred_damage_type,
      inferred_panels,
      vehicleType,
      suggestions,
      summary,
    });
  } catch (err) {
    console.error('[EstimateAssistant] scan-photo error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Always clean up temp file
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 10MB)' });
  res.status(400).json({ error: err.message });
});

module.exports = router;
