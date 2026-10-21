'use strict';

// Pass only an authenticated tenancy ID or a persisted job/resource's shop ID.
// Request/JWT flags, email spelling and caller-supplied shop objects are not policy.
// readRows is a server-owned DB adapter (the queue uses its locked connection).
// No cache: every external-effect boundary must consult current persisted policy.
const defaultRead = (sql, params) => require('../db').dbAll(sql, params);
async function resolveShopPolicy(shopId, readRows = defaultRead) {
  const unavailable = { allowExternalEffects: false, reason: 'SHOP_POLICY_UNAVAILABLE' };
  if (typeof shopId !== 'string' || !shopId.trim() || shopId !== shopId.trim()) return unavailable;
  try {
    const rows = await readRows(
      'SELECT id::text AS id, is_internal_test_shop FROM shops WHERE id::text = $1', [shopId]);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== shopId
        || typeof rows[0].is_internal_test_shop !== 'boolean') return unavailable;
    return rows[0].is_internal_test_shop
      ? { allowExternalEffects: false, reason: 'INTERNAL_TEST_SHOP' }
      : { allowExternalEffects: true, reason: null };
  } catch (_) {
    // Never propagate SQL, provider configuration or arbitrary error text.
    return unavailable;
  }
}

async function assertExternalEffectsAllowed(shopId, readRows) {
  const policy = await resolveShopPolicy(shopId, readRows);
  if (!policy.allowExternalEffects) {
    throw Object.assign(new Error(policy.reason), { reason: policy.reason });
  }
}
const isShopPolicyError = error => ['INTERNAL_TEST_SHOP', 'SHOP_POLICY_UNAVAILABLE'].includes(error?.reason);

module.exports = { resolveShopPolicy, assertExternalEffectsAllowed, isShopPolicyError };
