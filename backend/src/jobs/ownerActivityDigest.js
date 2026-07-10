const { dbAll, dbRun } = require('../db');
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
     WHERE COALESCE(p.owner_activity_digest_enabled, TRUE) = TRUE`
  );

  let sent = 0;
  let skipped = 0;
  for (const shop of shops) {
    if (String(shop.owner_activity_digest_time || '19:00') > nowTime) {
      skipped += 1;
      continue;
    }
    try {
      const lock = await dbRun(
        `INSERT INTO shop_notification_preferences
           (shop_id, owner_activity_last_digest_date, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (shop_id) DO UPDATE SET
           owner_activity_last_digest_date = EXCLUDED.owner_activity_last_digest_date,
           updated_at = NOW()
         WHERE COALESCE(shop_notification_preferences.owner_activity_last_digest_date, '') <> $2`,
        [shop.id, today]
      );
      if (!lock?.rowCount) {
        skipped += 1;
        continue;
      }
      const result = await sendOwnerActivityDigest({
        shopId: shop.id,
        since: since.toISOString(),
        until: until.toISOString(),
      });
      if (result?.skipped) skipped += 1;
      else sent += Number(result?.sent || 0);
    } catch (err) {
      console.error('[OwnerActivity] digest failed:', err.message);
    }
  }
  return { shops: shops.length, sent, skipped };
}

module.exports = { runOwnerActivityDigest };
