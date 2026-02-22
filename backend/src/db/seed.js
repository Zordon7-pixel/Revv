const db = require('./index');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function runSeed() {
  const existing = db.prepare('SELECT id FROM shops LIMIT 1').get();
  if (existing) { console.log('DB already seeded — skipping.'); return; }

  const shopId = uuidv4();
  db.prepare(`INSERT INTO shops (id, name, phone, address, city, state, zip, market_tier, labor_rate, parts_markup, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    shopId, "Premier Auto Body", "(555) 400-0100", "456 Commerce Blvd", "Houston", "TX", "77001", 2, 75, 0.35, 0.0825
  );

  const hash = bcrypt.hashSync('demo1234', 10);

  const userId = uuidv4();
  db.prepare(`INSERT INTO users (id, shop_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`).run(
    userId, shopId, "Shop Owner", "demo@shop.com", hash, "owner"
  );

  // Demo employee account
  db.prepare(`INSERT INTO users (id, shop_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`).run(
    uuidv4(), shopId, "Alex Rivera", "employee@shop.com", hash, "employee"
  );

  const customers = [
    { name: "Marcus Johnson",   phone: "(555) 200-0101", email: "marcus@customer.com", insurance: "Progressive", policy: "PRG-882341" },
    { name: "Sofia Rodriguez",  phone: "(555) 200-0202", email: "sofia@customer.com",  insurance: "Geico",       policy: "GCO-441892" },
    { name: "James Chen",       phone: "(555) 200-0303", email: "james@customer.com",  insurance: "State Farm",  policy: "STF-119283" },
    { name: "Aaliyah Williams", phone: "(555) 200-0404", email: "",                    insurance: "Cash",        policy: "" },
    { name: "Robert Kim",       phone: "(555) 200-0505", email: "robert@customer.com", insurance: "Integon",     policy: "INT-776541" },
    { name: "Diana Foster",     phone: "(555) 200-0606", email: "diana@customer.com",  insurance: "Allstate",    policy: "ALT-332211" },
    { name: "Carlos Reyes",     phone: "(555) 200-0707", email: "carlos@customer.com", insurance: "Progressive", policy: "PRG-991122" },
  ];

  const vehicles = [
    { year: 2021, make: "Toyota",    model: "Camry",    vin: "4T1B11HK5MU034521", color: "Silver", plate: "ABC-1001" },
    { year: 2019, make: "Honda",     model: "Accord",   vin: "1HGCV1F30KA012345", color: "Black",  plate: "ABC-1002" },
    { year: 2022, make: "BMW",       model: "330i",     vin: "WBA5R7C50NAJ12345", color: "White",  plate: "ABC-1003" },
    { year: 2020, make: "Ford",      model: "Explorer", vin: "1FM5K8D87LGA00123", color: "Blue",   plate: "ABC-1004" },
    { year: 2018, make: "Chevrolet", model: "Malibu",   vin: "1G1ZD5ST0JF123456", color: "Red",    plate: "ABC-1005" },
    { year: 2023, make: "Tesla",     model: "Model 3",  vin: "5YJ3E1EA7PF123456", color: "Pearl",  plate: "ABC-1006" },
    { year: 2017, make: "Nissan",    model: "Altima",   vin: "1N4AL3AP1HC123456", color: "Gray",   plate: "ABC-1007" },
  ];

  const ros = [
    { custIdx: 0, vehIdx: 0, jobType: "collision", status: "intake",    payType: "insurance", insurer: "Progressive",  claimSuffix: "8800", deduct: 500,  deductWaived: 500, refFee: 0,   parts: 1200, labor: 2200, date: "2026-02-15", delivered: null },
    { custIdx: 1, vehIdx: 1, jobType: "paint",     status: "estimate",  payType: "insurance", insurer: "Geico",        claimSuffix: "8801", deduct: 500,  deductWaived: 0,   refFee: 150, parts: 850,  labor: 1100, date: "2026-02-16", delivered: null },
    { custIdx: 2, vehIdx: 2, jobType: "collision", status: "approval",  payType: "insurance", insurer: "State Farm",   claimSuffix: "8802", deduct: 500,  deductWaived: 0,   refFee: 0,   parts: 3400, labor: 4800, date: "2026-02-17", delivered: null },
    { custIdx: 3, vehIdx: 3, jobType: "collision", status: "parts",     payType: "cash",      insurer: null,           claimSuffix: null,   deduct: 0,    deductWaived: 0,   refFee: 0,   parts: 600,  labor: 800,  date: "2026-02-18", delivered: null },
    { custIdx: 4, vehIdx: 4, jobType: "collision", status: "repair",    payType: "insurance", insurer: "Integon",      claimSuffix: "8804", deduct: 500,  deductWaived: 0,   refFee: 0,   parts: 980,  labor: 1600, date: "2026-02-19", delivered: null },
    { custIdx: 5, vehIdx: 5, jobType: "collision", status: "delivery",  payType: "insurance", insurer: "Allstate",     claimSuffix: "8805", deduct: 500,  deductWaived: 0,   refFee: 0,   parts: 2100, labor: 3200, date: "2026-02-08", delivered: "2026-02-14" },
    { custIdx: 6, vehIdx: 6, jobType: "paint",     status: "delivery",  payType: "cash",      insurer: null,           claimSuffix: null,   deduct: 0,    deductWaived: 0,   refFee: 0,   parts: 400,  labor: 900,  date: "2026-02-05", delivered: "2026-02-11" },
  ];

  let marcusCustId = null;
  ros.forEach((r, i) => {
    const custId = uuidv4();
    if (r.custIdx === 0) marcusCustId = custId; // Marcus Johnson — portal demo account
    const c = customers[r.custIdx];
    db.prepare(`INSERT INTO customers (id, shop_id, name, phone, email, insurance_company, policy_number) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      custId, shopId, c.name, c.phone, c.email, c.insurance, c.policy
    );

    const vehId = uuidv4();
    const v = vehicles[r.vehIdx];
    db.prepare(`INSERT INTO vehicles (id, shop_id, customer_id, year, make, model, vin, color, plate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      vehId, shopId, custId, v.year, v.make, v.model, v.vin, v.color, v.plate
    );

    const roId  = uuidv4();
    const roNum = `RO-2026-${String(i + 1).padStart(4, '0')}`;
    const total = r.parts + r.labor;
    const trueProfit = (r.labor - (r.parts * 0.1)) - r.deductWaived - r.refFee;

    db.prepare(`
      INSERT INTO repair_orders (id, shop_id, ro_number, vehicle_id, customer_id, job_type, status, payment_type,
        claim_number, insurer, deductible, intake_date, actual_delivery, parts_cost, labor_cost, total,
        deductible_waived, referral_fee, true_profit, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      roId, shopId, roNum, vehId, custId, r.jobType, r.status, r.payType,
      r.claimSuffix ? `CLM-2026-${r.claimSuffix}` : null,
      r.insurer, r.deduct, r.date, r.delivered,
      r.parts, r.labor, total, r.deductWaived, r.refFee, trueProfit,
      `Sample repair order #${i + 1}`
    );

    db.prepare(`INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?, ?)`).run(
      uuidv4(), roId, null, r.status, 'system'
    );
  });

  // Customer portal demo account — Marcus Johnson can log in at /portal
  if (marcusCustId) {
    db.prepare(`INSERT INTO users (id, shop_id, name, email, password_hash, role, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), shopId, "Marcus Johnson", "marcus@customer.com", hash, "customer", marcusCustId
    );
  }

  console.log('✅ REVV seeded.');
  console.log('   Shop: Premier Auto Body');
  console.log('   Owner login:    demo@shop.com / demo1234');
  console.log('   Employee login: employee@shop.com / demo1234');
  console.log('   Customer login: marcus@customer.com / demo1234 → /portal');
  console.log('   7 ROs: 5 active (all stages) + 2 completed');
}

// Allow running directly: node src/db/seed.js
if (require.main === module) {
  runSeed();
  process.exit(0);
}

module.exports = { runSeed };
