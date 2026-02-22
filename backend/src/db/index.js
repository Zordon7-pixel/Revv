const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const dbPath = path.resolve(__dirname, '../../shopcommand.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    market_tier INTEGER DEFAULT 3,
    labor_rate REAL DEFAULT 62,
    parts_markup REAL DEFAULT 0.30,
    tax_rate REAL DEFAULT 0.0700,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    shop_id TEXT REFERENCES shops(id),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    shop_id TEXT REFERENCES shops(id),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    insurance_company TEXT,
    policy_number TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    shop_id TEXT REFERENCES shops(id),
    customer_id TEXT REFERENCES customers(id),
    year INTEGER,
    make TEXT,
    model TEXT,
    vin TEXT,
    color TEXT,
    plate TEXT,
    mileage INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS repair_orders (
    id TEXT PRIMARY KEY,
    shop_id TEXT REFERENCES shops(id),
    ro_number TEXT UNIQUE,
    vehicle_id TEXT REFERENCES vehicles(id),
    customer_id TEXT REFERENCES customers(id),
    job_type TEXT DEFAULT 'collision',
    status TEXT DEFAULT 'intake',
    payment_type TEXT DEFAULT 'insurance',
    claim_number TEXT,
    insurer TEXT,
    adjuster_name TEXT,
    adjuster_phone TEXT,
    adjuster_email TEXT,
    deductible REAL DEFAULT 0,
    intake_date TEXT,
    estimated_delivery TEXT,
    actual_delivery TEXT,
    parts_cost REAL DEFAULT 0,
    labor_cost REAL DEFAULT 0,
    sublet_cost REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL DEFAULT 0,
    deductible_waived REAL DEFAULT 0,
    referral_fee REAL DEFAULT 0,
    goodwill_repair_cost REAL DEFAULT 0,
    true_profit REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_status_log (
    id TEXT PRIMARY KEY,
    ro_id TEXT REFERENCES repair_orders(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_by TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migrations — add columns to existing DBs without breaking them
const migrations = [
  `ALTER TABLE shops ADD COLUMN city TEXT`,
  `ALTER TABLE shops ADD COLUMN state TEXT`,
  `ALTER TABLE shops ADD COLUMN zip TEXT`,
  `ALTER TABLE shops ADD COLUMN market_tier INTEGER DEFAULT 3`,
  `ALTER TABLE shops ADD COLUMN parts_markup REAL DEFAULT 0.30`,
  `ALTER TABLE users ADD COLUMN customer_id TEXT REFERENCES customers(id)`,
];
migrations.forEach(sql => {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
});

module.exports = db;
