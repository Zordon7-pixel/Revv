const DEFAULT_NAPA_BASE_URL = 'https://api.prolink.napaonline.com/v1';

const MOCK_PARTS = [
  { partNumber: 'KI1000205', description: 'Front Bumper Cover Primed', brand: 'CAPA', price: 229.95, availability: 'In Stock', category: 'bumper', years: [2018, 2024], make: 'Kia', model: 'Optima' },
  { partNumber: 'HO1241184', description: 'Passenger Fender Steel', brand: 'Keystone', price: 184.5, availability: 'Limited Stock', category: 'fender', years: [2016, 2021], make: 'Honda', model: 'Civic' },
  { partNumber: 'TO1225348', description: 'Hood Panel Aluminum', brand: 'LKQ', price: 319.0, availability: 'In Stock', category: 'hood', years: [2020, 2025], make: 'Toyota', model: 'Camry' },
  { partNumber: 'FD1321460', description: 'Driver Power Mirror Heated', brand: 'Dorman', price: 142.75, availability: 'Ships in 2-3 days', category: 'mirror', years: [2017, 2022], make: 'Ford', model: 'F-150' },
  { partNumber: 'GM2502377', description: 'Passenger Headlight LED', brand: 'CAPA', price: 287.99, availability: 'In Stock', category: 'headlight', years: [2019, 2024], make: 'Chevrolet', model: 'Silverado 1500' },
  { partNumber: 'NI1904100', description: 'Radiator Support Upper', brand: 'LKQ', price: 96.4, availability: 'Limited Stock', category: 'support', years: [2015, 2020], make: 'Nissan', model: 'Altima' },
  { partNumber: 'BM2804103', description: 'Driver Tail Light Outer', brand: 'Keystone', price: 210.25, availability: 'In Stock', category: 'tail light', years: [2018, 2023], make: 'BMW', model: '3 Series' },
  { partNumber: 'HY1225172', description: 'Hood Assembly Steel', brand: 'CAPA', price: 278.0, availability: 'Backordered', category: 'hood', years: [2017, 2022], make: 'Hyundai', model: 'Elantra' },
  { partNumber: 'SU1240150', description: 'Driver Fender Primed', brand: 'Keystone', price: 168.3, availability: 'In Stock', category: 'fender', years: [2019, 2024], make: 'Subaru', model: 'Outback' },
  { partNumber: 'MA1100221', description: 'Rear Bumper Cover', brand: 'LKQ', price: 245.6, availability: 'Ships in 2-3 days', category: 'bumper', years: [2016, 2021], make: 'Mazda', model: 'CX-5' },
  { partNumber: 'VW1311149', description: 'Front Door Shell Passenger', brand: 'Keystone', price: 401.0, availability: 'Limited Stock', category: 'door', years: [2015, 2020], make: 'Volkswagen', model: 'Jetta' },
  { partNumber: 'AD2519132', description: 'Driver Headlight Xenon', brand: 'CAPA', price: 389.45, availability: 'In Stock', category: 'headlight', years: [2018, 2022], make: 'Audi', model: 'A4' },
  { partNumber: 'LX1321120', description: 'Passenger Side Mirror Power Fold', brand: 'Dorman', price: 258.2, availability: 'In Stock', category: 'mirror', years: [2019, 2025], make: 'Lexus', model: 'RX 350' },
  { partNumber: 'MB1200215', description: 'Front Bumper Reinforcement', brand: 'LKQ', price: 174.85, availability: 'In Stock', category: 'bumper', years: [2016, 2021], make: 'Mercedes-Benz', model: 'C-Class' },
  { partNumber: 'CH1230289', description: 'Liftgate Assembly', brand: 'Keystone', price: 512.0, availability: 'Ships in 2-3 days', category: 'door', years: [2017, 2023], make: 'Dodge', model: 'Durango' },
  { partNumber: 'FD1103181', description: 'Rear Bumper Cover Textured', brand: 'CAPA', price: 238.0, availability: 'Limited Stock', category: 'bumper', years: [2021, 2025], make: 'Ford', model: 'Escape' },
  { partNumber: 'TO2804128', description: 'Passenger Tail Light LED', brand: 'Keystone', price: 198.9, availability: 'In Stock', category: 'tail light', years: [2018, 2024], make: 'Toyota', model: 'RAV4' },
  { partNumber: 'GM1301407', description: 'Front Door Shell Driver', brand: 'LKQ', price: 429.99, availability: 'Backordered', category: 'door', years: [2016, 2022], make: 'Chevrolet', model: 'Equinox' },
  { partNumber: 'NI2503304', description: 'Driver Headlight Halogen', brand: 'CAPA', price: 179.4, availability: 'In Stock', category: 'headlight', years: [2014, 2019], make: 'Nissan', model: 'Rogue' },
  { partNumber: 'HO1900120', description: 'Front Bumper Grille Insert', brand: 'Dorman', price: 88.75, availability: 'In Stock', category: 'bumper', years: [2020, 2025], make: 'Honda', model: 'Accord' },
  { partNumber: 'KI1320197', description: 'Driver Mirror Power Manual Fold', brand: 'Keystone', price: 121.15, availability: 'Ships in 2-3 days', category: 'mirror', years: [2015, 2020], make: 'Kia', model: 'Sorento' },
  { partNumber: 'HY1117102', description: 'Front Bumper Impact Absorber', brand: 'LKQ', price: 54.25, availability: 'In Stock', category: 'bumper', years: [2019, 2024], make: 'Hyundai', model: 'Santa Fe' },
];

