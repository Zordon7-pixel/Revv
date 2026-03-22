function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function similarText(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function hasTokenOverlap(a, b, minMatches = 1) {
  const aTokens = new Set(tokens(a));
  const bTokens = new Set(tokens(b));
  let matches = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) matches += 1;
    if (matches >= minMatches) return true;
  }
  return false;
}

function vehicleOnFile(ro) {
  const v = ro?.vehicle || {};
  const label = [v.year, v.make, v.model].filter(Boolean).join(' ').trim();
  const vin = String(v.vin || ro?.vin || '').trim();
  return { label, vin };
}

function vehicleMatches(parsedVehicle, ro) {
  const parsed = String(parsedVehicle || '').trim();
  if (!parsed) return true;

  const { label, vin } = vehicleOnFile(ro);
  if (!label && !vin) return true;

  const parsedNorm = norm(parsed);
  if (vin) {
    const vinNorm = norm(vin);
    if (vinNorm && parsedNorm.includes(vinNorm)) return true;
    if (vinNorm.length >= 8 && parsedNorm.includes(vinNorm.slice(-8))) return true;
  }

  if (label && (similarText(parsed, label) || hasTokenOverlap(parsed, label, 2))) {
    return true;
  }

  const makeModel = [ro?.vehicle?.make, ro?.vehicle?.model].filter(Boolean).join(' ');
  if (makeModel && hasTokenOverlap(parsed, makeModel, 2)) return true;

  return false;
}

export function computeEstimateCrossCheck(parsed, ro) {
  const parsedInsurer = String(parsed?.insurance_company || '').trim();
  const parsedClaim = String(parsed?.claim_number || '').trim();
  const parsedAdjuster = String(parsed?.adjuster_name || '').trim();
  const parsedVehicle = String(parsed?.vehicle || '').trim();

  const onFileInsurer = String(ro?.insurance_company || ro?.insurer || '').trim();
  const onFileClaim = String(ro?.insurance_claim_number || ro?.claim_number || '').trim();
  const onFileAdjuster = String(ro?.adjuster_name || '').trim();

  const insurerMismatch = Boolean(
    parsedInsurer && onFileInsurer && !(similarText(parsedInsurer, onFileInsurer) || hasTokenOverlap(parsedInsurer, onFileInsurer, 1))
  );
  const claimMismatch = Boolean(parsedClaim && onFileClaim && norm(parsedClaim) !== norm(onFileClaim));
  const adjusterMismatch = Boolean(
    parsedAdjuster && onFileAdjuster && !(similarText(parsedAdjuster, onFileAdjuster) || hasTokenOverlap(parsedAdjuster, onFileAdjuster, 1))
  );
  const vehicleMismatch = Boolean(parsedVehicle && !vehicleMatches(parsedVehicle, ro));

  const messages = [];
  if (vehicleMismatch) messages.push(`Vehicle mismatch: parsed "${parsedVehicle}" vs RO vehicle on file.`);
  if (claimMismatch) messages.push(`Claim mismatch: parsed "${parsedClaim}" vs RO claim "${onFileClaim}".`);
  if (insurerMismatch) messages.push(`Carrier mismatch: parsed "${parsedInsurer}" vs RO carrier "${onFileInsurer}".`);
  if (adjusterMismatch) messages.push(`Adjuster mismatch: parsed "${parsedAdjuster}" vs RO adjuster "${onFileAdjuster}".`);

  return {
    insurerMismatch,
    claimMismatch,
    adjusterMismatch,
    vehicleMismatch,
    hasMismatch: messages.length > 0,
    messages,
  };
}

