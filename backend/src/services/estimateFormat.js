const FORMATS = Object.freeze({
  CCC: 'ccc',
  MITCHELL: 'mitchell',
  UNKNOWN: 'unknown',
});

const CCC_SIGNATURES = Object.freeze([
  { id: 'ccc-one-header', weight: 4, pattern: /\bCCC\s+ONE\b/i },
  { id: 'ccc-estimate-of-record', weight: 3, pattern: /\bEstimate\s+of\s+Record\b/i },
  { id: 'ccc-preliminary-estimate', weight: 2, pattern: /\bPreliminary\s+Estimate\b/i },
  { id: 'ccc-estimate-totals-block', weight: 3, pattern: /\bESTIMATE\s+TOTALS\b[\s\S]{0,400}\bCategory\s*Basis\s*Rate\s*Cost\b/i },
  { id: 'ccc-repair-authorization-footer', weight: 2, pattern: /\bThis\s+is\s+not\s+an\s+authorization\s+to\s+repair\b/i },
  { id: 'ccc-hours-at-rate', weight: 2, pattern: /\b(?:Body|Paint|Mechanical|Frame|Glass)\s+Labor\s+\d+(?:\.\d+)?\s*hrs\s*@\s*\$?\s*\d+(?:\.\d+)?\s*\/\s*hr/i },
  { id: 'ccc-gross-net-labels', weight: 1, pattern: /\bTotal\s+Cost\s+of\s+Repairs\b[\s\S]{0,250}\bNet\s+Cost\s+of\s+Repairs\b/i },
]);

const MITCHELL_SIGNATURES = Object.freeze([
  { id: 'mitchell-header', weight: 4, pattern: /\bMitchell\s+(?:Cloud\s+Estimating|Estimating|WorkCenter)\b/i },
  { id: 'mitchell-ultramate', weight: 4, pattern: /\bUltraMate\b/i },
  { id: 'mitchell-estimate-profile', weight: 2, pattern: /\bEstimate\s+Profile\b/i },
  { id: 'mitchell-gross-net-totals', weight: 3, pattern: /\bGross\s+Total\b[\s\S]{0,250}\bNet\s+Estimate\s+Total\b/i },
  { id: 'mitchell-taxable-parts', weight: 2, pattern: /\bTaxable\s+Parts\b/i },
  { id: 'mitchell-refinish-labor', weight: 2, pattern: /\bRefinish\s+Labor\b/i },
  { id: 'mitchell-additional-costs', weight: 1, pattern: /\bOther\s+Additional\s+Costs\b/i },
]);

function normalizeText(text) {
  return String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function scoreSignatures(text, signatures) {
  return signatures.reduce((acc, signature) => {
    if (!signature.pattern.test(text)) return acc;
    acc.score += signature.weight;
    acc.signals.push(signature.id);
    return acc;
  }, { score: 0, signals: [] });
}

function confidenceFor(score, competingScore) {
  if (score <= 0) return 0;
  const base = Math.min(score / 10, 1);
  const separation = Math.min(Math.max(score - competingScore, 0) / 6, 1);
  return Number(((base * 0.75) + (separation * 0.25)).toFixed(2));
}

function detectEstimateFormat(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { format: FORMATS.UNKNOWN, confidence: 0, signals: [] };
  }

  const ccc = scoreSignatures(normalized, CCC_SIGNATURES);
  const mitchell = scoreSignatures(normalized, MITCHELL_SIGNATURES);
  const threshold = 5;
  const ambiguousMargin = 2;

  if (ccc.score < threshold && mitchell.score < threshold) {
    return {
      format: FORMATS.UNKNOWN,
      confidence: 0,
      signals: [...ccc.signals, ...mitchell.signals],
    };
  }

  if (ccc.score >= threshold && mitchell.score >= threshold && Math.abs(ccc.score - mitchell.score) < ambiguousMargin) {
    return {
      format: FORMATS.UNKNOWN,
      confidence: 0,
      signals: [...ccc.signals, ...mitchell.signals],
    };
  }

  if (ccc.score > mitchell.score) {
    return {
      format: FORMATS.CCC,
      confidence: confidenceFor(ccc.score, mitchell.score),
      signals: ccc.signals,
    };
  }

  return {
    format: FORMATS.MITCHELL,
    confidence: confidenceFor(mitchell.score, ccc.score),
    signals: mitchell.signals,
  };
}

module.exports = {
  detectEstimateFormat,
  FORMATS,
};
