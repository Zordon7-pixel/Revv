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
    await ensureFinancialGuards(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

// No down migration: reservations and settled evidence must survive rollback.
module.exports = { up, ensureFinancialGuards };

// Shared with the panel initializer: startup creates some guarded child tables
// after this migration. Re-installing is idempotent and keeps minimal schemas valid.
async function ensureFinancialGuards(client) {
  await client.query(`CREATE OR REPLACE FUNCTION revv_financial_history(s TEXT, r TEXT, ro JSONB)
    RETURNS boolean LANGUAGE plpgsql AS $$ DECLARE evidence boolean; t TEXT; BEGIN
      IF lower(btrim(COALESCE(ro->>'payment_status',''))) IN ('paid','succeeded','partial','pending')
        OR COALESCE(ro->>'payment_received','0') NOT IN ('0','false','')
        OR COALESCE((ro->>'amount_paid_cents')::numeric,0) > 0
        OR COALESCE((ro->>'paid_amount')::numeric,0) > 0
        OR NULLIF(ro->>'paid_at','') IS NOT NULL OR NULLIF(ro->>'payment_received_at','') IS NOT NULL
        OR NULLIF(ro->>'stripe_payment_intent_id','') IS NOT NULL THEN RETURN true; END IF;
      FOREACH t IN ARRAY ARRAY['ro_payments','ro_payment_attempts'] LOOP
        IF to_regclass(t) IS NOT NULL THEN
          EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE shop_id::text=$1 AND ro_id::text=$2)',t)
            INTO evidence USING s,r;
          IF evidence THEN RETURN true; END IF;
        END IF;
      END LOOP;
      RETURN false;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_assert_ro_deletable(s TEXT, r TEXT)
    RETURNS void LANGUAGE plpgsql AS $$ DECLARE ro JSONB; evidence boolean; t TEXT; BEGIN
      SELECT to_jsonb(p) INTO ro FROM repair_orders p WHERE shop_id::text=s AND id::text=r FOR UPDATE;
      IF ro IS NULL THEN RETURN; END IF;
      IF revv_financial_history(s,r,ro)
        OR NULLIF(ro->>'estimate_approved_at','') IS NOT NULL OR NULLIF(ro->>'estimate_approved_by','') IS NOT NULL
        OR ro->>'insurance_approved_amount' IS NOT NULL
        OR lower(btrim(COALESCE(ro->>'estimate_status',''))) IN ('approved','accepted','signed')
        OR lower(btrim(COALESCE(ro->>'status',''))) IN ('approved','signed') THEN
        RAISE EXCEPTION 'RO_HISTORY_PROTECTED' USING ERRCODE='23514';
      END IF;
      FOREACH t IN ARRAY ARRAY['estimate_approval_links','ro_panel_estimator_approval_events',
        'claim_links','agreement_requests','ro_panel_estimator_drafts'] LOOP
        IF to_regclass(t) IS NOT NULL THEN
          EXECUTE format($evidence$SELECT EXISTS (SELECT 1 FROM %I e WHERE shop_id::text=$1 AND ro_id::text=$2
            AND ($3 NOT IN ('estimate_approval_links','ro_panel_estimator_approval_events')
              OR ($3='estimate_approval_links' AND to_jsonb(e)->>'responded_at' IS NOT NULL
                AND COALESCE(to_jsonb(e)->>'decline_reason','')='')
              OR ($3='ro_panel_estimator_approval_events' AND to_jsonb(e)->>'kind'='decision'
                AND to_jsonb(e)->>'decision'='approve')))$evidence$,t)
            INTO evidence USING s,r,t;
          IF evidence THEN RAISE EXCEPTION 'RO_HISTORY_PROTECTED' USING ERRCODE='23514'; END IF;
        END IF;
      END LOOP;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_guard_money_child() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE doc JSONB; ro JSONB; k TEXT; changed boolean; BEGIN
      -- An unselected draft/cost workspace does not change financial authority.
      IF TG_TABLE_NAME='ro_panel_estimator_drafts' AND TG_OP='INSERT'
        AND to_jsonb(NEW)->>'active_revision_id' IS NULL THEN RETURN NEW; END IF;
      IF TG_OP='UPDATE' THEN
        changed := false;
        IF TG_TABLE_NAME='ro_panel_estimator_drafts' THEN
          changed := (to_jsonb(OLD)->'active_revision_id') IS DISTINCT FROM (to_jsonb(NEW)->'active_revision_id')
            OR OLD.ro_id IS DISTINCT FROM NEW.ro_id OR OLD.shop_id IS DISTINCT FROM NEW.shop_id;
        ELSIF TG_TABLE_NAME='estimate_line_items' THEN
          FOREACH k IN ARRAY ARRAY['ro_id','shop_id','type','quantity','unit_price','total','taxable','panel_revision_id'] LOOP
            changed := changed OR (to_jsonb(OLD)->k) IS DISTINCT FROM (to_jsonb(NEW)->k);
          END LOOP;
        ELSE changed := to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW); END IF;
        IF NOT changed THEN RETURN NEW; END IF;
      END IF;
      -- Both old and new parents are checked; moving rows cannot evade a hold.
      FOR doc IN SELECT v FROM (VALUES
        (CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END),
        (CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END)) x(v) WHERE v IS NOT NULL LOOP
        SELECT to_jsonb(p) INTO ro FROM repair_orders p
          WHERE shop_id::text=doc->>'shop_id' AND id::text=doc->>'ro_id' FOR UPDATE;
        IF ro IS NULL AND TG_OP<>'DELETE' THEN RAISE EXCEPTION 'RO_NOT_FOUND' USING ERRCODE='23514'; END IF;
        IF revv_financial_history(doc->>'shop_id',doc->>'ro_id',ro) THEN
          RAISE EXCEPTION 'RO_FINANCIAL_HOLD' USING ERRCODE='23514';
        END IF;
      END LOOP;
      IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_guard_money_ro() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE k TEXT; BEGIN
      IF TG_OP='DELETE' THEN PERFORM revv_assert_ro_deletable(OLD.shop_id::text,OLD.id::text); RETURN OLD; END IF;
      IF COALESCE((to_jsonb(NEW)->>'amount_paid_cents')::numeric,0)
        < COALESCE((to_jsonb(OLD)->>'amount_paid_cents')::numeric,0) THEN
        RAISE EXCEPTION 'RO_FINANCIAL_HOLD' USING ERRCODE='23514';
      END IF;
      -- Bookkeeping fields (paid/status/owed) must remain writable by settlement.
      -- In particular, a newly inserted success must not block its own RO update.
      FOREACH k IN ARRAY ARRAY['id','shop_id','parts_cost','labor_cost','sublet_cost','tax','total','estimate_amount',
        'deductible','deductible_waived','referral_fee','goodwill_repair_cost','payment_type',
        'insurance_approved_amount','total_insurer_owed','supplement_amount'] LOOP
        IF (to_jsonb(OLD)->k) IS DISTINCT FROM (to_jsonb(NEW)->k)
          AND revv_financial_history(OLD.shop_id::text,OLD.id::text,to_jsonb(OLD)) THEN
          RAISE EXCEPTION 'RO_FINANCIAL_HOLD' USING ERRCODE='23514';
        END IF;
      END LOOP;
      RETURN NEW;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_guard_payment_evidence() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE k TEXT; BEGIN
      IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'RO_HISTORY_PROTECTED' USING ERRCODE='23514'; END IF;
      -- Serialize direct legacy ledger writes with deletion and monetary edits too.
      PERFORM id FROM shops WHERE id::text=NEW.shop_id::text FOR SHARE;
      PERFORM id FROM repair_orders WHERE id::text=NEW.ro_id::text AND shop_id::text=NEW.shop_id::text FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'RO_NOT_FOUND' USING ERRCODE='23514'; END IF;
      IF TG_OP='UPDATE' THEN
        FOREACH k IN ARRAY ARRAY['id','shop_id','ro_id','amount_cents','currency','kind','idempotency_key'] LOOP
          IF (to_jsonb(OLD)->k) IS DISTINCT FROM (to_jsonb(NEW)->k) THEN
            RAISE EXCEPTION 'RO_HISTORY_PROTECTED' USING ERRCODE='23514';
          END IF;
        END LOOP;
        IF TG_TABLE_NAME='ro_payments' AND lower(COALESCE(OLD.status,'')) IN ('paid','succeeded')
          AND lower(COALESCE(NEW.status,'')) NOT IN ('paid','succeeded') THEN
          RAISE EXCEPTION 'RO_HISTORY_PROTECTED' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_guard_shop_tax() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE ro RECORD; BEGIN
      IF (to_jsonb(OLD)->'tax_rate') IS DISTINCT FROM (to_jsonb(NEW)->'tax_rate') THEN
        FOR ro IN SELECT p.id, to_jsonb(p) AS data FROM repair_orders p
          WHERE shop_id::text=OLD.id::text ORDER BY p.id FOR UPDATE LOOP
          IF revv_financial_history(OLD.id::text,ro.id::text,ro.data) THEN
            RAISE EXCEPTION 'RO_FINANCIAL_HOLD' USING ERRCODE='23514';
          END IF;
        END LOOP;
      END IF;
      RETURN NEW;
    END $$`);
  for (const [table, events, fn] of [
    ['repair_orders','UPDATE OR DELETE','revv_guard_money_ro'],
    ['shops','UPDATE','revv_guard_shop_tax'],
    ['estimate_line_items','INSERT OR UPDATE OR DELETE','revv_guard_money_child'],
    ['estimate_metadata','INSERT OR UPDATE OR DELETE','revv_guard_money_child'],
    ['ro_panel_estimator_drafts','INSERT OR UPDATE OR DELETE','revv_guard_money_child'],
    ['ro_payments','INSERT OR UPDATE OR DELETE','revv_guard_payment_evidence'],
    ['ro_payment_attempts','INSERT OR UPDATE OR DELETE','revv_guard_payment_evidence'],
  ]) {
    if (!(await client.query('SELECT to_regclass($1) AS relation', [table])).rows[0].relation) continue;
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='revv_financial_guard') THEN
        CREATE TRIGGER revv_financial_guard BEFORE ${events} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();
      END IF;
    END $$`);
    if (table === 'ro_payments' || table === 'ro_payment_attempts') await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='revv_financial_no_truncate') THEN
        CREATE TRIGGER revv_financial_no_truncate BEFORE TRUNCATE ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION revv_guard_payment_evidence();
      END IF;
    END $$`);
  }
}
