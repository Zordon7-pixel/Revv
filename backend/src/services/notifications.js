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

module.exports = { createNotification };
