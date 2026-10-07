'use strict';

// Additive startup initializer only. Never infer enablement from historical AI use.
async function up(pool) {
  let client;
  let discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('revv.estimate-ai-policy.v1'))");
    await client.query('ALTER TABLE shops ADD COLUMN IF NOT EXISTS estimate_ai_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    const { rows: [column] } = await client.query(`SELECT atttypid::regtype::text AS type
      FROM pg_attribute WHERE attrelid = 'shops'::regclass
      AND attname = 'estimate_ai_enabled' AND NOT attisdropped`);
    if (column?.type !== 'boolean') throw new Error('Invalid estimate AI policy type');
    await client.query('ALTER TABLE shops ALTER COLUMN estimate_ai_enabled SET DEFAULT FALSE');
    // Refuse ambiguous existing NULLs; do not rewrite shop policy to make migration pass.
    await client.query('ALTER TABLE shops ALTER COLUMN estimate_ai_enabled SET NOT NULL');
    // Logical shop identity, intentionally TEXT without a UUID-only foreign key.
    // Admissions validate and lock the actual parent before touching this row.
    await client.query(`CREATE TABLE IF NOT EXISTS estimate_ai_budgets (
      shop_id TEXT PRIMARY KEY,
      window_started_at TIMESTAMPTZ NOT NULL CHECK (isfinite(window_started_at)),
      admission_count INTEGER NOT NULL CHECK (admission_count BETWEEN 1 AND 15)
    )`);
    const { rows: columns } = await client.query(`SELECT attname AS name,
      atttypid::regtype::text AS type, attnotnull AS required FROM pg_attribute
      WHERE attrelid = 'estimate_ai_budgets'::regclass AND attnum > 0 AND NOT attisdropped`);
    const expected = { shop_id: 'text', window_started_at: 'timestamp with time zone', admission_count: 'integer' };
    for (const [name, type] of Object.entries(expected)) {
      if (!columns.some(column => column.name === name && column.type === type && column.required)) {
        throw new Error('Invalid estimate AI budget schema');
      }
    }
    const { rows: [key] } = await client.query(`SELECT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid
      AND c.conkey = ARRAY[a.attnum] WHERE c.conrelid = 'estimate_ai_budgets'::regclass
      AND c.contype = 'p' AND a.attname = 'shop_id') AS valid`);
    if (key?.valid !== true) throw new Error('Missing estimate AI budget primary key');
    await client.query('COMMIT');
  } catch {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    const error = new Error('Estimate AI schema initialization failed; policy and budget rows preserved');
    error.code = 'ESTIMATE_AI_SCHEMA_REQUIRED';
    throw error;
  } finally {
    if (client) client.release(discard);
  }
}

module.exports = { up };
