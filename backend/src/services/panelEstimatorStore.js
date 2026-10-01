'use strict';

const PANELS = new Set(`front_bumper hood windshield roof rear_glass trunk rear_bumper
  left_front_fender left_front_door left_rear_door left_rear_quarter
  right_front_fender right_front_door right_rear_door right_rear_quarter undercarriage
  left_front_tire right_front_tire left_rear_tire right_rear_tire
  left_front_rim right_front_rim left_rear_rim right_rear_rim
  interior_dashboard interior_steering_column interior_ignition_switch
  interior_driver_door_trim interior_passenger_door_trim interior_headliner
  interior_center_console interior_front_left_seat interior_front_right_seat interior_rear_seats`.split(/\s+/));
const SELL = ['body_rate_cents', 'refinish_rate_cents', 'parts_sell_cents', 'materials_sell_cents', 'sublet_sell_cents'];
const COST = ['body_cost_rate_cents', 'refinish_cost_rate_cents', 'parts_cost_cents', 'materials_cost_cents', 'sublet_cost_cents'];
const ALLOCATION = ['total_cents', 'carrier_cents', 'customer_cents', 'deductible_cents', 'betterment_cents', 'uncovered_cents', 'adjustment_cents', 'paid_cents', 'balance_cents'];
const error = (code, status = 400) => Object.assign(new Error(code), { code, status, statusCode: status });
const invalid = () => { throw error('INVALID_INPUT'); };
const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value;
};
const text = (value, max = 200) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) invalid();
  return value;
};
const cents = (value, max = Number.MAX_SAFE_INTEGER) => {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) invalid();
  return value;
};
const hours = value => {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000 || !/^\d+(\.\d{1,2})?$/.test(String(value))) invalid();
  return value;
};
const boolean = value => {
  if (value == null) return null;
  if (typeof value !== 'boolean') invalid();
  return value;
};
const choice = (value, values) => {
  const result = text(value);
  if (result !== null && !values.includes(result)) invalid();
  return result;
};
const array = (value, max) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
};
function panelLines(value, normalize) {
  const seen = new Set();
  return array(value, PANELS.size).map(raw => {
    object(raw);
    if (!PANELS.has(raw.panel_id) || seen.has(raw.panel_id)) invalid();
    seen.add(raw.panel_id);
    return { panel_id: raw.panel_id, ...normalize(raw) };
  });
}
const amounts = (raw, fields) => Object.fromEntries(fields.map(key => [key, cents(raw[key])]));
function assessments(value) {
  return panelLines(value, raw => {
    const photo_ids = array(raw.photo_ids, 50).map(id => {
      const result = text(id, 255);
      if (!result) invalid();
      return result;
    });
    if (new Set(photo_ids).size !== photo_ids.length) invalid();
    return {
      label: text(raw.label), body_style: choice(raw.body_style, ['sedan', 'coupe', 'hatchback', 'suv', 'truck', 'van', 'other']),
      severity: choice(raw.severity, ['light', 'moderate', 'heavy']),
      damage_type: text(raw.damage_type), area: text(raw.area),
      operation: choice(raw.operation, ['repair', 'replace', 'paint-only', 'blend', 'inspection-required']),
      refinish: boolean(raw.refinish), body_hours: hours(raw.body_hours), refinish_hours: hours(raw.refinish_hours),
      ...amounts(raw, SELL), customer_notes: text(raw.customer_notes, 4000), reviewed: boolean(raw.reviewed),
      preset_version_id: text(raw.preset_version_id, 255), photo_ids,
    };
  });
}
function publicSnapshot(raw) {
  const scenario = raw.scenario == null ? { payer: 'cash', provenance: 'shop_prepared' } : object(raw.scenario);
  const allocation = scenario.allocation == null ? null : amounts(object(scenario.allocation), ALLOCATION);
  const adjustments = object(raw.adjustments ?? {});
  return {
    assessments: assessments(raw.assessments),
    scenario: { payer: choice(scenario.payer, ['cash', 'insurance']),
      provenance: choice(scenario.provenance, ['shop_prepared', 'imported_carrier']), allocation },
    adjustments: { ...amounts(adjustments, ['discount_cents', 'minimum_cents']), tax_rate_bps: cents(adjustments.tax_rate_bps, 10000) },
  };
}
function privateSnapshot(raw) {
  return { lines: panelLines(raw.lines, line => amounts(line, COST)),
    target_margin_bps: cents(raw.target_margin_bps, 9999), overhead_cents: cents(raw.overhead_cents), reason: text(raw.reason, 4000) };
}

async function validateReferences(client, shopId, roId, panels) {
  // No preset version model exists in this slice; never accept unverifiable IDs.
  if (panels.some(panel => panel.preset_version_id !== null)) throw error('INVALID_REFERENCE');
  const ids = [...new Set(panels.flatMap(panel => panel.photo_ids))];
  if (!ids.length) return;
  const table = await client.query("SELECT to_regclass('ro_photos') AS relation");
  if (!table.rows[0].relation) throw error('INVALID_REFERENCE');
  for (const id of ids) {
    const result = await client.query(`SELECT p.id FROM ro_photos p
      JOIN repair_orders ro ON ro.id = p.ro_id
      WHERE p.id = $1 AND ro.shop_id = $2 AND ro.id = $3`, [id, shopId, roId]);
    if (!result.rowCount) throw error('INVALID_REFERENCE');
  }
}

