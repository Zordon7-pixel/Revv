'use strict';

// Additive schema initializer; database is supplied by startup or isolated tests.
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
    await client.query(`ALTER TABLE ro_panel_estimator_costs ADD COLUMN IF NOT EXISTS private_notes TEXT
      CHECK (length(private_notes) <= 4000)`);
    await client.query(`ALTER TABLE ro_panel_estimator_costs ADD COLUMN IF NOT EXISTS include_overhead_in_target BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`CREATE TABLE IF NOT EXISTS panel_estimator_preset_families (
      shop_id ${types.shops} NOT NULL REFERENCES shops(id), id TEXT NOT NULL,
      archived BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY (shop_id, id)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS panel_estimator_preset_versions (
      shop_id ${types.shops} NOT NULL, id TEXT NOT NULL, family_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0), contract_version INTEGER NOT NULL CHECK (contract_version = 1),
      name TEXT NOT NULL, match JSONB NOT NULL CHECK (jsonb_typeof(match) = 'object'),
      sell_settings JSONB NOT NULL CHECK (jsonb_typeof(sell_settings) = 'object'),
      private_cost_config JSONB NOT NULL CHECK (jsonb_typeof(private_cost_config) = 'object'),
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 4000), created_by TEXT NOT NULL,
      effective_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (shop_id, id), UNIQUE (shop_id, family_id, version),
      FOREIGN KEY (shop_id, family_id) REFERENCES panel_estimator_preset_families(shop_id, id)
    )`);
    // A family can be archived; neither sell nor private historical versions can be rewritten.
    await client.query(`CREATE OR REPLACE FUNCTION panel_estimator_immutable_version() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable preset version' USING ERRCODE = '23514'; END $$`);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'panel_estimator_preset_versions'::regclass
        AND tgname = 'panel_estimator_immutable_version') THEN
        CREATE TRIGGER panel_estimator_immutable_version BEFORE UPDATE OR DELETE ON panel_estimator_preset_versions
          FOR EACH ROW EXECUTE FUNCTION panel_estimator_immutable_version();
      END IF;
    END $$`);
    await ensureRevisions(client, types);
    await ensureApprovals(client, types);
    await require('./paymentReservations').ensureFinancialGuards(client);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensurePanelEstimator };

async function ensureRevisions(client, types) {
  await client.query(`CREATE TABLE IF NOT EXISTS ro_panel_estimator_revisions (
    shop_id ${types.shops} NOT NULL, ro_id ${types.repair_orders} NOT NULL, id TEXT NOT NULL,
    version BIGINT NOT NULL CHECK (version > 0), scenario_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    input_hash TEXT NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
    quote_hash TEXT NOT NULL CHECK (quote_hash ~ '^[a-f0-9]{64}$'),
    reviewed BOOLEAN NOT NULL CHECK (reviewed), reviewed_by TEXT NOT NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    public_snapshot JSONB NOT NULL, accounting_snapshot JSONB NOT NULL,
    PRIMARY KEY (shop_id, ro_id, id), UNIQUE (shop_id, ro_id, idempotency_key),
    UNIQUE (shop_id, ro_id, version),
    FOREIGN KEY (shop_id, ro_id) REFERENCES ro_panel_estimator_drafts(shop_id, ro_id)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS ro_panel_estimator_revision_costs (
    shop_id ${types.shops} NOT NULL, ro_id ${types.repair_orders} NOT NULL, revision_id TEXT NOT NULL,
    snapshot JSONB NOT NULL, PRIMARY KEY (shop_id, ro_id, revision_id),
    FOREIGN KEY (shop_id, ro_id, revision_id) REFERENCES ro_panel_estimator_revisions(shop_id, ro_id, id)
  )`);
  await client.query(`ALTER TABLE ro_panel_estimator_drafts ADD COLUMN IF NOT EXISTS active_revision_id TEXT`);
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ro_panel_estimator_drafts'::regclass
      AND conname='panel_active_revision_owner') THEN
      ALTER TABLE ro_panel_estimator_drafts ADD CONSTRAINT panel_active_revision_owner
        FOREIGN KEY (shop_id, ro_id, active_revision_id) REFERENCES ro_panel_estimator_revisions(shop_id, ro_id, id);
    END IF;
  END $$`);
  for (const table of ['ro_panel_estimator_revisions', 'ro_panel_estimator_revision_costs']) {
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='panel_revision_immutable') THEN
        CREATE TRIGGER panel_revision_immutable BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION panel_estimator_immutable_version();
      END IF;
    END $$`);
  }
  // The transaction-local capability is set only by the server commit service.
  // Lock the parent before observing selection: legacy child writes racing a
  // commit wait, then see its committed pointer under READ COMMITTED.
  await client.query(`CREATE OR REPLACE FUNCTION panel_estimator_guard_owner(s TEXT, r TEXT) RETURNS void
    LANGUAGE plpgsql AS $$ BEGIN
      PERFORM id FROM repair_orders WHERE shop_id::text=s AND id::text=r FOR UPDATE;
      IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM repair_orders WHERE id::text=r) THEN
          RAISE EXCEPTION 'PANEL_REVISION_CONFLICT' USING ERRCODE='P0001';
        END IF;
        RETURN;
      END IF;
      IF EXISTS (SELECT 1 FROM ro_panel_estimator_drafts
        WHERE shop_id::text=s AND ro_id::text=r AND active_revision_id IS NOT NULL)
        AND current_setting('revv.panel_commit', true) IS DISTINCT FROM jsonb_build_array(s,r)::text THEN
        RAISE EXCEPTION 'PANEL_REVISION_CONFLICT' USING ERRCODE='P0001';
      END IF;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION panel_estimator_guard_child() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE parent RECORD; BEGIN
      FOR parent IN SELECT DISTINCT s,r FROM (VALUES
        (CASE WHEN TG_OP<>'INSERT' THEN OLD.shop_id::text END,CASE WHEN TG_OP<>'INSERT' THEN OLD.ro_id::text END),
        (CASE WHEN TG_OP<>'DELETE' THEN NEW.shop_id::text END,CASE WHEN TG_OP<>'DELETE' THEN NEW.ro_id::text END)) v(s,r)
        WHERE s IS NOT NULL AND r IS NOT NULL ORDER BY r,s LOOP
        PERFORM panel_estimator_guard_owner(parent.s,parent.r);
      END LOOP;
      IF TG_OP <> 'DELETE' THEN RETURN NEW; END IF;
      RETURN OLD;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION panel_estimator_guard_ro() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE k TEXT; owed BIGINT; ledger_paid BIGINT; BEGIN
      IF TG_OP='DELETE' THEN PERFORM panel_estimator_guard_owner(OLD.shop_id::text,OLD.id::text); RETURN OLD; END IF;
      -- Operational workflow is authorized by the lifecycle routes, independently
      -- of customer quote decisions. Financial and approval fields remain guarded.
      FOREACH k IN ARRAY ARRAY['id','shop_id','parts_cost','labor_cost','sublet_cost','tax','total','estimate_amount',
        'true_profit','deductible','deductible_waived','referral_fee','goodwill_repair_cost',
        'estimate_status','estimate_approved_at','estimate_approved_by','estimate_token','payment_type',
        'insurance_approved_amount','total_insurer_owed','supplement_amount','supplement_status',
        'claim_number','insurer','insurance_claim_number','insurance_company','adjuster_name',
        'adjuster_phone','adjuster_email','policy_number','is_drp','amount_owed_cents'] LOOP
        IF (to_jsonb(OLD)->k) IS DISTINCT FROM (to_jsonb(NEW)->k) THEN
          -- Intents store the derived balance; existing settlement routes store gross owed.
          -- Both must come from the selected quote, never caller-supplied financial totals.
          IF k = 'amount_owed_cents' THEN
            -- Optional legacy columns must be read through JSON, not record fields:
            -- PostgreSQL resolves record references even in an unselected AND arm.
            owed := (to_jsonb(NEW)->>'amount_owed_cents')::bigint;
            ledger_paid := 0;
            IF to_regclass('ro_payments') IS NOT NULL THEN
              SELECT COALESCE(SUM(p.amount_cents),0) INTO ledger_paid FROM ro_payments p
                WHERE p.ro_id::text=OLD.id::text AND p.shop_id::text=OLD.shop_id::text
                  AND LOWER(COALESCE(p.status,'')) IN ('paid','succeeded');
            END IF;
            IF owed >= 0 AND EXISTS (
              SELECT 1 FROM ro_panel_estimator_drafts d
              JOIN ro_panel_estimator_revisions r ON r.id=d.active_revision_id AND r.shop_id=d.shop_id AND r.ro_id=d.ro_id
              WHERE d.ro_id=OLD.id AND d.shop_id=OLD.shop_id
                AND owed IN ((r.accounting_snapshot->'money'->>'totalCents')::bigint,
                  (r.accounting_snapshot->'money'->>'totalCents')::bigint
                  - GREATEST(COALESCE((to_jsonb(OLD)->>'amount_paid_cents')::bigint,0), ledger_paid))
            ) THEN CONTINUE; END IF;
          END IF;
          PERFORM panel_estimator_guard_owner(OLD.shop_id::text,OLD.id::text);
          PERFORM panel_estimator_guard_owner(NEW.shop_id::text,NEW.id::text);
          EXIT;
        END IF;
      END LOOP;
      RETURN NEW;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION panel_estimator_guard_selection() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.active_revision_id IS DISTINCT FROM NEW.active_revision_id AND
        current_setting('revv.panel_commit', true) IS DISTINCT FROM jsonb_build_array(OLD.shop_id::text,OLD.ro_id::text)::text THEN
        RAISE EXCEPTION 'PANEL_REVISION_CONFLICT' USING ERRCODE='P0001';
      END IF;
      RETURN NEW;
    END $$`);
  const guards = [
    ['repair_orders', 'UPDATE OR DELETE', 'panel_estimator_guard_ro'],
    ['ro_panel_estimator_drafts', 'UPDATE', 'panel_estimator_guard_selection'],
    ['estimate_line_items', 'INSERT OR UPDATE OR DELETE', 'panel_estimator_guard_child'],
    ['estimate_metadata', 'INSERT OR UPDATE OR DELETE', 'panel_estimator_guard_child'],
    ['estimate_approval_links', 'INSERT OR UPDATE OR DELETE', 'panel_estimator_guard_child'],
  ];
  for (const [table, events, fn] of guards) {
    const exists = (await client.query('SELECT to_regclass($1) AS relation', [table])).rows[0].relation;
    if (!exists) continue; // Minimal standalone storage fixtures; next ensure installs it.
    if (table === 'estimate_line_items') {
      await client.query(`ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS panel_revision_id TEXT,
        ADD COLUMN IF NOT EXISTS panel_source_key TEXT, ADD COLUMN IF NOT EXISTS panel_fingerprint TEXT`);
    }
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='panel_estimator_guard') THEN
        CREATE TRIGGER panel_estimator_guard BEFORE ${events} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();
      END IF;
    END $$`);
  }
}

