const { pool } = require('../db');
const { assertExternalEffectsAllowed, isShopPolicyError } = require('../services/shopPolicy');

async function runMonthCarryover(shopId) {
  const client = await pool.connect();
  const readRows = async (sql, params) => (await client.query(sql, params)).rows;
  try {
    await client.query('BEGIN');
    await assertExternalEffectsAllowed(shopId, readRows);
    // Parent ROs first, in stable order, as in the other financial transactions.
    const openCarryovers = await readRows(
      `SELECT id FROM repair_orders
       WHERE shop_id = $1
         AND billing_month < TO_CHAR(NOW(), 'YYYY-MM')
         AND status NOT IN ('completed', 'closed', 'cancelled')
         AND carried_over = FALSE
       ORDER BY id FOR UPDATE`, [shopId]);
    // Prevent designation between the current policy check and commit.
    await client.query('SELECT id FROM shops WHERE id::text = $1 FOR SHARE', [shopId]);
    await assertExternalEffectsAllowed(shopId, readRows);
    let marked = 0;
    if (openCarryovers.length) {
      const result = await client.query(
        `UPDATE repair_orders SET carried_over = TRUE
         WHERE shop_id = $1
           AND id::text = ANY($2::text[])
           AND billing_month < TO_CHAR(NOW(), 'YYYY-MM')
           AND status NOT IN ('completed', 'closed', 'cancelled')
           AND carried_over = FALSE`, [shopId, openCarryovers.map(row => String(row.id))]);
      marked = result.rowCount;
    }
    await assertExternalEffectsAllowed(shopId, readRows);
    await client.query('COMMIT');
    return marked;
  } catch (error) {
    await client.query('ROLLBACK');
    if (isShopPolicyError(error)) return 0;
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { runMonthCarryover };
