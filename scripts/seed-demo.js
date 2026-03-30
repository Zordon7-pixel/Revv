#!/usr/bin/env node

/**
 * REVV Auto Body Shop — Demo Seed Script
 * Populates demo shop, users, ROs, vehicles, customers, and sample photos
 * 
 * Usage: node scripts/seed-demo.js [--force] [--db-url <url>]
 * 
 * Options:
 *   --force    Skip existing shop check, wipe demo shop & recreate
 *   --db-url   Custom DB connection string (default: process.env.DATABASE_URL)
 * 
 * This script is idempotent by default (checks for existing shop before seeding).
 */

const { dbGet, dbRun, dbAll } = require('../backend/src/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Parse CLI args
const args = process.argv.slice(2);
const forceReseed = args.includes('--force');
const customDbUrl = args.find(arg => arg.startsWith('--db-url'))?.split('=')[1] || '';

// Demo credentials
const DEMO_CONFIG = {
  shop: {
    name: 'Revv Auto Body',
    email: 'demo@revvauto.com',
    phone: '(202) 555-0100',
    smsNumber: '(202) 555-0100', // Same as phone for demo
    address: '123 Collision Way',
    city: 'Brentwood',
    state: 'MD',
    zip: '20722',
    laborRate: 95,
    partsMarkup: 0.40,
    taxRate: 0.0875,
  },
  users: [
    { name: 'Demo Owner', email: 'demo@revvauto.com', password: 'RevvDemo123!', role: 'owner' },
    { name: 'Tech 1', email: 'tech1@revvauto.com', password: 'TechPass123!', role: 'employee' },
    { name: 'Tech 2', email: 'tech2@revvauto.com', password: 'TechPass123!', role: 'employee' },
    { name: 'Admin', email: 'admin@revvauto.com', password: 'AdminPass123!', role: 'owner' },
  ],
  ros: [
    {
      num: '001',
      customer: { name: 'John Smith', phone: '(202) 555-1234', email: '' },
      vehicle: { year: 2024, make: 'Honda', model: 'Accord', color: 'Silver', plate: 'DEMO001', vin: '1HGCV1F30KA024521' },
      status: 'repair',
      payType: 'insurance',
      insurer: 'Progressive',
      claimSuffix: '001',
      estimatedDelivery: 3, // days from now
      actualDelivery: null,
      partsCost: 5200,
      laborCost: 3300,
      deductible: 500,
      deductibleWaived: 500,
      notes: 'Front collision — frame alignment needed',
      photos: 3,
    },
    {
      num: '002',
      customer: { name: 'Sarah Johnson', phone: '(301) 555-2345', email: '' },
      vehicle: { year: 2022, make: 'Tesla', model: 'Model 3', color: 'Pearl White', plate: 'DEMO002', vin: '5YJ3E1EA7PF234521' },
      status: 'estimate',
      payType: 'insurance',
      insurer: 'Allstate',
      claimSuffix: '002',
      estimatedDelivery: 8,
      actualDelivery: null,
      partsCost: 6500,
      laborCost: 5500,
      deductible: 500,
      deductibleWaived: 0,
      notes: 'Hail damage — 12+ panels, PDR vs. repaint decision',
      photos: 2,
    },
    {
      num: '003',
      customer: { name: 'Mike Rodriguez', phone: '(240) 555-3456', email: '' },
      vehicle: { year: 2018, make: 'Ford', model: 'F-150', color: 'Black', plate: 'DEMO003', vin: '1FM5K8D87LGA024521' },
      status: 'parts',
      payType: 'insurance',
      insurer: 'Geico',
      claimSuffix: '003',
      estimatedDelivery: 5,
      actualDelivery: null,
      partsCost: 3200,
      laborCost: 3000,
      deductible: 500,
      deductibleWaived: 0,
      notes: 'Frame damage — waiting for frame rails & suspension parts (ETA: 3/31)',
      photos: 2,
    },
  ],
};

/**
 * Generate placeholder damage images as PNG files
 * Creates 1x1 pixel PNG (minimal file, not corrupt)
 */
function generatePlaceholderImage(filename) {
  // Minimal 1x1 PNG (binary header)
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x9F, 0xE6, 0xDF,
    0x57, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
  ]);
  
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filename, png);
}

