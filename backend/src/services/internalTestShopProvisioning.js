'use strict';

// No DB/config/SDK imports. Only the dedicated CLI supplies production adapters.
const { createHash } = require('node:crypto');
const VERSION = 'internal-test-shop-v1';
const EXCLUSIONS = Object.freeze([
  'outbound-sms-email-ops', 'billing-payments-accounting', 'metrics-exports-usage',
  'scheduled-jobs', 'ai-supplier-media-providers', 'paid-trial-global-privileges',
]);
const PUBLIC_FLOW_LIMITATION = 'Public Firestore lead flows are not supported for fixture validation until separately isolated.';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
function normalizeEmail(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) fail('INVALID_EMAIL');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)
      || email.split('@')[0].length > 64 || email.startsWith('.') || email.includes('..') || email.includes('.@')) fail('INVALID_EMAIL');
  return email;
}
function identity(email) {
  const uuid = kind => {
    const hex = createHash('sha256').update(`${VERSION}:${kind}:${email}`).digest('hex');
    // UUID-shaped non-secret identities work with TEXT, UUID and VARCHAR(36).
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  return { email, shop_id: uuid('shop'), user_id: uuid('owner') };
}
function receipt(ids) {
  return { version: VERSION, ...ids, role: 'owner', is_internal_test_shop: true,
    verified_exclusions: [...EXCLUSIONS], public_flow_limitation: PUBLIC_FLOW_LIMITATION };
}
const shopValues = Object.freeze({ name: 'REVV Internal Test Shop', is_internal_test_shop: true,
  onboarded: false, plan: 'free', plan_expires_at: null, trial_ends_at: null,
  sms_comp: false, sms_notifications_enabled: false, email_notifications_enabled: false });
const defaults = Object.freeze({ market_tier: 3, labor_rate: 62, paint_rate: 62,
  parts_margin_pct: 0.25, materials_margin_pct: 0.45, sublet_margin_pct: 0.05,
  parts_markup: 0.30, tax_rate: 0.0700, geofence_radius: 0.5,
  monthly_revenue_target: 85000, quickbooks_environment: 'production' });
function verifyState(ids, shops, users) {
  if (shops.length !== 1 || users.length !== 1) fail('FIXTURE_COLLISION');
  const shop = shops[0], user = users[0];
  if (shop.id !== ids.shop_id || user.id !== ids.user_id || user.shop_id !== ids.shop_id
      || user.email !== ids.email || user.role !== 'owner' || user.name !== 'Internal Test Owner'
      || user.password_valid !== true) fail('FIXTURE_COLLISION');
  for (const [key, value] of Object.entries(shopValues)) if (shop[key] !== value) fail('FIXTURE_COLLISION');
  if (typeof shop.public_intake_slug !== 'string' || !/^[a-z2-7]{26}$/.test(shop.public_intake_slug)) fail('FIXTURE_COLLISION');
  // Unknown populated fields are incompatible, including future entitlements or
  // provider identities. Never try to clear them to make an account fit.
  for (const [key, value] of Object.entries(shop)) {
    if (Object.hasOwn(shopValues, key) || ['id', 'created_at', 'public_intake_slug'].includes(key)) continue;
    if (Object.hasOwn(defaults, key)) {
      if (String(value) !== String(defaults[key])) fail('FIXTURE_COLLISION');
    } else if (value !== null && value !== false) fail('FIXTURE_COLLISION');
  }
  for (const [key, value] of Object.entries(user)) {
    if (['id', 'shop_id', 'name', 'email', 'role', 'password_valid', 'created_at'].includes(key)) continue;
    if (value !== null && value !== false) fail('FIXTURE_COLLISION');
  }
  return receipt(ids);
}
async function readState(client, ids) {
  const { rows: shops } = await client.query(`SELECT to_jsonb(s) AS data FROM shops s
    WHERE s.id::text = $1 FOR UPDATE`, [ids.shop_id]);
  const { rows: users } = await client.query(`SELECT (to_jsonb(u) - 'password_hash') ||
    jsonb_build_object('password_valid', COALESCE(u.password_hash ~ '^\\$2[aby]\\$10\\$[./A-Za-z0-9]{53}$', FALSE)) AS data
    FROM users u WHERE lower(btrim(u.email)) = $1 OR u.shop_id::text = $2 OR u.id::text = $3
    ORDER BY u.id::text FOR UPDATE`, [ids.email, ids.shop_id, ids.user_id]);
  return { shops: shops.map(row => row.data), users: users.map(row => row.data) };
}
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function verifyNoRelatedRows(client, ids) {
  // Inspect all current tenant/user references, including optional provider tables.
  // Catalog names are quoted; identity values are always bound parameters.
  const { rows } = await client.query(`SELECT DISTINCT n.nspname, c.relname, a.attname,
      CASE WHEN a.attname ~ '(^|_)shop_id$' OR EXISTS (
        SELECT 1 FROM pg_constraint f WHERE f.conrelid=c.oid AND f.contype='f'
          AND a.attnum=ANY(f.conkey) AND f.confrelid='shops'::regclass
      ) THEN 'shop' ELSE 'user' END AS kind
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.oid=(SELECT relnamespace FROM pg_class WHERE oid='shops'::regclass)
      AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped
      AND c.oid NOT IN ('shops'::regclass, 'users'::regclass)
      AND (a.attname ~ '(^|_)(shop|user)_id$' OR EXISTS (
        SELECT 1 FROM pg_constraint f WHERE f.conrelid=c.oid AND f.contype='f'
          AND a.attnum=ANY(f.conkey) AND f.confrelid IN ('shops'::regclass,'users'::regclass)))
    ORDER BY n.nspname, c.relname, a.attname`);
  for (const row of rows) {
    const table = `${quote(row.nspname)}.${quote(row.relname)}`;
    await client.query(`LOCK TABLE ${table} IN SHARE MODE`);
    const result = await client.query(`SELECT 1 FROM ${table} WHERE ${quote(row.attname)}::text = $1 LIMIT 1`,
      [row.kind === 'shop' ? ids.shop_id : ids.user_id]);
    if (result.rows.length) fail('FIXTURE_COLLISION');
  }
}
async function verifyExistingFixtures(client, validateSchema) {
  const { rows } = await client.query(`SELECT id::text FROM shops WHERE is_internal_test_shop IS TRUE ORDER BY id::text`);
  if (rows.length) await validateSchema(client);
  for (const row of rows) {
    const owners = await client.query('SELECT email FROM users WHERE shop_id::text = $1 ORDER BY id::text', [row.id]);
    if (owners.rows.length !== 1) fail('FIXTURE_COLLISION');
    const ids = identity(normalizeEmail(owners.rows[0].email));
    if (ids.shop_id !== row.id) fail('FIXTURE_COLLISION');
    const state = await readState(client, ids);
    verifyState(ids, state.shops, state.users);
    await verifyNoRelatedRows(client, ids);
  }
}
async function provision({ env, argv = [], pool, hashPassword, validateSchema }) {
  let password = env.REVV_INTERNAL_TEST_SHOP_PASSWORD;
  delete env.REVV_INTERNAL_TEST_SHOP_PASSWORD;
  let client, discard = false;
  try {
    if (argv.length) fail('INVALID_ARGUMENTS');
    const ids = identity(normalizeEmail(env.REVV_INTERNAL_TEST_SHOP_EMAIL));
    // Same minimum and bcrypt cost as auth.js; reject bcrypt truncation and NUL.
    if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password, 'utf8') > 72 || password.includes('\0')) fail('INVALID_PASSWORD');
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query('SET LOCAL row_security = off');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('revv.internal-test-shop.email:' || $1, 0))", [ids.email]);
    // Also serialize ordinary registration, which does not take our advisory lock.
    await client.query('LOCK TABLE shops, users IN SHARE ROW EXCLUSIVE MODE');
    await validateSchema(client);
    const state = await readState(client, ids);
    if (state.shops.length || state.users.length) {
      verifyState(ids, state.shops, state.users);
    } else {
      await verifyNoRelatedRows(client, ids);
      const hash = await hashPassword(password, 10);
      password = undefined;
      await client.query(`INSERT INTO shops (id, name, is_internal_test_shop,
        onboarded, plan, plan_expires_at, trial_ends_at, sms_comp, sms_notifications_enabled, email_notifications_enabled)
        VALUES ($1, $2, TRUE, FALSE, 'free', NULL, NULL, FALSE, FALSE, FALSE)`,
      [ids.shop_id, shopValues.name]);
      await client.query(`INSERT INTO users (id, shop_id, name, email, password_hash, role)
        VALUES ($1, $2, 'Internal Test Owner', $3, $4, 'owner')`, [ids.user_id, ids.shop_id, ids.email, hash]);
    }
    const persisted = await readState(client, ids);
    const result = verifyState(ids, persisted.shops, persisted.users);
    await verifyNoRelatedRows(client, ids);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
    // Never trust a DB/provider error's code or message, even if it resembles ours.
    if (error instanceof Error && ['INVALID_ARGUMENTS', 'INVALID_EMAIL', 'INVALID_PASSWORD', 'FIXTURE_COLLISION'].includes(error.code)
        && error.message === error.code) fail(error.code);
    fail('PROVISIONING_FAILED');
  } finally {
    password = undefined;
    delete env.REVV_INTERNAL_TEST_SHOP_PASSWORD;
    if (client) { try { client.release(discard); } catch { fail('PROVISIONING_FAILED'); } }
  }
}
module.exports = { provision, identity, normalizeEmail, verifyState, verifyExistingFixtures, VERSION, EXCLUSIONS, PUBLIC_FLOW_LIMITATION };