// All four methods take {shopId, roId}; saves also require expectedVersion.
// Saves replace the corresponding bounded snapshot, not arbitrary JSON patches.
// ensurePanelEstimator(pool) must be explicitly called by the eventual integrator.
function createPanelEstimatorStore(pool) {
  async function access(input, kind, write) {
    object(input);
    const { shopId, roId, expectedVersion } = input;
    if (!text(shopId, 255) || !text(roId, 255)) throw error('NOT_FOUND', 404);
    const client = await pool.connect();
    try {
      // Re-read the shared version after a competing RO lock is released,
      // regardless of the connection's default transaction isolation.
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const owner = await client.query('SELECT id FROM repair_orders WHERE shop_id = $1 AND id = $2 FOR UPDATE', [shopId, roId]);
      if (!owner.rowCount) throw error('NOT_FOUND', 404);
      const existing = await client.query(`SELECT d.version, d.assessments, d.scenario, d.adjustments
        FROM ro_panel_estimator_drafts d JOIN repair_orders ro ON ro.id = d.ro_id AND ro.shop_id = d.shop_id
        WHERE d.shop_id = $1 AND d.ro_id = $2`, [shopId, roId]);
      const draft = existing.rows[0];
      let version = draft ? Number(draft.version) : 0;
      if (!Number.isSafeInteger(version) || version < 0) throw error('INVALID_VERSION', 500);
      if (write) {
        if (cents(expectedVersion) === null) invalid();
        if (expectedVersion !== version) throw error('VERSION_CONFLICT', 409);
        if (version === Number.MAX_SAFE_INTEGER) throw error('VERSION_CONFLICT', 409);
        const snapshot = kind === 'draft' ? publicSnapshot(input) : privateSnapshot(input);
        if (kind === 'draft') await validateReferences(client, shopId, roId, snapshot.assessments);
        // Inserting the draft for cost-only saves establishes the shared version.
        await client.query(`INSERT INTO ro_panel_estimator_drafts (shop_id, ro_id)
          SELECT shop_id, id FROM repair_orders WHERE shop_id = $1 AND id = $2
          ON CONFLICT (shop_id, ro_id) DO NOTHING`, [shopId, roId]);
        if (kind === 'draft') {
          await client.query(`UPDATE ro_panel_estimator_drafts d SET assessments = $3, scenario = $4, adjustments = $5
            WHERE d.shop_id = $1 AND d.ro_id = $2 AND EXISTS
            (SELECT 1 FROM repair_orders ro WHERE ro.shop_id = $1 AND ro.id = $2)`,
          [shopId, roId, JSON.stringify(snapshot.assessments), JSON.stringify(snapshot.scenario), JSON.stringify(snapshot.adjustments)]);
        } else {
          await client.query(`INSERT INTO ro_panel_estimator_costs (shop_id, ro_id, lines, target_margin_bps, overhead_cents, reason)
            SELECT shop_id, id, $3::jsonb, $4::integer, $5::bigint, $6::text FROM repair_orders WHERE shop_id = $1 AND id = $2
            ON CONFLICT (shop_id, ro_id) DO UPDATE SET lines = EXCLUDED.lines,
              target_margin_bps = EXCLUDED.target_margin_bps, overhead_cents = EXCLUDED.overhead_cents, reason = EXCLUDED.reason
            WHERE ro_panel_estimator_costs.shop_id = $1 AND ro_panel_estimator_costs.ro_id = $2`,
          [shopId, roId, JSON.stringify(snapshot.lines), snapshot.target_margin_bps, snapshot.overhead_cents, snapshot.reason]);
        }
        await client.query(`UPDATE ro_panel_estimator_drafts SET version = version + 1
          WHERE shop_id = $1 AND ro_id = $2 AND EXISTS
          (SELECT 1 FROM repair_orders WHERE shop_id = $1 AND id = $2)`, [shopId, roId]);
        version += 1;
        await client.query('COMMIT');
        return { version, ...snapshot };
      }
      let snapshot;
      if (kind === 'draft') snapshot = publicSnapshot(draft ?? {});
      else {
        const result = await client.query(`SELECT c.lines, c.target_margin_bps, c.overhead_cents, c.reason
          FROM ro_panel_estimator_costs c JOIN repair_orders ro ON ro.id = c.ro_id AND ro.shop_id = c.shop_id
          WHERE c.shop_id = $1 AND c.ro_id = $2`, [shopId, roId]);
        const row = result.rows[0] ?? {};
        snapshot = privateSnapshot({ ...row, overhead_cents: row.overhead_cents == null ? null : Number(row.overhead_cents) });
      }
      await client.query('COMMIT');
      return { version, ...snapshot };
    } catch (failure) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { failure.rollbackError = rollbackError; }
      if (failure.code === '22P02') throw error('INVALID_INPUT');
      throw failure;
    } finally {
      client.release();
    }
  }
  return {
    getDraft: input => access(input, 'draft', false), saveDraft: input => access(input, 'draft', true),
    getCosts: input => access(input, 'costs', false), saveCosts: input => access(input, 'costs', true),
  };
}

module.exports = { createPanelEstimatorStore };
