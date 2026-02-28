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
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
      `ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS paid_amount INTEGER`,
      `UPDATE repair_orders SET payment_status = 'succeeded' WHERE payment_status IS NULL AND payment_received = 1`,
      `UPDATE repair_orders SET payment_status = 'unpaid' WHERE payment_status IS NULL`,
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
        ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
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
    ];

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
