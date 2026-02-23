require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
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
      lat REAL,
      lng REAL,
      geofence_radius REAL DEFAULT 0.5,
      tracking_api_key TEXT,
      twilio_account_sid TEXT,
      twilio_auth_token TEXT,
      twilio_phone_number TEXT,
      monthly_revenue_target INTEGER DEFAULT 85000,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      shop_id TEXT REFERENCES shops(id),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      phone TEXT,
      customer_id TEXT REFERENCES customers(id),
      revoke_all_before TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
      assigned_to TEXT,
      tech_notes TEXT,
      estimate_status TEXT DEFAULT 'pending',
      estimate_approved_at TEXT,
      estimate_approved_by TEXT,
      estimate_token TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS job_status_log (
      id TEXT PRIMARY KEY,
      ro_id TEXT REFERENCES repair_orders(id),
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by TEXT,
      note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS claim_links (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      ro_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TEXT,
      adjustor_name TEXT,
      adjustor_company TEXT,
      adjustor_email TEXT,
      approved_labor REAL,
      approved_parts REAL,
      supplement_amount REAL,
      adjustor_notes TEXT,
      assessment_filename TEXT,
      submitted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS parts_orders (
      id TEXT PRIMARY KEY,
      shop_id TEXT REFERENCES shops(id),
      ro_id TEXT REFERENCES repair_orders(id),
      part_name TEXT NOT NULL,
      part_number TEXT,
      vendor TEXT,
      quantity INTEGER DEFAULT 1,
      unit_cost REAL DEFAULT 0,
      status TEXT DEFAULT 'ordered',
      ordered_date TEXT,
      expected_date TEXT,
      received_date TEXT,
      notes TEXT,
      tracking_number TEXT,
      carrier TEXT,
      tracking_status TEXT,
      tracking_detail TEXT,
      tracking_updated_at TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      shop_id TEXT REFERENCES shops(id),
      user_id TEXT REFERENCES users(id),
      shift_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS early_clockin_authorizations (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      used SMALLINT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      shop_id TEXT REFERENCES shops(id),
      user_id TEXT REFERENCES users(id),
      clock_in TEXT,
      clock_out TEXT,
      clock_in_lat REAL,
      clock_in_lng REAL,
      clock_out_lat REAL,
      clock_out_lng REAL,
      scheduled_start TEXT,
      is_late SMALLINT DEFAULT 0,
      late_minutes INTEGER DEFAULT 0,
      total_hours REAL,
      adjusted_by TEXT,
      admin_note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used SMALLINT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      id TEXT PRIMARY KEY,
      token_jti TEXT UNIQUE NOT NULL,
      user_id TEXT,
      revoked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ro_photos (
      id TEXT PRIMARY KEY,
      ro_id TEXT,
      user_id TEXT,
      photo_url TEXT,
      caption TEXT,
      photo_type TEXT DEFAULT 'damage',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS parts_requests (
      id TEXT PRIMARY KEY,
      ro_id TEXT,
      requested_by TEXT,
      part_name TEXT,
      part_number TEXT,
      quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      app TEXT DEFAULT 'shopcommand',
      tester_name TEXT,
      category TEXT,
      priority TEXT DEFAULT 'medium',
      message TEXT NOT NULL,
      expected TEXT,
      page TEXT,
      status TEXT DEFAULT 'new',
      routed_to TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  console.log('[DB] Tables initialized');
}

async function dbGet(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows[0] || null;
}

async function dbAll(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function dbRun(sql, params = []) {
  const r = await pool.query(sql, params);
  return r;
}

module.exports = { pool, dbGet, dbAll, dbRun, initDb };
