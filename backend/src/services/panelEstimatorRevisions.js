'use strict';
const { randomUUID } = require('node:crypto');
const n = require('./panelEstimatorStore');
const { createPanelEstimatorDraft, hashInputs, canonical } = require('./panelEstimatorDraft');

const conflict = code => { throw n.error(code, 409); };
const dollars = cents => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const author = input => {
  if (!['owner', 'admin', 'assistant'].includes(input.role)) throw n.error('FORBIDDEN', 403);
};
const resultDTO = row => ({ revision_id: row.id, quote_hash: row.quote_hash,
  version: Number(row.version), quote: row.public_snapshot });

// Compare every safe input field, including scope, operations, prices, presets,
// discounts and payer provenance. This makes no carrier/equivalence inference.
function differences(before, after, path = '') {
  if (canonical(before) === canonical(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' &&
      !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key =>
      differences(before[key] ?? null, after[key] ?? null, path ? `${path}.${key}` : key));
  }
  return [{ path, before: before ?? null, after: after ?? null }];
}

function billingRows(quote, revisionId) {
  return quote.buckets.map((bucket, index) => {
    const line = quote.lines.find(l => l.id === bucket.id);
    const pkg = quote.packages.find(p => p.id === (bucket.package_id ?? bucket.id));
    // B1 allocation buckets materialize once per category, preserving explicit
    // taxability and accounting classification. Legacy whole packages stay other.
    const category = bucket.kind === 'package_allocation' ? bucket.category : line?.category;
    const type = ['body', 'refinish'].includes(category) ? 'labor' :
      ['parts', 'sublet'].includes(category) ? category : 'other';
    const value = { id: randomUUID(), type,
      description: bucket.kind === 'package_allocation' ? `${pkg.name} — ${bucket.category}` :
        bucket.kind === 'package' ? pkg.name : bucket.kind === 'panel_minimum' ? `${bucket.panel_id} — Minimum charge adjustment` : bucket.kind === 'minimum' ? 'Minimum charge adjustment' : `${line.description} — ${line.operation_id}`,
      quantity: '1.00', unit_price: dollars(bucket.net_cents), total: dollars(bucket.net_cents),
      taxable: bucket.taxable, sort_order: index, panel_revision_id: revisionId,
      panel_source_key: `${bucket.kind}:${bucket.id}` };
    return { ...value, panel_fingerprint: hashInputs(value) };
  });
}

function moneySnapshot(quote, lines) {
  const category = type => lines.filter(l => l.type === type).reduce((sum, l) => sum + Number(l.unit_price.replace('.', '')), 0);
  return { lineCount: lines.length, taxRate: quote.totals.tax_rate_bps / 10000,
    subtotalCents: quote.totals.net_cents, laborCents: category('labor'), partsCents: category('parts'),
    subletCents: category('sublet'), otherCents: category('other'),
    taxableSubtotalCents: quote.buckets.filter(b => b.taxable).reduce((sum, b) => sum + b.net_cents, 0),
    taxCents: quote.totals.tax_cents, totalCents: quote.totals.total_cents };
}

function requirePreservedAssessments(previous, panels) {
  for (const old of previous) {
    const next = panels.find(p => p.panel_id === old.panel_id);
    if (!next || next.operation !== old.operation || (old.refinish && !next.refinish)) conflict('SCOPE_RECONCILIATION_REQUIRED');
    // Retained deferred work is checked against its immutable committed scope by
    // validateScopePolicy. Reactivation cannot shrink the retained work either.
    for (const key of ['body_hours', 'refinish_hours']) {
      if (Number(next[key] ?? 0) < Number(old[key] ?? 0)) conflict('SCOPE_RECONCILIATION_REQUIRED');
    }
    for (const extra of old.extras ?? []) {
      const found = next.extras.find(e => e.key === extra.key && e.scope === extra.scope && e.category === extra.category);
      if (!found || Number(found.quantity ?? 0) < Number(extra.quantity ?? 0)) conflict('SCOPE_RECONCILIATION_REQUIRED');
    }
  }
}
function requirePreservedScope(previous, quote) {
  for (const old of previous.lines) {
    if (Number(old.quantity) <= 0) continue;
    if (quote.scope.assessments.some(p => p.panel_id === old.panel_id && p.deferral)) continue;
    const next = quote.lines.find(l => l.id === old.id && l.operation_id === old.operation_id);
    if (!next || Number(next.quantity) < Number(old.quantity)) conflict('SCOPE_RECONCILIATION_REQUIRED');
  }
  requirePreservedAssessments(previous.scope.assessments, quote.scope.assessments);
}

