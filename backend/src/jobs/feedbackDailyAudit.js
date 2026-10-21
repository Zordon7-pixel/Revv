const { dbAll, pool } = require('../db');
const { assertExternalEffectsAllowed, isShopPolicyError } = require('../services/shopPolicy');

// An omitted target enumerates only ordinary shops. A direct target must pass
// the same fresh, locked policy checks; callers cannot supply a policy flag.
async function auditOrdinaryShops(sql, shopId) {
  const shops = shopId === undefined
    ? await dbAll('SELECT id FROM shops WHERE is_internal_test_shop IS FALSE ORDER BY id')
    : [{ id: shopId }];
  let changed = 0;
  for (const shop of shops) {
    let client;
    try {
      await assertExternalEffectsAllowed(shop.id);
      client = await pool.connect();
      const readRows = async (query, params) => (await client.query(query, params)).rows;
      await client.query('BEGIN');
      await client.query('SELECT id FROM shops WHERE id::text = $1 FOR SHARE', [shop.id]);
      await assertExternalEffectsAllowed(shop.id, readRows);
      const result = await client.query(sql, [shop.id]);
      await assertExternalEffectsAllowed(shop.id, readRows);
      await client.query('COMMIT');
      changed += result.rowCount || 0;
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      if (!isShopPolicyError(error)) throw error;
      console.warn('[Feedback Audit] suppressed:', error.reason);
    } finally {
      if (client) client.release();
    }
  }
  return changed;
}


const RESOLVED_STATUSES_SQL = "('shipped', 'closed', 'wont_fix')";

async function closeEstimateImportSuccessNoise(shopId) {
  return auditOrdinaryShops(
    `UPDATE feedback
     SET status = 'closed',
         routed_to = COALESCE(NULLIF(routed_to, ''), 'Codex'),
         support_note = COALESCE(
           NULLIF(support_note, ''),
           'Daily feedback audit auto-closed this row because it is an estimate-import success notification, not an error.'
         ),
         linked_ref = COALESCE(NULLIF(linked_ref, ''), 'daily-feedback-audit'),
         resolved_at = COALESCE(resolved_at, NOW()),
         updated_at = NOW()
     WHERE shop_id::text = $1
       AND EXISTS (SELECT 1 FROM shops s WHERE s.id::text = feedback.shop_id::text AND s.is_internal_test_shop IS FALSE)
       AND COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'new') NOT IN ${RESOLVED_STATUSES_SQL}
       AND COALESCE(tester_name, '') = 'Auto-Reporter'
       AND message ~* '^\\[AUTO\\]\\s+[0-9]+\\s+items imported from insurance estimate'`, shopId
  );
}

async function assignOpenUnassignedFeedback(shopId) {
  return auditOrdinaryShops(
    `UPDATE feedback
     SET status = CASE
           WHEN COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'new') = 'new' THEN 'assigned'
           ELSE status
         END,
         routed_to = CASE
           WHEN LOWER(COALESCE(category, '')) IN ('feature', 'idea', 'question') THEN 'Hermes'
           ELSE 'Codex'
         END,
         assigned_at = COALESCE(assigned_at, NOW()),
         support_note = COALESCE(
           NULLIF(support_note, ''),
           'Daily feedback audit assigned this open item for agent review.'
         ),
         updated_at = NOW()
     WHERE shop_id::text = $1
       AND EXISTS (SELECT 1 FROM shops s WHERE s.id::text = feedback.shop_id::text AND s.is_internal_test_shop IS FALSE)
       AND COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'new') NOT IN ${RESOLVED_STATUSES_SQL}
       AND (
         COALESCE(NULLIF(TRIM(routed_to), ''), '') = ''
         OR COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'new') = 'new'
         OR LOWER(TRIM(COALESCE(routed_to, ''))) IN ('codex', 'codex 5.3', 'colonel zordon')
       )`, shopId
  );
}

async function runFeedbackDailyAudit(shopId) {
  const closedNoise = await closeEstimateImportSuccessNoise(shopId);
  const assigned = await assignOpenUnassignedFeedback(shopId);
  return { closedNoise, assigned };
}

module.exports = {
  runFeedbackDailyAudit,
  closeEstimateImportSuccessNoise,
  assignOpenUnassignedFeedback,
};
