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

module.exports = { calculateProfit };
