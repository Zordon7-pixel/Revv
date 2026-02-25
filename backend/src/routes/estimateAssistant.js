const router = require('express').Router();
const auth = require('../middleware/auth');
const suggestionMatrix = require('../data/estimate-suggestions.json');

const DAMAGE_TYPES = ['front_impact', 'rear_impact', 'side_damage', 'hail', 'glass'];
const TRUCK_MAKES = ['ford', 'chevrolet', 'gmc', 'ram', 'toyota', 'nissan'];
const SUV_MODELS = ['rav4', 'cr-v', 'explorer', 'pilot', 'highlander', 'x5', 'model y'];

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

router.get('/suggestions', auth, (req, res) => {
  const { make, model, damageType } = req.query || {};

  if (!make || !model || !damageType) {
    return res.status(400).json({ error: 'make, model, and damageType are required' });
  }

  if (!DAMAGE_TYPES.includes(damageType)) {
    return res.status(400).json({ error: `damageType must be one of: ${DAMAGE_TYPES.join(', ')}` });
  }

  const vehicleType = classifyVehicleType(make, model);
  const suggestions = suggestionMatrix[vehicleType]?.[damageType] || [];

  const summary = suggestions.reduce((acc, item) => {
    acc.estimated_labor_hours += Number(item.labor_hours || 0);
    acc.estimated_parts_cost += Number(item.parts_estimate || 0);
    return acc;
  }, { estimated_labor_hours: 0, estimated_parts_cost: 0 });

  return res.json({
    vehicleType,
    damageType,
    suggestions,
    summary,
  });
});

module.exports = router;
