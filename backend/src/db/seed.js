const db = require('./index');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const existing = db.prepare('SELECT id FROM shops LIMIT 1').get();
if (existing) { console.log('DB already seeded.'); process.exit(0); }

const shopId = uuidv4();
db.prepare(`INSERT INTO shops (id, name, phone, address, labor_rate, tax_rate) VALUES (?, ?, ?, ?, ?, ?)`).run(
  shopId, "Premier Auto Body", "(718) 555-0100", "123 Atlantic Ave, Brooklyn, NY 11201", 55, 0.0875
);

const userId = uuidv4();
const hash = bcrypt.hashSync('demo1234', 10);
db.prepare(`INSERT INTO users (id, shop_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`).run(
  userId, shopId, "Shop Manager", "demo@shop.com", hash, "owner"
);

const customers = [
  { name: "Marcus Johnson", phone: "(646) 555-0201", insurance: "Progressive", policy: "PRG-882341" },
  { name: "Sofia Rodriguez", phone: "(347) 555-0302", insurance: "Geico", policy: "GCO-441892" },
  { name: "James Chen", phone: "(718) 555-0403", insurance: "State Farm", policy: "STF-119283" },
  { name: "Aaliyah Williams", phone: "(917) 555-0504", insurance: "Cash", policy: "" },
  { name: "Robert Kim", phone: "(646) 555-0605", insurance: "Integon", policy: "INT-776541" },
];

const vehicles = [
  { year: 2021, make: "Toyota", model: "Camry", vin: "4T1B11HK5MU034521", color: "Silver", plate: "NJK4821" },
  { year: 2019, make: "Honda", model: "Accord", vin: "1HGCV1F30KA012345", color: "Black", plate: "NYP9923" },
  { year: 2022, make: "BMW", model: "330i", vin: "WBA5R7C50NAJ12345", color: "White", plate: "NYC1234" },
  { year: 2020, make: "Ford", model: "Explorer", vin: "1FM5K8D87LGA00123", color: "Blue", plate: "MDX8821" },
  { year: 2018, make: "Chevrolet", model: "Malibu", vin: "1G1ZD5ST0JF123456", color: "Red", plate: "VAB4421" },
];

const statuses = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery'];
const jobTypes = ['collision', 'paint', 'detailing', 'collision', 'collision'];
const insurers = ['Progressive', 'Geico', 'State Farm', null, 'Integon'];

for (let i = 0; i < 5; i++) {
  const custId = uuidv4();
  db.prepare(`INSERT INTO customers (id, shop_id, name, phone, email, insurance_company, policy_number) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    custId, shopId, customers[i].name, customers[i].phone, '', customers[i].insurance, customers[i].policy
  );

  const vehId = uuidv4();
  db.prepare(`INSERT INTO vehicles (id, shop_id, customer_id, year, make, model, vin, color, plate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    vehId, shopId, custId, vehicles[i].year, vehicles[i].make, vehicles[i].model, vehicles[i].vin, vehicles[i].color, vehicles[i].plate
  );

  const roId = uuidv4();
  const roNum = `RO-2026-${String(i + 1).padStart(4, '0')}`;
  const partsC = [1200, 850, 3400, 600, 980][i];
  const laborC = [2200, 1100, 4800, 800, 1600][i];
  const total = partsC + laborC;
  const deductWaived = i === 0 ? 500 : 0;
  const refFee = i === 1 ? 150 : 0;
  const trueProfit = (laborC - (partsC * 0.1)) - deductWaived - refFee;
  const intakeDate = `2026-02-${15 + i}`;

  db.prepare(`
    INSERT INTO repair_orders (id, shop_id, ro_number, vehicle_id, customer_id, job_type, status, payment_type,
      claim_number, insurer, deductible, intake_date, parts_cost, labor_cost, total,
      deductible_waived, referral_fee, true_profit, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    roId, shopId, roNum, vehId, custId, jobTypes[i], statuses[i],
    i === 3 ? 'cash' : 'insurance',
    i === 3 ? null : `CLM-2026-${8800 + i}`,
    insurers[i], i === 3 ? 0 : 500, intakeDate,
    partsC, laborC, total, deductWaived, refFee, trueProfit,
    `Sample repair order #${i + 1}`
  );

  db.prepare(`INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?, ?)`).run(
    uuidv4(), roId, null, statuses[i], 'system'
  );
}

console.log('✅ Database seeded successfully.');
console.log('   Shop: Premier Auto Body');
console.log('   Login: demo@shop.com / demo1234');
console.log('   Sample ROs: 5 vehicles across all stages');
