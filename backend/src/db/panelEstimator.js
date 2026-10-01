'use strict';

// Explicit opt-in migration: no default database, startup hook, or environment load.
async function ensurePanelEstimator(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('revv-panel-estimator-schema'))");
    const types = {};
    for (const table of ['shops', 'repair_orders']) {
      const { rows } = await client.query(`SELECT format_type(atttypid, atttypmod) AS type
        FROM pg_attribute WHERE attrelid = $1::regclass AND attname = 'id'
        AND attnum > 0 AND NOT attisdropped`, [table]);
      const type = rows[0]?.type;
      if (!['text', 'uuid', 'character varying', 'character varying(36)', 'character varying(255)'].includes(type)) {
        throw new Error('Unsupported panel estimator parent identifier type');
      }
      types[table] = type;
    }
    // Composite FK prevents a valid shop and valid RO from being paired incorrectly.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ro_panel_estimator_parent_owner
      ON repair_orders (shop_id, id)`);
    await client.query(`CREATE TABLE IF NOT EXISTS ro_panel_estimator_drafts (
      shop_id ${types.shops} NOT NULL REFERENCES shops(id),
      ro_id ${types.repair_orders} NOT NULL,
      version BIGINT NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
      assessments JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(assessments) = 'array'),
      scenario JSONB NOT NULL DEFAULT '{"payer":"cash","provenance":"shop_prepared","allocation":null}'
        CHECK (jsonb_typeof(scenario) = 'object'),
      adjustments JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(adjustments) = 'object'),
      PRIMARY KEY (shop_id, ro_id),
      FOREIGN KEY (shop_id, ro_id) REFERENCES repair_orders(shop_id, id)
    )`);
    // Version belongs only to the draft, including when only private costs change.
    // These snapshots can coexist with future immutable revisions without ID changes.
    await client.query(`CREATE TABLE IF NOT EXISTS ro_panel_estimator_costs (
      shop_id ${types.shops} NOT NULL,
      ro_id ${types.repair_orders} NOT NULL,
      lines JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(lines) = 'array'),
      target_margin_bps INTEGER CHECK (target_margin_bps BETWEEN 0 AND 9999),
      overhead_cents BIGINT CHECK (overhead_cents BETWEEN 0 AND 9007199254740991),
      reason TEXT CHECK (length(reason) <= 4000),
      PRIMARY KEY (shop_id, ro_id),
      FOREIGN KEY (shop_id, ro_id) REFERENCES ro_panel_estimator_drafts(shop_id, ro_id)
    )`);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensurePanelEstimator };
