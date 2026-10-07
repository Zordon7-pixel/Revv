const { dbRun } = require('../db');
const { v4: uuidv4 } = require('uuid');

async function createNotification(shopId, userId, type, title, body = null, roId = null) {
  if (!shopId || !type || !title) return null;
  const id = uuidv4();
  const message = body || title;

  await dbRun(
    `INSERT INTO notifications (id, shop_id, user_id, type, title, body, message, ro_id, read)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)`,
    [id, shopId, userId || null, type, title, message, message, roId || null]
  );

  return id;
}

// In-app only. Caller owns the RO lock, investigation deduplication and transaction.
// Do not call activity/email/SMS hooks or use the global dbRun here. All selected
// recipients must persist or the caller rolls back the investigation too.
async function createPaymentInvestigationNotifications(client, shopId, roId) {
  const recipients = await client.query(
    "SELECT id FROM users WHERE shop_id = $1 AND role IN ('owner', 'admin')", [shopId]
  );
  for (const user of recipients.rows) {
    await client.query(`INSERT INTO notifications
      (id, shop_id, user_id, type, title, body, ro_id, read)
      VALUES ($1,$2,$3,'payment_investigation',$4,$5,$6,FALSE)`,
    [uuidv4(), shopId, user.id, 'Payment investigation required',
      'A payment success was reported after this payment attempt was released. Review the repair order and verify payment records before taking any payment action. No payment balance was changed.',
      roId]);
  }
}

module.exports = { createNotification, createPaymentInvestigationNotifications };
