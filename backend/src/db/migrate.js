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
