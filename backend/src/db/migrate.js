const fs = require('fs');
const path = require('path');

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set, skipping PostgreSQL migrations.');
    return;
  }

  const { query } = require('./postgres');
  const schemaPath = path.join(__dirname, 'schema.pg.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  try {
    // Check if base schema exists
    const exists = await query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS exists`
    );

    if (!exists.rows[0]?.exists) {
      // Fresh DB — run full schema
      try { await query(schemaSql); } catch (e) { console.warn('[migrate] schemaSql warning:', e.message); }
      console.log('PostgreSQL schema created.');
    } else {
      // Existing DB — re-run schema idempotently (best effort)
      try { await query(schemaSql); } catch (e) { console.warn('[migrate] schemaSql warning (existing db):', e.message); }
      console.log('PostgreSQL schema already exists; running idempotent column additions.');
    }

    // ── Idempotent column additions ──────────────────────────────────────────
    // These ALWAYS run regardless of schema state. Each wrapped independently.
    const alters = [
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT TRUE`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS twilio_phone_number TEXT`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS monthly_revenue_target INTEGER DEFAULT 85000`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ`,
      `ALTER TABLE shops ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days')`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS revoke_all_before TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_received INTEGER DEFAULT 0`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_received_at TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_method TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS paid_amount INTEGER`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS tech_notes TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_status TEXT DEFAULT 'pending'`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_approved_at TIMESTAMPTZ`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_approved_by UUID REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_token TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS billing_month VARCHAR(7)`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS revenue_period VARCHAR(8) DEFAULT 'current'`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS carried_over BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimate_amount NUMERIC(12,2)`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS actual_amount NUMERIC(12,2)`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS auth_number TEXT`,
      `ALTER TABLE repair_orders ALTER COLUMN billing_month SET DEFAULT TO_CHAR(NOW(), 'YYYY-MM')`,
      `ALTER TABLE repair_orders ALTER COLUMN revenue_period SET DEFAULT 'current'`,
      `ALTER TABLE repair_orders ALTER COLUMN carried_over SET DEFAULT FALSE`,
      `UPDATE repair_orders SET payment_status = 'succeeded' WHERE payment_status IS NULL AND payment_received = 1`,
      `UPDATE repair_orders SET payment_status = 'unpaid' WHERE payment_status IS NULL`,
      `UPDATE repair_orders SET billing_month = TO_CHAR(COALESCE(created_at, NOW()), 'YYYY-MM') WHERE billing_month IS NULL`,
      `UPDATE repair_orders SET revenue_period = 'current' WHERE revenue_period IS NULL`,
      `UPDATE repair_orders SET carried_over = FALSE WHERE carried_over IS NULL`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS damaged_panels TEXT DEFAULT '[]'`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS claim_status TEXT DEFAULT NULL`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS pre_siu_status TEXT DEFAULT NULL`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS estimated_delivery DATE DEFAULT NULL`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS insurance_claim_number TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS insurance_company TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS policy_number TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS is_drp BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS insurance_approved_amount INTEGER`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS supplement_status TEXT DEFAULT 'none'`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS supplement_amount INTEGER`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS supplement_notes TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS total_insurer_owed INTEGER`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        message TEXT,
        ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT`,
      `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT`,
      `UPDATE notifications SET body = COALESCE(body, message, title) WHERE body IS NULL`,
      `UPDATE notifications SET message = COALESCE(message, body, title, '') WHERE message IS NULL`,
      `ALTER TABLE notifications ALTER COLUMN message SET DEFAULT ''`,
      `ALTER TABLE notifications ALTER COLUMN message SET NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_shop_user
       ON notifications(shop_id, user_id, read, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS inspections (
        id UUID PRIMARY KEY,
        ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        status TEXT DEFAULT 'draft',
        sent_at TIMESTAMPTZ,
        viewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS inspection_items (
        id UUID PRIMARY KEY,
        inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        item_name TEXT NOT NULL,
        condition TEXT,
        note TEXT,
        photo_url TEXT,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inspections_ro_id ON inspections(ro_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inspections_shop_id ON inspections(shop_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inspection_items_inspection_id ON inspection_items(inspection_id)`,
      `UPDATE repair_orders
       SET insurance_claim_number = claim_number
       WHERE insurance_claim_number IS NULL AND claim_number IS NOT NULL`,
      `UPDATE repair_orders
       SET insurance_company = insurer
       WHERE insurance_company IS NULL AND insurer IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS early_clockin_authorizations (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        authorized_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        used SMALLINT DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used SMALLINT DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS revoked_tokens (
        id UUID PRIMARY KEY,
        token_jti TEXT UNIQUE NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        revoked_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS ro_photos (
        id UUID PRIMARY KEY,
        ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        photo_url TEXT,
        caption TEXT,
        photo_type TEXT DEFAULT 'damage',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS parts_requests (
        id UUID PRIMARY KEY,
        ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
        requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
        part_name TEXT,
        part_number TEXT,
        quantity INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS feedback (
        id UUID PRIMARY KEY,
        app TEXT DEFAULT 'shopcommand',
        tester_name TEXT,
        category TEXT,
        priority TEXT DEFAULT 'medium',
        message TEXT NOT NULL,
        expected TEXT,
        page TEXT,
        status TEXT DEFAULT 'new',
        routed_to TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS ro_comms (
        id UUID PRIMARY KEY,
        ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS estimate_approval_links (
        id UUID PRIMARY KEY,
        ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        decline_reason TEXT,
        responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS appointment_requests (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        vehicle_info TEXT,
        service TEXT NOT NULL,
        preferred_date TEXT,
        preferred_time TEXT,
        notes TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS portal_tokens (
        id UUID PRIMARY KEY,
        ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS shop_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        ro_id UUID REFERENCES repair_orders(id) ON DELETE SET NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT,
        customer_name TEXT,
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_reviews_unique_ro
       ON shop_reviews(ro_id)
       WHERE ro_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS ro_ratings (
        id UUID PRIMARY KEY,
        ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS monthly_goals (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        year_month TEXT NOT NULL,
        revenue_goal NUMERIC(12,2),
        ro_goal INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(shop_id, year_month)
      )`,
      // Supplement tracker — individual supplement line items per RO
      `CREATE TABLE IF NOT EXISTS ro_supplements (
        id UUID PRIMARY KEY,
        ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Pending',
        submitted_date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ro_supplements_ro_id ON ro_supplements(ro_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ro_supplements_shop_id ON ro_supplements(shop_id)`,
    ];

    // Fix job_status_log FK to use ON DELETE CASCADE
    alters.push(
      `ALTER TABLE job_status_log DROP CONSTRAINT IF EXISTS job_status_log_ro_id_fkey`,
      `ALTER TABLE job_status_log ADD CONSTRAINT job_status_log_ro_id_fkey FOREIGN KEY (ro_id) REFERENCES repair_orders(id) ON DELETE CASCADE`
    );

    for (const sql of alters) {
      try {
        await query(sql);
      } catch (e) {
        console.warn('[migrate] alter warning:', e.message.split('\n')[0]);
      }
    }

    console.log('[migrate] All idempotent migrations complete.');
  } catch (err) {
    console.error('[migrate] Fatal migration error:', err.message);
  }
}

module.exports = { runMigrations };
