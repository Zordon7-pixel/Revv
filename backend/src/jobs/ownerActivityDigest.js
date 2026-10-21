const { dbAll, pool } = require('../db');
const { assertExternalEffectsAllowed, isShopPolicyError } = require('../services/shopPolicy');
const { sendOwnerActivityDigest } = require('../services/ownerActivity');

async function runOwnerActivityDigest() {
  const until = new Date();
  const since = new Date(until.getTime() - 24 * 60 * 60 * 1000);
  const today = until.toISOString().slice(0, 10);
  const nowTime = until.toISOString().slice(11, 16);
  const shops = await dbAll(
    `SELECT s.id, COALESCE(p.owner_activity_digest_time, '19:00') AS owner_activity_digest_time
     FROM shops s
     LEFT JOIN shop_notification_preferences p ON p.shop_id::text = s.id::text
     WHERE s.is_internal_test_shop IS FALSE
       AND COALESCE(p.owner_activity_digest_enabled, TRUE) = TRUE`
  );

  let sent = 0;
  let skipped = 0;
  for (const shop of shops) {
    if (String(shop.owner_activity_digest_time || '19:00') > nowTime) {
      skipped += 1;
      continue;
    }
    let client;
    let transactionOpen = false;
    try {
      await assertExternalEffectsAllowed(shop.id);
      client = await pool.connect();
      const readRows = async (sql, params) => (await client.query(sql, params)).rows;
      await client.query('BEGIN');
      transactionOpen = true;
      // Hold policy stable through claim and service: a skipped fixture must not
      // consume today's date. The unique preference row still serializes claims.
      await client.query('SELECT id FROM shops WHERE id::text = $1 FOR SHARE', [shop.id]);
      await assertExternalEffectsAllowed(shop.id, readRows);
      const lock = await client.query(
        `INSERT INTO shop_notification_preferences
           (shop_id, owner_activity_last_digest_date, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (shop_id) DO UPDATE SET
           owner_activity_last_digest_date = EXCLUDED.owner_activity_last_digest_date,
           updated_at = NOW()
         WHERE COALESCE(shop_notification_preferences.owner_activity_last_digest_date, '') <> $2
           AND COALESCE(shop_notification_preferences.owner_activity_digest_enabled, TRUE) = TRUE
           AND COALESCE(shop_notification_preferences.owner_activity_digest_time, '19:00') <= $3`,
        [shop.id, today, nowTime]
      );
      if (!lock?.rowCount) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        skipped += 1;
        continue;
      }
      await assertExternalEffectsAllowed(shop.id, readRows);
      let result;
      try {
        result = await sendOwnerActivityDigest({
          shopId: shop.id,
          since: since.toISOString(),
          until: until.toISOString(),
        });
      } catch (error) {
        // Preserve the ordinary once-per-day attempt even if its provider fails.
        // Policy refusals must instead roll back the date and remain retryable.
        if (!isShopPolicyError(error)) {
          await assertExternalEffectsAllowed(shop.id, readRows);
          await client.query('COMMIT');
          transactionOpen = false;
        }
        throw error;
      }
      const refusal = [result, ...(result?.results || [])].find(isShopPolicyError);
      if (refusal) throw Object.assign(new Error(refusal.reason), { reason: refusal.reason });
      await assertExternalEffectsAllowed(shop.id, readRows);
      await client.query('COMMIT');
      transactionOpen = false;
      if (result?.skipped) skipped += 1;
      else sent += Number(result?.sent || 0);
    } catch (err) {
      if (client && transactionOpen) await client.query('ROLLBACK');
      if (isShopPolicyError(err)) {
        skipped += 1;
        console.warn('[OwnerActivity] digest suppressed:', err.reason);
      } else {
        console.error('[OwnerActivity] digest failed:', err.message);
      }
    } finally {
      if (client) client.release();
    }
  }
  return { shops: shops.length, sent, skipped };
}

module.exports = { runOwnerActivityDigest };
