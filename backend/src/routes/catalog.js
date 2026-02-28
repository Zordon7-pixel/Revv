const router = require('express').Router();
const auth = require('../middleware/auth');
const { searchParts } = require('../services/partsCatalog');

const COMMON_MAKES = [
  'Acura',
  'Audi',
  'BMW',
  'Chevrolet',
  'Dodge',
  'Ford',
  'GMC',
  'Honda',
  'Hyundai',
  'Jeep',
  'Kia',
  'Lexus',
  'Mazda',
  'Mercedes-Benz',
  'Nissan',
  'Subaru',
  'Tesla',
  'Toyota',
  'Volkswagen',
];

const MODELS_BY_MAKE = {
  Acura: ['ILX', 'Integra', 'MDX', 'RDX', 'TLX'],
  Audi: ['A3', 'A4', 'A5', 'Q5', 'Q7'],
  BMW: ['3 Series', '5 Series', 'X3', 'X5', 'X7'],
  Chevrolet: ['Equinox', 'Malibu', 'Silverado 1500', 'Tahoe', 'Traverse'],
  Dodge: ['Charger', 'Durango', 'Journey', 'Ram 1500'],
  Ford: ['Escape', 'Explorer', 'F-150', 'Mustang', 'Transit'],
  GMC: ['Acadia', 'Sierra 1500', 'Terrain', 'Yukon'],
  Honda: ['Accord', 'Civic', 'CR-V', 'HR-V', 'Pilot'],
  Hyundai: ['Elantra', 'Palisade', 'Santa Fe', 'Sonata', 'Tucson'],
  Jeep: ['Cherokee', 'Compass', 'Grand Cherokee', 'Wrangler'],
  Kia: ['Forte', 'K5', 'Optima', 'Sorento', 'Sportage'],
  Lexus: ['ES 350', 'IS 300', 'NX 300', 'RX 350'],
  Mazda: ['CX-30', 'CX-5', 'CX-9', 'Mazda3', 'Mazda6'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'GLC', 'GLE'],
  Nissan: ['Altima', 'Maxima', 'Rogue', 'Sentra', 'Versa'],
  Subaru: ['Forester', 'Impreza', 'Legacy', 'Outback'],
  Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y'],
  Toyota: ['Camry', 'Corolla', 'Highlander', 'RAV4', 'Tacoma'],
  Volkswagen: ['Atlas', 'Jetta', 'Passat', 'Tiguan'],
};

router.use(auth);

router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const year = req.query.year ? Number(req.query.year) : undefined;
    const make = String(req.query.make || '').trim();
    const model = String(req.query.model || '').trim();

    const parts = await searchParts(q, year, make, model);
    return res.json({ results: parts });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to search parts catalog.' });
  }
});

router.get('/vehicles/makes', (req, res) => {
  return res.json({ makes: COMMON_MAKES });
});

router.get('/vehicles/models', (req, res) => {
  const make = String(req.query.make || '').trim();
  if (!make) return res.json({ models: [] });
  return res.json({ models: MODELS_BY_MAKE[make] || [] });
});

module.exports = router;
