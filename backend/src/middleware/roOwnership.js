const { dbGet } = require('../db');

async function assertRoOwnership(roId, shopId) {
  if (!roId || !shopId) return null;
  return dbGet(
    `SELECT id
     FROM repair_orders
     WHERE id::text = $1::text
       AND shop_id::text = $2::text`,
    [roId, shopId]
  );
}

module.exports = { assertRoOwnership };