function createPanelEstimatorRevisions(database) {
  const pool = database.pool ?? database;
  const store = n.createPanelEstimatorStore(pool), drafts = createPanelEstimatorDraft(pool);
  async function selected(input) {
    const client = input.client ?? pool;
    const row = (await client.query(`SELECT d.active_revision_id FROM repair_orders ro
      LEFT JOIN ro_panel_estimator_drafts d ON d.shop_id=ro.shop_id AND d.ro_id=ro.id
      WHERE ro.shop_id=$1 AND ro.id=$2`, [input.shopId, input.roId])).rows[0];
    if (!row) throw n.error('NOT_FOUND', 404);
    return row.active_revision_id;
  }
  async function get(input, privateOnly = false) {
    author(input);
    if (privateOnly && !['owner', 'admin'].includes(input.role)) throw n.error('FORBIDDEN', 403);
    const revisionId = input.revisionId === undefined ? await selected(input) : n.requiredText(input.revisionId, 255);
    const row = (await pool.query(`SELECT r.id, r.version, r.quote_hash, ${privateOnly ? 'c.snapshot' : 'r.public_snapshot'}
      FROM ro_panel_estimator_revisions r JOIN repair_orders ro ON ro.id=r.ro_id AND ro.shop_id=r.shop_id
      ${privateOnly ? 'JOIN ro_panel_estimator_revision_costs c ON c.shop_id=r.shop_id AND c.ro_id=r.ro_id AND c.revision_id=r.id' : ''}
      WHERE r.shop_id=$1 AND r.ro_id=$2 AND r.id=$3`, [input.shopId, input.roId, revisionId])).rows[0];
    if (!row) throw n.error('NOT_FOUND', 404);
    return privateOnly ? { revision_id: row.id, version: Number(row.version), costs: row.snapshot } : resultDTO(row);
  }
  async function commit(input) {
    author(input);
    const raw = n.object(input.body), body = n.publicSnapshot(raw);
    if (raw.reviewed !== true || !/^[a-f0-9]{64}$/.test(raw.input_hash ?? '') ||
      typeof raw.input_hash !== 'string' || n.cents(raw.expected_version, Number.MAX_SAFE_INTEGER) === null) n.invalid();
    if (Object.hasOwn(raw, 'tax_rate_bps') || Object.hasOwn(raw.adjustments ?? {}, 'tax_rate_bps') ||
      Object.hasOwn(raw.scenario ?? {}, 'carrier_approved')) n.invalid();
    const key = n.requiredText(raw.idempotency_key, 200);
    const requestHash = hashInputs({ body, expected_version: raw.expected_version, input_hash: raw.input_hash, reviewed: true });
    const client = await pool.connect();
    const scope = { shopId: input.shopId, roId: input.roId, role: input.role, actorId: input.actorId, client };
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const owner = await client.query('SELECT id FROM repair_orders WHERE shop_id=$1 AND id=$2 FOR UPDATE', [input.shopId, input.roId]);
      if (!owner.rowCount) throw n.error('NOT_FOUND', 404);
      const retry = (await client.query(`SELECT id, version, request_hash, quote_hash, public_snapshot
        FROM ro_panel_estimator_revisions WHERE shop_id=$1 AND ro_id=$2 AND idempotency_key=$3`,
      [input.shopId, input.roId, key])).rows[0];
      if (retry) {
        if (retry.request_hash !== requestHash) conflict('IDEMPOTENCY_CONFLICT');
        // Retry is still an authorization boundary; assistants cannot replay an
        // owner's overridden price or deferred work using a known idempotency key.
        await n.validateReferences(client, input.shopId, input.roId, body.assessments, { role: input.role });
        if (body.assessments.some(p => p.deferral) && !['owner', 'admin'].includes(input.role)) throw n.error('FORBIDDEN', 403);
        await client.query('COMMIT');
        return resultDTO(retry);
      }
      const preview = await drafts.read({ ...scope, expectedVersion: raw.expected_version, body });
      if (preview.input_hash !== raw.input_hash) conflict('PREVIEW_CONFLICT');
      // Allow only known non-blocking observations. New review codes fail closed.
      const warnings = new Set(['incomplete_insurance_allocation', 'missing_posted_payments']);
      if (!preview.sell.complete || preview.sell.inspection_required ||
        preview.sell.review_flags.some(f => !warnings.has(f.code)) || !preview.draft.scenario.provenance) conflict('REVIEW_REQUIRED');
      const activeId = await selected(scope);
      const history = (await client.query(`SELECT id, public_snapshot, accounting_snapshot FROM ro_panel_estimator_revisions
        WHERE shop_id=$1 AND ro_id=$2 ORDER BY version`, [input.shopId, input.roId])).rows;
      const previous = history.find(r => r.id === activeId);
      if (activeId && !previous) throw n.error('INVALID_REVISION', 500);
      if (previous) requirePreservedScope(previous.public_snapshot, preview.sell);
      const current = (await client.query(`SELECT id::text, type, description, quantity::text, unit_price::text, total::text,
        taxable, sort_order, panel_revision_id, panel_source_key, panel_fingerprint
        FROM estimate_line_items WHERE shop_id=$1 AND ro_id=$2 ORDER BY sort_order, id FOR UPDATE`,
      [input.shopId, input.roId])).rows;
      const expected = previous?.accounting_snapshot.lines ?? [];
      if (canonical(current) !== canonical(expected)) conflict('LINE_RECONCILIATION_REQUIRED');
      const saved = await store.saveDraft({ ...preview.draft, ...scope, expectedVersion: raw.expected_version });
      const revisionId = randomUUID();
      const reviewedAt = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
      const quote = { ...preview.sell, revision_id: revisionId, reviewed: true, reviewed_at: reviewedAt,
        scenario_key: `${saved.scenario.payer}:${saved.scenario.provenance}`,
        comparisons: history.map(r => ({ revision_id: r.id, scenario: r.public_snapshot.scenario,
          differences: differences({ scope: r.public_snapshot.scope, scenario: r.public_snapshot.scenario,
            adjustments: r.public_snapshot.adjustments, totals: r.public_snapshot.totals },
          { scope: preview.sell.scope, scenario: preview.sell.scenario, adjustments: preview.sell.adjustments, totals: preview.sell.totals }) })) };
      // Hash the entire public snapshot excluding its own hash field.
      const quoteHash = hashInputs(quote);
      quote.quote_hash = quoteHash;
      const lines = billingRows(quote, revisionId), money = moneySnapshot(quote, lines);
      await client.query(`INSERT INTO ro_panel_estimator_revisions
        (shop_id,ro_id,id,version,scenario_key,idempotency_key,request_hash,input_hash,quote_hash,reviewed,reviewed_by,reviewed_at,public_snapshot,accounting_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11,$12,$13)`,
      [input.shopId,input.roId,revisionId,saved.version,quote.scenario_key,key,requestHash,preview.input_hash,quoteHash,
        n.requiredText(input.actorId,255),reviewedAt,JSON.stringify(quote),JSON.stringify({ lines, money })]);
      await client.query(`INSERT INTO ro_panel_estimator_revision_costs (shop_id,ro_id,revision_id,snapshot)
        VALUES ($1,$2,$3,$4)`, [input.shopId,input.roId,revisionId,JSON.stringify(preview.costs)]);
      await client.query("SELECT set_config('revv.panel_commit', jsonb_build_array($1::text,$2::text)::text, true)", [input.shopId,input.roId]);
      await client.query(`DELETE FROM estimate_line_items WHERE shop_id=$1 AND ro_id=$2 AND panel_revision_id=$3`, [input.shopId,input.roId,activeId]);
      for (const line of lines) {
        await client.query(`INSERT INTO estimate_line_items
          (id,shop_id,ro_id,type,description,quantity,unit_price,taxable,sort_order,panel_revision_id,panel_source_key,panel_fingerprint)
          VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11)`,
        [line.id,input.shopId,input.roId,line.type,line.description,line.unit_price,line.taxable,line.sort_order,revisionId,line.panel_source_key,line.panel_fingerprint]);
      }
      await client.query(`UPDATE repair_orders SET parts_cost=$3,labor_cost=$4,sublet_cost=$5,tax=$6,total=$7,estimate_amount=$7,updated_at=NOW()
        WHERE shop_id=$1 AND id=$2`, [input.shopId,input.roId,dollars(money.partsCents),dollars(money.laborCents),
        dollars(money.subletCents + money.otherCents),dollars(money.taxCents),dollars(money.totalCents)]);
      await client.query(`UPDATE ro_panel_estimator_drafts SET active_revision_id=$3 WHERE shop_id=$1 AND ro_id=$2`, [input.shopId,input.roId,revisionId]);
      await client.query('COMMIT');
      return { revision_id: revisionId, quote_hash: quoteHash, version: saved.version, quote };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { err.rollbackError = rollbackError; }
      throw err;
    } finally { client.release(); }
  }
  return { commit, selected, getQuote: input => get(input), getCosts: input => get(input, true) };
}

module.exports = { createPanelEstimatorRevisions, differences, requirePreservedAssessments, requirePreservedScope };
