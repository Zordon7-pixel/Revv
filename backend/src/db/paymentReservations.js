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
    await client.query('ALTER TABLE ro_payment_attempts DROP CONSTRAINT IF EXISTS ro_payment_attempts_status_check');
    await client.query(`ALTER TABLE ro_payment_attempts ADD CONSTRAINT ro_payment_attempts_status_check
      CHECK (status IN ('reserved','open','unknown','retryable','settled','released'))`);
    await client.query(`CREATE TABLE IF NOT EXISTS ro_payment_attempt_audit (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, ro_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
      actor_id TEXT, action TEXT NOT NULL, prior_state TEXT NOT NULL, outcome TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`CREATE OR REPLACE FUNCTION revv_guard_payment_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'RO_HISTORY_PROTECTED' USING ERRCODE='23514';
      END $$`);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='ro_payment_attempt_audit'::regclass AND tgname='revv_audit_immutable') THEN
        CREATE TRIGGER revv_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON ro_payment_attempt_audit
          FOR EACH STATEMENT EXECUTE FUNCTION revv_guard_payment_audit();
      END IF;
    END $$`);
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
  // Match roMoney's Number -> Math.round arithmetic, including negative ties.
  // numeric round() and summing individually rounded lines are NOT equivalent.
  await client.query(`CREATE OR REPLACE FUNCTION revv_money_round(n DOUBLE PRECISION)
    RETURNS BIGINT LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT (floor(n) + CASE WHEN n-floor(n) >= 0.5 THEN 1 ELSE 0 END)::bigint
    $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_authoritative_money(s TEXT, r TEXT)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    DECLARE selected TEXT; money JSONB; subtotal DOUBLE PRECISION := 0;
      taxable DOUBLE PRECISION := 0; rate DOUBLE PRECISION := 0; tax BIGINT;
    BEGIN
      IF to_regclass('ro_panel_estimator_revisions') IS NOT NULL AND EXISTS (
        SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ro_panel_estimator_drafts')
          AND attname='active_revision_id' AND NOT attisdropped) THEN
        EXECUTE 'SELECT d.active_revision_id, v.accounting_snapshot->''money''
          FROM ro_panel_estimator_drafts d JOIN repair_orders p ON p.id=d.ro_id AND p.shop_id=d.shop_id
          LEFT JOIN ro_panel_estimator_revisions v ON v.shop_id=d.shop_id AND v.ro_id=d.ro_id AND v.id=d.active_revision_id
          WHERE d.shop_id::text=$1 AND d.ro_id::text=$2'
          INTO selected,money USING s,r;
        IF selected IS NOT NULL THEN
          IF money->>'totalCents' IS NULL THEN RAISE EXCEPTION 'Invalid selected panel revision'; END IF;
          RETURN money || jsonb_build_object('revision_id',selected);
        END IF;
      END IF;
      IF to_regclass('estimate_line_items') IS NOT NULL THEN
        EXECUTE 'SELECT COALESCE(SUM(total),0)::text::double precision,
          COALESCE(SUM(CASE WHEN taxable THEN total ELSE 0 END),0)::text::double precision
          FROM estimate_line_items WHERE shop_id::text=$1 AND ro_id::text=$2'
          INTO subtotal,taxable USING s,r;
      END IF;
      SELECT COALESCE((to_jsonb(p)->>'tax_rate')::double precision,0) INTO rate FROM shops p WHERE id::text=s;
      tax := revv_money_round(revv_money_round(taxable*100)::double precision * COALESCE(rate,0));
      RETURN jsonb_build_object('totalCents',revv_money_round(subtotal*100)+tax,'taxCents',tax);
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_assert_money_floor(s TEXT, r TEXT)
    RETURNS void LANGUAGE plpgsql AS $$
    DECLARE ro JSONB; ledger JSONB := '[]'; attempts JSONB := '[]'; paid BIGINT; held BIGINT; money JSONB;
    BEGIN
      SELECT to_jsonb(p) INTO ro FROM repair_orders p WHERE shop_id::text=s AND id::text=r FOR UPDATE;
      IF ro IS NULL THEN RETURN; END IF;
      IF to_regclass('ro_payments') IS NOT NULL THEN
        EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(p)),''[]'') FROM ro_payments p WHERE shop_id::text=$1 AND ro_id::text=$2'
          INTO ledger USING s,r;
      END IF;
      IF to_regclass('ro_payment_attempts') IS NOT NULL THEN
        EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(p)),''[]'') FROM ro_payment_attempts p WHERE shop_id::text=$1 AND ro_id::text=$2'
          INTO attempts USING s,r;
      END IF;
      IF COALESCE((ro->>'amount_paid_cents')::numeric,0) NOT BETWEEN 0 AND 9007199254740991
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(ledger || attempts) p
          WHERE p->>'amount_cents' IS NULL OR (p->>'amount_cents')::numeric NOT BETWEEN 0 AND 9007199254740991
            OR (p->>'amount_cents')::numeric <> trunc((p->>'amount_cents')::numeric)) THEN
        RAISE EXCEPTION 'RO_FINANCIAL_HOLD' USING ERRCODE='23514';
      END IF;
      SELECT GREATEST(COALESCE((ro->>'amount_paid_cents')::bigint,0),
        COALESCE(SUM((p->>'amount_cents')::bigint),0)) INTO paid FROM jsonb_array_elements(ledger) p
        WHERE lower(COALESCE(p->>'status','')) IN ('paid','succeeded');
      SELECT COALESCE(SUM((a->>'amount_cents')::bigint),0) INTO held FROM jsonb_array_elements(attempts) a
        WHERE a->>'status' NOT IN ('settled','released');
      -- Legacy failed/pending intents remain chargeable until Phase A records a
      -- released attempt. A matching attempt owns capacity, so never count twice.
      SELECT held + COALESCE(SUM((p->>'amount_cents')::bigint),0) INTO held FROM jsonb_array_elements(ledger) p
        WHERE lower(COALESCE(p->>'status','')) NOT IN ('paid','succeeded') AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(attempts) a
          WHERE NULLIF(a->>'stripe_payment_intent_id','')=p->>'stripe_payment_intent_id');
      IF paid+held <= 0 THEN RETURN; END IF;
      money := revv_authoritative_money(s,r);
      IF (money->>'totalCents')::bigint < paid+held THEN
        RAISE EXCEPTION 'RO_FINANCIAL_HOLD' USING ERRCODE='23514';
      END IF;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_guard_money_child() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE doc JSONB; BEGIN
      -- Always lock both parents, even for metadata. Final authority is checked
      -- by the deferred constraint, after all replacement lines/pointers exist.
      FOR doc IN SELECT v FROM (SELECT DISTINCT v FROM (VALUES
        (CASE WHEN TG_OP<>'INSERT' THEN jsonb_build_object('s',OLD.shop_id::text,'r',OLD.ro_id::text) END),
        (CASE WHEN TG_OP<>'DELETE' THEN jsonb_build_object('s',NEW.shop_id::text,'r',NEW.ro_id::text) END)) x(v)
        WHERE v IS NOT NULL) parents ORDER BY v->>'r',v->>'s' LOOP
        PERFORM id FROM repair_orders WHERE shop_id::text=doc->>'s' AND id::text=doc->>'r' FOR UPDATE;
        -- This BEFORE trigger runs before the composite ownership FK. Preserve
        -- its foreign_key_violation contract for absent or wrong-tenant parents.
        IF NOT FOUND AND TG_OP<>'DELETE' THEN RAISE EXCEPTION 'RO_NOT_FOUND' USING ERRCODE='23503'; END IF;
      END LOOP;
      IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_money_changed(t TEXT, old_doc JSONB, new_doc JSONB)
    RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE k TEXT; BEGIN
      IF t='repair_orders' THEN
        FOREACH k IN ARRAY ARRAY['id','shop_id','parts_cost','labor_cost','sublet_cost','tax','total','estimate_amount',
          'deductible','deductible_waived','referral_fee','goodwill_repair_cost','payment_type',
          'insurance_approved_amount','total_insurer_owed','supplement_amount'] LOOP
          IF old_doc->k IS DISTINCT FROM new_doc->k THEN RETURN true; END IF;
        END LOOP;
        RETURN false;
      ELSIF t='ro_panel_estimator_drafts' THEN
        RETURN old_doc->>'active_revision_id' IS DISTINCT FROM new_doc->>'active_revision_id'
          OR (old_doc->>'ro_id' IS NOT NULL AND new_doc->>'ro_id' IS NOT NULL AND
            (old_doc->>'shop_id' IS DISTINCT FROM new_doc->>'shop_id' OR old_doc->>'ro_id' IS DISTINCT FROM new_doc->>'ro_id'));
      END IF;
      RETURN true;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_check_money_floor() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE doc JSONB; BEGIN
      IF NOT revv_money_changed(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NULL; END IF;
      FOR doc IN SELECT DISTINCT v FROM (VALUES
        (CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END),
        (CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END)) x(v) WHERE v IS NOT NULL ORDER BY v LOOP
        PERFORM revv_assert_money_floor(doc->>'shop_id',CASE WHEN TG_TABLE_NAME='repair_orders' THEN doc->>'id' ELSE doc->>'ro_id' END);
      END LOOP;
      RETURN NULL;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_guard_money_ro() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='INSERT' THEN
        -- Creation is the one path without an existing parent to lock: it must
        -- wait for a concurrent tax update before adding a new taxable RO.
        PERFORM id FROM shops WHERE id::text=NEW.shop_id::text FOR SHARE;
        RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN PERFORM revv_assert_ro_deletable(OLD.shop_id::text,OLD.id::text); RETURN OLD; END IF;
      IF COALESCE((to_jsonb(NEW)->>'amount_paid_cents')::numeric,0)
        < COALESCE((to_jsonb(OLD)->>'amount_paid_cents')::numeric,0) THEN
        RAISE EXCEPTION 'RO_FINANCIAL_HOLD' USING ERRCODE='23514';
      END IF;
      IF OLD.id IS DISTINCT FROM NEW.id OR OLD.shop_id IS DISTINCT FROM NEW.shop_id THEN
        -- Moving an RO must not orphan retained financial/approval evidence.
        PERFORM revv_assert_ro_deletable(OLD.shop_id::text,OLD.id::text);
      END IF;
      RETURN NEW;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_guard_payment_evidence() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE k TEXT; BEGIN
      IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'RO_HISTORY_PROTECTED' USING ERRCODE='23514'; END IF;
      -- Serialize direct legacy ledger writes with deletion and monetary edits too.
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
    LANGUAGE plpgsql AS $$ BEGIN
      IF (to_jsonb(OLD)->'tax_rate') IS DISTINCT FROM (to_jsonb(NEW)->'tax_rate') THEN
        -- No other writer locks an existing shop after its RO. Holding all of
        -- this shop's parents until commit serializes reserve/manual/settlement
        -- and line/selection edits, without a permanent shop history freeze.
        PERFORM id FROM repair_orders WHERE shop_id::text=OLD.id::text ORDER BY id FOR UPDATE;
      END IF;
      RETURN NEW;
    END $$`);
  await client.query(`CREATE OR REPLACE FUNCTION revv_check_shop_tax() RETURNS trigger
    LANGUAGE plpgsql AS $$ DECLARE ro RECORD; money JSONB; assignments TEXT; BEGIN
      IF (to_jsonb(OLD)->'tax_rate') IS NOT DISTINCT FROM (to_jsonb(NEW)->'tax_rate') THEN RETURN NULL; END IF;
      FOR ro IN SELECT id FROM repair_orders WHERE shop_id::text=NEW.id::text ORDER BY id FOR UPDATE LOOP
        PERFORM revv_assert_money_floor(NEW.id::text,ro.id::text);
        money := revv_authoritative_money(NEW.id::text,ro.id::text);
        IF money->>'revision_id' IS NOT NULL THEN CONTINUE; END IF;
        -- Only live line-backed totals follow shop defaults. Selected accounting
        -- and public snapshots (and their materialized RO amounts) remain issued.
        IF to_regclass('estimate_line_items') IS NULL THEN CONTINUE; END IF;
        SELECT string_agg(format('%I = %s',attname,CASE WHEN attname='tax' THEN
          '$3::numeric / 100' WHEN attname='amount_owed_cents' THEN '$4::bigint'
          ELSE '$4::numeric / 100' END),',') INTO assignments
          FROM pg_attribute WHERE attrelid='repair_orders'::regclass AND NOT attisdropped
            AND attname IN ('tax','total','estimate_amount','amount_owed_cents');
        IF assignments IS NOT NULL THEN
          EXECUTE 'UPDATE repair_orders SET ' || assignments || ' WHERE shop_id::text=$1 AND id::text=$2'
            USING NEW.id::text,ro.id::text,(money->>'taxCents')::bigint,(money->>'totalCents')::bigint;
        END IF;
      END LOOP;
      RETURN NULL;
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
    if (table === 'repair_orders') await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='repair_orders'::regclass AND tgname='revv_financial_birth') THEN
        CREATE TRIGGER revv_financial_birth BEFORE INSERT ON repair_orders
          FOR EACH ROW EXECUTE FUNCTION revv_guard_money_ro();
      END IF;
    END $$`);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='revv_financial_guard') THEN
        CREATE TRIGGER revv_financial_guard BEFORE ${events} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();
      END IF;
    END $$`);
    if (['repair_orders','estimate_line_items','estimate_metadata','ro_panel_estimator_drafts','shops'].includes(table)) {
      await client.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='revv_money_floor') THEN
          CREATE CONSTRAINT TRIGGER revv_money_floor AFTER ${table === 'shops' ? 'UPDATE' : 'INSERT OR UPDATE OR DELETE'} ON ${table}
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${table === 'shops' ? 'revv_check_shop_tax' : 'revv_check_money_floor'}();
        END IF;
      END $$`);
    }
    if (table === 'ro_payments' || table === 'ro_payment_attempts') await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='revv_financial_no_truncate') THEN
        CREATE TRIGGER revv_financial_no_truncate BEFORE TRUNCATE ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION revv_guard_payment_evidence();
      END IF;
    END $$`);
  }
}
