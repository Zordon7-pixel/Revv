# SPEC — Estimate → True Shop Profit (Lane B)

**Owner:** Bryan · **Created:** 2026-06-03 · **App:** REVV (revvshop.app)
**Decision:** Lane B (TRUE margin, not gross proxy). Approved by Bryan 2026-06-03.

## Problem
Today `profit.js` assumes shop profit = **labor only** and **0% margin on parts/sublet**:
`trueProfit = (labor+parts+sublet) − (parts+sublet) − nyAdj = labor − nyAdj`.
That understates reality — shops make 20–40% on parts, high margin on paint/materials, and
labor "profit" ≠ 100% of billed labor (tech wages are a cost). We want: upload/enter an estimate →
see what the shop is **actually** making.

## What already exists (extend, do NOT rebuild)
- `backend/src/services/profit.js` — `calculateProfit(ro)` → {gross, cogs, trueProfit, margin}.
- `estimate_line_items` table (type: parts|labor|…, quantity, unit_price) — aggregated in `ros.js`.
- `ros.js` recompute path (~L395–446) → stores `parts_cost`, `labor_cost`, `estimate_amount`, `true_profit`.
- `estimateLineItems.js` — manual line-item CRUD (INSERT path L299).
- `estimateAssistant.js` `scan-photo` — AI **damage-photo** scan; returns rough labor-hrs/parts; does NOT persist line items or feed profit.
- `RODetail.jsx` (~L1649–1706) — shows `true_profit` (emerald, admin-only, inline-editable).
- Profit display is already **admin/owner-gated**. Keep it that way — never expose to techs/customers.

## TRUE-PROFIT MODEL (the math Bryan flagged)
Per-category, owner-tunable in a **Shop Cost Profile**:
- **Labor:** `labor_cost = labor_hours × blended_labor_cost_per_hr`; `labor_profit = billed_labor − labor_cost`.
- **Parts:** `parts_profit = billed_parts × parts_margin_pct` (gross margin on parts; default 0.25).
- **Paint/Materials:** `materials_profit = billed_materials × materials_margin_pct` (default 0.45); paint LABOR treated as labor.
- **Sublet:** `sublet_profit = billed_sublet × sublet_margin_pct` (default 0.05).
- `true_profit = labor_profit + parts_profit + materials_profit + sublet_profit − ny_adjustments`.
- `margin = true_profit / gross`.
- **Backward-compatible:** if a shop has NO cost profile, fall back to today's formula (no silent number change).

---

## Phases

### Phase 1 — Shop Cost Profile (foundation)
- **WHAT:** New per-shop cost settings: `parts_margin_pct`, `blended_labor_cost_per_hr`, `materials_margin_pct`, `sublet_margin_pct`. Migration + owner-only settings UI.
- **WHY:** True margin is impossible without the shop's cost assumptions. Nothing else in Lane B works first.
- **HOW:** Add `shop_cost_profile` columns (or table keyed by shop_id) w/ sane defaults (0.25 / wage / 0.45 / 0.05). Settings page section (owner-gated) to view/edit. Validate ranges (0–1 for pcts, >0 for wage).
- **GATE:** Owner can set + persist all four values; non-owners cannot see/edit; defaults applied to existing shops via migration.

### Phase 2 — True-Margin Engine + RO Profit Breakdown
- **WHAT:** Rewrite `calculateProfit` to use the model above; add a profit **breakdown** (labor/parts/materials/sublet contributions) to the RO payload. RO page shows a profit breakdown card (owner-only).
- **WHY:** Turns existing (manually-entered) line items into a real, trusted profit number immediately — value before the parser exists.
- **HOW:** Extend `profit.js` (keep `calculateProfit` signature; add `calculateTrueProfit(ro, costProfile)`); classify line items into labor/parts/materials/sublet; backward-compat fallback when no profile. Surface breakdown in `RODetail` profit section.
- **GATE:** Existing RO with manual line items shows correct per-category breakdown + true profit; no-profile shop shows unchanged legacy number; unit tests on the math.

### Phase 3 — Estimate Upload → Extract → Confirm → Profit
- **WHAT:** Real "Upload Estimate" flow (PDF or photo of CCC/Mitchell/Audatex) → AI/OCR extracts line items (desc, type, qty, unit_price) → **owner confirms/edits** in a review table → writes `estimate_line_items` → triggers profit recompute.
- **WHY:** Removes manual entry — the actual ask ("when we upload an estimate…").
- **HOW:** Extend `estimateAssistant.js` (reuse multer + AI-extract helper); new endpoint `POST /ros/:id/estimate/extract` returns parsed lines (NOT auto-saved); owner confirms → reuse `estimateLineItems` INSERT. NEVER trust raw OCR straight to profit — confirm step is mandatory.
- **GATE:** Upload a sample estimate → lines extracted → owner edits/confirms → line items saved → RO true profit updates live. Bad/garbled file → graceful error, no partial writes.

### Phase 4 — Backlog / refinement (post-trial, not blocking)
- OEM vs aftermarket parts markup tiers; insurer-specific overrides; materials hours×rate precision; "profit at-a-glance" on the estimate upload confirmation screen.

---

## Pipeline (every phase)
Hermes pre-flight (this spec) → Codex build (≤10 files/session) → Claude Code QA (incl. execution smoke-test) → Hermes review verdict+diff → ship to Railway → post-deploy live-verify (Bryan dogfoods on revvshop.app). Ship gate: 0 CRITICAL + 0 unresolved HIGH; MEDIUM/LOW → backlog.

## Risks / what to AVOID
- Don't build a 2nd profit engine — extend `profit.js`.
- Don't silently change existing shops' profit numbers — fallback when no cost profile.
- Don't trust OCR straight to the books — owner confirm step is mandatory.
- Keep ALL profit data owner-only (existing gate).
