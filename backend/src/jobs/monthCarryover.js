const { dbAll, dbRun } = require('../db');

async function runMonthCarryover(shopId) {
  const openCarryovers = await dbAll(
    `
      SELECT id
      FROM repair_orders
      WHERE shop_id = $1
        AND billing_month < TO_CHAR(NOW(), 'YYYY-MM')
        AND status NOT IN ('completed', 'closed', 'cancelled')
        AND carried_over = FALSE
    `,
    [shopId]
  );

  if (!openCarryovers.length) return 0;

  await dbRun(
    `
      UPDATE repair_orders
      SET carried_over = TRUE
      WHERE shop_id = $1
        AND billing_month < TO_CHAR(NOW(), 'YYYY-MM')
        AND status NOT IN ('completed', 'closed', 'cancelled')
        AND carried_over = FALSE
    `,
    [shopId]
  );

  return openCarryovers.length;
}

module.exports = { runMonthCarryover };