function normalizePart(part) {
  return {
    partNumber: part.partNumber || part.part_number || part.sku || '',
    description: part.description || part.name || part.partDescription || 'Auto Body Part',
    brand: part.brand || part.manufacturer || part.vendor || 'Aftermarket',
    price: Number(part.price || part.unitPrice || part.list_price || 0),
    availability: part.availability || part.stockStatus || 'Availability Unknown',
  };
}

function matchesVehicle(part, year, make, model) {
  const hasYear = Number.isFinite(Number(year));
  const hasMake = !!String(make || '').trim();
  const hasModel = !!String(model || '').trim();
  if (!hasYear && !hasMake && !hasModel) return true;

  if (hasYear) {
    const y = Number(year);
    if (y < part.years[0] || y > part.years[1]) return false;
  }
  if (hasMake && String(part.make).toLowerCase() !== String(make).toLowerCase()) return false;
  if (hasModel && String(part.model).toLowerCase() !== String(model).toLowerCase()) return false;
  return true;
}

function matchesQuery(part, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return (
    part.partNumber.toLowerCase().includes(q) ||
    part.description.toLowerCase().includes(q) ||
    part.brand.toLowerCase().includes(q) ||
    part.category.toLowerCase().includes(q)
  );
}

function searchMockParts(query, year, make, model) {
  return MOCK_PARTS
    .filter((part) => matchesVehicle(part, year, make, model))
    .filter((part) => matchesQuery(part, query))
    .slice(0, 50)
    .map(normalizePart);
}

async function searchNapaParts(query, year, make, model) {
  const apiKey = process.env.NAPA_API_KEY;
  if (!apiKey) return [];

  const baseUrl = process.env.NAPA_API_BASE_URL || DEFAULT_NAPA_BASE_URL;
  const endpoint = `${baseUrl.replace(/\/$/, '')}/parts/search`;

  const payload = {
    query: String(query || '').trim(),
    vehicle: {
      year: year ? Number(year) : undefined,
      make: make || undefined,
      model: model || undefined,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`NAPA search failed with status ${response.status}`);
  }

  const data = await response.json();
  const records = data?.results || data?.parts || data?.items || [];
  return Array.isArray(records) ? records.map(normalizePart).filter((p) => p.partNumber && p.description) : [];
}

async function searchParts(query, year, make, model) {
  if (process.env.NAPA_API_KEY) {
    try {
      const napaResults = await searchNapaParts(query, year, make, model);
      if (napaResults.length > 0) return napaResults;
    } catch (_) {
      // Silent fallback to local catalog for uninterrupted RO workflow.
    }
  }
  return searchMockParts(query, year, make, model);
}

module.exports = {
  searchParts,
};
