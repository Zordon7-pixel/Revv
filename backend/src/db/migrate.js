const fs = require('fs');
const path = require('path');

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set, skipping PostgreSQL migrations.');
    return;
  }

  const { pool, query } = require('./postgres');
  const schemaPath = path.join(__dirname, 'schema.pg.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  try {
    const exists = await query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS exists`
    );

    if (!exists.rows[0]?.exists) {
      await query(schemaSql);
      await query('ALTER TABLE shops ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT FALSE');
      await query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'`);
      await query(`UPDATE repair_orders SET payment_status = 'succeeded' WHERE payment_status IS NULL AND payment_received = 1`);
      await query(`UPDATE repair_orders SET payment_status = 'unpaid' WHERE payment_status IS NULL`);
      await query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS damaged_panels TEXT DEFAULT '[]'`);
      await query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS claim_status TEXT DEFAULT NULL`);
      await query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS pre_siu_status TEXT DEFAULT NULL`);
      await query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
          read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_shop_user
        ON notifications(shop_id, user_id, read, created_at DESC)
      `);
      console.log('PostgreSQL schema created.');
    } else {
      await query(schemaSql);
      await query('ALTER TABLE shops ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT FALSE');
      await query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'`);
      await query(`UPDATE repair_orders SET payment_status = 'succeeded' WHERE payment_status IS NULL AND payment_received = 1`);
      await query(`UPDATE repair_orders SET payment_status = 'unpaid' WHERE payment_status IS NULL`);
      await query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS damaged_panels TEXT DEFAULT '[]'`);
      await query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS claim_status TEXT DEFAULT NULL`);
      await query(`ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS pre_siu_status TEXT DEFAULT NULL`);
      await query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
          read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_shop_user
        ON notifications(shop_id, user_id, read, created_at DESC)
      `);
      console.log('PostgreSQL schema already exists; ensured idempotent statements.');
    }
  } finally {
    await pool.end();
  }
}

module.exports = { runMigrations };
