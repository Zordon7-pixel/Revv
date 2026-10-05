const { hash, inputError } = require('./agreements');

const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function money(value, allowZero = true) {
  if (value === null || value === undefined || value === '' || !/^-?\d+(\.\d{1,2})?$/.test(String(value))) return '';
  const n = Number(value);
  return Number.isFinite(n) && n >= (allowZero ? 0 : 0.01) && n <= 99999999.99 ? n.toFixed(2) : '';
}
function date(value) {
  const raw = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString().slice(0,10) === raw ? raw : '';
}
function buildAutofill(ro, customer = {}, vehicle = {}, metadata = {}, previous = {}) {
  const identity = {
    name: text(customer.name), email: text(customer.email, 254), phone: text(customer.phone, 40),
    vehicle: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' '),
    vin: text(vehicle.vin, 30), claim: text(ro.claim_number || ro.insurance_claim_number, 100),
    insurer: text(ro.insurer || ro.insurance_company), ro_number: text(ro.ro_number),
  };
  const samePrevious = previous.name === identity.name && previous.vin === identity.vin && previous.claim === identity.claim;
  const needsReview = metadata.import_draft?.needs_review === true;
  const amount = needsReview ? '' : money(ro.total, false);
  const deductible = money(ro.deductible);
  const lossDate = date(ro.date_of_loss || ro.loss_date) || (samePrevious ? date(previous.loss_date) : '');
  // A stored RO total is in dollars. Never infer totals from OCR rows, net insurer payments,
  // insurance approval, or legacy estimate_amount columns with inconsistent historical units.
  const stamp = metadata.updated_at || ro.updated_at;
  const version = stamp && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '';
  const estimate = amount && version ? `${identity.ro_number} / estimate ${version}`.slice(0, 100) : '';
  const defaults = { estimate, amount, deductible, loss_date: lossDate, invoice: identity.ro_number ? `Invoice for ${identity.ro_number}`.slice(0, 100) : '' };
  const sources = { estimate: estimate ? 'Saved estimate snapshot' : '', amount: amount ? 'Saved RO total, including tax' : '',
    deductible: deductible ? 'Saved RO insurance details' : '', loss_date: lossDate ? (date(ro.date_of_loss || ro.loss_date) ? 'Saved RO insurance details' : 'Previous authorization for this claim') : '',
    invoice: defaults.invoice ? 'Repair order invoice reference' : '' };
  const warnings = [];
  if (needsReview) warnings.push('The imported estimate needs review. Check the estimate and enter the authorized total before preparing this agreement.');
  if (!amount && !needsReview) warnings.push('No saved repair total is available. Enter the agreed amount, including tax.');
  const revision = hash(JSON.stringify({ identity, defaults, sources, needsReview, ro_updated: ro.updated_at, estimate_updated: metadata.updated_at }));
  return { identity, defaults, sources, warnings, revision };
}
async function loadAutofill(client, roId, shopId) {
  const ro = (await client.query('SELECT * FROM repair_orders WHERE id::text=$1 AND shop_id::text=$2', [roId, shopId])).rows[0];
  if (!ro) throw inputError('Repair order not found.', 404);
  const customer = ro.customer_id ? (await client.query('SELECT * FROM customers WHERE id::text=$1 AND shop_id::text=$2', [ro.customer_id,shopId])).rows[0] : null;
  const vehicle = ro.vehicle_id ? (await client.query('SELECT * FROM vehicles WHERE id::text=$1 AND shop_id::text=$2', [ro.vehicle_id,shopId])).rows[0] : null;
  const hasMetadata = (await client.query("SELECT to_regclass('estimate_metadata') AS table_name")).rows[0]?.table_name;
  const metadata = hasMetadata ? (await client.query('SELECT * FROM estimate_metadata WHERE ro_id::text=$1 AND shop_id::text=$2 ORDER BY updated_at DESC LIMIT 1', [roId, shopId])).rows[0] : null;
  const previous = (await client.query(`SELECT preparation_details FROM agreement_requests WHERE ro_id=$1 AND shop_id=$2
    AND status <> 'voided' AND preparation_details->>'stage'='intake'
    ORDER BY created_at DESC LIMIT 1`, [roId,shopId])).rows[0]?.preparation_details;
  return buildAutofill(ro, customer || {}, vehicle || {}, metadata || {}, previous || {});
}
function checkRevision(supplied, current) {
  if (typeof supplied !== 'string' || supplied.length !== 64 || !/^[a-f0-9]{64}$/.test(supplied) || supplied !== current.revision) {
    throw inputError('The repair order or estimate changed. Reload RO details and review the agreement again.', 409);
  }
}
module.exports = { buildAutofill, loadAutofill, checkRevision };