async function seedDemo() {
  console.log('🚀 REVV Demo Seed Script');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log('');

  try {
    // Check for existing demo shop
    const existingShop = await dbGet(
      `SELECT id FROM shops WHERE name = $1 LIMIT 1`,
      [DEMO_CONFIG.shop.name]
    );

    if (existingShop && !forceReseed) {
      console.log('✅ Demo shop already exists. Skipping seed.');
      console.log('   (Use --force to wipe and recreate)');
      return { success: true, skipped: true };
    }

    if (existingShop && forceReseed) {
      console.log('🔄 --force flag: wiping existing demo shop...');
      const shopId = existingShop.id;
      
      // Cascade delete via foreign keys
      await dbRun(`DELETE FROM repair_orders WHERE shop_id = $1`, [shopId]);
      await dbRun(`DELETE FROM vehicles WHERE shop_id = $1`, [shopId]);
      await dbRun(`DELETE FROM customers WHERE shop_id = $1`, [shopId]);
      await dbRun(`DELETE FROM users WHERE shop_id = $1`, [shopId]);
      await dbRun(`DELETE FROM shops WHERE id = $1`, [shopId]);
      console.log('   ✓ Demo shop deleted');
    }

    // 1. Create shop
    const shopId = uuidv4();
    console.log('📦 Creating shop...');
    await dbRun(
      `INSERT INTO shops (id, name, onboarded, phone, address, city, state, zip, market_tier, labor_rate, parts_markup, tax_rate)
       VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        shopId,
        DEMO_CONFIG.shop.name,
        DEMO_CONFIG.shop.phone,
        DEMO_CONFIG.shop.address,
        DEMO_CONFIG.shop.city,
        DEMO_CONFIG.shop.state,
        DEMO_CONFIG.shop.zip,
        1,
        DEMO_CONFIG.shop.laborRate,
        DEMO_CONFIG.shop.partsMarkup,
        DEMO_CONFIG.shop.taxRate,
      ]
    );
    console.log(`   ✓ Shop: ${DEMO_CONFIG.shop.name} (${DEMO_CONFIG.shop.address})`);

    // 2. Create users
    console.log('👥 Creating users...');
    const userIds = {};
    for (const user of DEMO_CONFIG.users) {
      const userId = uuidv4();
      const hash = await bcrypt.hash(user.password, 10);
      await dbRun(
        `INSERT INTO users (id, shop_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, shopId, user.name, user.email, hash, user.role]
      );
      userIds[user.email] = userId;
      console.log(`   ✓ ${user.name} (${user.email}) — ${user.role}`);
    }

    // 3. Create ROs with customers, vehicles, and photos
    console.log('🛠️  Creating repair orders...');
    for (let idx = 0; idx < DEMO_CONFIG.ros.length; idx++) {
      const ro = DEMO_CONFIG.ros[idx];
      const custId = uuidv4();
      const vehId = uuidv4();
      const roId = uuidv4();

      // Create customer
      await dbRun(
        `INSERT INTO customers (id, shop_id, name, phone, email, insurance_company) VALUES ($1, $2, $3, $4, $5, $6)`,
        [custId, shopId, ro.customer.name, ro.customer.phone, ro.customer.email || null, ro.insurer]
      );

      // Create vehicle
      await dbRun(
        `INSERT INTO vehicles (id, shop_id, customer_id, year, make, model, color, plate, vin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [vehId, shopId, custId, ro.vehicle.year, ro.vehicle.make, ro.vehicle.model, ro.vehicle.color, ro.vehicle.plate, ro.vehicle.vin]
      );

      // Calculate dates
      const intakeDate = new Date(2026, 2, 28); // Mar 28, 2026
      const estimatedDelivery = new Date(intakeDate);
      estimatedDelivery.setDate(estimatedDelivery.getDate() + ro.estimatedDelivery);

      const total = ro.partsCost + ro.laborCost;
      const trueProfit = (ro.laborCost - (ro.partsCost * 0.1)) - ro.deductibleWaived;

      // Create RO
      const roNumber = `RO-2026-${String(ro.num).padStart(4, '0')}`;
      await dbRun(
        `INSERT INTO repair_orders (id, shop_id, ro_number, vehicle_id, customer_id, job_type, status, payment_type,
          claim_number, insurer, deductible, intake_date, estimated_delivery, parts_cost, labor_cost, total,
          deductible_waived, referral_fee, true_profit, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          roId, shopId, roNumber, vehId, custId, 'collision', ro.status, ro.payType,
          `CLM-2026-${ro.claimSuffix}`, ro.insurer, ro.deductible,
          intakeDate, estimatedDelivery,
          ro.partsCost, ro.laborCost, total,
          ro.deductibleWaived, 0, trueProfit,
          ro.notes,
        ]
      );

      // Log status change
      await dbRun(
        `INSERT INTO job_status_log (id, ro_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), roId, null, ro.status, 'system']
      );

      console.log(`   ✓ RO #${ro.num} — ${ro.customer.name} / ${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model} — ${ro.status}`);

      // 4. Generate placeholder photos
      if (ro.photos > 0) {
        const uploadsDir = path.join(__dirname, '../backend/uploads/photos');
        for (let p = 1; p <= ro.photos; p++) {
          const photoFile = path.join(uploadsDir, `ro-${roNumber}-damage-${p}.png`);
          generatePlaceholderImage(photoFile);
        }
        console.log(`      📸 Generated ${ro.photos} placeholder photos`);
      }
    }

    console.log('');
    console.log('✅ Demo seed complete!');
    console.log('');
    console.log('📋 Demo Credentials:');
    DEMO_CONFIG.users.forEach(u => {
      console.log(`   ${u.email} / ${u.password}`);
    });
    console.log('');
    console.log('📊 Created:');
    console.log(`   • 1 shop (${DEMO_CONFIG.shop.name})`);
    console.log(`   • ${DEMO_CONFIG.users.length} users`);
    console.log(`   • ${DEMO_CONFIG.ros.length} repair orders`);
    console.log(`   • ${DEMO_CONFIG.ros.reduce((sum, ro) => sum + ro.photos, 0)} sample photos`);
    console.log('');

    return { success: true, shopId };
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  seedDemo()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seedDemo };
