const router = require('express').Router();
const auth = require('../middleware/auth');
const { searchParts } = require('../services/partsCatalog');

const COMMON_MAKES = [
  'Acura',
  'Audi',
  'Buick',
  'BMW',
  'Cadillac',
  'Chrysler',
  'Chevrolet',
  'Dodge',
  'Ford',
  'GMC',
  'Honda',
  'Hyundai',
  'Infiniti',
  'Jaguar',
  'Jeep',
  'Land Rover',
  'Kia',
  'Lexus',
  'Lincoln',
  'Mitsubishi',
  'Mazda',
  'Mercedes-Benz',
  'Nissan',
  'Porsche',
  'Ram',
  'Rivian',
  'Subaru',
  'Tesla',
  'Toyota',
  'Volkswagen',
  'Volvo',
  'MINI',
  'Genesis',
  'Alfa Romeo',
  'Polestar',
  'Fiat',
  'Maserati',
  'Lucid',
];

const MODELS_BY_MAKE = {
  Acura: ['ILX', 'Integra', 'MDX', 'RDX', 'TLX'],
  'Alfa Romeo': ['Giulia', 'Stelvio', 'Tonale'],
  Audi: ['A3', 'A4', 'A5', 'Q5', 'Q7'],
  Buick: ['Encore', 'Encore GX', 'Enclave', 'Envision'],
  BMW: ['3 Series', '5 Series', 'X3', 'X5', 'X7'],
  Cadillac: ['CT4', 'CT5', 'Escalade', 'XT4', 'XT5'],
  Chevrolet: ['Equinox', 'Malibu', 'Silverado 1500', 'Tahoe', 'Traverse'],
  Chrysler: ['300', 'Pacifica', 'Voyager'],
  Dodge: ['Charger', 'Durango', 'Journey', 'Ram 1500'],
  Fiat: ['500', '500X'],
  Ford: ['Escape', 'Explorer', 'F-150', 'Mustang', 'Transit'],
  Genesis: ['G70', 'G80', 'GV70', 'GV80'],
  GMC: ['Acadia', 'Sierra 1500', 'Terrain', 'Yukon'],
  Honda: ['Accord', 'Civic', 'CR-V', 'HR-V', 'Pilot'],
  Hyundai: ['Elantra', 'Palisade', 'Santa Fe', 'Sonata', 'Tucson'],
  Infiniti: ['Q50', 'Q60', 'QX50', 'QX60', 'QX80'],
  Jaguar: ['F-PACE', 'E-PACE', 'I-PACE', 'XF'],
  Jeep: ['Cherokee', 'Compass', 'Grand Cherokee', 'Wrangler'],
  Kia: ['Forte', 'K5', 'Optima', 'Sorento', 'Sportage'],
  'Land Rover': ['Defender', 'Discovery', 'Range Rover', 'Range Rover Sport'],
  Lexus: ['ES 350', 'IS 300', 'NX 300', 'RX 350'],
  Lincoln: ['Aviator', 'Corsair', 'Nautilus', 'Navigator'],
  Lucid: ['Air'],
  Mazda: ['CX-30', 'CX-5', 'CX-9', 'Mazda3', 'Mazda6'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'GLC', 'GLE'],
  MINI: ['Clubman', 'Countryman', 'Cooper'],
  Maserati: ['Ghibli', 'Levante', 'Grecale'],
  Mitsubishi: ['Eclipse Cross', 'Mirage', 'Outlander', 'Outlander Sport'],
  Nissan: ['Altima', 'Maxima', 'Rogue', 'Sentra', 'Versa'],
  Polestar: ['2', '3', '4'],
  Porsche: ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'],
  Ram: ['1500', '2500', '3500', 'ProMaster'],
  Rivian: ['R1S', 'R1T'],
  Subaru: ['Forester', 'Impreza', 'Legacy', 'Outback'],
  Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y'],
  Toyota: ['Camry', 'Corolla', 'Highlander', 'RAV4', 'Tacoma'],
  Volkswagen: ['Atlas', 'Jetta', 'Passat', 'Tiguan'],
  Volvo: ['S60', 'S90', 'XC40', 'XC60', 'XC90'],
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
