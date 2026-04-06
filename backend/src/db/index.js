require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      onboarded BOOLEAN DEFAULT FALSE,
      phone TEXT,
      logo_url TEXT,
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
      quickbooks_company_id TEXT,
      quickbooks_realm_id TEXT,
      quickbooks_access_token TEXT,
      quickbooks_refresh_token TEXT,
      quickbooks_token_expires_at TIMESTAMP WITH TIME ZONE,
      quickbooks_refresh_expires_at TIMESTAMP WITH TIME ZONE,
      quickbooks_connected_at TIMESTAMP WITH TIME ZONE,
      quickbooks_last_sync_at TIMESTAMP WITH TIME ZONE,
      quickbooks_sync_enabled BOOLEAN DEFAULT FALSE,
      quickbooks_environment TEXT DEFAULT 'production',
      sms_notifications_enabled BOOLEAN DEFAULT TRUE,
      email_notifications_enabled BOOLEAN DEFAULT TRUE,
      monthly_revenue_target INTEGER DEFAULT 85000,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customers (
      id UUID PRIMARY KEY,
      shop_id UUID REFERENCES shops(id),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      insurance_company TEXT,
      policy_number TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      phone TEXT,
      customer_id UUID REFERENCES customers(id),
      revoke_all_before TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id UUID PRIMARY KEY,
      shop_id UUID REFERENCES shops(id),
      customer_id UUID REFERENCES customers(id),
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
      id UUID PRIMARY KEY,
      shop_id UUID REFERENCES shops(id),
      ro_number TEXT UNIQUE,
      vehicle_id UUID REFERENCES vehicles(id),
      customer_id UUID REFERENCES customers(id),
      job_type TEXT DEFAULT 'collision',
      status TEXT DEFAULT 'intake',
      payment_type TEXT DEFAULT 'insurance',
      payment_status TEXT DEFAULT 'unpaid',
      claim_number TEXT,
      insurer TEXT,
      insurance_claim_number TEXT,
      insurance_company TEXT,
      adjuster_name TEXT,
      adjuster_phone TEXT,
      adjuster_email TEXT,
      policy_number TEXT,
      deductible REAL DEFAULT 0,
      is_drp BOOLEAN DEFAULT FALSE,
      insurance_approved_amount INTEGER,
      supplement_status TEXT DEFAULT 'none',
      supplement_amount INTEGER,
      supplement_notes TEXT,
      total_insurer_owed INTEGER,
      intake_date TEXT,
      estimated_delivery TEXT,
      actual_delivery TEXT,
      pickup_type TEXT DEFAULT 'customer',
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
      id UUID PRIMARY KEY,
      ro_id UUID REFERENCES repair_orders(id),
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by TEXT,
      note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS claim_links (
      id UUID PRIMARY KEY,
      shop_id UUID NOT NULL,
      ro_id UUID NOT NULL,
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
      id UUID PRIMARY KEY,
      shop_id UUID REFERENCES shops(id),
      ro_id UUID REFERENCES repair_orders(id),
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
      id UUID PRIMARY KEY,
      shop_id UUID REFERENCES shops(id),
      user_id UUID REFERENCES users(id),
      shift_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS early_clockin_authorizations (
      id UUID PRIMARY KEY,
      shop_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      date TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      used SMALLINT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id UUID PRIMARY KEY,
      shop_id UUID REFERENCES shops(id),
      user_id UUID REFERENCES users(id),
      clock_in TEXT,
      clock_out TEXT,
      clock_in_lat REAL,
      clock_in_lng REAL,
      clock_out_lat REAL,
      clock_out_lng REAL,
      scheduled_start TEXT,
      is_late SMALLINT DEFAULT 0,
      late_minutes INTEGER DEFAULT 0,
      unscheduled_approved_by TEXT,
      unscheduled_approved_at TIMESTAMPTZ,
      total_hours REAL,
      adjusted_by TEXT,
      admin_note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used SMALLINT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      id UUID PRIMARY KEY,
      token_jti TEXT UNIQUE NOT NULL,
      user_id UUID,
      revoked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ro_photos (
      id UUID PRIMARY KEY,
      ro_id UUID,
      user_id UUID,
      photo_url TEXT,
      caption TEXT,
      photo_type TEXT DEFAULT 'damage',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ro_claim_evidence (
      id UUID PRIMARY KEY,
      ro_id UUID,
      shop_id UUID,
      uploaded_by UUID,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL,
      mime_type TEXT,
      caption TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ro_claim_contacts (
      id UUID PRIMARY KEY,
      ro_id UUID,
      shop_id UUID,
      logged_by UUID,
      insurer_name TEXT,
      contact_name TEXT NOT NULL,
      channel TEXT NOT NULL,
      summary TEXT NOT NULL,
      outcome TEXT,
      follow_up TEXT,
      contact_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ro_claim_disputes (
      id UUID PRIMARY KEY,
      ro_id UUID,
      shop_id UUID,
      created_by UUID,
      note TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS parts_requests (
      id UUID PRIMARY KEY,
      ro_id UUID,
      requested_by TEXT,
      part_name TEXT,
      part_number TEXT,
      quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id UUID PRIMARY KEY,
      app TEXT DEFAULT 'shopcommand',
      tester_name TEXT,
      shop_id TEXT,
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
      id UUID PRIMARY KEY,
      shop_id UUID NOT NULL REFERENCES shops(id),
      ro_id UUID NOT NULL REFERENCES repair_orders(id),
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

  // vehicle_diagnostic_scans — prefer FK-backed schema, but auto-fallback to a
  // compatibility table when legacy schema drift prevents FK creation.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicle_diagnostic_scans (
        id SERIAL PRIMARY KEY,
        shop_id UUID REFERENCES shops(id),
        ro_id UUID REFERENCES repair_orders(id),
        vehicle_id UUID REFERENCES vehicles(id),
        vin TEXT,
        scan_date TIMESTAMPTZ DEFAULT NOW(),
        scanned_by TEXT,
        scanner_tool TEXT,
        pre_repair BOOLEAN DEFAULT FALSE,
        post_repair BOOLEAN DEFAULT FALSE,
        dtc_codes JSONB DEFAULT '[]',
        adas_systems JSONB DEFAULT '[]',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.warn('[DB] vehicle_diagnostic_scans FK create failed, using compatibility schema:', e.message);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicle_diagnostic_scans (
        id SERIAL PRIMARY KEY,
        shop_id TEXT NOT NULL,
        ro_id TEXT,
        vehicle_id TEXT,
        vin TEXT,
        scan_date TIMESTAMPTZ DEFAULT NOW(),
        scanned_by TEXT,
        scanner_tool TEXT,
        pre_repair BOOLEAN DEFAULT FALSE,
        post_repair BOOLEAN DEFAULT FALSE,
        dtc_codes JSONB DEFAULT '[]',
        adas_systems JSONB DEFAULT '[]',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  console.log('[DB] Tables initialized');

  // Add missing columns to existing repair_orders table in production
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_approved_at TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_approved_by TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_received INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_received_at TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_method TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS invoice_emailed_at TEXT`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS billing_month VARCHAR(7)`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS revenue_period VARCHAR(8) DEFAULT 'current'`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS carried_over BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE repair_orders ALTER COLUMN billing_month SET DEFAULT TO_CHAR(NOW(), 'YYYY-MM')`);
  await pool.query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS pickup_type TEXT DEFAULT 'customer'`);
  await pool.query(`ALTER TABLE repair_orders ALTER COLUMN revenue_period SET DEFAULT 'current'`);
  await pool.query(`ALTER TABLE repair_orders ALTER COLUMN carried_over SET DEFAULT FALSE`);
  await pool.query(`UPDATE repair_orders SET billing_month = TO_CHAR(created_at, 'YYYY-MM') WHERE billing_month IS NULL`);
  await pool.query(`UPDATE repair_orders SET payment_status = 'succeeded' WHERE payment_status IS NULL AND payment_received = 1`);
  await pool.query(`UPDATE repair_orders SET payment_status = 'unpaid' WHERE payment_status IS NULL`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS logo_url TEXT`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_company_id TEXT`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_realm_id TEXT`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_access_token TEXT`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_refresh_token TEXT`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_token_expires_at TIMESTAMP WITH TIME ZONE`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_refresh_expires_at TIMESTAMP WITH TIME ZONE`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_connected_at TIMESTAMP WITH TIME ZONE`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_last_sync_at TIMESTAMP WITH TIME ZONE`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_sync_enabled BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS quickbooks_environment TEXT DEFAULT 'production'`);
  await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS shop_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_shop_created_at ON feedback(shop_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC)`);
  await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS unscheduled_approved_by TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS unscheduled_approved_at TIMESTAMP WITH TIME ZONE`).catch(() => {});

  // Wave 4: lunch breaks, notifications, schedule lunch field
  await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS lunch_break_minutes INTEGER DEFAULT 30`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lunch_breaks (
      id UUID PRIMARY KEY,
      shop_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      time_entry_id UUID,
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
      id UUID PRIMARY KEY,
      ro_id UUID NOT NULL REFERENCES repair_orders(id),
      shop_id UUID NOT NULL REFERENCES shops(id),
      user_id UUID REFERENCES users(id),
      channel TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'outbound',
      summary TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS channel TEXT`);
  await pool.query(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS direction TEXT`);
  await pool.query(`ALTER TABLE ro_comms ADD COLUMN IF NOT EXISTS summary TEXT`);
  await pool.query(`
    UPDATE ro_comms
    SET channel = CASE
      WHEN channel IS NOT NULL THEN channel
      WHEN type = 'text' THEN 'sms'
      WHEN type IN ('call', 'email', 'in-person') THEN type
      ELSE 'call'
    END
  `).catch(() => {});
  await pool.query(`UPDATE ro_comms SET direction = COALESCE(direction, 'outbound')`).catch(() => {});
  await pool.query(`UPDATE ro_comms SET summary = COALESCE(summary, notes, '')`).catch(() => {});
  await pool.query(`ALTER TABLE ro_comms ALTER COLUMN direction SET DEFAULT 'outbound'`).catch(() => {});
  await pool.query(`ALTER TABLE ro_comms ALTER COLUMN channel SET DEFAULT 'call'`).catch(() => {});
  await pool.query(`ALTER TABLE ro_comms ALTER COLUMN summary SET DEFAULT ''`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS parts_inventory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      part_number TEXT NOT NULL,
      name TEXT NOT NULL,
      qty_on_hand INTEGER NOT NULL DEFAULT 0,
      reorder_point INTEGER NOT NULL DEFAULT 0,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      supplier TEXT,
      location TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS cost_cents INTEGER`).catch(() => {});
  await pool.query(`UPDATE parts_inventory SET cost_cents = COALESCE(cost_cents, ROUND(cost * 100)::INTEGER, 0)`).catch(() => {});
  await pool.query(`ALTER TABLE parts_inventory ALTER COLUMN cost_cents SET DEFAULT 0`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parts_inventory_shop ON parts_inventory(shop_id)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parts_inventory_low_stock ON parts_inventory(shop_id, qty_on_hand, reorder_point)`).catch(() => {});
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_inventory_shop_part_number ON parts_inventory(shop_id, part_number)`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS estimate_approval_links (
      id UUID PRIMARY KEY,
      ro_id UUID NOT NULL REFERENCES repair_orders(id),
      shop_id UUID NOT NULL REFERENCES shops(id),
      token TEXT NOT NULL UNIQUE,
      created_by UUID REFERENCES users(id),
      decline_reason TEXT,
      responded_at TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_requests (
      id UUID PRIMARY KEY,
      shop_id UUID NOT NULL REFERENCES shops(id),
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS estimate_requests (
      id UUID PRIMARY KEY,
      shop_id TEXT REFERENCES shops(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      year TEXT NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      damage_type TEXT NOT NULL,
      description TEXT,
      preferred_date TEXT,
      photos_json TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Customer experience: portal tokens for tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_tokens (
      id UUID PRIMARY KEY,
      ro_id UUID NOT NULL REFERENCES repair_orders(id),
      shop_id UUID NOT NULL REFERENCES shops(id),
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TEXT
    )
  `);

  // Customer experience: ratings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ro_ratings (
      id UUID PRIMARY KEY,
      ro_id UUID NOT NULL REFERENCES repair_orders(id),
      shop_id UUID NOT NULL REFERENCES shops(id),
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_goals (
      id UUID PRIMARY KEY,
      shop_id UUID NOT NULL REFERENCES shops(id),
      year_month TEXT NOT NULL,
      revenue_goal REAL,
      ro_goal INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(shop_id, year_month)
    )
  `);

  // Estimate builder line items (kept text-typed for cross-schema compatibility)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS estimate_line_items (
      id TEXT PRIMARY KEY,
      ro_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('labor','parts','sublet','other')),
      description TEXT NOT NULL DEFAULT '',
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
      total NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
      taxable BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_estimate_line_items_ro ON estimate_line_items(ro_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_estimate_line_items_shop ON estimate_line_items(shop_id)`);

  await pool.query(`
    ALTER TABLE shops
    ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT TRUE
  `);
  await pool.query(`
    ALTER TABLE shops
    ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT TRUE
  `);

  const demoOwnerEmail = (process.env.DEMO_OWNER_EMAIL || '').trim().toLowerCase();
  if (demoOwnerEmail) {
    // Ensure configured demo shop is always marked as onboarded (fixes existing deployments)
    await pool.query(
      `
        UPDATE shops
        SET onboarded = TRUE
        WHERE id IN (SELECT shop_id FROM users WHERE email = $1)
      `,
      [demoOwnerEmail]
    ).catch(() => {});

    // Fix configured demo shop stuck at DC (Railway migration)
    await pool.query(
      `
        UPDATE shops
        SET city = 'New York', state = 'NY', zip = '10001', address = '123 Miles Ave', market_tier = 1
        WHERE id IN (SELECT shop_id FROM users WHERE email = $1)
        AND state = 'DC'
      `,
      [demoOwnerEmail]
    ).catch(() => {});
  }
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
