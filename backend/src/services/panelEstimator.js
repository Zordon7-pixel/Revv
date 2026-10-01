const { exactMoney, allocateInsurance } = require('./roMoney');
const { scaledDecimal, checkedCents, roundHalfUp } = exactMoney;

const cents = (value, label) => scaledDecimal(value, 0, label);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}
function text(value, label, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new TypeError(`Invalid ${label}`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${label}`);
  return value;
}
function list(value, label) {
  if (!Array.isArray(value) || value.length > 1000) throw new TypeError(`Invalid ${label}`);
  return value;
}
const operationKind = value => value.toLowerCase().replaceAll('-', '_');

function normalizeLine(raw) {
  record(raw, 'line');
  const line = {
    id: text(raw.id, 'line id'),
    panel_id: text(raw.panel_id, 'panel_id'),
    operation_id: text(raw.operation_id, 'operation_id'),
    shared_key: text(raw.shared_key, 'shared_key', true),
    category: text(raw.category, 'category'),
    description: raw.description == null || raw.description === '' ? '' : text(raw.description, 'description'),
    quantity: scaledDecimal(raw.quantity, 2, 'quantity', 100000000n),
    taxable: boolean(raw.taxable, 'taxable'),
    cost_unit: raw.cost_unit_cents == null ? null : cents(raw.cost_unit_cents, 'cost_unit_cents'),
    cost_source: text(raw.cost_source, 'cost_source', true),
    package_id: text(raw.package_id, 'package_id', true),
    included: raw.included === undefined ? false : boolean(raw.included, 'included'),
  };
  line.inspection_required = [line.operation_id, line.category].some(value => operationKind(value) === 'inspection_required');
  line.unit_price = line.inspection_required && raw.unit_price_cents == null
    ? null : cents(raw.unit_price_cents, 'unit_price_cents');
  if (line.included && !line.package_id) throw new TypeError('Included operation requires a package');
  return line;
}

function normalizeLines(rawLines) {
  const ids = new Set();
  const operations = new Map();
  const panelKinds = new Map();
  const result = [];
  for (const raw of list(rawLines, 'lines')) {
    const line = normalizeLine(raw);
    if (ids.has(line.id)) throw new TypeError('Duplicate line id');
    ids.add(line.id);
    const kind = operationKind(line.operation_id);
    const kinds = panelKinds.get(line.panel_id) || new Set();
    kinds.add(kind);
    panelKinds.set(line.panel_id, kinds);
    if (kinds.has('repair') && kinds.has('replace')) throw new TypeError('Repair and replace conflict on the same panel');
    // shared_key explicitly names the shared scope across panels; operation and
    // category identify the work within it. Descriptions never identify work.
    const key = JSON.stringify([line.shared_key ? 'shared' : 'panel', line.shared_key || line.panel_id, line.operation_id, line.category]);
    const previous = operations.get(key);
    if (previous) {
      const fields = ['quantity', 'unit_price', 'taxable', 'cost_unit', 'cost_source', 'package_id', 'included', 'inspection_required'];
      if (!line.shared_key || fields.some(field => line[field] !== previous[field])) throw new TypeError('Conflicting duplicate operation');
      // Stable representative, independent of input order; cost and sell counted once.
      if (compare(line.id, previous.id) < 0) Object.assign(previous, line);
    } else {
      operations.set(key, line);
      result.push(line);
    }
  }
  return result.sort((a, b) => compare(a.id, b.id));
}

function normalizePackages(rawPackages, lines) {
  const packages = new Map();
  for (const raw of list(rawPackages, 'packages')) {
    record(raw, 'package');
    const id = text(raw.id, 'package id');
    if (packages.has(id)) throw new TypeError('Duplicate package id');
    const price = cents(raw.price_cents, 'package price_cents');
    const taxable = boolean(raw.taxable, 'package taxable');
    const members = lines.filter(line => line.package_id === id && line.included);
    const matched = new Set();
    for (const ref of list(raw.included_operations, 'included_operations')) {
      // Strings are operation IDs, only when unambiguous within this package.
      // Scoped references {panel_id, operation_id} support repeated operations.
      const operation = typeof ref === 'string' ? text(ref, 'included operation') : text(record(ref, 'included operation').operation_id, 'operation_id');
      const panel = typeof ref === 'string' ? null : text(ref.panel_id, 'panel_id');
      const candidates = members.filter(line => line.operation_id === operation && (panel === null || line.panel_id === panel));
      if (candidates.length !== 1 || matched.has(candidates[0].id)) throw new TypeError('Ambiguous or missing included operation');
      matched.add(candidates[0].id);
    }
    if (!members.length || matched.size !== members.length) throw new TypeError('Package requires explicit included operations');
    if (members.some(line => line.inspection_required || line.quantity === 0n || line.taxable !== taxable)) {
      throw new TypeError('Package requires priced work with homogeneous tax settings');
    }
    packages.set(id, { id, price, taxable, members });
  }
  for (const line of lines) {
    if (line.package_id && !packages.has(line.package_id)) throw new TypeError('Unknown package');
  }
  return [...packages.values()].sort((a, b) => compare(a.id, b.id));
}

function extend(unit, quantity) {
  const value = roundHalfUp(unit * quantity, 100n);
  checkedCents(value);
  return value;
}

// Largest remainder allocation; ties use bucket identity, never insertion order.
function allocateDiscount(buckets, discount, subtotal) {
  if (discount > subtotal) throw new RangeError('Discount exceeds eligible subtotal');
  let allocated = 0n;
  for (const bucket of buckets) {
    bucket.discount = subtotal === 0n ? 0n : discount * bucket.gross / subtotal;
    bucket.remainder = subtotal === 0n ? 0n : discount * bucket.gross % subtotal;
    allocated += bucket.discount;
  }
  const eligible = buckets.filter(bucket => bucket.gross > 0n).sort((a, b) =>
    a.remainder === b.remainder ? compare(a.key, b.key) : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; allocated < discount; i++, allocated++) eligible[i].discount++;
}

function publicBucket(bucket) {
  return {
    id: bucket.id, kind: bucket.kind, taxable: bucket.taxable,
    gross_cents: checkedCents(bucket.gross), discount_cents: checkedCents(bucket.discount),
    net_cents: checkedCents(bucket.net), tax_cents: checkedCents(bucket.tax),
    total_cents: checkedCents(bucket.net + bucket.tax),
  };
}

/** Pure calculator, no persistence. Money is nonnegative integer cents (number or
 * decimal string), quantity has at most two decimal places and is <= 1,000,000.
 * Money inputs/outputs are bounded to 9,999,999,999 cents; tax <= 10000 bps;
 * target margin < 10000 bps and is never inferred. Optional discount/minimum/tax/
 * overhead default to zero only when absent. Explicit null overhead stays unknown.
 *
 * Returns {sell, costs}. Only sell is the public allowlist projection. Inspection
 * markers in category or operation_id are pending, with null sell and no charge.
 * Minimum is a visible, non-discounted bucket after discount; when needed, mixed
 * tax settings or no billable work require clarification and are rejected.
 */
function calculateEstimate(input) {
  record(input, 'estimate');
  const lines = normalizeLines(input.lines);
  const packages = normalizePackages(input.packages === undefined ? [] : input.packages, lines);
  const discount = cents(input.discount_cents === undefined ? 0 : input.discount_cents, 'discount_cents');
  const minimum = cents(input.minimum_cents === undefined ? 0 : input.minimum_cents, 'minimum_cents');
  const taxRate = scaledDecimal(input.tax_rate_bps === undefined ? 0 : input.tax_rate_bps, 0, 'tax_rate_bps', 10000n);
  const target = input.target_margin_bps == null ? null : scaledDecimal(input.target_margin_bps, 0, 'target_margin_bps', 9999n);
  const overhead = input.overhead_cents === null ? null : cents(input.overhead_cents === undefined ? 0 : input.overhead_cents, 'overhead_cents');
  const includeOverhead = input.include_overhead_in_target === undefined ? false : boolean(input.include_overhead_in_target, 'include_overhead_in_target');
  const buckets = lines.filter(line => !line.included && !line.inspection_required).map(line => ({
    key: `line:${line.id}`, id: line.id, kind: 'line', taxable: line.taxable, gross: extend(line.unit_price, line.quantity),
  }));
  for (const pkg of packages) buckets.push({ key: `package:${pkg.id}`, id: pkg.id, kind: 'package', taxable: pkg.taxable, gross: pkg.price });
  const subtotal = buckets.reduce((sum, bucket) => sum + bucket.gross, 0n);
  checkedCents(subtotal);
  allocateDiscount(buckets, discount, subtotal);
  const adjustment = minimum > subtotal - discount ? minimum - (subtotal - discount) : 0n;
  if (adjustment > 0n) {
    const billable = buckets.filter(bucket => bucket.kind === 'package' || lines.find(line => line.id === bucket.id).quantity > 0n);
    const settings = new Set(billable.map(bucket => bucket.taxable));
    if (settings.size !== 1) throw new TypeError('Minimum adjustment requires homogeneous tax settings and billable work');
    buckets.push({ key: 'minimum:', id: 'minimum_adjustment', kind: 'minimum', taxable: billable[0].taxable, gross: adjustment, discount: 0n });
  }
  // Round the shop taxable subtotal once, then allocate cents deterministically.
  let taxableNet = 0n;
  let allocatedTax = 0n;
  for (const bucket of buckets) {
    bucket.net = bucket.gross - bucket.discount;
    if (bucket.taxable) taxableNet += bucket.net;
    bucket.tax = bucket.taxable ? bucket.net * taxRate / 10000n : 0n;
    bucket.taxRemainder = bucket.taxable ? bucket.net * taxRate % 10000n : 0n;
    allocatedTax += bucket.tax;
  }
  const tax = roundHalfUp(taxableNet * taxRate, 10000n);
  const taxableBuckets = buckets.filter(bucket => bucket.taxable).sort((a, b) =>
    a.taxRemainder === b.taxRemainder ? compare(a.key, b.key) : a.taxRemainder > b.taxRemainder ? -1 : 1);
  for (let i = 0; allocatedTax < tax; i++, allocatedTax++) taxableBuckets[i].tax++;
  const net = subtotal - discount + adjustment;
  const bucketMap = new Map(buckets.map(bucket => [bucket.key, bucket]));
  const missing = [];
  let known = 0n;
  const costLines = lines.map(line => {
    let extended = null;
    if (line.inspection_required) missing.push({ id: line.id, reason: 'inspection_required' });
    else if (line.cost_unit === null) missing.push({ id: line.id, reason: 'missing_unit_cost' });
    else extended = line.quantity === 0n ? 0n : extend(line.cost_unit, line.quantity);
    if (extended !== null) known += extended;
    return { id: line.id, cost_unit_cents: line.cost_unit === null ? null : checkedCents(line.cost_unit), cost_source: line.cost_source, cost_cents: extended === null ? null : checkedCents(extended) };
  });
  if (overhead === null) missing.push({ id: null, reason: 'missing_overhead' });
  const complete = missing.length === 0;
  const directComplete = !missing.some(item => item.reason !== 'missing_overhead');
  const totalCost = complete ? known + overhead : null;
  const contribution = directComplete ? net - known : null;
  const afterOverhead = complete ? net - totalCost : null;
  const targetCost = directComplete && (!includeOverhead || overhead !== null) ? known + (includeOverhead ? overhead : 0n) : null;
  const targetRevenue = targetCost !== null && target !== null ? (targetCost * 10000n + (10000n - target) - 1n) / (10000n - target) : null;
  // Build all public objects explicitly. Never spread input (even nested lines).
  const sell = {
    lines: lines.map(line => {
      const bucket = bucketMap.get(`line:${line.id}`);
      return {
        id: line.id, panel_id: line.panel_id, operation_id: line.operation_id,
        shared_key: line.shared_key, category: line.category, description: line.description,
        quantity: `${line.quantity / 100n}.${String(line.quantity % 100n).padStart(2, '0')}`,
        unit_price_cents: line.inspection_required ? null : checkedCents(line.unit_price), taxable: line.taxable,
        package_id: line.package_id, included: line.included, inspection_required: line.inspection_required,
        net_cents: line.inspection_required ? null : bucket ? checkedCents(bucket.net) : 0,
        tax_cents: line.inspection_required ? null : bucket ? checkedCents(bucket.tax) : 0,
      };
    }),
    packages: packages.map(pkg => ({ id: pkg.id, price_cents: checkedCents(pkg.price), taxable: pkg.taxable,
      included_operations: pkg.members.map(line => ({ panel_id: line.panel_id, operation_id: line.operation_id })) })),
    buckets: buckets.sort((a, b) => compare(a.key, b.key)).map(publicBucket),
    inspection_required: lines.some(line => line.inspection_required),
    subtotal_cents: checkedCents(subtotal), discount_cents: checkedCents(discount),
    minimum_adjustment_cents: checkedCents(adjustment), net_cents: checkedCents(net),
    tax_rate_bps: Number(taxRate), tax_cents: checkedCents(tax), total_cents: checkedCents(net + tax),
  };
  return { sell, costs: {
    lines: costLines, known_subtotal_cents: checkedCents(known), missing, complete,
    direct_cost_cents: directComplete ? checkedCents(known) : null,
    overhead_cents: overhead === null ? null : checkedCents(overhead),
    total_cost_cents: totalCost === null ? null : checkedCents(totalCost),
    include_overhead_in_target: includeOverhead,
    after_overhead_cents: afterOverhead === null ? null : checkedCents(afterOverhead),
    contribution_cents: contribution === null ? null : checkedCents(contribution),
    // Only display ratios use Number; all cent arithmetic above is exact.
    margin_bps: contribution === null || net === 0n ? null : Number(contribution) / Number(net) * 10000,
    target_margin_bps: target === null ? null : Number(target),
    target_revenue_cents: targetRevenue === null ? null : checkedCents(targetRevenue),
  } };
}

module.exports = { calculateEstimate, allocateInsurance };
