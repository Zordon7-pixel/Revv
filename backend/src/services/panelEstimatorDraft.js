'use strict';
const { createHash } = require('node:crypto');
const n = require('./panelEstimatorStore');
const { calculateEstimate, allocateInsurance, normalizeDiscounts } = require('./panelEstimator');
const { exactMoney } = require('./roMoney');
const { scaledDecimal, checkedCents, roundHalfUp } = exactMoney;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hashInputs = input => createHash('sha256').update(canonical(input)).digest('hex');
const publicLine = line => ({ id: line.id, panel_id: line.panel_id, operation_id: line.operation_id,
  shared_key: line.shared_key ?? null, category: line.category, description: line.description ?? '',
  quantity: line.quantity, unit_price_cents: line.unit_price_cents, taxable: line.taxable,
  package_id: line.package_id ?? null, included: line.included ?? false,
  inspection_required: line.inspection_required ?? false, net_cents: null, tax_cents: null });

// The eventual customer route must use this same pure projection; no raw inputs,
// private config, private reason or calculator costs may enter the quote DTO.
function quoteDTO(sell) {
  const safe = {
    lines: sell.lines.map(line => ({ ...publicLine(line), net_cents: line.net_cents, tax_cents: line.tax_cents })),
    packages: sell.packages.map(pkg => ({ id: pkg.id, name: pkg.name, price_cents: pkg.price_cents, taxable: pkg.taxable,
      ...(pkg.sell_allocation_cents ? { sell_allocation_cents: n.amounts(pkg.sell_allocation_cents,
        n.CATEGORIES.filter(k => Object.hasOwn(pkg.sell_allocation_cents, k))) } : {}),
      included_operations: pkg.included_operations.map(op => ({ panel_id: op.panel_id, operation_id: op.operation_id })) })),
    buckets: sell.buckets.map(b => ({ ...Object.fromEntries(['id', 'kind', 'taxable', 'gross_cents', 'discount_cents', 'net_cents', 'tax_cents', 'total_cents'].map(k => [k, b[k]])),
      ...(b.kind === 'panel_minimum' ? { panel_id: b.panel_id } : {}),
      ...(b.kind === 'package_allocation' ? { package_id: b.package_id, category: b.category } : {}) })),
    inspection_required: sell.inspection_required, complete: sell.complete,
    flags: sell.flags.map(f => ({ panel_id: f.panel_id, code: f.code })),
    subtotal_cents: sell.subtotal_cents, discount_cents: sell.discount_cents,
    minimum_adjustment_cents: sell.minimum_adjustment_cents, net_cents: sell.net_cents,
    tax_rate_bps: sell.tax_rate_bps, tax_cents: sell.tax_cents, total_cents: sell.total_cents,
    allocation: { complete: sell.allocation.complete, carrier_cents: sell.allocation.carrier_cents,
      customer_cents: sell.allocation.customer_cents, paid_cents: sell.allocation.paid_cents, balance_cents: sell.allocation.balance_cents },
  };
  return { lines: safe.lines, packages: safe.packages, buckets: safe.buckets,
    totals: Object.fromEntries(['subtotal_cents', 'discount_cents', 'minimum_adjustment_cents', 'net_cents',
      'tax_rate_bps', 'tax_cents', 'total_cents'].map(k => [k, safe[k]])),
    review_flags: safe.flags, complete: safe.complete, inspection_required: safe.inspection_required,
    calculation_version: 1, scope: { panel_ids: [...new Set(safe.lines.map(line => line.panel_id))].sort() },
    allocation: safe.allocation };
}

/** Pure assembly: consumes normalized store snapshots and trusted server context.
 * Unknown required quantities/prices/tax policy never become a complete zero.
 * Category tax flags are explicit per assessment; shops currently supply rate only.
 * Cost preset config is not silently applied: explicit RO private settings win.
 */
