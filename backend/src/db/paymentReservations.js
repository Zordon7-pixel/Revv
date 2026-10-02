'use strict';

// Startup/migration only. Never run DDL in a payment request. TEXT bindings work
// with both legacy TEXT and fresh UUID parents without rewriting financial rows.
async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('revv.payment-reservations.v1'))");
    await client.query(`CREATE TABLE IF NOT EXISTS ro_payments (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, ro_id TEXT NOT NULL,
      stripe_payment_intent_id TEXT UNIQUE, amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'usd', status TEXT DEFAULT 'pending', payment_method TEXT,
      receipt_email TEXT, paid_at TEXT, failure_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await client.query('ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER DEFAULT 0');
    await client.query('ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS amount_owed_cents INTEGER DEFAULT 0');
    await client.query(`CREATE TABLE IF NOT EXISTS ro_payment_attempts (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, ro_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
      kind TEXT NOT NULL CHECK (kind IN ('intent', 'checkout')),
      status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'open', 'unknown', 'retryable', 'settled')),
      stripe_payment_intent_id TEXT UNIQUE, stripe_checkout_session_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query('CREATE INDEX IF NOT EXISTS ro_payment_attempts_ro ON ro_payment_attempts(shop_id, ro_id)');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

// No down migration: reservations and settled evidence must survive rollback.
module.exports = { up };
