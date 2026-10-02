'use strict';

// Adapter only: the calculator's frozen revision costs remain the authority.
// Importing this module never initializes a database or reads environment files.
const { dollarsToCents } = require('./roMoney');
const canReadEconomics = role => ['owner', 'admin'].includes(String(role || '').toLowerCase());
const cents = value => Number.isSafeInteger(value) ? value : null;
const safeNumber = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Economics aggregate exceeds safe integer range');
  return number;
};

function projection(revisionId, snapshot) {
  return {
    source: 'panel_estimator_revision', revision_id: revisionId,
    contribution_cents: cents(snapshot?.contribution_cents),
    direct_cost_cents: cents(snapshot?.direct_cost_cents),
    margin_bps: Number.isFinite(snapshot?.margin_bps) ? snapshot.margin_bps : null,
    complete: snapshot?.complete === true,
    missing_count: Array.isArray(snapshot?.missing) ? snapshot.missing.length : 1,
  };
}

async function selectedEconomics(shopId, roIds, role) {
  const pool = require('../db').pool;
  const selected = new Map();
  // Thin legacy test adapters have no pool. Real DB errors must propagate.
  if (typeof pool?.query !== 'function' || !roIds.length) return selected;
  const schema = (await pool.query(`SELECT
    to_regclass('ro_panel_estimator_revision_costs') AS costs,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ro_panel_estimator_drafts')
      AND attname='active_revision_id' AND NOT attisdropped) AS pointer`)).rows[0];
  if (!schema.pointer) return selected;
  const privateRead = canReadEconomics(role) && !!schema.costs;
  const rows = (await pool.query(`SELECT ro.id, d.active_revision_id
      ${privateRead ? ', c.snapshot' : ''}
    FROM repair_orders ro
    JOIN ro_panel_estimator_drafts d ON d.shop_id=ro.shop_id AND d.ro_id=ro.id
    ${privateRead ? `LEFT JOIN ro_panel_estimator_revision_costs c
      ON c.shop_id=d.shop_id AND c.ro_id=d.ro_id AND c.revision_id=d.active_revision_id` : ''}
    WHERE ro.shop_id=$1 AND ro.id::text=ANY($2::text[]) AND d.active_revision_id IS NOT NULL`,
  [shopId, roIds.map(String)])).rows;
  for (const row of rows) selected.set(String(row.id), {
    revision_id: row.active_revision_id,
    ...(canReadEconomics(role) ? { panel_economics: projection(row.active_revision_id, row.snapshot) } : {}),
  });
  return selected;
}

function redactSelectedRO(ro, selected) {
  if (!ro || !selected.has(String(ro.id))) return ro;
  return { ...ro, panel_estimator_selected: true, true_profit: null, profit: null, profit_breakdown: null };
}
async function redactROs(rows, shopId) {
  const selected = await selectedEconomics(shopId, rows.map(row => row.id));
  return rows.map(row => redactSelectedRO(row, selected));
}
async function redactRO(ro, shopId = ro?.shop_id) {
  return ro ? (await redactROs([ro], shopId))[0] : ro;
}

function summarizeEconomics(rows, selected, role) {
  let known = 0n, cost = 0n, unknown = 0, costUnknown = 0, positive = 0, panelCount = 0;
  for (const row of rows) {
    const panel = selected.get(String(row.id));
    const economics = canReadEconomics(role) ? panel?.panel_economics : undefined;
    if (panel) panelCount++;
    const profitCents = panel ? economics?.contribution_cents ?? null
      : row.true_profit == null ? null : dollarsToCents(row.true_profit);
    const costCents = panel ? economics?.direct_cost_cents ?? null
      : dollarsToCents(row.parts_cost) + dollarsToCents(row.labor_cost) + dollarsToCents(row.sublet_cost);
    if (profitCents === null || (panel && !economics?.complete)) unknown++;
    if (profitCents !== null) { known += BigInt(profitCents); if (profitCents > 0) positive++; }
    if (costCents === null) costUnknown++;
    else cost += BigInt(costCents);
  }
  // Unauthorized selected values count as unknown without reading their snapshots.
  const complete = unknown === 0;
  return {
    profit_cents: complete ? safeNumber(known) : null,
    cost_cents: costUnknown ? null : safeNumber(cost),
    profitable_count: complete ? positive : null,
    profit_complete: complete, unknown_count: unknown,
    profit_source: panelCount === 0 ? 'legacy_profit' : panelCount === rows.length
      ? 'panel_estimator_revision' : 'panel_contribution_and_legacy_profit',
    profit_metric: panelCount === 0 ? 'Legacy profit' : panelCount === rows.length
      ? 'Contribution before overhead' : 'Contribution before overhead + legacy profit',
    ...(canReadEconomics(role) ? { known_profit_cents: safeNumber(known) } : {}),
  };
}

// Callers supply only fixed SQL fragments and bound period parameters, never user SQL.
async function periodEconomics(shopId, role, filter, params = []) {
  const pool = require('../db').pool;
  if (typeof pool?.query !== 'function') return null;
  const rows = (await pool.query(`SELECT id, true_profit FROM repair_orders
    WHERE shop_id=$1${filter}`, [shopId, ...params])).rows;
  return summarizeEconomics(rows, await selectedEconomics(shopId, rows.map(row => row.id), role), role);
}

function aggregateMetadata(summary) {
  if (!summary) return { profit_complete: true, unknown_count: 0, profit_source: 'legacy_profit', profit_metric: 'Legacy profit' };
  const { profit_cents, cost_cents, profitable_count, ...metadata } = summary;
  return metadata;
}

module.exports = { canReadEconomics, selectedEconomics, redactSelectedRO, redactROs, redactRO,
  summarizeEconomics, periodEconomics, aggregateMetadata };
