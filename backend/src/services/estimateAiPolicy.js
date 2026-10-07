'use strict';

const { pool } = require('../db');
const WINDOW_MS = 10 * 60 * 1000;
const SHOP_ADMISSIONS = 15;

// Internal API: the caller supplies ONLY the authenticated shop ID, never body
// policy, user identity, quota or time. No provider imports/calls and no DDL here.
async function admitEstimateAi(shopId) {
  if (typeof shopId !== 'string' || !shopId.trim()) return { status: 'unavailable' };
  let client;
  let discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const { rows: [shop] } = await client.query(
      'SELECT id::text AS id, estimate_ai_enabled FROM shops WHERE id = $1 FOR UPDATE', [shopId]);
    if (!shop || typeof shop.estimate_ai_enabled !== 'boolean') {
      await client.query('ROLLBACK');
      return { status: 'unavailable' };
    }
    if (shop.estimate_ai_enabled !== true) {
      await client.query('ROLLBACK');
      return { status: 'off' };
    }
    // Read DB time AFTER acquiring the parent lock, not transaction-start time.
    // Tests may replace this query in an isolated module fixture; no runtime seam.
    const { rows: [clock] } = await client.query('SELECT clock_timestamp() AS now');
    const now = clock?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid clock');
    const { rows } = await client.query(
      'SELECT window_started_at, admission_count FROM estimate_ai_budgets WHERE shop_id = $1 FOR UPDATE', [shop.id]);
    if (rows.length > 1) throw new Error('Invalid budget schema');
    const budget = rows[0];
    let expired = false;
    if (budget) {
      const start = budget.window_started_at;
      if (!(start instanceof Date) || !Number.isFinite(start.getTime()) || start > now
          || !Number.isInteger(budget.admission_count) || budget.admission_count < 1
          || budget.admission_count > SHOP_ADMISSIONS) throw new Error('Invalid budget');
      expired = now - start >= WINDOW_MS;
      if (!expired && budget.admission_count >= SHOP_ADMISSIONS) {
        await client.query('ROLLBACK');
        return { status: 'quota' };
      }
    }
    const start = !budget || expired ? now : budget.window_started_at;
    const count = !budget || expired ? 1 : budget.admission_count + 1;
    const returning = 'RETURNING window_started_at, admission_count, pg_typeof(shop_id)::text AS identity_type';
    const result = !budget
      ? await client.query(`INSERT INTO estimate_ai_budgets (shop_id, window_started_at, admission_count)
          VALUES ($1, $2, $3) ${returning}`, [shop.id, start, count])
      : await client.query(`UPDATE estimate_ai_budgets SET window_started_at = $2, admission_count = $3
          WHERE shop_id = $1 ${returning}`, [shop.id, start, count]);
    const saved = result.rows[0];
    if (result.rowCount !== 1 || saved?.identity_type !== 'text'
        || saved.admission_count !== count || !(saved.window_started_at instanceof Date)
        || saved.window_started_at.getTime() !== start.getTime()) throw new Error('Budget write failed');
    await client.query('COMMIT');
    return { status: 'admitted' };
  } catch {
    // Even an ambiguous commit consumes no provider call; never refund admissions.
    if (client) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    return { status: 'unavailable' };
  } finally {
    if (client) client.release(discard);
  }
}

module.exports = { admitEstimateAi };
