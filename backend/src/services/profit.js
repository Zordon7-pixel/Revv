// NY Market Profit Calculator
// TRUE_PROFIT = (labor + parts + sublet) - cogs - ny_adjustments
function calculateProfit(ro) {
  const gross = (ro.parts_cost || 0) + (ro.labor_cost || 0) + (ro.sublet_cost || 0);
  const cogs = (ro.parts_cost || 0) + (ro.sublet_cost || 0);
  const naiveProfit = gross - cogs; // = labor_cost essentially
  const nyAdjustments = (ro.deductible_waived || 0) + (ro.referral_fee || 0) + (ro.goodwill_repair_cost || 0);
  const trueProfit = naiveProfit - nyAdjustments;
  const margin = gross > 0 ? Math.round((trueProfit / gross) * 100) : 0;
  return { gross, cogs, naiveProfit, nyAdjustments, trueProfit, margin };
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function calculateTrueProfit(ro, costProfile, opts = {}) {
  const legacy = calculateProfit(ro);

  if (costProfile?.blended_labor_cost_per_hr == null) {
    // Keep the serialized shape byte-for-byte compatible while still allowing
    // direct callers to inspect whether the profile was applied.
    Object.defineProperty(legacy, 'costProfileApplied', {
      value: false,
      enumerable: false,
    });
    return legacy;
  }

  const billedParts = toFiniteNumber(ro.parts_cost);
  const billedLabor = toFiniteNumber(ro.labor_cost);
  const billedSublet = toFiniteNumber(ro.sublet_cost);
  const gross = billedParts + billedLabor + billedSublet;
  const nyAdjustments = toFiniteNumber(ro.deductible_waived)
    + toFiniteNumber(ro.referral_fee)
    + toFiniteNumber(ro.goodwill_repair_cost);

  const partsProfit = billedParts * toFiniteNumber(costProfile.parts_margin_pct);
  const subletProfit = billedSublet * toFiniteNumber(costProfile.sublet_margin_pct);
  const materialsProfit = 0; // TODO Phase 4: add only when billed-materials data exists.

  const explicitLaborHours = opts.laborHours == null ? null : Number(opts.laborHours);
  const laborRate = toFiniteNumber(opts.laborRate);
  let laborHours = null;

  if (Number.isFinite(explicitLaborHours)) {
    laborHours = explicitLaborHours;
  } else if (laborRate > 0) {
    laborHours = billedLabor / laborRate;
  }

  const laborCostDollars = laborHours == null
    ? 0
    : laborHours * toFiniteNumber(costProfile.blended_labor_cost_per_hr);
  const laborProfit = billedLabor - laborCostDollars;
  const trueProfit = laborProfit + partsProfit + materialsProfit + subletProfit - nyAdjustments;
  const margin = gross > 0 ? Math.round((trueProfit / gross) * 100) : 0;

  return {
    ...legacy,
    gross,
    nyAdjustments,
    trueProfit,
    margin,
    breakdown: {
      labor_profit: laborProfit,
      parts_profit: partsProfit,
      materials_profit: materialsProfit,
      sublet_profit: subletProfit,
      labor_cost_dollars: laborCostDollars,
      labor_hours: laborHours,
      nyAdjustments,
    },
    costProfileApplied: true,
  };
}

// The synchronous calculators above are pure arithmetic, not authorization.
// Route/service boundaries use the guarded variants below with server-owned
// persisted RO snapshots. Pending monetary edits cannot override DB identity.
// readRows is a server-owned adapter: imports use their uncommitted transaction,
// and all policy/resource reads (including the late recheck) stay on that adapter.
async function persistedProfit(ro, calculate, readRows = (sql, params) => require('../db').dbAll(sql, params)) {
  const { assertExternalEffectsAllowed } = require('./shopPolicy');
  const unavailable = () => Object.assign(new Error('SHOP_POLICY_UNAVAILABLE'), { reason: 'SHOP_POLICY_UNAVAILABLE', excluded: true });
  await assertExternalEffectsAllowed(ro?.shop_id, readRows);
  if (typeof ro?.id !== 'string' || !ro.id.trim()) throw unavailable();
  let rows;
  try { rows = await readRows(
    'SELECT id::text AS id, shop_id::text AS shop_id FROM repair_orders WHERE id::text = $1 AND shop_id::text = $2',
    [ro.id, ro.shop_id]);
  } catch (_) { throw unavailable(); }
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== ro.id || rows[0]?.shop_id !== ro.shop_id) throw unavailable();
  const result = calculate();
  await assertExternalEffectsAllowed(rows[0].shop_id, readRows);
  return result;
}
async function calculatePersistedProfit(ro, readRows) {
  return persistedProfit(ro, () => calculateProfit(ro), readRows);
}
async function calculatePersistedTrueProfit(ro, costProfile, opts = {}, readRows) {
  return persistedProfit(ro, () => calculateTrueProfit(ro, costProfile, opts), readRows);
}

// Versioned explicit-cost path; legacy functions and serialized shapes stay unchanged.
const { calculateEstimate } = require('./panelEstimator');
module.exports = { calculateProfit, calculateTrueProfit, calculatePersistedProfit, calculatePersistedTrueProfit,
  calculateEstimateProfit: calculateEstimate };
