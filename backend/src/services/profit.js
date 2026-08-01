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

module.exports = { calculateProfit, calculateTrueProfit };
