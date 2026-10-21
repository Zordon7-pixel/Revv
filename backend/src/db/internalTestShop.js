'use strict';

const INTERNAL_TEST_SHOP_SCHEMA_REQUIRED = 'INTERNAL_TEST_SHOP_SCHEMA_REQUIRED';

// Foundation only: no shop can be designated until ALL consumer exclusions land.
// Keep this constraint in both fresh schemas and the required startup migration.
// A later reviewed candidate must replace this hold before adding provisioning.
async function up(pool) {
  let client;
  let discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('revv.internal-test-shop.v1'))");
    await client.query(`
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_internal_test_shop BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE shops ALTER COLUMN is_internal_test_shop SET DEFAULT FALSE;
      ALTER TABLE shops ALTER COLUMN is_internal_test_shop SET NOT NULL;
      DO $test_shop$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_attribute WHERE attrelid = 'shops'::regclass
            AND attname = 'is_internal_test_shop' AND NOT attisdropped
            AND atttypid = 'boolean'::regtype
        ) THEN
          RAISE EXCEPTION 'Invalid internal test shop column';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conrelid = 'shops'::regclass
            AND conname = 'shops_internal_test_shop_hold'
        ) THEN
          ALTER TABLE shops ADD CONSTRAINT shops_internal_test_shop_hold
            CHECK (is_internal_test_shop IS FALSE);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conrelid = 'shops'::regclass
            AND conname = 'shops_internal_test_shop_hold' AND contype = 'c'
            AND convalidated AND NOT connoinherit
            AND pg_get_expr(conbin, conrelid) = '(is_internal_test_shop IS FALSE)'
        ) THEN
          RAISE EXCEPTION 'Invalid internal test shop hold';
        END IF;
      END;
      $test_shop$;
    `);
    await client.query('COMMIT');
  } catch {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    // Do not expose database errors, row contents, or connection details.
    const error = new Error('Internal test shop schema initialization failed; designation remains unavailable');
    error.code = INTERNAL_TEST_SHOP_SCHEMA_REQUIRED;
    throw error;
  } finally {
    if (client) client.release(discard);
  }
}

module.exports = { up, INTERNAL_TEST_SHOP_SCHEMA_REQUIRED };