async function ensureApprovals(client, types) {
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS panel_revision_quote_owner
    ON ro_panel_estimator_revisions(shop_id, ro_id, id, quote_hash)`);
  await client.query(`CREATE TABLE IF NOT EXISTS ro_panel_estimator_approval_links (
    shop_id ${types.shops} NOT NULL, ro_id ${types.repair_orders} NOT NULL,
    id TEXT NOT NULL, revision_id TEXT NOT NULL, quote_hash TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    disclosure_version TEXT NOT NULL CHECK (disclosure_version = 'panel-quote-v1'),
    created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '168 hours',
    revoked_at TIMESTAMPTZ,
    CHECK (expires_at = created_at + INTERVAL '168 hours'),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    PRIMARY KEY (shop_id, ro_id, id),
    UNIQUE (shop_id, ro_id, id, revision_id, quote_hash, disclosure_version),
    FOREIGN KEY (shop_id, ro_id, revision_id, quote_hash)
      REFERENCES ro_panel_estimator_revisions(shop_id, ro_id, id, quote_hash)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS ro_panel_estimator_approval_events (
    shop_id ${types.shops} NOT NULL, ro_id ${types.repair_orders} NOT NULL,
    id TEXT NOT NULL, link_id TEXT NOT NULL, revision_id TEXT NOT NULL, quote_hash TEXT NOT NULL,
    disclosure_version TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('issued','revoked','decision')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), actor_id TEXT,
    decision TEXT, actor_name TEXT, acknowledged BOOLEAN, reason TEXT,
    CHECK ((kind = 'decision' AND decision IS NOT NULL AND decision IN ('approve','decline')
      AND actor_name IS NOT NULL AND length(btrim(actor_name)) BETWEEN 1 AND 200
      AND acknowledged IS TRUE AND
      ((decision = 'approve' AND reason IS NULL) OR
       (decision = 'decline' AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 4000)))
      OR (kind <> 'decision' AND decision IS NULL AND actor_name IS NULL AND acknowledged IS NULL AND reason IS NULL)),
    PRIMARY KEY (shop_id, ro_id, id), UNIQUE (shop_id, ro_id, link_id, kind),
    FOREIGN KEY (shop_id, ro_id, revision_id, quote_hash)
      REFERENCES ro_panel_estimator_revisions(shop_id, ro_id, id, quote_hash),
    FOREIGN KEY (shop_id, ro_id, link_id, revision_id, quote_hash, disclosure_version)
      REFERENCES ro_panel_estimator_approval_links(shop_id, ro_id, id, revision_id, quote_hash, disclosure_version)
  )`);
  // One decision per revision, even if an author issues multiple links.
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS panel_approval_revision_decision
    ON ro_panel_estimator_approval_events(shop_id, ro_id, revision_id) WHERE kind='decision'`);
  await client.query(`CREATE OR REPLACE FUNCTION panel_approval_link_immutable() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION 'Immutable approval link' USING ERRCODE='23514';
      END IF;
      IF (to_jsonb(OLD) - 'revoked_at') IS DISTINCT FROM (to_jsonb(NEW) - 'revoked_at')
        OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
        RAISE EXCEPTION 'Immutable approval link' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$`);
  for (const [table, fn] of [
    ['ro_panel_estimator_approval_links', 'panel_approval_link_immutable'],
    ['ro_panel_estimator_approval_events', 'panel_estimator_immutable_version'],
  ]) {
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='panel_approval_immutable') THEN
        CREATE TRIGGER panel_approval_immutable BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION ${fn}();
        CREATE TRIGGER panel_approval_no_truncate BEFORE TRUNCATE ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION panel_estimator_immutable_version();
      END IF;
    END $$`);
  }
}
