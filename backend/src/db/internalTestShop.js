'use strict';

const INTERNAL_TEST_SHOP_SCHEMA_REQUIRED = 'INTERNAL_TEST_SHOP_SCHEMA_REQUIRED';
const schemaFailure = () => Object.assign(new Error(INTERNAL_TEST_SHOP_SCHEMA_REQUIRED), { code: INTERNAL_TEST_SHOP_SCHEMA_REQUIRED });

// Read-only validation shared by startup and the installer. No default/null/type
// repair: only a genuinely absent column may receive the safe FALSE default.
function policySql(allowHold) {
  return `DO $test_shop$
  DECLARE policy_attnum SMALLINT;
  BEGIN
    SELECT a.attnum INTO policy_attnum FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='shops'::regclass AND a.attname='is_internal_test_shop'
      AND NOT a.attisdropped AND a.atttypid='boolean'::regtype
      AND a.attnotnull AND a.attgenerated='' AND a.attidentity=''
      AND pg_get_expr(d.adbin, d.adrelid)='false';
    IF policy_attnum IS NULL THEN RAISE EXCEPTION 'Invalid policy schema'; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid='shops'::regclass
        AND (policy_attnum=ANY(conkey) OR conname='shops_internal_test_shop_hold')
        AND NOT (${allowHold ? 'TRUE' : 'FALSE'} AND conname='shops_internal_test_shop_hold'
          AND contype='c' AND convalidated AND NOT connoinherit
          AND conkey=ARRAY[policy_attnum] AND conislocal AND coninhcount=0
          AND pg_get_expr(conbin, conrelid)='(is_internal_test_shop IS FALSE)')
    ) THEN RAISE EXCEPTION 'Incompatible policy constraint'; END IF;
  END;
  $test_shop$;`;
}
async function validateSchema(client) {
  await client.query(policySql(false));
  await client.query(`DO $identity$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('shops'::regclass,'users'::regclass)
      AND (relkind <> 'r' OR relrowsecurity OR relforcerowsecurity))
      OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('shops'::regclass,'users'::regclass)
        AND NOT tgisinternal AND (tgtype & 4) <> 0 AND tgenabled <> 'D')
      OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class IN ('shops'::regclass,'users'::regclass)) THEN
      RAISE EXCEPTION 'Incompatible identity behavior';
    END IF;
    IF (SELECT count(*) FROM pg_attribute
      WHERE ((attrelid='shops'::regclass AND attname='id')
        OR (attrelid='users'::regclass AND attname IN ('id','shop_id')))
        AND NOT attisdropped AND (atttypid IN ('text'::regtype,'uuid'::regtype)
          OR (atttypid='varchar'::regtype AND atttypmod=40))) <> 3 THEN
      RAISE EXCEPTION 'Incompatible identity schema';
    END IF;
  END;
  $identity$;`);
}
// Catalog-only inspection: no shop rows, table lock or DDL on the steady path.
async function transitionState(client) {
  const { rows: [state] } = await client.query(`SELECT
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='shops'::regclass
      AND attname='is_internal_test_shop' AND NOT attisdropped) AS present,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='shops'::regclass
      AND conname='shops_internal_test_shop_hold') AS hold`);
  if (!state || typeof state.present !== 'boolean' || typeof state.hold !== 'boolean') throw schemaFailure();
  return state;
}
async function transaction(pool, action) {
  let client;
  let discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query('SET LOCAL row_security = off');
    await action(client);
    await client.query('COMMIT');
  } catch {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    throw schemaFailure();
  } finally {
    if (client) { try { client.release(discard); } catch { throw schemaFailure(); } }
  }
}
async function up(pool) {
  return transaction(pool, async client => {
    let state = await transitionState(client);
    if (!state.present || state.hold) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('revv.internal-test-shop.v1'))");
      // Another initializer may have completed the transition while we waited.
      state = await transitionState(client);
      if (!state.present) {
        // ADD COLUMN requires ACCESS EXCLUSIVE; let PostgreSQL acquire it only
        // for this actual transition, rather than locking every startup.
        await client.query('ALTER TABLE shops ADD COLUMN is_internal_test_shop BOOLEAN NOT NULL DEFAULT FALSE');
      }
      await client.query(policySql(true));
      if (state.hold) {
        // Only the exact validated historical CHECK can reach this DROP.
        await client.query('ALTER TABLE shops DROP CONSTRAINT shops_internal_test_shop_hold');
      }
    }
    await client.query(policySql(false));
    // Fixture contents belong exclusively to the server-only provisioning CLI.
  });
}

// Explicit operator rollback, never called by startup. No CASCADE or row edits.
// TRUE fixtures must first be dealt with under a separately reviewed data plan.
async function down(pool) {
  return transaction(pool, async client => {
    if (!(await transitionState(client)).present) return;
    await client.query(policySql(true));
    await client.query("SELECT pg_advisory_xact_lock(hashtext('revv.internal-test-shop.v1'))");
    if (!(await transitionState(client)).present) return;
    // DROP COLUMN requires this lock; it also closes the concurrent TRUE-write
    // race between the refusal check and schema removal.
    await client.query('LOCK TABLE shops IN ACCESS EXCLUSIVE MODE');
    await client.query(policySql(true));
    const { rows } = await client.query('SELECT 1 FROM shops WHERE is_internal_test_shop IS TRUE LIMIT 1');
    if (rows.length) throw schemaFailure();
    await client.query('ALTER TABLE shops DROP COLUMN is_internal_test_shop RESTRICT');
  });
}
module.exports = { up, down, validateSchema, INTERNAL_TEST_SHOP_SCHEMA_REQUIRED };