function assembleDraft({ draft, costs, taxRateBps, paidCents }) {
  const lines = [], pending = [], packages = [], flags = [];
  let incomplete = taxRateBps === null;
  const flag = (panel_id, code, blocks = false) => { flags.push({ panel_id, code }); if (blocks) incomplete = true; };
  if (taxRateBps === null) flag(null, 'missing_shop_tax_rate', true);
  if (paidCents === null) flag(null, 'missing_posted_payments');
  if (draft.scenario.payer === 'insurance' && (!draft.scenario.allocation || Object.values(draft.scenario.allocation).some(v => v === null))) {
    flag(null, 'incomplete_insurance_allocation');
  }
  if (!draft.scenario.payer) flag(null, 'missing_payer', true);
  if (!draft.assessments.length) flag(null, 'missing_assessments', true);
  for (const panel of draft.assessments) {
    if (panel.deferral) continue;
    const privateLine = costs.lines.find(line => line.panel_id === panel.panel_id) ?? {};
    if (!panel.body_style) flag(panel.panel_id, 'invalid_body_style', true);
    if (!panel.severity) flag(panel.panel_id, 'invalid_severity', true);
    if (!panel.operation || (['paint-only', 'blend'].includes(panel.operation) && panel.refinish !== true)) flag(panel.panel_id, 'invalid_applicability', true);
    if (panel.reviewed !== true) flag(panel.panel_id, 'unreviewed');
    const inspect = panel.operation === 'inspection-required';
    if (inspect) flag(panel.panel_id, 'inspection_required', true);
    if (panel.refinish === null) flag(panel.panel_id, 'missing_refinish_selection', true);
    const pkg = panel.package;
    const packageId = pkg ? `${panel.panel_id}:package` : null;
    const panelLines = [];
    function add(category, operation, quantity, price, cost, extra, source) {
      const included = !extra && !!pkg?.included_operations.includes(category);
      const line = { id: extra ? `${panel.panel_id}:extra:${extra.scope}:${extra.key}` : `${panel.panel_id}:${category}`,
        panel_id: panel.panel_id, operation_id: operation, shared_key: extra ? `extra:${extra.scope}` : null,
        category, description: extra?.description ?? panel.label ?? panel.panel_id,
        quantity, unit_price_cents: price, taxable: extra ? extra.taxable : panel.taxable[category],
        cost_unit_cents: cost ?? null, cost_source: source ?? null,
        package_id: included ? packageId : null, included, inspection_required: inspect };
      // An included operation's sale is explicitly the package price, not a missing hourly price.
      if (included) line.unit_price_cents = 0;
      const unknown = inspect || quantity === null || (!included && price === null) || line.taxable === null;
      if (unknown) {
        flag(panel.panel_id, inspect ? 'inspection_required' : `missing_${extra ? 'extra' : category}_inputs`, true);
        pending.push(line);
      } else lines.push(line);
      panelLines.push(line);
    }
    // Every category remains represented, including explicit known zero amounts.
    // Body work is required for repair/replace; other operations explicitly omit it.
    const bodyActive = ['repair', 'replace'].includes(panel.operation);
    add('body', panel.operation ?? 'unknown', bodyActive ? panel.body_hours : inspect ? null : 0,
      bodyActive ? panel.body_rate_cents : inspect ? null : 0, privateLine.body_cost_rate_cents, null, privateLine.cost_sources?.body_cost_rate_cents);
    add('refinish', 'refinish', panel.refinish === false ? 0 : panel.refinish_hours,
      panel.refinish === false ? 0 : panel.refinish_rate_cents, privateLine.refinish_cost_rate_cents, null, privateLine.cost_sources?.refinish_cost_rate_cents);
    for (const category of ['parts', 'materials', 'sublet']) {
      let price = panel[`${category}_sell_cents`];
      // B1 material quantities extend the sell total once, half up. Private material
      // costs remain total amounts, not per-unit costs multiplied by sell quantity.
      if (category === 'materials' && panel.materials_pricing?.method === 'quantity_rate') {
        const method = panel.materials_pricing;
        price = method.quantity === null || method.unit_rate_cents === null ? null : checkedCents(roundHalfUp(
          scaledDecimal(method.quantity, 2, 'materials quantity', 100000000n) * BigInt(method.unit_rate_cents), 100n));
      }
      const quantity = category === 'materials' && panel.materials_pricing?.method === 'quantity_rate' && price === null ? null : 1;
      add(category, category, quantity, price, privateLine[`${category}_cost_cents`], null, privateLine.cost_sources?.[`${category}_cost_cents`]);
    }
    for (const extra of panel.extras) {
      const cost = (privateLine.extras ?? []).find(c => c.key === extra.key && c.scope === extra.scope);
      add(extra.category, `extra:${extra.key}`, extra.quantity, extra.unit_price_cents, cost?.cost_unit_cents, extra, cost?.cost_source);
    }
    if (pkg) {
      const members = panelLines.filter(line => line.included);
      if (members.length !== pkg.included_operations.length || members.some(line => line.quantity === 0 ||
          (line.taxable !== null && pkg.taxable !== null && line.taxable !== pkg.taxable))) {
        throw n.error('INVALID_PACKAGE');
      }
      packages.push({ id: packageId, price_cents: pkg.price_cents, taxable: pkg.taxable,
        ...(pkg.sell_allocation_cents ? { sell_allocation_cents: pkg.sell_allocation_cents } : {}),
        included_operations: members.map(line => ({ panel_id: line.panel_id, operation_id: line.operation_id })) });
    }
  }
  // Unknown package members cannot be fed to the strict calculator as zero work.
  const pendingPackages = new Set(pending.map(line => line.package_id).filter(Boolean));
  const calculable = lines.filter(line => !pendingPackages.has(line.package_id));
  for (const line of lines.filter(line => pendingPackages.has(line.package_id))) pending.push(line);
  const discounts = normalizeDiscounts(draft.adjustments.discounts, [...calculable, ...pending], packages);
  const result = calculateEstimate({ lines: calculable, packages: packages.filter(p => !pendingPackages.has(p.id)),
    discount_cents: incomplete ? 0 : draft.adjustments.discount_cents ?? 0,
    discounts: incomplete ? [] : discounts,
    panel_minima: incomplete ? [] : draft.assessments.filter(p => !p.deferral && p.application_snapshot?.sell_settings.minimum_cents != null)
      .map(p => ({ panel_id: p.panel_id, minimum_cents: p.application_snapshot.sell_settings.minimum_cents })),
    minimum_cents: incomplete ? 0 : draft.adjustments.minimum_cents ?? 0,
    tax_rate_bps: taxRateBps ?? 0, target_margin_bps: costs.target_margin_bps,
    overhead_cents: costs.overhead_cents, include_overhead_in_target: costs.include_overhead_in_target });
  result.sell.packages.push(...packages.filter(pkg => pendingPackages.has(pkg.id)));
  result.sell.packages.forEach(pkg => { pkg.name = draft.assessments.find(p => `${p.panel_id}:package` === pkg.id).package.name; });
  result.sell.lines.push(...pending.map(publicLine));
  result.sell.lines.sort((a, b) => a.id.localeCompare(b.id));
  result.sell.complete = !incomplete;
  result.sell.flags = [...new Map(flags.map(f => [canonical(f), f])).values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  result.sell.inspection_required = draft.assessments.some(p => p.operation === 'inspection-required');
  result.sell.tax_rate_bps = taxRateBps;
  if (incomplete) {
    for (const field of ['subtotal_cents', 'minimum_adjustment_cents', 'net_cents', 'tax_cents', 'total_cents']) result.sell[field] = null;
    result.sell.discount_cents = checkedCents(BigInt(draft.adjustments.discount_cents ?? 0) + discounts.reduce((sum, d) => sum + BigInt(d.amount_cents), 0n));
    // No bucket or line may suggest a final discount/tax allocation for a partial draft.
    result.sell.buckets = [];
    result.sell.lines.forEach(line => { line.net_cents = null; line.tax_cents = null; });
    result.costs.complete = false;
    for (const field of ['contribution_cents', 'after_overhead_cents', 'margin_bps']) result.costs[field] = null;
  }
  if (pending.length) {
    result.costs.lines.push(...pending.map(line => ({ id: line.id, cost_unit_cents: line.cost_unit_cents, cost_source: line.cost_source, cost_cents: null })));
    result.costs.missing.push(...pending.map(line => ({ id: line.id, reason: 'incomplete_operation' })));
    for (const field of ['direct_cost_cents', 'total_cost_cents', 'target_revenue_cents']) result.costs[field] = null;
  }
  const total = result.sell.total_cents;
  if (draft.scenario.payer === 'cash') {
    result.sell.allocation = { complete: total !== null && paidCents !== null, carrier_cents: 0, customer_cents: total,
      paid_cents: paidCents, balance_cents: total === null || paidCents === null ? null : Math.max(0, total - paidCents) };
  } else {
    result.sell.allocation = allocateInsurance({ ...(draft.scenario.allocation ?? {}), total_cents: total, paid_cents: paidCents });
  }
  const sell = quoteDTO(result.sell);
  sell.scenario = { ...draft.scenario };
  sell.adjustments = { ...draft.adjustments };
  sell.discount_lines = discounts.map(d => ({ ...d, description: 'Scoped discount (already allocated to billing amounts)' }));
  if (draft.adjustments.discount_cents > 0) sell.discount_lines.push({
    description: 'Quote discount (already allocated to billing amounts)', amount_cents: draft.adjustments.discount_cents });
  sell.scope.panel_ids = draft.assessments.map(p => p.panel_id).sort();
  sell.scope.assessments = n.publicSnapshot(draft).assessments;
  return { sell, costs: result.costs };
}

// read() without a body is a safe stored read. preview() always rechecks policy,
// including when called directly with no body. role/actorId belong to server
// context, not the normalized/hashable customer draft.
function createPanelEstimatorDraft(database) {
  const pool = database.pool ?? database;
  const store = n.createPanelEstimatorStore(pool);
  async function read(input, reviewing = false) {
    const client = input.client ?? await pool.connect(), own = !input.client;
    try {
      if (own) await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const scope = { shopId: input.shopId, roId: input.roId, client };
      const saved = await store.getDraft(scope);
      if (input.expectedVersion !== undefined && input.expectedVersion !== saved.version) throw n.error('VERSION_CONFLICT', 409);
      const draft = input.body === undefined ? saved : { version: saved.version, ...n.publicSnapshot(n.object(input.body)) };
      await n.validateReferences(client, input.shopId, input.roId, draft.assessments, { role: input.role, enforce: reviewing || input.body !== undefined });
      if (reviewing || input.body !== undefined) await n.validateScopePolicy(client, input, draft.assessments, saved.assessments);
      const costs = await store.getCosts(scope);
      const shop = await client.query('SELECT tax_rate FROM shops WHERE id=$1', [input.shopId]);
      let taxRateBps = null;
      if (shop.rows[0]?.tax_rate != null) {
        try { taxRateBps = Number(scaledDecimal(shop.rows[0].tax_rate, 4, 'shop tax rate', 10000n)); }
        catch { taxRateBps = null; } // Invalid/unknown server configuration is a visible incomplete flag.
      }
      const paymentTable = await client.query("SELECT to_regclass('ro_payments') AS relation");
      let paidCents = null;
      if (paymentTable.rows[0].relation) {
        const payments = await client.query(`SELECT COALESCE(SUM(p.amount_cents),0)::text AS paid_cents FROM ro_payments p
          JOIN repair_orders ro ON ro.id=p.ro_id AND ro.shop_id=p.shop_id
          WHERE p.shop_id=$1 AND p.ro_id=$2 AND LOWER(COALESCE(p.status,'')) IN ('paid','succeeded')`, [input.shopId, input.roId]);
        paidCents = checkedCents(scaledDecimal(payments.rows[0].paid_cents, 0, 'posted paid'));
      }
      const calculated = assembleDraft({ draft, costs, taxRateBps, paidCents });
      const inputHash = hashInputs({ contract_version: 1, shop_id: input.shopId, ro_id: input.roId,
        draft, private_costs: costs, server_tax_rate_bps: taxRateBps, posted_paid_cents: paidCents });
      if (own) await client.query('COMMIT');
      return { version: saved.version, input_hash: inputHash, draft, sell: calculated.sell,
        costs: { ...calculated.costs, settings: costs } };
    } catch (err) {
      try { if (own) await client.query('ROLLBACK'); } catch (rollbackError) { err.rollbackError = rollbackError; }
      throw err;
    } finally { if (own) client.release(); }
  }
  return { read, preview: input => read(input, true) };
}
module.exports = { assembleDraft, createPanelEstimatorDraft, quoteDTO, canonical, hashInputs };
