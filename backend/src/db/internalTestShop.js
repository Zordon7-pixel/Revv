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
    IF EXISTS (SELECT 1 FROM shops WHERE is_internal_test_shop IS NULL) THEN
      RAISE EXCEPTION 'Invalid policy state';
    END IF;
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
async function up(pool) {
  let client;
  let discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query('SET LOCAL row_security = off');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('revv.internal-test-shop.v1'))");
    await client.query('LOCK TABLE shops IN ACCESS EXCLUSIVE MODE');
    await client.query('ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_internal_test_shop BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query(policySql(true));
    // Only the exact validated historical CHECK (is_internal_test_shop IS FALSE)
    // can reach this DROP. Unknown/weakened/inherited shapes abort unchanged.
    await client.query('ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_internal_test_shop_hold');
    await client.query(policySql(false));
    await require('../services/internalTestShopProvisioning').verifyExistingFixtures(client, validateSchema);
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
module.exports = { up, validateSchema, INTERNAL_TEST_SHOP_SCHEMA_REQUIRED };
