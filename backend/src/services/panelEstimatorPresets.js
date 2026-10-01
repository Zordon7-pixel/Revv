'use strict';
const { randomUUID } = require('node:crypto');
const n = require('./panelEstimatorStore');

/** Preset JSON contract v1 (all unknown keys, including nested keys, are rejected):
 * {contract_version:1,name,match:{panel_id,body_style,operation,severity,paint_system?},
 *  sell_settings:{body_hours,refinish_hours,refinish,...SELL,taxable:{body,refinish,parts,materials,sublet},
 *    package:null|{name,price_cents,taxable,included_operations:[category,...]},
 *    extras:[{key,scope,category,description?,quantity,unit_price_cents,taxable}]},
 *  private_cost_config:{...COST,extras:[{key,scope,cost_unit_cents}],private_notes?,
 *    target_margin_bps?,overhead_cents?,include_overhead_in_target?},reason}
 * Every hour/rate/price/tax flag is explicit, nullable for unknown; no default prices.
 * Package inclusions name base categories; extra identity is (scope,key,category),
 * never description. A scope is local to one estimate; equal extras deduplicate.
 * POST versions addresses a family ID, returning a new immutable version ID.
 * Actor/effective time/version/family are server-owned, never accepted in JSON.
 * Application is explicit: clients copy safe sell settings for user review. Merely
 * selecting a version does NOT replace entered prices. The server retains the
 * immutable source snapshot, checks compatibility, and never follows 'latest'.
 * B1 adds optional package.sell_allocation_cents and materials_pricing to public
 * sell settings; private cost_sources and extras.cost_source never enter that DTO.
 */
