const router = require('express').Router();
const { dbAll, dbGet, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { calculateProfit } = require('../services/profit');

const ALLOWED_TYPES = new Set(['labor', 'parts', 'sublet', 'other']);

function normalizeType(type) {
  const next = String(type || '').trim().toLowerCase();
  return ALLOWED_TYPES.has(next) ? next : null;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toInteger(value, fallback = 0) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return false;
}

async function ensureRepairOrder(roId, shopId) {
  return dbGet(
    `SELECT ro.id, ro.shop_id, COALESCE(s.tax_rate, 0) AS tax_rate
     FROM repair_orders ro
     LEFT JOIN shops s ON s.id = ro.shop_id
     WHERE ro.id = $1 AND ro.shop_id = $2`,
    [roId, shopId]
  );
}

async function getSummary(roId, shopId) {
  const summaryRow = await dbGet(
    `SELECT
      COALESCE(SUM(total), 0) AS subtotal,
      COALESCE(SUM(CASE WHEN type = 'labor' THEN total ELSE 0 END), 0) AS labor_total,
      COALESCE(SUM(CASE WHEN type = 'parts' THEN total ELSE 0 END), 0) AS parts_total,
      COALESCE(SUM(CASE WHEN type = 'sublet' THEN total ELSE 0 END), 0) AS sublet_total,
      COALESCE(SUM(CASE WHEN type = 'other' THEN total ELSE 0 END), 0) AS other_total,
      COALESCE(SUM(CASE WHEN taxable THEN total ELSE 0 END), 0) AS taxable_subtotal,
      COUNT(*)::int AS line_count
     FROM estimate_line_items
     WHERE ro_id = $1 AND shop_id = $2`,
    [roId, shopId]
  );

  const ro = await ensureRepairOrder(roId, shopId);
  const taxRate = toNumber(ro?.tax_rate, 0);
  const taxableSubtotal = toNumber(summaryRow?.taxable_subtotal, 0);
  const taxAmount = taxableSubtotal * taxRate;
  const subtotal = toNumber(summaryRow?.subtotal, 0);

  return {
    subtotal,
    labor_total: toNumber(summaryRow?.labor_total, 0),
    parts_total: toNumber(summaryRow?.parts_total, 0),
    sublet_total: toNumber(summaryRow?.sublet_total, 0),
    other_total: toNumber(summaryRow?.other_total, 0),
    taxable_subtotal: taxableSubtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    grand_total: subtotal + taxAmount,
    line_count: toInteger(summaryRow?.line_count, 0),
  };
}

async function getProfitOpportunities(roId, shopId) {
  const [shop, ro, items, summary] = await Promise.all([
    dbGet('SELECT labor_rate, paint_rate, parts_markup FROM shops WHERE id = $1', [shopId]),
    dbGet(
      `SELECT id, true_profit, deductible_waived, referral_fee, goodwill_repair_cost
       FROM repair_orders
       WHERE id = $1 AND shop_id = $2`,
      [roId, shopId]
    ),
    dbAll(
      `SELECT id, type, description, quantity, unit_price, total
       FROM estimate_line_items
       WHERE ro_id = $1 AND shop_id = $2
       ORDER BY sort_order ASC, created_at ASC`,
      [roId, shopId]
    ),
    getSummary(roId, shopId),
  ]);

  const shopLaborRate = toNumber(shop?.labor_rate, 0);
  const flags = [];
  let supplementTotal = 0;
  let laborUndercutCount = 0;
  let reviewCount = 0;

  for (const item of items) {
    const type = String(item?.type || '').toLowerCase();
    const qty = toNumber(item?.quantity, 0);
    const unitPrice = toNumber(item?.unit_price, 0);

    if (type === 'labor' && shopLaborRate > 0 && unitPrice < shopLaborRate) {
      const gapPerHour = shopLaborRate - unitPrice;
      const supplementOpportunity = gapPerHour * qty;
      supplementTotal += supplementOpportunity;
      laborUndercutCount += 1;
      flags.push({
        item_id: item.id,
        type: 'undervalue',
        description: item.description || 'Labor line',
        quantity: qty,
        insurance_rate: unitPrice,
        shop_rate: shopLaborRate,
        gap_per_unit: gapPerHour,
        supplement_opportunity: supplementOpportunity,
        message: `Insurance ${unitPrice.toFixed(2)}/hr vs shop ${shopLaborRate.toFixed(2)}/hr.`,
      });
      continue;
    }

    if (type === 'parts' && unitPrice > 0 && unitPrice < 15) {
      reviewCount += 1;
      flags.push({
        item_id: item.id,
        type: 'review',
        description: item.description || 'Parts line',
        quantity: qty,
        insurance_rate: unitPrice,
        shop_rate: null,
        gap_per_unit: null,
        supplement_opportunity: 0,
        message: `Low parts unit price (${unitPrice.toFixed(2)}). Verify markup/cost.`,
      });
    }
  }

  const currentProfit = toNumber(ro?.true_profit, 0);
  const projectedProfit = currentProfit + supplementTotal;

  return {
    shop_rates: {
      labor_rate: shopLaborRate,
      paint_rate: toNumber(shop?.paint_rate, 0),
      parts_markup: toNumber(shop?.parts_markup, 0),
    },
    summary: {
      line_count: toInteger(summary?.line_count, 0),
      labor_undercut_count: laborUndercutCount,
      review_count: reviewCount,
      total_supplement_opportunity: supplementTotal,
      current_grand_total: toNumber(summary?.grand_total, 0),
      projected_grand_total: toNumber(summary?.grand_total, 0) + supplementTotal,
      current_true_profit: currentProfit,
      projected_true_profit: projectedProfit,
      profit_uplift: supplementTotal,
    },
    flags: flags.sort((a, b) => toNumber(b.supplement_opportunity, 0) - toNumber(a.supplement_opportunity, 0)),
  };
}

async function syncRepairOrderFinancials(roId, shopId, summary) {
  const ro = await dbGet(
    `SELECT id, deductible_waived, referral_fee, goodwill_repair_cost
     FROM repair_orders
     WHERE id = $1 AND shop_id = $2`,
    [roId, shopId]
  );
  if (!ro) return;

  const nextValues = {
    parts_cost: toNumber(summary?.parts_total, 0),
    labor_cost: toNumber(summary?.labor_total, 0),
    sublet_cost: toNumber(summary?.sublet_total, 0),
    tax: toNumber(summary?.tax_amount, 0),
    total: toNumber(summary?.grand_total, 0),
  };
  const profit = calculateProfit({ ...ro, ...nextValues });

  await dbRun(
    `UPDATE repair_orders
     SET parts_cost = $1,
         labor_cost = $2,
         sublet_cost = $3,
         tax = $4,
         total = $5,
         estimate_amount = $6,
         true_profit = $7,
         updated_at = NOW()
     WHERE id = $8 AND shop_id = $9`,
    [
      nextValues.parts_cost,
      nextValues.labor_cost,
      nextValues.sublet_cost,
      nextValues.tax,
      nextValues.total,
      nextValues.total,
      toNumber(profit?.trueProfit, 0),
      roId,
      shopId,
    ]
  );
}

router.get('/:roId/opportunities', auth, async (req, res) => {
  try {
    const ro = await ensureRepairOrder(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const opportunities = await getProfitOpportunities(req.params.roId, req.user.shop_id);
    return res.json({ success: true, ...opportunities });
  } catch (err) {
    console.error('[Estimate Items] opportunities error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:roId/import-financials', auth, async (req, res) => {
  try {
    const ro = await ensureRepairOrder(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const summary = await getSummary(req.params.roId, req.user.shop_id);
    await syncRepairOrderFinancials(req.params.roId, req.user.shop_id, summary);

    const financials = await dbGet(
      `SELECT parts_cost, labor_cost, sublet_cost, tax, total, estimate_amount, true_profit
       FROM repair_orders
       WHERE id = $1 AND shop_id = $2`,
      [req.params.roId, req.user.shop_id]
    );

    return res.json({ success: true, summary, financials });
  } catch (err) {
    console.error('[Estimate Items] import financials error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:roId/summary', auth, async (req, res) => {
  try {
    const ro = await ensureRepairOrder(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const summary = await getSummary(req.params.roId, req.user.shop_id);
    return res.json({ success: true, summary });
  } catch (err) {
    console.error('[Estimate Items] summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:roId', auth, async (req, res) => {
  try {
    const ro = await ensureRepairOrder(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const items = await dbAll(
      `SELECT id, ro_id, shop_id, type, description, quantity, unit_price, total, taxable, sort_order, created_at, updated_at
       FROM estimate_line_items
       WHERE ro_id = $1 AND shop_id = $2
       ORDER BY sort_order ASC, created_at ASC`,
      [req.params.roId, req.user.shop_id]
    );

    const summary = await getSummary(req.params.roId, req.user.shop_id);
    return res.json({ success: true, items, summary });
  } catch (err) {
    console.error('[Estimate Items] list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:roId', auth, async (req, res) => {
  try {
    const ro = await ensureRepairOrder(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const nextType = normalizeType(req.body?.type || 'labor');
    if (!nextType) return res.status(400).json({ error: 'Invalid line item type' });

    const maxSortRow = await dbGet(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM estimate_line_items WHERE ro_id = $1 AND shop_id = $2',
      [req.params.roId, req.user.shop_id]
    );

    const description = String(req.body?.description || '').trim();
    const quantity = toNumber(req.body?.quantity, 1);
    const unitPrice = toNumber(req.body?.unit_price, 0);
    const taxable = toBool(req.body?.taxable);
    const sortOrder = req.body?.sort_order === undefined
      ? toInteger(maxSortRow?.max_sort, -1) + 1
      : toInteger(req.body?.sort_order, 0);

    const inserted = await dbGet(
      `INSERT INTO estimate_line_items (id, ro_id, shop_id, type, description, quantity, unit_price, taxable, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, ro_id, shop_id, type, description, quantity, unit_price, total, taxable, sort_order, created_at, updated_at`,
      [uuidv4(), req.params.roId, req.user.shop_id, nextType, description, quantity, unitPrice, taxable, sortOrder]
    );

    const summary = await getSummary(req.params.roId, req.user.shop_id);
    await syncRepairOrderFinancials(req.params.roId, req.user.shop_id, summary);
    return res.status(201).json({ success: true, item: inserted, summary });
  } catch (err) {
    console.error('[Estimate Items] create error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.put('/:roId/:itemId', auth, async (req, res) => {
  try {
    const ro = await ensureRepairOrder(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const existing = await dbGet(
      'SELECT id FROM estimate_line_items WHERE id = $1 AND ro_id = $2 AND shop_id = $3',
      [req.params.itemId, req.params.roId, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Line item not found' });

    const nextType = req.body?.type === undefined ? undefined : normalizeType(req.body?.type);
    if (req.body?.type !== undefined && !nextType) {
      return res.status(400).json({ error: 'Invalid line item type' });
    }

    const description = req.body?.description === undefined
      ? undefined
      : String(req.body.description || '').trim();

    const quantity = req.body?.quantity === undefined ? undefined : toNumber(req.body.quantity, 0);
    const unitPrice = req.body?.unit_price === undefined ? undefined : toNumber(req.body.unit_price, 0);
    const taxable = req.body?.taxable === undefined ? undefined : toBool(req.body.taxable);
    const sortOrder = req.body?.sort_order === undefined ? undefined : toInteger(req.body.sort_order, 0);

    await dbRun(
      `UPDATE estimate_line_items
       SET type = COALESCE($1, type),
           description = COALESCE($2, description),
           quantity = COALESCE($3, quantity),
           unit_price = COALESCE($4, unit_price),
           taxable = COALESCE($5, taxable),
           sort_order = COALESCE($6, sort_order),
           updated_at = NOW()
       WHERE id = $7 AND ro_id = $8 AND shop_id = $9`,
      [nextType, description, quantity, unitPrice, taxable, sortOrder, req.params.itemId, req.params.roId, req.user.shop_id]
    );

    const updated = await dbGet(
      `SELECT id, ro_id, shop_id, type, description, quantity, unit_price, total, taxable, sort_order, created_at, updated_at
       FROM estimate_line_items
       WHERE id = $1`,
      [req.params.itemId]
    );

    const summary = await getSummary(req.params.roId, req.user.shop_id);
    await syncRepairOrderFinancials(req.params.roId, req.user.shop_id, summary);
    return res.json({ success: true, item: updated, summary });
  } catch (err) {
    console.error('[Estimate Items] update error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:roId/:itemId', auth, async (req, res) => {
  try {
    const ro = await ensureRepairOrder(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const removed = await dbGet(
      `DELETE FROM estimate_line_items
       WHERE id = $1 AND ro_id = $2 AND shop_id = $3
       RETURNING id`,
      [req.params.itemId, req.params.roId, req.user.shop_id]
    );

    if (!removed) return res.status(404).json({ error: 'Line item not found' });

    const summary = await getSummary(req.params.roId, req.user.shop_id);
    await syncRepairOrderFinancials(req.params.roId, req.user.shop_id, summary);
    return res.json({ success: true, deleted_id: removed.id, summary });
  } catch (err) {
    console.error('[Estimate Items] delete error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Estimate Metadata — adjuster totals persistence ──────────────────────────

// GET /estimate-items/metadata/:roId — fetch adjuster totals for a given RO
router.get('/metadata/:roId', auth, async (req, res) => {
  try {
    const { roId } = req.params;
    const ro = await ensureRepairOrder(roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const metadata = await dbGet(
      `SELECT id, ro_id, shop_id, adjuster_totals, adjuster_raw_text, created_at, updated_at
       FROM estimate_metadata
       WHERE ro_id = $1 AND shop_id = $2`,
      [roId, req.user.shop_id]
    );

    return res.json({ metadata: metadata || null });
  } catch (err) {
    console.error('[Estimate Metadata] GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /estimate-items/metadata/:roId — upsert adjuster totals for a given RO
router.post('/metadata/:roId', auth, async (req, res) => {
  try {
    const { roId } = req.params;
    const ro = await ensureRepairOrder(roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const adjusterTotals = req.body?.adjuster_totals ?? null;
    const adjusterRawText = req.body?.adjuster_raw_text !== undefined
      ? String(req.body.adjuster_raw_text || '')
      : undefined;

    const existing = await dbGet(
      `SELECT id FROM estimate_metadata WHERE ro_id = $1 AND shop_id = $2`,
      [roId, req.user.shop_id]
    );

    let metadata;
    if (existing) {
      metadata = await dbGet(
        `UPDATE estimate_metadata
         SET adjuster_totals = COALESCE($1, adjuster_totals),
             adjuster_raw_text = COALESCE($2, adjuster_raw_text),
             updated_at = NOW()
         WHERE ro_id = $3 AND shop_id = $4
         RETURNING id, ro_id, shop_id, adjuster_totals, adjuster_raw_text, created_at, updated_at`,
        [adjusterTotals !== undefined ? JSON.stringify(adjusterTotals) : null,
         adjusterRawText !== undefined ? adjusterRawText : null,
         roId, req.user.shop_id]
      );
    } else {
      metadata = await dbGet(
        `INSERT INTO estimate_metadata (id, ro_id, shop_id, adjuster_totals, adjuster_raw_text, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id, ro_id, shop_id, adjuster_totals, adjuster_raw_text, created_at, updated_at`,
        [uuidv4(), roId, req.user.shop_id,
         adjusterTotals !== undefined ? JSON.stringify(adjusterTotals) : null,
         adjusterRawText !== undefined ? adjusterRawText : null]
      );
    }

    return res.json({ success: true, metadata });
  } catch (err) {
    console.error('[Estimate Metadata] POST error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
