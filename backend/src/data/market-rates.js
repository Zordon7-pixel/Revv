/**
 * REVV Market Rates Engine
 * Auto-calibrates labor rate, parts markup, and tax rate by US state.
 *
 * Tiers are based on prevailing auto body labor rates across US markets:
 *   Tier 1 — Major metros (NYC, LA, SF, Seattle, Boston, Chicago, Miami)  → $95/hr
 *   Tier 2 — Large cities (Dallas, Denver, Atlanta, Philadelphia, DC)     → $75/hr
 *   Tier 3 — Mid-size markets (Columbus, Memphis, Phoenix, Tampa)         → $62/hr
 *   Tier 4 — Small market / rural                                         → $52/hr
 *
 * Tax rates = state sales tax applied to parts (most states exempt labor).
 * Parts markup = gross margin target on parts.
 */

const TIERS = {
  1: { label: 'Major Metro',    laborRate: 95, partsMarkup: 0.40 },
  2: { label: 'Large City',     laborRate: 75, partsMarkup: 0.35 },
  3: { label: 'Mid-Size Market',laborRate: 62, partsMarkup: 0.30 },
  4: { label: 'Small Market',   laborRate: 52, partsMarkup: 0.25 },
};

// State → { tier, taxRate }
// taxRate = combined average state+local sales tax on parts
const STATE_DATA = {
  AL: { tier: 4, taxRate: 0.0922 }, // Alabama
  AK: { tier: 2, taxRate: 0.0176 }, // Alaska (no state tax, low local)
  AZ: { tier: 3, taxRate: 0.0840 }, // Arizona
  AR: { tier: 4, taxRate: 0.0947 }, // Arkansas
  CA: { tier: 1, taxRate: 0.0875 }, // California
  CO: { tier: 2, taxRate: 0.0773 }, // Colorado
  CT: { tier: 1, taxRate: 0.0635 }, // Connecticut
  DE: { tier: 3, taxRate: 0.0000 }, // Delaware (no sales tax)
  FL: { tier: 3, taxRate: 0.0700 }, // Florida
  GA: { tier: 2, taxRate: 0.0732 }, // Georgia
  HI: { tier: 1, taxRate: 0.0400 }, // Hawaii (GET tax, not sales)
  ID: { tier: 4, taxRate: 0.0600 }, // Idaho
  IL: { tier: 2, taxRate: 0.0873 }, // Illinois
  IN: { tier: 3, taxRate: 0.0700 }, // Indiana
  IA: { tier: 4, taxRate: 0.0694 }, // Iowa
  KS: { tier: 4, taxRate: 0.0869 }, // Kansas
  KY: { tier: 4, taxRate: 0.0600 }, // Kentucky
  LA: { tier: 3, taxRate: 0.0995 }, // Louisiana
  ME: { tier: 3, taxRate: 0.0550 }, // Maine
  MD: { tier: 2, taxRate: 0.0600 }, // Maryland
  MA: { tier: 1, taxRate: 0.0625 }, // Massachusetts
  MI: { tier: 2, taxRate: 0.0600 }, // Michigan
  MN: { tier: 2, taxRate: 0.0749 }, // Minnesota
  MS: { tier: 4, taxRate: 0.0707 }, // Mississippi
  MO: { tier: 3, taxRate: 0.0881 }, // Missouri
  MT: { tier: 4, taxRate: 0.0000 }, // Montana (no sales tax)
  NE: { tier: 4, taxRate: 0.0694 }, // Nebraska
  NV: { tier: 3, taxRate: 0.0820 }, // Nevada
  NH: { tier: 2, taxRate: 0.0000 }, // New Hampshire (no sales tax)
  NJ: { tier: 1, taxRate: 0.0663 }, // New Jersey
  NM: { tier: 4, taxRate: 0.0783 }, // New Mexico
  NY: { tier: 1, taxRate: 0.0875 }, // New York
  NC: { tier: 3, taxRate: 0.0698 }, // North Carolina
  ND: { tier: 4, taxRate: 0.0696 }, // North Dakota
  OH: { tier: 3, taxRate: 0.0723 }, // Ohio
  OK: { tier: 4, taxRate: 0.0895 }, // Oklahoma
  OR: { tier: 3, taxRate: 0.0000 }, // Oregon (no sales tax)
  PA: { tier: 2, taxRate: 0.0634 }, // Pennsylvania
  RI: { tier: 2, taxRate: 0.0700 }, // Rhode Island
  SC: { tier: 3, taxRate: 0.0746 }, // South Carolina
  SD: { tier: 4, taxRate: 0.0640 }, // South Dakota
  TN: { tier: 3, taxRate: 0.0955 }, // Tennessee
  TX: { tier: 2, taxRate: 0.0825 }, // Texas
  UT: { tier: 3, taxRate: 0.0720 }, // Utah
  VT: { tier: 3, taxRate: 0.0620 }, // Vermont
  VA: { tier: 2, taxRate: 0.0575 }, // Virginia
  WA: { tier: 1, taxRate: 0.1023 }, // Washington
  WV: { tier: 4, taxRate: 0.0651 }, // West Virginia
  WI: { tier: 3, taxRate: 0.0543 }, // Wisconsin
  WY: { tier: 4, taxRate: 0.0547 }, // Wyoming
  DC: { tier: 1, taxRate: 0.0600 }, // Washington DC
};

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia',
  HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas',
  KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts',
  MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana',
  NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico',
  NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma',
  OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota',
  TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington',
  WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', DC:'Washington DC',
};

function getRatesForState(stateCode) {
  const code = (stateCode || '').toUpperCase().trim();
  const data = STATE_DATA[code];
  if (!data) return null;
  const tier = TIERS[data.tier];
  return {
    stateCode: code,
    stateName: STATE_NAMES[code],
    tier: data.tier,
    tierLabel: tier.label,
    laborRate: tier.laborRate,
    partsMarkup: tier.partsMarkup,
    taxRate: data.taxRate,
  };
}

function getAllStates() {
  return Object.keys(STATE_DATA).sort().map(code => ({
    code,
    name: STATE_NAMES[code],
    ...getRatesForState(code),
  }));
}

module.exports = { getRatesForState, getAllStates, STATE_DATA, TIERS };
