const router = require('express').Router();
const auth = require('../middleware/auth');
const suggestionMatrix = require('../data/estimate-suggestions.json');

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

module.exports = router;