const SELL_KEYS = ['body_hours', 'refinish_hours', 'refinish', ...n.SELL, 'taxable', 'package', 'extras', 'materials_pricing'];
function matchSettings(raw) {
  n.keys(raw, ['panel_id', 'body_style', 'operation', 'severity', 'paint_system']);
  const panel = n.assessments([raw])[0];
  if (!panel.body_style || !panel.operation || !panel.severity) n.invalid();
  return { panel_id: panel.panel_id, body_style: panel.body_style, operation: panel.operation,
    severity: panel.severity, paint_system: panel.paint_system };
}
function sellSettings(raw) {
  n.keys(raw, SELL_KEYS);
  // All core fields must exist; null explicitly records an unknown, not a free item.
  for (const key of SELL_KEYS.filter(k => !['package', 'extras', 'materials_pricing'].includes(k))) {
    if (!Object.hasOwn(raw, key)) n.invalid();
  }
  n.keys(raw.taxable, n.CATEGORIES);
  if (n.CATEGORIES.some(key => !Object.hasOwn(raw.taxable, key))) n.invalid();
  return { body_hours: n.hours(raw.body_hours), refinish_hours: n.hours(raw.refinish_hours),
    refinish: n.boolean(raw.refinish), ...n.amounts(raw, n.SELL), taxable: n.taxable(raw.taxable),
    package: n.packageSettings(raw.package), extras: n.extras(raw.extras), materials_pricing: n.materialsPricing(raw) };
}
function privateConfig(raw) {
  n.keys(raw, [...n.COST, 'cost_sources', 'extras', 'private_notes', 'target_margin_bps', 'overhead_cents', 'include_overhead_in_target']);
  return { ...n.amounts(raw, n.COST), cost_sources: n.costSources(raw.cost_sources), extras: n.extras(raw.extras, true), private_notes: n.text(raw.private_notes, 4000),
    target_margin_bps: n.cents(raw.target_margin_bps, 9999), overhead_cents: n.cents(raw.overhead_cents),
    include_overhead_in_target: n.boolean(raw.include_overhead_in_target) ?? false };
}
function normalizePreset(raw) {
  n.keys(raw, ['contract_version', 'name', 'match', 'sell_settings', 'private_cost_config', 'reason']);
  if (raw.contract_version !== 1) n.invalid();
  const result = { contract_version: 1, name: n.requiredText(raw.name), match: matchSettings(raw.match),
    sell_settings: sellSettings(raw.sell_settings), private_cost_config: privateConfig(raw.private_cost_config),
    reason: n.requiredText(raw.reason, 4000) };
  const settings = result.sell_settings;
  if (settings.package) {
    for (const category of settings.package.included_operations) {
      const quantity = category === 'body' ? settings.body_hours : category === 'refinish' ? settings.refinish_hours : 1;
      if (!quantity || settings.taxable[category] === null ||
          (settings.package.taxable !== null && settings.taxable[category] !== settings.package.taxable) || result.match.operation === 'inspection-required' ||
          (category === 'refinish' && settings.refinish !== true)) n.invalid();
    }
  }
  const identities = new Set(settings.extras.map(x => JSON.stringify([x.scope, x.key])));
  if (result.private_cost_config.extras.some(x => !identities.has(JSON.stringify([x.scope, x.key])))) n.invalid();
  return result;
}
// Safe even for legacy JSON: projections never spread persisted objects.
function safeSnapshot(row) {
  n.object(row);
  if (row.contract_version !== 1 || n.cents(row.version, 2147483647) === null || row.version < 1) n.invalid();
  const match = n.object(row.match), sell = n.object(row.sell_settings);
  const projectedSell = Object.fromEntries(SELL_KEYS.map(k => [k, sell[k]]));
  // Deep validators reject contamination instead of allowing private JSON through.
  return { id: n.requiredText(row.id, 255), family_id: n.requiredText(row.family_id, 255),
    version: n.cents(row.version, 2147483647), contract_version: 1, name: n.requiredText(row.name),
    match: matchSettings(Object.fromEntries(['panel_id', 'body_style', 'operation', 'severity', 'paint_system'].map(k => [k, match[k]]))),
    sell_settings: sellSettings(projectedSell) };
}
const COLUMNS = 'v.id, v.family_id, v.version, v.contract_version, v.name, v.match, v.sell_settings';
async function resolveApplications(client, shopId, panels) {
  for (const panel of panels) {
    panel.application_snapshot = null;
    if (!panel.preset_version_id) continue;
    const result = await client.query(`SELECT ${COLUMNS} FROM panel_estimator_preset_versions v
      WHERE v.shop_id = $1 AND v.id = $2`, [shopId, panel.preset_version_id]);
    if (!result.rowCount) throw n.error('INVALID_REFERENCE');
    const snapshot = safeSnapshot(result.rows[0]);
    for (const key of ['panel_id', 'body_style', 'operation', 'severity', 'paint_system']) {
      if ((key !== 'paint_system' || snapshot.match[key] !== null) && snapshot.match[key] !== panel[key]) {
        throw n.error('PRESET_INCOMPATIBLE');
      }
    }
    panel.application_snapshot = snapshot;
  }
}
function createPanelEstimatorPresets(database) {
  const pool = database.pool ?? database;
  async function write(input, action) {
    const client = input.client ?? await pool.connect(), own = !input.client;
    try {
      if (own) await client.query('BEGIN');
      if (!['owner', 'admin'].includes(input.role)) throw n.error('FORBIDDEN', 403);
      const actor = n.requiredText(input.actorId, 255);
      const shop = await client.query('SELECT id FROM shops WHERE id = $1', [input.shopId]);
      if (!shop.rowCount) throw n.error('NOT_FOUND', 404);
      let family = input.familyId, version = 1;
      if (action === 'create') {
        family = randomUUID();
        await client.query('INSERT INTO panel_estimator_preset_families(shop_id,id) VALUES ($1,$2)', [input.shopId, family]);
      } else {
        const found = await client.query('SELECT archived FROM panel_estimator_preset_families WHERE shop_id=$1 AND id=$2 FOR UPDATE', [input.shopId, family]);
        if (!found.rowCount) throw n.error('NOT_FOUND', 404);
        if (action === 'archive') {
          if (n.boolean(input.archived) === null) n.invalid();
          await client.query('UPDATE panel_estimator_preset_families SET archived=$3 WHERE shop_id=$1 AND id=$2', [input.shopId, family, input.archived]);
          if (own) await client.query('COMMIT');
          return { family_id: family, archived: input.archived };
        }
        if (found.rows[0].archived) throw n.error('PRESET_ARCHIVED', 409);
        const latest = await client.query('SELECT MAX(version) AS version FROM panel_estimator_preset_versions WHERE shop_id=$1 AND family_id=$2', [input.shopId, family]);
        version = latest.rows[0].version + 1;
      }
      const data = normalizePreset(input.body), id = randomUUID();
      await client.query(`INSERT INTO panel_estimator_preset_versions
        (shop_id,id,family_id,version,contract_version,name,match,sell_settings,private_cost_config,reason,created_by)
        VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10)`, [input.shopId, id, family, version, data.name,
        JSON.stringify(data.match), JSON.stringify(data.sell_settings), JSON.stringify(data.private_cost_config), data.reason, actor]);
      if (own) await client.query('COMMIT');
      return safeSnapshot({ ...data, id, family_id: family, version });
    } catch (err) {
      try { if (own) await client.query('ROLLBACK'); } catch (rollbackError) { err.rollbackError = rollbackError; }
      throw err;
    } finally { if (own) client.release(); }
  }
  return {
    create: input => write(input, 'create'), version: input => write(input, 'version'), archive: input => write(input, 'archive'),
    async list({ shopId, client = pool }) {
      const rows = await client.query(`SELECT ${COLUMNS}, f.archived FROM panel_estimator_preset_versions v
        JOIN panel_estimator_preset_families f ON f.shop_id=v.shop_id AND f.id=v.family_id
        WHERE v.shop_id=$1 ORDER BY v.family_id, v.version`, [shopId]);
      return rows.rows.map(row => ({ ...safeSnapshot(row), archived: row.archived }));
    },
    async getPrivate({ shopId, id, role, client = pool }) {
      if (!['owner', 'admin'].includes(role)) throw n.error('FORBIDDEN', 403);
      const result = await client.query('SELECT private_cost_config, reason, created_by, effective_at FROM panel_estimator_preset_versions WHERE shop_id=$1 AND id=$2', [shopId, id]);
      if (!result.rowCount) throw n.error('NOT_FOUND', 404);
      const row = result.rows[0];
      return { private_cost_config: privateConfig(row.private_cost_config), reason: row.reason, created_by: row.created_by, effective_at: row.effective_at };
    },
  };
}
module.exports = { createPanelEstimatorPresets, normalizePreset, safeSnapshot, resolveApplications, privateConfig };
