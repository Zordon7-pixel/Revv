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
      onboarded BOOLEAN DEFAULT FALSE,
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
      payment_status TEXT DEFAULT 'unpaid',
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
      billing_month VARCHAR(7) DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
      revenue_period VARCHAR(8) DEFAULT 'current',
      carried_over BOOLEAN DEFAULT FALSE,
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

    CREATE TABLE IF NOT EXISTS ro_payments (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id),
      ro_id TEXT NOT NULL REFERENCES repair_orders(id),
      stripe_payment_intent_id TEXT UNIQUE,
      amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'pending',
      payment_method TEXT,
      receipt_email TEXT,
      paid_at TEXT,
      failure_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  console.log('[DB] Tables initialized');

  // Add missing columns to existing repair_orders table in production
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_approved_at TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_approved_by TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_received INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_received_at TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_method TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS billing_month VARCHAR(7)`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS revenue_period VARCHAR(8) DEFAULT 'current'`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS carried_over BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE repair_orders ALTER COLUMN billing_month SET DEFAULT TO_CHAR(NOW(), 'YYYY-MM')`);
  await pool.query(`ALTER TABLE repair_orders ALTER COLUMN revenue_period SET DEFAULT 'current'`);
  await pool.query(`ALTER TABLE repair_orders ALTER COLUMN carried_over SET DEFAULT FALSE`);
  await pool.query(`UPDATE repair_orders SET billing_month = TO_CHAR(created_at, 'YYYY-MM') WHERE billing_month IS NULL`);
  await pool.query(`UPDATE repair_orders SET payment_status = 'succeeded' WHERE payment_status IS NULL AND payment_received = 1`);
  await pool.query(`UPDATE repair_orders SET payment_status = 'unpaid' WHERE payment_status IS NULL`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT FALSE`);

  // Wave 4: lunch breaks, notifications, schedule lunch field
  await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS lunch_break_minutes INTEGER DEFAULT 30`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lunch_breaks (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      time_entry_id TEXT,
      lunch_start TIMESTAMP WITH TIME ZONE NOT NULL,
      lunch_end TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      ro_id TEXT,
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id TEXT`);
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT`);
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT`);
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ro_id TEXT`);
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE`);
  await pool.query(`UPDATE notifications SET body = message WHERE body IS NULL AND message IS NOT NULL`).catch(() => {});
  await pool.query(`UPDATE notifications SET user_id = employee_id WHERE user_id IS NULL AND employee_id IS NOT NULL`).catch(() => {});
  await pool.query(`UPDATE notifications SET title = type WHERE title IS NULL`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ro_comms (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL REFERENCES repair_orders(id),
      shop_id TEXT NOT NULL REFERENCES shops(id),
      user_id TEXT REFERENCES users(id),
      type TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS estimate_approval_links (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL REFERENCES repair_orders(id),
      shop_id TEXT NOT NULL REFERENCES shops(id),
      token TEXT NOT NULL UNIQUE,
      created_by TEXT REFERENCES users(id),
      decline_reason TEXT,
      responded_at TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_requests (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      vehicle_info TEXT,
      service TEXT NOT NULL,
      preferred_date TEXT,
      preferred_time TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Customer experience: portal tokens for tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_tokens (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL REFERENCES repair_orders(id),
      shop_id TEXT NOT NULL REFERENCES shops(id),
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TEXT
    )
  `);

  // Customer experience: ratings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ro_ratings (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL REFERENCES repair_orders(id),
      shop_id TEXT NOT NULL REFERENCES shops(id),
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_goals (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id),
      year_month TEXT NOT NULL,
      revenue_goal REAL,
      ro_goal INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(shop_id, year_month)
    )
  `);

  // Ensure demo shop is always marked as onboarded (fixes existing deployments)
  await pool.query(`
    UPDATE shops
    SET onboarded = TRUE
    WHERE id IN (SELECT shop_id FROM users WHERE email = 'demo@shop.com')
  `).catch(() => {});

  // Fix demo shop stuck at DC (Railway migration)
  await pool.query(`
    UPDATE shops
    SET city = 'New York', state = 'NY', zip = '10001', address = '123 Miles Ave', market_tier = 1
    WHERE id IN (SELECT shop_id FROM users WHERE email = 'demo@shop.com')
    AND state = 'DC'
  `).catch(() => {});
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
