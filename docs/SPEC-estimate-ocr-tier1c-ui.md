# REVV Estimate Import — Tier 1c: Surface per-RO Revenue + Rates in the Wizard UI

> The last mile of the OCR estimate work. Tier 1 (extraction) is SHIPPED to prod (origin/main @ a655348): parseEstimateTotalsFromPdfText now reliably extracts the CCC totals block including revenue, labor rate, paint rate, and category costs. BUT the wizard does not yet SHOW them. This task makes the extracted money VISIBLE to the front desk. Extraction is correct; this is display-only.

## Goal
When Miles uploads an estimate PDF and the wizard opens, show a clear financial summary so the front desk immediately sees what the job brings into the shop — without retyping or hunting.

## Current state (verified by QA on a655348)
- `parsed.estimate_totals` already returns: parts, body_labor_{hours,rate,cost}, paint_labor_{hours,rate,cost}, mechanical_labor_{hours,rate,cost}, paint_supplies_{hours,rate,cost}, miscellaneous, other_charges, subtotal, sales_tax_{basis,rate,cost}, total_cost_of_repairs, net_cost_of_repairs, and revenue (= net_cost_of_repairs, fallback total_cost_of_repairs).
- `frontend/src/components/EstimateImportWizard.jsx` currently reads ONLY `parsed?.estimate_totals?.deductible` (line ~46). The rich values are received but not displayed.
- A real reference estimate parses to: revenue $7,770.11; body 48.2h @ $50; paint 20.5h @ $50; mechanical 2.2h @ $50; paint_supplies 20.5h @ $30; parts $2,976.73; subtotal $7,136.73; tax $633.38.

## Build (frontend only)
1. In EstimateImportWizard.jsx, add a compact, read-only "Job Financials" summary card shown when `parsed.estimate_totals` is present:
   - Headline: the revenue ("This job brings in $7,770.11") using `estimate_totals.revenue`.
   - Breakdown rows (only render rows whose value is non-null): Body Labor (hours x rate = cost), Paint Labor, Mechanical Labor, Paint Supplies, Parts, Subtotal, Sales Tax, Net.
   - Show the rate explicitly (e.g. "48.2 hrs @ $50.00/hr = $2,410.00") so the labor/paint RATES are visible, since that is what Bryan asked for.
2. Format currency consistently (existing helper if present, else a small `formatUSD`). Gracefully omit any missing field; never render `null`/`NaN`.
3. Do NOT change the import/create flow or the parsed contract; this is presentational. Keep the existing wizard behavior (line items, confirm/create) intact.

## DoD
- cd frontend && npm run test:run green; npm run build green; rm -rf dist && git diff --check clean; git ls-files frontend/dist empty.
- Add/extend a component test asserting the financials card renders revenue + at least the labor/paint rate rows from a mocked `parsed.estimate_totals`, and renders nothing when estimate_totals is absent.
- Independent Claude Code QA (opus-4-8) PASS, 0 CRITICAL / 0 HIGH.
- Manual proof: with the shipped Tier 1 extraction, a real CCC estimate upload shows the revenue headline + labor/paint rates in the wizard (capture redacted screenshot/DOM in dispatch).

## Pipeline
Codex build (frontend only, <=6 files) -> codex-commit-guard -> Claude Code QA -> Hermes review -> ship to origin/main (note: use `git push origin <branch>:main` FF if the main worktree is locked) + Railway auto-deploy. Log to DAILY-OPS.

## Out of scope
Tier 2 line-item per-operation extraction; Mitchell/Audatex formats; any backend/extraction change (already shipped).
