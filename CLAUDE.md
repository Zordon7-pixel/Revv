# CLAUDE.md — Revv Project Intelligence

> **Read by: CW3 Codex (before building) AND Claude Code (before QA review)**
> Updated after every build. If you're building or reviewing, read this first.

---

## Dispatch Guard — Prevent Duplicate Jobs

Before starting any new task:

1. Check the newest "Dispatch Log" entry in this file.
2. If a task is marked **DONE + VERIFIED**, do not redispatch it unless there is a new repro with timestamp/evidence.
3. If a task is only partial, mark it **IN PROGRESS** with next action.
4. After finishing work, append/update the log with:
   - date/time (ET + UTC),
   - scope,
   - files touched,
   - verification method,
   - status.

---

## What This App Is

Revv is an **auto body shop management platform** — NOT a general mechanic app.
- Web frontend (React + Vite) + REST backend (Node.js/Express) + PostgreSQL on Railway
- Single Railway deployment: frontend builds to `frontend/dist`, served as static files by backend
- GitHub: `Zordon7-pixel/Revv` | Deploy: `git push origin main` → Railway auto-builds

---

## Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | React + Vite | `frontend/src/` |
| Backend | Node.js + Express | `backend/src/` |
| Database | PostgreSQL (Railway) | `dbGet`, `dbAll`, `dbRun` from `../db` |
| Auth | JWT (30-day tokens) | `req.user.shop_id` scopes ALL DB queries |
| SMS | Twilio | API Key + Secret auth (not just Auth Token) |
| Deploy | Railway | `railway.toml` at root |

---

## Auth Model — Critical

Every route that touches data **must** scope to `req.user.shop_id`. No exceptions.

```js
// CORRECT — ownership enforced in the query
await dbRun('DELETE FROM ros WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]);

// WRONG — auth bypass: checks ownership in SELECT but not in DELETE
const ro = await dbGet('SELECT * FROM ros WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]);
await dbRun('DELETE FROM ros WHERE id = $1', [id]); // ← SECURITY BUG
```

## Dispatch Log — 2026-07-10 Estimate Upload Reuse + Zero-Line OCR Recovery

**Status:** READY FOR CLAUDE CODE QA — NOT DEPLOYED

**Reported behavior**
- Insurance Import showed `Review this CCC estimate before import` but returned 0 selectable rows.
- Supplement Finder returned `No line items were extracted` for the same estimate.
- Appraisal Quick Intake created the RO and attached the source pages, but its parsed estimate data was not carried into Insurance Import or Supplement Finder, forcing a duplicate upload.

**Root cause**
- `backend/src/routes/insuranceOcr.js` returned the strict CCC/Mitchell parser result immediately whenever a known format was detected, including when that parser produced zero detailed rows. That bypassed the existing relaxed AI retry and totals-derived fallback.
- Appraisal Quick Intake intentionally used `mode=intake`, which discarded estimate rows and totals after filling the New RO fields.
- Existing attached appraisal pages had no reuse path into the two estimate tools.

**Behavior shipped for QA**
- Known-format estimates with real detailed rows keep the deterministic fast path.
- A known-format zero-row result now continues through the full-text relaxed retry, rendered-page visual retry, then a reviewable parts/labor/paint/other category fallback derived from insurer totals. A valid totals page no longer ends at an unselectable 0-item result.
- Appraisal Quick Intake parses the uploaded pages once, still fills editable customer/vehicle/claim fields, attaches every source page to the RO, and stages a bounded `import_draft` for explicit review.
- Insurance Import automatically opens that staged draft with all rows selected. Importing the rows clears the draft. Insurer money is never silently posted before the user chooses Import.
- Supplement Finder analyzes the staged draft without another upload.
- Existing ROs whose Claim Tracker contains `Appraisal quick intake source` evidence offer `Use Attached Appraisal`, reusing the shop-scoped attached files in Insurance Import and Supplement Finder.
- `estimate_metadata.import_draft` is additive JSONB, persisted through the existing RO-and-shop-scoped metadata endpoints.

**Files changed**
- `backend/src/routes/insuranceOcr.js`
- `backend/src/routes/estimateLineItems.js`
- `backend/src/db/migrate.js`
- `backend/src/__tests__/insuranceOcr.review.test.js`
- `backend/src/__tests__/estimateMetadataDraft.test.js`
- `frontend/src/components/AppraisalQuickIntake.jsx`
- `frontend/src/components/AddROModal.jsx`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/components/SupplementFinderPanel.jsx`
- `frontend/src/lib/attachedAppraisal.js`
- `frontend/src/lib/estimateReview.js`
- `frontend/src/components/__tests__/AppraisalQuickIntake.test.jsx`
- `frontend/src/components/__tests__/AddROModal.appraisal.test.jsx`
- `frontend/src/components/__tests__/InsurancePanel.phase31.test.jsx`
- `frontend/src/components/__tests__/SupplementFinderPanel.draft.test.jsx`
- `CLAUDE.md`

**Verification**
```text
node --check backend/src/routes/insuranceOcr.js backend/src/routes/estimateLineItems.js backend/src/db/migrate.js
  -> passed
node --test backend/src/__tests__/*.test.js <Node backend/test suites>
  -> 123/123 passed
cd backend && npm run test:run
  -> 3 files, 7/7 extractor tests passed
cd frontend && npm run test:run
  -> 28 files, 77/77 tests passed
cd frontend && npm run build
  -> built cleanly in 2.02s
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist
  -> clean; dist untracked
Rendered-app smoke at 1180x820 with synthetic shop/RO responses only
  -> staged notice visible
  -> parts and body-labor rows visible
  -> Import 2 items enabled
  -> Supplement Finder analyzed the staged draft without upload
  -> estimate content remained clear of the sidebar
  -> no page-level horizontal overflow
  -> screenshot: /tmp/revv-staged-estimate-review.png
```

**Data safety**
- No hosted database/backend was opened.
- No production API, AI provider, customer, shop, RO, estimate, or Miles Automotive data was read or mutated.
- Tests and the rendered-app smoke used mocks/synthetic data only.

## Dispatch Log — 2026-07-10 Multi-Photo Intake

**Status:** DEPLOYED + HEALTH VERIFIED — PHYSICAL IPAD PICKER SPOT CHECK PENDING

**Requested behavior**
- Pre-Dropoff Condition and every other existing photo/evidence upload surface must allow staff to select more than one file at a time.
- A failed file must not discard successful files from the same selection.

**Behavior implemented**
- `RODetail.jsx` Pre-Dropoff Condition now accepts multiple images, optimizes and uploads them sequentially, shows `Uploading N of M`, refreshes the gallery once after the batch, and reports partial failures inline.
- `ROPhotos.jsx` now uses the same batch path for both file-picker selections and drag/drop. Each image keeps the chosen photo type and shared caption; damage analysis remains per image.
- `ClaimTrackerPanel.jsx` Claim Documentation now accepts multiple photos, videos, and PDFs, uploads each through the existing evidence endpoint, shows the selected-file count and upload progress, then reloads evidence once.
- Existing backend endpoints remain single-file and shop-scoped; the frontend intentionally sends one request per file to preserve current authorization, storage, AI analysis, and per-file failure isolation.
- Existing multi-file controls were audited and left intact: Appraisal Quick Intake, Estimate Builder, Insurance Estimate Import, Supplement Finder, Estimate Import Wizard, and Public Estimate Request damage photos.
- Intentionally singular controls remain singular: shop-logo replacement and the Claim Portal assessment PDF.
- No backend, schema, database, seed/reset path, customer/shop/RO/photo record, or Miles Automotive data was accessed or changed.

**Files changed**
- `frontend/src/pages/RODetail.jsx`
- `frontend/src/components/ROPhotos.jsx`
- `frontend/src/components/ClaimTrackerPanel.jsx`
- `frontend/src/pages/__tests__/RODetail.totalLoss.test.jsx`
- `frontend/src/components/__tests__/ROPhotos.phase31.test.jsx`
- `frontend/src/components/__tests__/ClaimTrackerPanel.phase32.test.jsx`

**Verification — local mocked only**
```text
Focused multi-file tests
# 3 files, 14/14 passed

cd frontend && npm run test:run
# 27 files, 73/73 passed

cd frontend && npm run build
# clean production build

node --test backend/src/__tests__/photos.scope.test.js
# 3/3 passed; shop-scoped photo reads preserved

rm -rf frontend/dist
git diff --check
git ls-files frontend/dist
# clean; dist untracked
```

**QA requirements**
- Read-only review must verify all three inputs carry `multiple`, selected files are uploaded sequentially, gallery/evidence reload happens once per successful batch, and a later failure does not erase an earlier successful upload.
- Confirm estimate/appraisal multi-file workflows remain unchanged and the intentionally singular logo/PDF controls were not broadened.
- Do not access a hosted database or mutate Miles Automotive data.

**Claude Code read-only QA — PASS (`f9ce285`)**
- Final verdict: `QA PASS — CLEAR FOR HERMES`; zero CRITICAL, HIGH, or MEDIUM findings.
- Independently confirmed all three multi-file inputs, unchanged endpoint/FormData contracts, sequential requests, one post-batch reload, progress/disabled states, shared drag/drop path, and accessible partial-failure reporting.
- Confirmed the new tests are behavioral: two requests per two selected files, one gallery reload after initial load, and a forced second-file failure that preserves the first upload.
- Re-ran frontend 27 files / 73 tests, production build, photo tenant-scope 3/3, diff guard, and untracked-dist guard.
- Confirmed no backend/schema/data file changed and the pre-existing untracked `SPEC-revv-redesign.md` remains untouched.
- Physical iPad/Safari was unavailable. Native picker behavior and progress visibility remain an honest post-deploy physical-device spot check, not a claimed visual pass.

**Deployment verification — 2026-07-10**
- Hermes fast-forwarded exactly `f9ce285` + `f7bdb3c` from live base `acc1452` to `origin/main`; no force push, rebase, or unrelated commit.
- `https://revvshop.app/api/health` and the Railway production health endpoint both returned HTTP 200 on exact commit `f7bdb3c91bddbe3cea0e9f8233f982e34951b11b`.
- `./scripts/smoke-test.sh` returned 6/6 PASS plus the documented local `RESEND_API_KEY` warning; SPF passed.
- `frontend/dist` remains untracked, and the only worktree entry is the pre-existing untracked `SPEC-revv-redesign.md`, which remains untouched.
- Required physical validation: on iPad/Safari, select at least two files in Pre-Dropoff Condition, RO Photos, and Claim Documentation; verify all selected files appear after upload and progress remains visible.

## Dispatch Log — 2026-07-10 Landscape Overlay + Complete Estimate Import

**Status:** CLAUDE CODE QA PASS — CLEAR FOR HERMES — NOT DEPLOYED; LIVE LANDSCAPE VISUAL PENDING

**Bugs addressed**
- Landscape tablet dialogs could still sit behind the desktop sidebar. The earlier estimate fix only raised a descendant from `z-50` to `z-100`; the dialog remained trapped inside the main page's `z-10` stacking context.
- Insurance estimate selection shortcuts were not protected by interaction tests and were difficult to use on a touch tablet.
- The Insurance tab imported detail rows without persisting/syncing the extracted financial snapshot, so parts, labor, paint/refinish, materials, tax, deductible, gross/net totals, and RO profit inputs could diverge.

**Behavior shipped for QA**
- Migrated authenticated modal, drawer, picker, payment, help, customer, schedule, timeclock, storage, settings, user, diagnostic, onboarding estimate, and RO parts-search surfaces to the shared `AppOverlay`. `AppOverlay` portals to `document.body` at `z-[150]`, above the desktop sidebar's `z-[70]`, and centers dialogs against the full visible viewport.
- Left the full-page Add RO route and public tracking portal out of the authenticated-overlay rule because neither is rendered under the desktop sidebar.
- Rebuilt Insurance Estimate Import as a bounded, scrollable `AppOverlay` with 44px touch targets and working `Select Parts Only`, `Select All`, and `Clear` controls.
- Added a complete collision-estimate financial review: parts; body, paint/refinish, mechanical, frame, and glass labor; paint materials; sublet; miscellaneous/other charges; pre-tax subtotal; tax; gross; deductible; and net.
- Clarified that insurer totals are allowed revenue and that true profit is calculated only after actual shop costs are recorded.
- Both Estimate Builder and the RO Insurance tab now persist `adjuster_totals` and call the existing guarded `/estimate-items/:roId/import-financials` sync after detail-line import. A reconciliation failure keeps imported lines and reports that financial totals need review instead of silently dropping them.
- Added an architecture regression test that rejects page-local `fixed inset-0` overlays on authenticated surfaces, plus behavioral tests for all three selection shortcuts, financial buckets, portal placement, and financial sync.
- No backend code, schema, database, seed/reset path, customer record, shop record, RO record, or Miles Automotive data was touched.

**Files changed**
- Shared UI: `frontend/src/components/AppOverlay.jsx` consumers, `EstimateSelectionToolbar.jsx`, `EstimateFinancialReview.jsx`
- Estimate flow: `frontend/src/pages/EstimateBuilder.jsx`, `frontend/src/components/InsurancePanel.jsx`, `frontend/src/components/EstimateImportWizard.jsx`
- Authenticated overlays: `Layout.jsx`, `HelpPanel.jsx`, `HelpDesk.jsx`, `FeedbackButton.jsx`, `PartsSearch.jsx`, `PaymentModal.jsx`, `CarryoverModal.jsx`, `Customers.jsx`, `Schedule.jsx`, `Settings.jsx`, `StorageHold.jsx`, `TimeClock.jsx`, `Users.jsx`, `VehicleDiagnostics.jsx`
- Tests: `AppOverlay.architecture.test.jsx`, `EstimateSelectionToolbar.test.jsx`, `EstimateFinancialReview.test.jsx`, `EstimateBuilder.phase31.test.jsx`, `InsurancePanel.phase31.test.jsx`, `EstimateImportWizard.test.jsx`

**Verification**
```text
cd frontend && npm run test:run
# 27 files, 69/69 tests passed

cd frontend && npm run build
# clean production build

node --test backend/src/__tests__/*.test.js <Node backend/test files>
# 119/119 passed

cd backend && npm run test:run
# 3 files, 7/7 extractor tests passed

rm -rf frontend/dist
git diff --check
git ls-files frontend/dist
# clean; dist untracked
```

**Required QA visual gate**
- At iPad landscape dimensions with the desktop sidebar expanded, open every authenticated dialog/picker and confirm the overlay is centered or intentionally right-docked, fully above the dimmed sidebar, and internally scrollable.
- In Estimate Builder, import a mocked mixed estimate and physically click `Clear` -> `Select Parts Only` -> `Select All`; verify selected counts `0` -> parts count -> all count.
- Confirm the financial review remains legible in landscape and includes all collision-estimate buckets listed above.

**Claude Code read-only QA — PASS (`1945072`)**
- Zero CRITICAL, HIGH, or MEDIUM findings. Final verdict: `QA PASS — CLEAR FOR HERMES`.
- Re-ran frontend 27 files / 69 tests, backend Node 119/119, backend extractor Vitest 7/7, production frontend build, diff check, and untracked-dist guard.
- Confirmed all 15 migrated authenticated surfaces use the body-level `AppOverlay`; the only `fixed inset-0` exceptions are the public Track Portal, dedicated full-page Add RO route, shared AppOverlay itself, and Layout's mobile sidebar.
- Confirmed the selection tests exercise real state transitions and all financial buckets plus the `$9,969.25` gross / `$8,969.25` net fixture.
- Confirmed Estimate Builder and Insurance Panel persist `adjuster_totals` before guarded financial sync and preserve imported lines when reconciliation requires review.
- Confirmed no hosted DB, production customer/shop/RO record, or Miles Automotive data was accessed; `SPEC-revv-redesign.md` remains untracked and untouched.
- Browser extension was unavailable to Claude, so it explicitly left the live iPad landscape screenshot gate pending instead of claiming a visual pass. Hermes must not close the issue without that evidence.

**Deployment verification — 2026-07-10**
- Hermes fast-forwarded only `1945072` + `37989fe` to `origin/main`; no force push or history rewrite.
- Both `https://revvshop.app/api/health` and the Railway health endpoint returned HTTP 200 on exact commit `37989fe9e65aa5bea0a4c085d985aedaa78067ec`.
- `./scripts/smoke-test.sh` returned 6 PASS + the documented local `RESEND_API_KEY` warning.
- Tracked worktree remained clean; `frontend/dist` remained untracked; `SPEC-revv-redesign.md` remained untracked and untouched.
- Hermes' visual/browser step did not return and produced no screenshot. The process was stopped after deployment and health were independently confirmed. Live physical iPad landscape validation therefore remains open and must not be represented as complete.

## Dispatch Log — 2026-07-10 Photo Delete + Above-Sidebar Overlay Audit

**Status:** CLAUDE CODE QA PASS — CLEAR FOR HERMES — NOT DEPLOYED

**Reported behavior:** Uploaded photos could not always be deleted, and full-size photo previews rendered behind the desktop/tablet sidebar because they used `z-50` inside the main-content stacking context while the sidebar uses `z-70`. The image also opened too large by default.

**Behavior shipped**
- Added a shared body-level `AppOverlay` portal so dialogs render outside the main-content stacking context and above the complete app shell.
- Added a shared `PhotoLightbox` with `z-200`, Escape/backdrop close, body scroll lock, bounded default image sizing (`76vw` by `64dvh` maximum), and 75%–200% zoom controls.
- Migrated all internal RO photo surfaces to the shared viewer: Pre-Dropoff Condition, Technician Photos, and Claim Tracker photo evidence. Inspection photo links open a separate page/tab and the public tracking portal has no internal sidebar.
- Added touch-visible delete buttons to Pre-Dropoff and Technician photo thumbnails, plus delete actions inside every internal full-size photo viewer. Existing shop-scoped backend delete routes are reused.
- Migrated the remaining RO Detail dialogs (Communication Log, Mark Paid, Total Loss, and Storage Billing) to `AppOverlay` after the tab audit found the same unsafe local `z-50` pattern.
- Did not change database schema, upload storage, API authorization, seed/reset behavior, or production data. Miles Automotive data was not read or modified.

**Files changed**
- `frontend/src/components/AppOverlay.jsx`
- `frontend/src/components/PhotoLightbox.jsx`
- `frontend/src/components/ROPhotos.jsx`
- `frontend/src/components/ClaimTrackerPanel.jsx`
- `frontend/src/pages/RODetail.jsx`
- `frontend/src/components/__tests__/ROPhotos.phase31.test.jsx`
- `frontend/src/components/__tests__/ClaimTrackerPanel.phase32.test.jsx`
- `frontend/src/pages/__tests__/RODetail.totalLoss.test.jsx`

**Verification**
- Focused photo/RO Detail tests — 3 files / 10 tests PASS.
- Full frontend suite — 24 files / 62 tests PASS.
- `node --check backend/src/routes/photos.js` — PASS.
- Backend photo scope tests — 3/3 PASS.
- `cd frontend && npm run build` — PASS (existing bundle-size warning only).
- `git diff --check` — PASS; `frontend/dist` remains untracked.
- Regression tests assert each internal photo viewer is portaled directly under `document.body`, uses `z-200` above the sidebar, defaults to bounded dimensions, supports zoom, and calls the correct delete endpoint. The Total Loss dialog test also asserts RO Detail dialogs use the body-level `z-150` overlay.

**Claude Code read-only QA — PASS (`98a3097`)**
- Zero CRITICAL, HIGH, or MEDIUM findings.
- Confirmed Pre-Dropoff, Technician Photos, and Claim Tracker photo evidence all use the body-level viewer, preserve broken-media fallbacks, close stale viewer state after delete, and use the correct existing shop-scoped delete endpoints.
- Confirmed the viewer defaults to bounded dimensions, zooms only after explicit controls, restores body scrolling, supports Escape/backdrop/close, and cannot sit behind the sidebar.
- Confirmed Communication Log, Mark Paid, Total Loss, and Storage Billing now use `AppOverlay` without changing submit/cancel business logic.
- Re-ran focused tests 10/10, frontend 62/62, backend photo scope 3/3, frontend build, diff check, and untracked-dist guard.
- Non-blocking product note accepted: non-assistant technicians/employees can now delete RO photos, matching the existing authenticated/shop-scoped backend permission and the request that uploaders be able to delete photos.
- Remaining post-deploy check: physical iPad/tablet landscape confirmation. No hosted database or Miles Automotive data was accessed during QA.

**Hermes Deployment Verification — 2026-07-10 (Photo Delete + Above-Sidebar Overlay Audit)**
- Confirmed only QA-passed commits `98a3097` (fix) + `a24bb9c` (QA record) were shipped; tracked worktree clean, untracked `SPEC-revv-redesign.md` left untouched (not added/edited/committed).
- Fast-forward push `e2e085d..a24bb9c` to `origin/main` (no force, no history rewrite). Diff range = 9 files, frontend photo/overlay code + this CLAUDE.md only.
- Railway auto-deployed; both hosts live on `a24bb9c`:
  - `https://revvshop.app/api/health` → HTTP 200, commit `a24bb9c0ad8f86450b0c9a5f1cfc47f110498eb6`
  - `https://revv-production-ffa9.up.railway.app/api/health` → HTTP 200, commit `a24bb9c0ad8f86450b0c9a5f1cfc47f110498eb6`
- `./scripts/smoke-test.sh` → 6 PASS + SPF PASS + 1 documented `RESEND_API_KEY` local-env WARN.
- Visual production probe: relied on Claude QA DOM assertions (body-level portal, `z-200` above sidebar `z-70`, bounded default sizing, zoom controls render, delete propagation) rather than driving a browser session against live production photos; no production data was read, uploaded, deleted, or mutated. Physical iPad/tablet landscape confirmation remains for Bryan.
- No seed/reset/migration ran; no Miles Automotive or other real customer data was accessed.
- Production is ready for Bryan to validate the above-sidebar photo viewer on a physical tablet.

## Dispatch Log — 2026-07-10 CCC/Mitchell Reviewable Estimate Import

**Status:** DEPLOYED + VERIFIED — live on `8c1801e` (both hosts HTTP 200; synthetic flagged CCC probe returns reviewable 200)

**Reported behavior:** A recognized CCC insurance estimate returned `CCC estimate needs review before import` as a fatal error, preventing the shop from reaching the existing review/import UI.

**Behavior shipped**
- Recognized CCC and Mitchell documents now return HTTP 200 with `success: true`, the parsed estimate, `needs_review`, and preserved `review_reasons`. Parser uncertainty remains visible but is no longer misreported as an upload failure.
- Added one shared, shop-facing review warning that translates parser reason codes into clear instructions without exposing internal reason strings.
- Added the warning to Estimate Builder, the RO Insurance panel, and the Estimate Import Wizard. Each flow keeps its explicit Import/Create action; flagged line items or a new RO are not created merely by parsing the file.
- Preserved deterministic parser reconciliation and low-confidence checks. No extractor thresholds, financial calculations, database schema, production data, seed, reset, or migration behavior changed.
- Miles Automotive data was not read or modified. Verification used mocked files, mocked API responses, source-level route checks, and local builds only.

**Files changed**
- `backend/src/routes/insuranceOcr.js`
- `backend/src/__tests__/insuranceOcr.review.test.js`
- `frontend/src/components/EstimateReviewWarning.jsx`
- `frontend/src/lib/estimateReview.js`
- `frontend/src/lib/__tests__/estimateReview.test.js`
- `frontend/src/pages/EstimateBuilder.jsx`
- `frontend/src/pages/__tests__/EstimateBuilder.phase31.test.jsx`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/components/__tests__/InsurancePanel.phase31.test.jsx`
- `frontend/src/components/EstimateImportWizard.jsx`
- `frontend/src/components/__tests__/EstimateImportWizard.test.jsx`

**Verification**
- `node --check backend/src/routes/insuranceOcr.js` — PASS
- Backend Node test files (excluding the three Vitest parser specs) — 119/119 PASS
- `cd backend && npm run test:run` — 3 files / 7 tests PASS
- `cd frontend && npm run test:run` — 24 files / 58 tests PASS
- `cd frontend && npm run build` — PASS
- `git diff --check` — PASS
- Regression coverage confirms flagged CCC parses open review on all three frontend surfaces and make no estimate-item or RO creation request before the explicit action.

**Claude Code read-only QA — PASS (`6267a74`)**
- Zero CRITICAL, HIGH, or MEDIUM findings.
- Confirmed both deterministic formats return reviewable success payloads and the old 409/error strings are absent.
- Confirmed top-level-only `detected_format` is merged by all three clients, unknown review reasons remain visible in human-readable copy, and flagged parse requests do not create estimate items or an RO.
- Re-ran backend Node tests 119/119, parser tests 7/7, frontend tests 58/58, frontend build, diff check, and untracked-dist guard.
- Remaining post-deploy check: use a synthetic flagged CCC/Mitchell estimate to confirm production returns HTTP 200 and opens the review UI. No hosted database or Miles Automotive data was accessed during QA.

**Hermes Deployment Verification — 2026-07-10 (CCC/Mitchell Reviewable Estimate Import)**
- Pushed linear HEAD `8c1801e` to `origin/main` (fast-forward `78c1774..8c1801e`, no force, no history rewrite). Batch: fix commit `6267a74` + QA-record docs `8c1801e`.
- Railway auto-deployed; both hosts live on `8c1801e`:
  - `https://revvshop.app/api/health` → HTTP 200, commit `8c1801e057df235601230f29f5b7ee4e725c57ac`
  - `https://revv-production-ffa9.up.railway.app/api/health` → HTTP 200, commit `8c1801e057df235601230f29f5b7ee4e725c57ac`
- `./scripts/smoke-test.sh` → 6 PASS + 1 documented `RESEND_API_KEY` local-env WARN.
- Post-deploy flagged-estimate probe (safe synthetic, non-Miles): generated a synthetic CCC PDF from `backend/test/fixtures/ccc-estimate-low-confidence.txt` (synthetic customer, claim `SYN-CCC-BAD`) and POSTed it to `/api/insurance-ocr/parse` under the `demo@revvauto.com` demo shop. Live production returned HTTP 200 with `success:true`, `needs_review:true`, `detected_format:"ccc"`, and preserved `review_reasons` `["low_confidence_line_1","low_confidence_line_2","total_cost_does_not_reconcile","ccc_line_items_missing"]`. `line_items` empty and the parse-only endpoint created no estimate item or RO. Confirms the former fatal `409 needs review` path now returns a reviewable success payload in production.
- No RO/line-item creation was requested; no seed/reset/migration ran; no hosted database rows or Miles Automotive data were read or mutated. Probe used the deterministic CCC extractor path (no AI provider call) and a synthetic upload only.
- Production is ready for Bryan to validate the CCC/Mitchell estimate review flow in the UI.

## Dispatch Log — 2026-07-10 Appraisal Quick Intake + Estimate Gap Review

**Status:** BUILD READY FOR CLAUDE CODE QA — NOT DEPLOYED

**Build commits:** `2b70648` (Appraisal Quick Intake) + `00a5a6b` (Estimate Gap Review)

**Behavior shipped**
- Added `Appraisal Quick Intake` as a dedicated New RO entry method. It accepts up to 12 PDF/image pages, extracts intake metadata only, and never imports estimate line items or financial totals.
- Extracted customer, vehicle, insurer, claim, policy, adjuster, mileage, and deductible fields remain editable before they are applied to the existing three-step New RO workflow.
- Intake matching reuses a unique customer phone/email match and a unique VIN or year/make/model vehicle match. Exact duplicate claim numbers produce a warning before another RO is created.
- Notification consent is never inferred from appraisal paperwork. New extracted customers start with SMS/email consent disabled; previously recorded consent is retained only when an existing customer is matched.
- Appraisal source pages are attached after RO creation in Claim Tracker. Claim evidence now supports PDF documents and renders them as document links rather than broken image thumbnails. Failed attachments do not invite a duplicate RO submission; the created RO enters an explicit retry/open state.
- Removed the contextless `AI Estimate Suggestions` and damage-photo AI controls from New RO. New RO now captures damage type/panels only.
- Added a shop-scoped `Estimate Gap Review` in Estimate Builder. It runs only after estimate lines and damaged panels/evidence exist, filters operations already represented in the estimate, explains sources/reason/confidence, and can add only a zero-dollar non-taxable draft for human review.
- Expanded RO search to include exact claim fields for intake duplicate detection and persisted policy number on normal RO creation.
- No seed, reset, destructive migration, or hosted database action was run. Miles Automotive data was not read or modified; all visual/browser flows used mocked shop records.

**Primary files**
- `backend/src/routes/insuranceOcr.js`
- `backend/src/routes/estimateAssistant.js`
- `backend/src/routes/claimTracker.js`
- `backend/src/routes/ros.js`
- `frontend/src/components/AppraisalQuickIntake.jsx`
- `frontend/src/components/AddROModal.jsx`
- `frontend/src/components/ClaimTrackerPanel.jsx`
- `frontend/src/pages/EstimateBuilder.jsx`
- `frontend/src/lib/appraisalIntake.js`
- Regression tests under `backend/src/__tests__`, `frontend/src/components/__tests__`, `frontend/src/pages/__tests__`, and `frontend/src/lib/__tests__`

**Verification**
```text
node --check backend/src/routes/{insuranceOcr,claimTracker,estimateAssistant,ros}.js  # PASS
node --test backend/src/__tests__/*.test.js                                        # 98/98 PASS
cd backend && npm run test:run                                                     # 3 files, 7/7 PASS
node --test backend/test/{bmsParser,estimateFinancials,estimateImport,estimateTotals,idTypeCastGuard,typeCastRoutes}.test.js  # 19/19 PASS
cd frontend && npm run test:run                                                    # 23 files, 53/53 PASS
cd frontend && npm run build                                                       # PASS
Playwright mocked tablet flow, 1024x768: no page errors, no horizontal overflow, 2-page intake applied, existing customer/VIN matched, old suggestion panel count 0
Playwright mocked phone flow, 390x844: no horizontal overflow
Playwright Estimate Builder: gap visible, evidence sources visible, zero-dollar draft disclosure present
Screenshots: /tmp/revv-appraisal-quick-intake.png, /tmp/revv-new-ro-appraisal-loaded.png, /tmp/revv-estimate-gap-review.png, /tmp/revv-appraisal-mobile.png
```

**Claude Code QA — PASS (2026-07-10) Appraisal Quick Intake + Estimate Gap Review**
- Reviewed range `db96956..12d9a05` (feature commits `2b70648`, `00a5a6b`). All 15 dispatch items verified with file:line evidence; zero CRITICAL/HIGH/MEDIUM findings.
- Independent verification: backend route syntax passed; backend suites passed 98/98, 7/7, and 19/19; frontend passed 23 files/53 tests; production build passed; `git diff --check` clean; `frontend/dist` untracked.
- Confirmed intake mode returns metadata only and leaves full estimate parsing unchanged; unique matching reuses records; new extracted customers start with consent false while matched customers retain stored consent; exact duplicate claims warn before create; PDF source pages attach as claim documents; failed attachments cannot trigger duplicate RO creation; New RO no longer shows contextless AI suggestions; Estimate Gap Review is authenticated, shop-scoped, evidence-gated, and forces zero-dollar non-taxable drafts.
- LOW, non-blocking: gap-review counts `ro_photos` by `ro_id` after first validating that the RO belongs to `req.user.shop_id`; `ro_photos` has no `shop_id` column, so this follows the established ownership pattern and does not expose cross-tenant data.
- **Hermes is clear to ship.**

**Hermes Deployment Verification — 2026-07-10 (Appraisal Quick Intake + Estimate Gap Review)**
- Pushed linear HEAD `6536f91` to `origin/main` (fast-forward `db96956..6536f91`, no force, no history rewrite). Batch: feature commits `2b70648`, `00a5a6b` + docs `1a16572`, `12d9a05`, `6536f91`.
- Railway auto-deployed; both hosts live on `6536f91`:
  - `https://revvshop.app/api/health` → HTTP 200, commit `6536f9182d9072ac1182289c1607d606d7c7ca8e`
  - `https://revv-production-ffa9.up.railway.app/api/health` → HTTP 200, commit `6536f9182d9072ac1182289c1607d606d7c7ca8e`
- `./scripts/smoke-test.sh` → 6 PASS + 1 documented `RESEND_API_KEY` local-env WARN.
- Railway startup logs clean: Sentry release `6536f91`, `[DB] Tables initialized`, idempotent migrations complete, PostgreSQL connected, server on :4000, feedback audit + owner digest jobs ran. Pre-existing benign `[migrate] schemaSql warning ... syntax error at or near "NOT"` present (idempotent path completes right after; no migration/schema files changed in this batch) — not a blocker.
- Control-room BUILD SHIPPED notice: could not be sent from this workspace host — `openclaw` CLI not on PATH here. Left for operator/Bryan to post.
- Production is ready for Bryan to validate Appraisal Quick Intake.

## Dispatch Log — 2026-07-10 iPad Landscape Compact Entry Follow-up

**Status:** CLAUDE CODE QA PASS — READY FOR HERMES DEPLOYMENT; PHYSICAL IPAD VALIDATION REQUIRED

**Why the prior production fix was insufficient**
- Physical-iPad validation after deploy `c69ae92` still reproduced the landscape keyboard problem.
- Safari can shrink both `innerHeight` and `visualViewport.height`; using `innerHeight` as the stable device height could still downgrade the iPad to phone mode.
- Real iPad Safari user agents contain `Mobile`; the prior phone-agent regex ran before the tablet exclusion and classified that real UA as a phone.
- Even with correct visual-viewport sizing, the native landscape keyboard leaves too little height for the complete multi-field form. REVV cannot resize the operating-system keyboard.

**Replacement behavior**
- Touch-device classification now uses physical screen dimensions and excludes identified tablets from the generic `Mobile` phone match.
- A compact one-field editor activates only for touch + physical landscape orientation + at least 160px of soft-keyboard viewport reduction.
- The compact editor shows the active field, `Done`, and the existing RO step footer/`Next`; typed values synchronize to the original controlled form field.
- Closing the keyboard or tapping `Done` restores the complete form without losing the typed value.
- iPad portrait remains the normal form.
- iPad with a wireless keyboard remains the normal full-height form because no large visual-viewport reduction occurs.
- Desktop is unchanged; phone landscape with its native soft keyboard uses the same compact behavior.
- No customer, shop, RO, seed, reset, migration, backend, or production-data mutation was performed. Miles Automotive data was not touched.

**Files changed**
- `frontend/src/components/AddROModal.jsx`
- `frontend/src/components/__tests__/AddROModal.feedback.test.jsx`
- `frontend/src/index.css`
- `frontend/src/lib/viewport.js`
- `frontend/src/lib/__tests__/viewport.test.js`
- `CLAUDE.md`

**Verification**
```text
cd frontend && npm run test:run  # 19 files, 46/46 passed
cd frontend && npm run build     # passed; existing Sentry/chunk warnings only
rm -rf frontend/dist
git diff --check                 # passed
git ls-files frontend/dist       # no tracked files

Rendered iPad landscape soft-keyboard state:
- realistic iPad Safari UA with Mobile token => deviceMode tablet
- visual viewport 1024x248 at offsetTop 74
- compact input y=122..164, Next y=183..219; both inside shell y=74..322
- typed `Miles Landscape` present in both compact input and original form field
- focused compact input=true; sidebar count=0
- screenshot: /tmp/revv-ipad-landscape-compact-editor.png

Rendered wireless-keyboard state:
- visual viewport expanded to 1024x700
- deviceMode tablet; compact editor=false
- complete Add RO form restored; typed value retained
- screenshot: /tmp/revv-ipad-wireless-keyboard-full-form.png
```

**Claude Code QA — PASS (2026-07-10)**
- Verified all 12 dispatch items with file/line evidence.
- Independent verification: 19 frontend test files, 46/46 tests passed; production build passed; `git diff --check` clean; `frontend/dist` untracked.
- Confirmed realistic `iPad` + `Mobile` Safari UA remains tablet, both-height shrink remains tablet, compact values sync and survive Done, and portrait/wireless/desktop gates remain normal.
- Confirmed listener/timer/animation-frame cleanup and no backend/schema/data/Miles changes.
- Do not close the originating user report until Bryan validates the deployed change with the physical iPad in landscape.

**Claude Code QA Prompt**
```text
TASK: REVV — Read-only QA for physical-iPad landscape compact-entry follow-up

Repo: /Users/zordon/.openclaw/workspace/Revv
Review the commit immediately following this dispatch. Do not edit, deploy, access a live DB, or mutate customer/shop/RO/Miles data.

Verify:
1. A realistic iPad Safari UA containing `iPad` and `Mobile` is classified as tablet, not phone.
2. If Safari shrinks both innerHeight and visualViewport height, physical screen dimensions keep the iPad classified as tablet.
3. Compact entry activates only for touch + physical landscape + >=160px viewport reduction.
4. Portrait soft-keyboard use does not activate compact entry.
5. An iPad wireless-keyboard/full-height viewport does not activate compact entry.
6. A non-touch desktop never activates compact entry.
7. Compact input changes synchronize to the original controlled Add-RO field and survive Done/restore.
8. The compact state leaves the active input, Done, and RO footer/Next visible while hiding the rest of the form from the reduced viewport.
9. Closing the keyboard restores the full form.
10. Existing Add-RO validation, portrait flow, desktop modal flow, and three-step submission remain unchanged.
11. Tests/build/diff pass; frontend/dist is untracked.
12. No backend, schema, data, seed/reset, or Miles Automotive change exists.

Commands:
- cd frontend && npm run test:run
- cd frontend && npm run build
- rm -rf frontend/dist
- git diff --check
- git ls-files frontend/dist

Return PASS or NEEDS FIXES with file:line evidence. On PASS, hand to Hermes for deploy, then require Bryan's physical-iPad landscape validation before marking the user report closed.
```

## Claude Code QA — 2026-07-10 Permanent REVV Logo Assets

**Status:** PASS — commit `1ca3b06` is safe to ship.
- Confirmed valid wordmark, 1024x1024 app icon, 512x512 and 192x192 PWA icons, and 64x64 favicon.
- Confirmed valid manifest entries and square-icon use in both Layout logo tiles.
- Production frontend build passed; `git diff --check` clean; `frontend/dist` untracked.
- Commit contains frontend/docs assets only. No backend, migration, seed, DB, or Miles Automotive data changes.

## Dispatch Log — 2026-07-10 iPad Landscape Add-RO Keyboard

**Status:** CLAUDE CODE QA PASS — READY FOR HERMES DEPLOYMENT

**Root cause**
- The prior `/ros/new` “full-page” flow still rendered inside the normal REVV `Layout`, leaving the desktop sidebar/header in control of the available space.
- Viewport detection used the keyboard-reduced `visualViewport.height` to classify the device. An iPad in landscape changed from `tablet` to `phone` when the keyboard opened.
- REVV tracked the visual viewport's size but not Safari's `offsetTop`/`offsetLeft`, so the page could be correctly sized but positioned outside the visible area after Safari panned it.

**Behavior shipped**
- `/ros/new` now uses a dedicated visual-viewport shell with no sidebar or app header.
- Device classification now uses stable layout dimensions; visual dimensions are used only for the currently usable screen area.
- The shell follows `visualViewport.width`, `height`, `offsetTop`, and `offsetLeft` during keyboard resize/pan events.
- The focused Add-RO field is rechecked at 0/100/300 ms after focus or viewport changes and centered only when it falls outside the usable area.
- The landscape keyboard state compacts the page header while keeping the active field and Add-RO footer controls visible.
- No customer, shop, RO, seed, reset, migration, or production-data mutation was performed. Miles Automotive data was not touched.

**Files changed**
- `frontend/src/components/AddROModal.jsx`
- `frontend/src/components/Layout.jsx`
- `frontend/src/components/__tests__/AddROModal.feedback.test.jsx`
- `frontend/src/index.css`
- `frontend/src/lib/viewport.js`
- `frontend/src/lib/__tests__/viewport.test.js`

**Verification**
```text
cd frontend && npm run test:run  # 19 files, 43/43 passed
cd frontend && npm run build     # passed
git diff --check                 # passed
git ls-files frontend/dist       # no tracked files

Headless interactive render at iPad landscape dimensions with the keyboard-reduced
visual viewport simulated as 1024x248 at offsetTop=74:
- /ros/new remained the active route
- .new-ro-visual-shell = x:0, y:74, width:1024, height:248
- focused Full Name input = y:143..181 (fully visible)
- sidebar count = 0
- focused input = true
- screenshot: /tmp/revv-ipad-landscape-keyboard-fix.png
```

**Claude Code QA — PASS (2026-07-10)**
- Read-only code review passed all behavior and safety checks.
- Independent command verification: 19 frontend test files, 43/43 tests passed; production build passed; `git diff --check` clean; `frontend/dist` has zero tracked files.
- Claude confirmed `/ros/new` has no sidebar/header, iPad classification remains `tablet` at a 248px keyboard-reduced visual height, visual offsets are published, and focused fields are moved only when outside usable bounds.
- No source edits, deployment, DB access, or Miles Automotive data mutation occurred during QA.

**Claude Code QA Prompt**
```text
TASK: REVV — Read-only QA for iPad landscape Add-RO keyboard fix

Repo: /Users/zordon/.openclaw/workspace/Revv
Scope: the commit immediately following this dispatch entry.

Do not edit code, deploy, connect to a live DB, or mutate customer/shop/RO data. Miles Automotive data must remain untouched.

Verify:
1. /ros/new renders in the dedicated new-ro-visual-shell and does not render the normal sidebar/header.
2. Other Layout routes still render the existing sidebar/header unchanged.
3. detectViewportProfile keeps a 1024x768 touch iPad classified as tablet when visualViewport.height falls to 248.
4. applyViewportProfile publishes visualViewport width/height/offsetTop/offsetLeft as CSS variables.
5. The Add-RO full-page editor follows those variables and remains scrollable within the keyboard-reduced viewport.
6. A focused field outside the visible bounds is recentered after focus and visualViewport resize/scroll; an already-visible field is not needlessly moved.
7. Landscape compact styling leaves the focused field and footer controls visible without the sidebar.
8. Portrait and desktop modal behavior are not regressed.
9. Tests/build/diff pass and frontend/dist is not tracked.
10. No data, migration, seed, reset, backend, or Miles Automotive changes are present.

Commands:
- cd frontend && npm run test:run
- cd frontend && npm run build
- rm -rf frontend/dist
- git diff --check
- git ls-files frontend/dist

Return PASS/NEEDS FIXES with file:line evidence. On PASS, hand off to Hermes for deployment and require a real iPad landscape validation after production deploy.
```

## Dispatch Log — 2026-07-10 Customer Email + Owner Activity Notifications

**Status:** BUILT LOCALLY — READY FOR CLAUDE CODE QA

**Scope**
- Added customer-level email status notification consent alongside the existing SMS consent flow.
- Customer status emails now require both shop email notifications enabled and `customers.email_consent = TRUE`; SMS behavior remains unchanged.
- Add RO now collects customer email notification consent and blocks enabling it without a customer email address.
- Added owner/admin activity logging for RO creation, status changes, assignment changes, total-loss changes, SIU holds, and claim workflow approval.
- Added owner activity preferences, daily digest email support, optional immediate critical alerts, and Settings UI controls.
- Added once-per-day digest locking (`owner_activity_last_digest_date`) so deploys/restarts do not spam owners.
- Added source/schema/migration alignment for new customer consent fields and owner activity tables.
- No customer, shop, RO, seed, reset, or destructive data mutation was performed. Miles Automotive data was not touched.

**Files changed**
- `backend/src/app.js`
- `backend/src/db/index.js`
- `backend/src/db/migrate.js`
- `backend/src/db/schema.pg.sql`
- `backend/src/jobs/ownerActivityDigest.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/ownerActivity.js`
- `backend/src/routes/ros.js`
- `backend/src/services/ownerActivity.js`
- `backend/src/__tests__/ownerActivity.test.js`
- `frontend/src/components/AddROModal.jsx`
- `frontend/src/components/__tests__/AddROModal.feedback.test.jsx`
- `frontend/src/pages/Settings.jsx`
- `docs/SPEC-email-status-notifications.md`
- `docs/SPEC-owner-activity-digest.md`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/app.js backend/src/routes/ownerActivity.js backend/src/services/ownerActivity.js backend/src/jobs/ownerActivityDigest.js backend/src/routes/customers.js backend/src/routes/ros.js backend/src/db/index.js backend/src/db/migrate.js
node --test backend/src/__tests__/*.test.js  # 92/92 passed
cd backend && npm run test:run  # 3 files, 7/7 passed
cd frontend && npm run test:run -- src/components/__tests__/AddROModal.feedback.test.jsx  # 1 file, 2/2 passed
cd frontend && npm run build
rm -rf frontend/dist
git diff --check
git ls-files frontend/dist  # 0 tracked files
```

**Claude Code follow-up addressed**
- Claude Code first-pass QA returned a conditional code-review pass and flagged 3 medium items.
- Fixed `queueStatusEmail` outer catch to log `[Email] queueStatusEmail failed` instead of swallowing DB/runtime errors.
- Aligned owner activity severity taxonomy to `critical` in the spec because implementation and immediate alerts use `critical`.
- Changed owner immediate alerts default to ON in schema/init/migration/service fallback/frontend default to match the spec recommendation.
- Re-ran verification after the fixes:
  - `node --check ...` passed.
  - `node --test backend/src/__tests__/*.test.js` passed, 92/92.
  - `cd backend && npm run test:run` passed, 3 files / 7 tests.
  - `cd frontend && npm run test:run -- src/components/__tests__/AddROModal.feedback.test.jsx` passed, 2/2.
  - `cd frontend && npm run build` passed.

**Claude Code QA Prompt**
```text
TASK: REVV — QA customer email status notifications + owner activity digest

CONTEXT
Repo: /Users/zordon/.openclaw/workspace/Revv
Change: Customer email notification opt-in plus owner/admin activity digest and Settings controls.
Read docs/SPEC-email-status-notifications.md and docs/SPEC-owner-activity-digest.md first.

SCOPE — read-only QA. Do not edit code. Do not mutate customer/shop/RO data. Do not run seed/reset/destructive scripts. Do not deploy.

Review these changed files:
- backend/src/app.js
- backend/src/db/index.js
- backend/src/db/migrate.js
- backend/src/db/schema.pg.sql
- backend/src/jobs/ownerActivityDigest.js
- backend/src/routes/customers.js
- backend/src/routes/ownerActivity.js
- backend/src/routes/ros.js
- backend/src/services/ownerActivity.js
- backend/src/__tests__/ownerActivity.test.js
- frontend/src/components/AddROModal.jsx
- frontend/src/components/__tests__/AddROModal.feedback.test.jsx
- frontend/src/pages/Settings.jsx
- docs/SPEC-email-status-notifications.md
- docs/SPEC-owner-activity-digest.md
- CLAUDE.md

Verify:
1. Customer status email sends only when shop email notifications are enabled AND customer.email_consent is true AND customer has an email.
2. SMS consent behavior is unchanged.
3. Add RO blocks email-notification opt-in without a customer email and sends email_consent/preferred_contact_method to backend.
4. Customers create/update/autofill include email_consent and preferred_contact_method without breaking existing sms_consent.
5. Owner activity routes are auth/admin gated and explicitly block assistant/technician/customer roles from owner digest preferences.
6. Owner activity logging is non-blocking and redacts sensitive keys before storage/email.
7. Daily digest job respects owner_activity_digest_time and owner_activity_last_digest_date so one shop cannot receive multiple daily digests after restarts.
8. Immediate alerts only fire for critical owner events and only when enabled.
9. Schema changes are additive only: no DROP, no destructive migration, no data reset.
10. Settings Messaging tab exposes customer email notifications and owner activity digest preferences and saves both.
11. `frontend/dist` is not tracked.
12. No Miles Automotive data is read/written/mutated during QA.

Commands:
- node --check backend/src/app.js backend/src/routes/ownerActivity.js backend/src/services/ownerActivity.js backend/src/jobs/ownerActivityDigest.js backend/src/routes/customers.js backend/src/routes/ros.js backend/src/db/index.js backend/src/db/migrate.js
- node --test backend/src/__tests__/*.test.js
- cd backend && npm run test:run
- cd frontend && npm run test:run -- src/components/__tests__/AddROModal.feedback.test.jsx
- cd frontend && npm run build
- rm -rf frontend/dist && git diff --check && git ls-files frontend/dist

Expected:
- All checks pass.
- Verdict should say whether Hermes can review/ship this notification work after QA.
```

---

## Dispatch Log — 2026-07-07 Phase 1 Money Authority (H2 + H3)

**Status:** BUILD READY for Claude Code QA. Local commit only; not pushed or deployed.

**Scope**
- Made RO invoice/payment totals server-authoritative from estimate line items plus shop tax.
- Removed client control over scalar RO money fields in the PATCH route.
- Reconciled payment state from integer cents paid vs integer cents owed.
- Switched close gating to strict `payment_status = 'paid'` instead of the legacy boolean-only close path.
- Added additive `amount_paid_cents` and `amount_owed_cents` columns for reconciliation snapshots.
- No customer, shop, RO, seed, reset, migration, or destructive data mutation was performed. Miles Automotive data was not touched.

**Files changed**
- `backend/src/services/roMoney.js`
- `backend/src/routes/ros.js`
- `backend/src/routes/invoice.js`
- `backend/src/routes/payments.js`
- `backend/src/services/customerBilling.js`
- `backend/src/db/index.js`
- `backend/src/db/migrate.js`
- `backend/src/db/schema.pg.sql`
- `backend/src/__tests__/moneyAuthority.phase1.test.js`

**Verification**
```
node --check backend/src/services/roMoney.js backend/src/routes/ros.js backend/src/routes/invoice.js backend/src/routes/payments.js backend/src/services/customerBilling.js backend/src/db/index.js backend/src/db/migrate.js
node --test backend/src/__tests__/moneyAuthority.phase1.test.js  # 4/4 passed
node --test backend/src/__tests__/moneyAuthority.phase1.test.js backend/src/__tests__/*.test.js backend/test/*.test.js  # 99/99 passed
cd frontend && npm run build  # passed; existing Vite/Sentry and chunk-size warnings only
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist  # clean; no dist tracked
```

**Notes for QA**
- Phase 1 is intentionally build-only. Hermes should ship only after Claude Code QA PASS.
- Existing unrelated local edits in `backend/src/routes/auth.js`, `frontend/src/pages/ShopRegister.jsx`, and legal/marketing files were left untouched.

## Dispatch Log — 2026-07-03 FABLE H1: Unified RO Status Gates

**Status:** DONE + VERIFIED — BUILD ONLY, NOT PUSHED/DEPLOYED

**Commit:** see final handoff SHA

**Scope**
- Fixed FABLE_AUDIT.md finding H1: `PUT /api/ros/:id/status` now enforces the same business gates as `PATCH /api/ros/:id`.
- Added one shared `assertStatusTransitionAllowed(ro, toStatus, actor)` helper in `backend/src/routes/ros.js`.
- Both status routes now block:
  - normal workflow movement while `ro.status === 'siu_hold'`
  - non-owner/admin attempts to reopen a closed RO
  - closing an RO when `payment_received` is false
- Closed side effects remain after the status write, so illegitimate close attempts return before `queueClosedReviewEmail`, `sendClosedPaidInvoiceEmail`, or `queueQuickBooksSync` can run.
- Preserved existing status update behavior, `actual_delivery` handling, `job_status_log` writes, and claim-status total-loss/SIU/approved flows.
- No customer, shop, RO, feedback, seed, reset, migration, destructive script, push, or deploy action was performed. Miles Automotive data was not touched.

**Files changed**
- `backend/src/routes/ros.js`
- `backend/src/__tests__/status.gates.test.js`
- `CLAUDE.md`

**Verification**
```

## Dispatch Log — 2026-07-03 FABLE C3/H6: By-RO IDOR Read Scope

**Status:** DONE + VERIFIED — BUILD ONLY, NOT PUSHED/DEPLOYED

**Commit:** see final handoff SHA

**Scope**
- Fixed FABLE_AUDIT.md finding C3: `GET /api/claim-links/ro/:roId` now verifies the caller owns the RO before reading `claim_links`, and the claim-link read is scoped by both `ro_id` and `shop_id`.
- Preserved the owning-shop response shape, including `token`, so the RO UI can still copy the adjuster link.
- Tightened `POST /api/claim-links/:roId` existing-link lookup to include `shop_id` after the same ownership guard.
- Fixed FABLE_AUDIT.md finding H6: `GET /api/parts-requests/:ro_id` now verifies RO ownership and reads `parts_requests` through a `repair_orders` join scope. Response shape remains `{ requests: [...] }`.
- Added shared `assertRoOwnership(roId, shopId)` helper using the repo's text-cast convention: `id::text = $1::text AND shop_id::text = $2::text`.
- Route sweep found one additional authenticated by-RO child read in `backend/src/routes/parts.js`; it now uses `assertRoOwnership` and scopes `parts_orders` by `shop_id`.
- Public token-bearer adjuster routes (`/claim-link/:token`, `/claim-link/view/:token`, and submit routes) were left public by design.
- No customer, shop, RO, claim, parts, feedback, seed, reset, migration, destructive script, push, or deploy action was performed. Miles Automotive data was not touched.

**Files changed**
- `backend/src/middleware/roOwnership.js`
- `backend/src/routes/claimLinks.js`
- `backend/src/routes/partsRequests.js`
- `backend/src/routes/parts.js`
- `backend/src/__tests__/claimLinks.scope.test.js`
- `backend/src/__tests__/partsRequests.scope.test.js`
- `CLAUDE.md`

**Verification**
```

## Dispatch Log — 2026-07-03 FABLE H7: ro_supplements Fresh-DB Schema

**Status:** DONE + VERIFIED — BUILD ONLY, NOT PUSHED/DEPLOYED

**Commit:** see final handoff SHA

**Scope**
- Fixed FABLE_AUDIT.md finding H7: `backend/src/db/index.js` now creates `ro_supplements` with the insert-contract columns used by both supplement write paths.
- Added `description TEXT NOT NULL DEFAULT ''`, `amount NUMERIC(12,2) NOT NULL DEFAULT 0`, and `submitted_date DATE NOT NULL DEFAULT CURRENT_DATE` to the `CREATE TABLE IF NOT EXISTS ro_supplements` block in `initDb()`.
- Added idempotent additive backfills for existing partial fresh/dev DBs:
  - `ALTER TABLE ro_supplements ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`
  - `ALTER TABLE ro_supplements ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0`
  - `ALTER TABLE ro_supplements ADD COLUMN IF NOT EXISTS submitted_date DATE NOT NULL DEFAULT CURRENT_DATE`
- Did not change `toIntCents`, `dollarsToCents`, ledger recompute behavior, C2 supplement logic, or `migrate.js`.
- No customer, shop, RO, supplement data, seed, reset, destructive migration, push, or deploy action was performed. Miles Automotive data was not touched.

**Files changed**
- `backend/src/db/index.js`
- `backend/src/__tests__/roSupplements.schema.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/db/index.js backend/src/db/migrate.js
node --test backend/src/__tests__/roSupplements.schema.test.js backend/src/__tests__/supplements.ledger.test.js  # 5/5 passed
node --test backend/src/__tests__/roSupplements.schema.test.js backend/src/__tests__/supplements.ledger.test.js backend/src/__tests__/*.test.js backend/test/*.test.js  # 95/95 passed
cd frontend && npm run build  # built in 2.09s; existing Vite chunk-size/Sentry warnings only
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist  # clean; dist not tracked
```

**Claude Code QA Prompt**
```text
TASK: REVV — Read-only QA for FABLE H7 ro_supplements fresh-DB schema

Repo: /Users/zordon/.openclaw/workspace/Revv
Commit under review: see final handoff SHA
Ref: FABLE_AUDIT.md H7

Read-only QA only. Do not edit code. Do not push/deploy. Do not mutate customer/shop/RO/supplement data. Do not run seed/reset/migration/destructive scripts.

Changed files:
- backend/src/db/index.js
- backend/src/__tests__/roSupplements.schema.test.js
- CLAUDE.md

Verify:
1. backend/src/db/index.js `CREATE TABLE IF NOT EXISTS ro_supplements` includes `description TEXT NOT NULL DEFAULT ''`.
2. The same CREATE block includes `amount NUMERIC(12,2) NOT NULL DEFAULT 0`.
3. The same CREATE block includes `submitted_date DATE NOT NULL DEFAULT CURRENT_DATE`.
4. index.js has additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` backfills for all three columns.
5. No DROP, destructive DDL, seed, reset, data backfill, or supplement row mutation was added.
6. backend/src/db/migrate.js was not changed by this dispatch.
7. `toIntCents`, `dollarsToCents`, and ledger recompute logic were not changed.
8. `roSupplements.schema.test.js` locks the index.js fresh-DB schema against regression.
9. Existing supplement ledger tests still pass.
10. No push/deploy was performed.

Commands:
- node --check backend/src/db/index.js backend/src/db/migrate.js
- node --test backend/src/__tests__/roSupplements.schema.test.js backend/src/__tests__/supplements.ledger.test.js backend/src/__tests__/*.test.js backend/test/*.test.js
- cd frontend && npm run build
- git diff --check && git ls-files frontend/dist

Expected:
- All commands pass.
- frontend/dist remains untracked.
- Verdict should explicitly say whether H7 is fixed and whether Hermes is clear to ship after QA PASS.

Hermes post-deploy check on fresh scratch DB:
- Boot app.
- Submit a supplement -> succeeds with no `column "description" does not exist`.
- With $1000 approved, submit $500 then $300 -> total_insurer_owed = $1,800.
- Deny the $300 -> total_insurer_owed = $1,500.
```
node --check backend/src/routes/claimLinks.js backend/src/routes/partsRequests.js backend/src/routes/parts.js backend/src/middleware/roOwnership.js
node --test backend/src/__tests__/claimLinks.scope.test.js backend/src/__tests__/partsRequests.scope.test.js  # 4/4 passed
node --test backend/src/__tests__/claimLinks.scope.test.js backend/src/__tests__/partsRequests.scope.test.js backend/src/__tests__/*.test.js backend/test/*.test.js  # 93/93 passed
cd frontend && npm run build  # built in 2.21s; existing Vite chunk-size/Sentry warnings only
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist  # clean; dist not tracked
```

**Claude Code QA Prompt**
```text
TASK: REVV — Read-only QA for FABLE C3/H6 by-RO IDOR read scope

Repo: /Users/zordon/.openclaw/workspace/Revv
Commit under review: see final handoff SHA
Refs: FABLE_AUDIT.md C3 (claim-link token leak) + H6 (parts-requests read leak)

Read-only QA only. Do not edit code. Do not push/deploy. Do not mutate customer/shop/RO/claim/parts/feedback data. Do not run seed/reset/migration/destructive scripts.

Changed files:
- backend/src/middleware/roOwnership.js
- backend/src/routes/claimLinks.js
- backend/src/routes/partsRequests.js
- backend/src/routes/parts.js
- backend/src/__tests__/claimLinks.scope.test.js
- backend/src/__tests__/partsRequests.scope.test.js
- CLAUDE.md

Verify:
1. `assertRoOwnership(roId, shopId)` uses text casts on both RO id and shop id.
2. `GET /api/claim-links/ro/:roId` returns 404 before reading `claim_links` when the RO is not in the caller's shop.
3. Owning-shop `GET /api/claim-links/ro/:roId` still returns the claim-link object with token intact for copy-link UX.
4. Claim-link by-RO reads include `ro_id = $1 AND shop_id = $2`; no unscoped token read remains.
5. Public adjuster token routes remain public and token-bearer; no `auth` was added to `/view/:token` or submit routes.
6. `GET /api/parts-requests/:ro_id` returns 404 before reading child rows for another shop's RO.
7. Parts-request reads scope through `JOIN repair_orders ro ON ro.id = pr.ro_id` and preserve `{ requests: [...] }`.
8. The extra route-sweep fix in `backend/src/routes/parts.js` uses the same ownership guard and shop-scoped `parts_orders` read.
9. New mocked tests cover cross-shop and same-shop claim-link and parts-request reads.
10. No data mutation, seeds, migrations, pushes, or deploys were performed.

Commands:
- node --check backend/src/routes/claimLinks.js backend/src/routes/partsRequests.js backend/src/routes/parts.js backend/src/middleware/roOwnership.js
- node --test backend/src/__tests__/claimLinks.scope.test.js backend/src/__tests__/partsRequests.scope.test.js backend/src/__tests__/*.test.js backend/test/*.test.js
- cd frontend && npm run build
- rm -rf frontend/dist && git diff --check && git ls-files frontend/dist

Expected:
- All commands pass.
- `frontend/dist` remains untracked.
- Verdict should explicitly say whether C3/H6 are fixed and whether Hermes is clear to ship after QA PASS.

Hermes post-deploy checks:
- As shop A token, GET /api/claim-links/ro/<shop-B-ro-id> -> 404/no token.
- As shop A token, GET /api/parts-requests/<shop-B-ro-id> -> 404/no rows.
```
node --check backend/src/routes/ros.js
node --test backend/src/__tests__/status.gates.test.js  # 4/4 passed
node --test backend/src/__tests__/status.gates.test.js backend/src/__tests__/*.test.js backend/test/*.test.js  # 89/89 passed
cd frontend && npm run build  # built in 2.13s; existing Vite chunk-size/Sentry warnings only
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist  # clean; dist not tracked
```

**Claude Code QA Prompt**
```text
TASK: REVV — Read-only QA for FABLE H1 status-transition gates

Repo: /Users/zordon/.openclaw/workspace/Revv
Commit under review: see final handoff SHA
Ref: FABLE_AUDIT.md finding H1

Context:
This build fixes a production correctness/security gap where PUT /api/ros/:id/status could bypass the business gates enforced by PATCH /api/ros/:id, then still fire closed-RO side effects.

Read-only QA only. Do not edit code. Do not push/deploy. Do not mutate customer/shop/RO/feedback data. Do not run seed/reset/migration/destructive scripts.

Changed files:
- backend/src/routes/ros.js
- backend/src/__tests__/status.gates.test.js
- CLAUDE.md

Verify:
1. backend/src/routes/ros.js has one shared status-transition gate helper, not copied checks in both routes.
2. PUT /:id/status and PATCH /:id both call the shared helper before any status write.
3. SIU hold blocks normal workflow movement with the existing PATCH message: "This RO is under SIU investigation. Clear the SIU hold before changing status."
4. Reopening a closed RO is still owner/admin only and technicians get 403 "Only admins can reopen a closed RO".
5. Closing an unpaid RO returns 400 "Payment must be received before closing this RO".
6. Closed side effects only run after a legitimate gated close, not on blocked PUT attempts.
7. Existing total_loss/delivery actual_delivery behavior and job_status_log writes are preserved.
8. Claim-status total_loss / siu / approved logic was not broadened or refactored outside H1.
9. The new mocked tests cover unpaid close, technician reopen, SIU movement, and legitimate paid close side effects.
10. No data mutation, seeds, migrations, pushes, or deploys were performed.

Commands:
- node --check backend/src/routes/ros.js
- node --test backend/src/__tests__/status.gates.test.js backend/src/__tests__/*.test.js backend/test/*.test.js
- cd frontend && npm run build
- rm -rf frontend/dist && git diff --check && git ls-files frontend/dist

Expected:
- All commands pass.
- `frontend/dist` remains untracked.
- Verdict should explicitly say whether H1 is fixed and whether Hermes is clear to ship after QA PASS.
```

---

## Dispatch Log — 2026-07-03 FABLE C2: Supplement Ledger Money Fix

**Status**
- Ready for Claude Code QA.
- Not deployed and not pushed. Hermes ships only after Claude Code QA PASS.
- No customer/shop/RO/supplement data was read, written, seeded, reset, or migrated. Miles Automotive data was not touched.

**Context**
- Source: `FABLE_AUDIT.md` finding C2.
- Confirmed bug: `POST /api/ros/:id/supplement` overwrote `repair_orders.supplement_amount` and recomputed `total_insurer_owed` from only the newest supplement.
- Risk: a second supplement silently dropped the first supplement from insurer-owed totals.

**Decision**
- Statuses counted toward `total_insurer_owed`: `requested`, `pending`, `approved`.
- Statuses excluded from `total_insurer_owed`: `denied`, `withdrawn`.
- Exact active duplicate guard: same RO, shop, amount cents, notes, and active counted status is treated as an idempotent retry and not inserted again.

**Files changed**
- `backend/src/db/index.js`
- `backend/src/db/migrate.js`
- `backend/src/routes/ros.js`
- `backend/src/routes/supplements.js`
- `backend/src/__tests__/supplements.ledger.test.js`
- `CLAUDE.md`

**Behavior shipped locally**
- Added additive `ro_supplements.amount_cents INTEGER` and `updated_at` support in init/migration paths.
- Did not modify existing supplement rows. Existing legacy `amount` values remain available as a fallback when `amount_cents` is null.
- Singular `POST /api/ros/:id/supplement` now inserts an append-only `ro_supplements` row instead of treating `repair_orders.supplement_amount` as the source of truth.
- `repair_orders.supplement_status`, `supplement_amount`, and `supplement_notes` are now denormalized latest-row display fields derived after ledger recompute.
- `repair_orders.total_insurer_owed` is recomputed as `insurance_approved_amount + SUM(active supplement amount_cents)`.
- New singular `PATCH /api/ros/:id/supplement/:supplementId` changes ledger status and recomputes insurer owed.
- Existing plural `/api/ros/:id/supplements` create/status-update path also writes `amount_cents` and recomputes totals so the current RO Detail UI cannot regress the money math.
- Existing `ro_comms` and notification side effects for singular supplement requests are preserved for new inserts.

**Verification**
```
node --check backend/src/routes/ros.js backend/src/db/index.js
node --check backend/src/routes/supplements.js backend/src/db/migrate.js

node --test backend/src/__tests__/supplements.ledger.test.js
# 3/3 passed

node --test backend/src/__tests__/supplements.ledger.test.js backend/src/__tests__/*.test.js backend/test/*.test.js
# 85/85 passed

cd frontend && npm run build
# built clean; existing Vite chunk-size warning only

rg -n -U "supplement_amount\\s*=\\s*\\$|total_insurer_owed\\s*=.*approved \\+ amount|SET supplement_status = \\$1,\\s*\\n\\s*supplement_amount = \\$2" backend/src/routes -g "*.js"
# No matches.

rm -rf frontend/dist && git diff --check && git ls-files frontend/dist
# No output; dist is not tracked.
```

**Claude Code QA Prompt**
```text
TASK: REVV — QA FABLE C2 supplement ledger money fix

Repo: /Users/zordon/.openclaw/workspace/Revv
Commit: use the final local SHA from the Codex handoff for this dispatch
Finding: FABLE_AUDIT.md C2 — supplements overwrote insurer-owed money instead of accumulating.

Mode: read-only QA. Do not edit code. Do not mutate customer/shop/RO/supplement data. Do not run seed/reset/migrations/destructive scripts. Do not push/deploy.

Review changed files:
- backend/src/db/index.js
- backend/src/db/migrate.js
- backend/src/routes/ros.js
- backend/src/routes/supplements.js
- backend/src/__tests__/supplements.ledger.test.js
- CLAUDE.md

Verify:
1. `toIntCents` behavior is unchanged.
2. Schema changes are additive only: no destructive DDL and no data backfill/mutation.
3. `ro_supplements.amount_cents` is integer cents; old `amount` remains only as compatibility fallback.
4. `POST /api/ros/:id/supplement` inserts into `ro_supplements` and does not overwrite the ledger.
5. `total_insurer_owed = insurance_approved_amount + SUM(amount_cents)` for statuses `requested`, `pending`, `approved`.
6. `denied` and `withdrawn` supplements are excluded from the sum.
7. `repair_orders.supplement_amount/status/notes` are latest-row display fields only.
8. Repeating the same active supplement submission is idempotent and does not double-count.
9. Changing supplement status through the new singular status route recomputes totals.
10. Existing plural `/api/ros/:id/supplements/:suppId` status changes also recompute totals.
11. Existing ro_comms + notification side effects are preserved for new singular supplement requests.
12. frontend/dist is not tracked and no live data was touched.

Commands:
- node --check backend/src/routes/ros.js backend/src/db/index.js
- node --check backend/src/routes/supplements.js backend/src/db/migrate.js
- node --test backend/src/__tests__/supplements.ledger.test.js
- node --test backend/src/__tests__/supplements.ledger.test.js backend/src/__tests__/*.test.js backend/test/*.test.js
- cd frontend && npm run build
- rg -n -U "supplement_amount\\s*=\\s*\\$|total_insurer_owed\\s*=.*approved \\+ amount|SET supplement_status = \\$1,\\s*\\n\\s*supplement_amount = \\$2" backend/src/routes -g "*.js"
- rm -rf frontend/dist && git diff --check && git ls-files frontend/dist

Expected:
- PASS.
- If PASS, Hermes can push/deploy.
- Hermes post-deploy verification: create $500 then $300 supplements on a test RO with $1,000 approved amount and confirm total_insurer_owed is $1,800; deny the $300 and confirm total_insurer_owed returns to $1,500.
```

---

## Dispatch Log — 2026-07-03 FABLE C1: Photo Read IDOR

**Status**
- Ready for Claude Code QA.
- Not deployed and not pushed. Hermes ships only after Claude Code QA PASS.
- No customer/shop/RO/photo data was read, written, seeded, reset, or migrated. Miles Automotive data was not touched.

**Context**
- Source: `FABLE_AUDIT.md` finding C1.
- Confirmed bug: authenticated `GET /api/photos/:ro_id` queried `ro_photos` by `ro_id` only even though `ro_photos` has no `shop_id`.
- Risk: any authenticated shop user who knew another shop's RO id could read that RO's photo metadata/URLs.

**Files changed**
- `backend/src/routes/photos.js`
- `backend/src/routes/export.js`
- `backend/src/routes/portal.js`
- `backend/src/__tests__/photos.scope.test.js`
- `CLAUDE.md`

**Behavior shipped locally**
- `GET /api/photos/:ro_id` now reads photos through `JOIN repair_orders ro ON ro.id = p.ro_id` and `ro.shop_id = $2`.
- `GET /api/photos/ro/:roId/predropoff` uses the same join-scoped `ro_photos` read.
- `photos.js` read-after-insert and upload-count queries are also join-scoped through `repair_orders`.
- `GET /api/export/ro/:id` photo export query is join-scoped through `repair_orders` using the authenticated shop id.
- `GET /api/portal/track/:token` photo query is join-scoped through `repair_orders` using the portal token's shop id.
- Orphaned/mismatched photos naturally return no rows because the inner join has no matching shop-scoped RO.
- Existing response shapes are preserved: `{ photos: [...] }` for photo list routes.

**ro_photos audit**
- `backend/src/routes/photos.js`: all `ro_photos` reads now join `repair_orders`.
- `backend/src/routes/export.js`: photo read now joins `repair_orders`.
- `backend/src/routes/portal.js`: public portal photo read now joins `repair_orders`.
- `backend/src/routes/settings.js` and `backend/src/routes/ros.js`: only scoped deletes matched the grep; no read leak found.
- `backend/src/db/index.js` and `backend/src/db/migrate.js`: schema definitions only.
- No unscopable `ro_photos` read remained.

**Verification**
```
node --check backend/src/routes/photos.js
node --check backend/src/routes/export.js
node --check backend/src/routes/portal.js

node --test backend/src/__tests__/photos.scope.test.js
# 3/3 passed

node --test backend/src/__tests__/photos.scope.test.js backend/src/__tests__/*.test.js backend/test/*.test.js
# 82/82 passed

cd frontend && npm run build
# built clean; existing Vite chunk-size warning only

rg -n "ro_photos" backend/src/routes backend/src/__tests__/photos.scope.test.js -g "*.js"
# Reviewed all route hits.

rg -n -U "SELECT \\* FROM ro_photos|FROM ro_photos\\s*\\n\\s*WHERE ro_id|FROM ro_photos WHERE ro_id" backend/src/routes -g "*.js"
# Only scoped DELETE statements in ros.js/settings.js matched; no read leak remained.

rm -rf frontend/dist && git diff --check && git ls-files frontend/dist
# No output; dist is not tracked.
```

**Claude Code QA Prompt**
```text
TASK: REVV — QA FABLE C1 photo read IDOR fix

Repo: /Users/zordon/.openclaw/workspace/Revv
Commit: use the final local SHA from the Codex handoff for this dispatch
Finding: FABLE_AUDIT.md C1 — cross-tenant ro_photos read via GET /api/photos/:ro_id

Mode: read-only QA. Do not edit code. Do not mutate customer/shop/RO/photo data. Do not run seed/reset/migrations/destructive scripts. Do not push/deploy.

Review changed files:
- backend/src/routes/photos.js
- backend/src/routes/export.js
- backend/src/routes/portal.js
- backend/src/__tests__/photos.scope.test.js
- CLAUDE.md

Verify:
1. `GET /api/photos/:ro_id` uses `SELECT p.* FROM ro_photos p JOIN repair_orders ro ON ro.id = p.ro_id WHERE p.ro_id = $1 AND ro.shop_id = $2`.
2. It passes `[req.params.ro_id, req.user.shop_id]`.
3. The response shape remains `{ photos: [...] }`.
4. A caller from shop A receives no rows for a shop B RO id.
5. A caller from the owning shop receives that RO's photos.
6. Predropoff reads are also join-scoped through `repair_orders`.
7. `photos.js` upload count and read-after-insert queries do not read bare `ro_photos` rows.
8. `export.js` photo reads are scoped with the authenticated shop id.
9. `portal.js` token photo reads are scoped with the portal token's shop id.
10. Grep all `ro_photos` usage and confirm no other read remains bare/unscoped. Deletes may remain if scoped through `repair_orders`.
11. Orphaned photos / missing RO return no rows or 404, not a 500.
12. No frontend/dist is tracked and no data was mutated.

Commands:
- node --check backend/src/routes/photos.js backend/src/routes/export.js backend/src/routes/portal.js
- node --test backend/src/__tests__/photos.scope.test.js
- node --test backend/src/__tests__/photos.scope.test.js backend/src/__tests__/*.test.js backend/test/*.test.js
- cd frontend && npm run build
- rg -n "ro_photos" backend/src/routes -g "*.js"
- rg -n -U "SELECT \\* FROM ro_photos|FROM ro_photos\\s*\\n\\s*WHERE ro_id|FROM ro_photos WHERE ro_id" backend/src/routes -g "*.js"
- rm -rf frontend/dist && git diff --check && git ls-files frontend/dist

Expected:
- PASS.
- If PASS, Hermes can push/deploy.
- Hermes post-deploy verification: as shop A token, GET /api/photos/<shop-B-ro-id> returns `{ photos: [] }` or 404, never shop B photo rows.
```

---

## Dispatch Log — 2026-07-03 Security Review: Feedback API + Email Simulation

**Status**
- Ready for Claude Code QA.
- Not deployed and not pushed after this dispatch until Claude Code returns QA PASS.
- No customer/shop/RO data was read, written, seeded, reset, or migrated. Miles Automotive data was not touched.

**Context**
- Source request: security/QA review pasted into `/Users/zordon/.codex/attachments/959af616-7294-478b-8350-aadb3aedc89b/pasted-text.txt`.
- Confirmed blockers:
  1. `GET /api/feedback` was unauthenticated and returned `SELECT * FROM feedback`.
  2. `backend/src/services/email.js` simulated successful email sends in production when no provider was configured and logged recipient/body previews.
  3. `superadmin` was missing from `ROLE_RANK`, creating inconsistent behavior across admin-gated surfaces.

**Files changed**
- `backend/src/routes/feedback.js`
- `backend/src/services/email.js`
- `backend/src/middleware/roles.js`
- `backend/src/__tests__/feedback.auth.test.js`
- `backend/src/__tests__/email.production.test.js`
- `backend/src/__tests__/role-guards.test.js`
- `CLAUDE.md`

**Behavior shipped locally**
- `GET /api/feedback` now requires `auth + requireAdmin`.
- Admin/owner/assistant-style admin-ranked users only receive feedback rows scoped to `req.user.shop_id` using `shop_id::text = $1::text`.
- Superadmin has an explicit cross-shop read path at `GET /api/feedback/all`.
- Feedback read queries use an allow-listed column projection instead of `SELECT *`.
- Public feedback submission remains available at `POST /api/feedback`, but now has an express-rate-limit guard: 10 submissions per minute per client.
- Production email with no configured provider now returns `{ ok:false, provider:'none', error:'no_provider_configured' }` and refuses simulated success.
- Non-production email simulation still works but logs only `[EMAIL] simulated (no provider configured)` with no recipient, subject, or body preview.
- `ROLE_RANK.superadmin = 5`, above owner/admin, so admin gates treat master support accounts consistently.

**Verification**
```
node --check backend/src/routes/feedback.js
node --check backend/src/services/email.js
node --check backend/src/middleware/roles.js

node --test backend/src/__tests__/feedback.auth.test.js backend/src/__tests__/email.production.test.js backend/src/__tests__/role-guards.test.js backend/src/__tests__/feedback.sanitize.test.js
# 14/14 passed

node --test backend/src/__tests__/*.test.js backend/test/*.test.js
# 79/79 passed

cd frontend && npm run build
# built clean; existing Vite chunk-size warning only

rg -n "\\[EMAIL\\].*(To:|Body:)|console\\.(log|error)\\([^\\n]*(customer@example|reset token|html\\.replace|Body:|To:)" backend/src/services/email.js backend/src/routes -g "*.js"
# No matches.

rg -n "(/feedback|feedback/all|api\\.get\\(['\\\"]/?feedback|api\\.post\\(['\\\"]/?feedback)" frontend/src backend/src -g "*.js" -g "*.jsx"
# Frontend posts feedback only; current superadmin inbox reads through /api/superadmin.

rg -n "router\\.get\\([^\\n]*(async|auth|require|\\()" backend/src/routes -g "*.js"
# Reviewed feedback plus relevant false positives: superadmin/router.use(superadmin), storage/router.use(auth), catalog/router.use(auth), inspections public-token route before router.use(auth), apiV1/router.use(apiKeyAuth), market public rates, QuickBooks callback.

rm -rf frontend/dist && git diff --check && git ls-files frontend/dist | wc -l
# 0
```

**Claude Code QA Prompt**
```text
TASK: REVV — Security review fixes for feedback API + email simulation

CONTEXT
Repo: /Users/zordon/.openclaw/workspace/Revv
Date: 2026-07-03

This dispatch responds to the pasted security review that flagged:
1. CRITICAL: unauthenticated GET /api/feedback leaking all tenant feedback.
2. HIGH: email.js simulating successful sends in production and logging recipient/body PII.
3. LOW/MED support issue: superadmin missing from ROLE_RANK.

SCOPE — read-only QA. Do not edit code. Do not mutate customer/shop/RO data. Do not run seed/reset/destructive scripts. Do not deploy or push.

Changed files to review:
- backend/src/routes/feedback.js
- backend/src/services/email.js
- backend/src/middleware/roles.js
- backend/src/__tests__/feedback.auth.test.js
- backend/src/__tests__/email.production.test.js
- backend/src/__tests__/role-guards.test.js
- CLAUDE.md

Verify:
1. GET /api/feedback now requires auth + admin rank.
2. Non-admin tokens cannot list feedback.
3. Shop-scoped users only query rows with `shop_id::text = $1::text`.
4. Feedback read queries no longer use `SELECT *`.
5. Superadmin cross-shop listing is available only through a gated superadmin path (`GET /api/feedback/all`) and does not bypass JWT verification.
6. POST /api/feedback remains publicly usable for in-app error reporting/feedback, but is rate-limited.
7. Production unconfigured email returns a failure (`no_provider_configured`) and does not simulate success.
8. Email simulation logs do not include recipient addresses, subjects, or HTML/body previews.
9. `superadmin` outranks owner/admin in `ROLE_RANK`.
10. The current frontend does not depend on unauthenticated GET /api/feedback for the master inbox; it uses /api/superadmin paths.
11. Static route sweep: confirm any unauthenticated GETs in backend/src/routes are either protected by router.use(...), API-key middleware, public-token/callback endpoints, or intentionally public metadata such as market rates/catalog makes/models. Flag any real newly-discovered issue separately; do not fix it in this QA pass.

Commands:
- node --check backend/src/routes/feedback.js
- node --check backend/src/services/email.js
- node --check backend/src/middleware/roles.js
- node --test backend/src/__tests__/feedback.auth.test.js backend/src/__tests__/email.production.test.js backend/src/__tests__/role-guards.test.js backend/src/__tests__/feedback.sanitize.test.js
- node --test backend/src/__tests__/*.test.js backend/test/*.test.js
- cd frontend && npm run build
- rg -n "\\[EMAIL\\].*(To:|Body:)|console\\.(log|error)\\([^\\n]*(customer@example|reset token|html\\.replace|Body:|To:)" backend/src/services/email.js backend/src/routes -g "*.js"
- rg -n "(/feedback|feedback/all|api\\.get\\(['\\\"]/?feedback|api\\.post\\(['\\\"]/?feedback)" frontend/src backend/src -g "*.js" -g "*.jsx"
- rg -n "router\\.get\\([^\\n]*(async|auth|require|\\()" backend/src/routes -g "*.js"
- rm -rf frontend/dist && git diff --check && git ls-files frontend/dist

Expected:
- All node checks/tests/build pass.
- No frontend/dist files are tracked.
- No production data is touched.
- Verdict should say whether this is safe to push/deploy, and list any remaining security recommendations separately from this scoped fix.
```

**This exact bug was found and fixed in runs.js and lifts.js. Don't reintroduce it.**

---

## Key Files

```
backend/src/
├── app.js                   ← Route registration, static file serving, DB init
├── middleware/auth.js        ← JWT verification, sets req.user
├── middleware/roles.js       ← requireAdmin check
├── routes/
│   ├── ros.js               ← Repair orders (largest file — 1200+ lines)
│   ├── sms.js               ← SMS send/receive/webhook/inbox
│   ├── market.js            ← Shop settings (saves Twilio creds to DB)
│   ├── auth.js              ← User auth + profile
│   └── settings.js          ← Shop-level settings (SMS notifications toggle)
├── services/
│   └── sms.js               ← Twilio client, getTwilioConfigForShop()
└── db/
    ├── index.js             ← dbGet, dbAll, dbRun exports
    └── migrate.js           ← Run on every startup (idempotent)

frontend/src/
├── lib/api.js               ← Axios instance, baseURL: '/api', JWT header auto-inject
└── pages/Settings.jsx       ← Large file (1000+ lines) — SMS config, shop settings
```

---

## Database Patterns

```js
// All helpers return null (not undefined) on no result
const row = await dbGet('SELECT * FROM table WHERE id = $1', [id]);
if (!row) return res.status(404).json({ error: 'Not found' });

// Arrays always return [], never null
const rows = await dbAll('SELECT * FROM table WHERE shop_id = $1', [shopId]);
```

---

## SMS Architecture

- Twilio config lookup order: **DB first** (shops table), then **env vars** fallback
- DB fields: `twilio_account_sid`, `twilio_auth_token`, `twilio_phone_number`
- Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_PHONE_NUMBER`
- API Key auth takes priority over Auth Token in env var path
- If DB has partial creds (e.g., sid + phone but no auth_token), falls back to env vars

```js
// sendSMS options signature
sendSMS(phone, message, { shopId, twilioConfig? })
```

---

## Env Vars (Railway)

| Var | Required | Notes |
|-----|----------|-------|
| `JWT_SECRET` | YES | App refuses to start without it |
| `DATABASE_URL` | YES | PostgreSQL connection string |
| `TWILIO_ACCOUNT_SID` | For SMS | |
| `TWILIO_API_KEY` | For SMS (preferred) | SK... prefix |
| `TWILIO_API_SECRET` | For SMS (preferred) | |
| `TWILIO_PHONE_NUMBER` | For SMS | E.164 format: +1XXXXXXXXXX |
| `PORT` | No | Defaults to 4000 |

---

## Deploy Process

```bash
git push origin main   # Railway auto-builds and deploys
# Health check: https://revv-production-ffa9.up.railway.app/api/health
# Returns: { ok: true, deployed: "ISO timestamp", commit: "sha" }
```

Build command (from railway.toml):
```
cd frontend && npm install && npm run build && cd ../backend && npm install
```
Start command: `cd backend && node src/db/seed.js; node src/app.js`

---

## Recently Fixed Bugs — Do NOT Reintroduce

| Bug | Where Fixed | Pattern |
|-----|------------|---------|
| Silent SMS failure | routes/ros.js `queueStatusSMS` | `catch (_) {}` swallowing all errors |
| Auth bypass in DELETE | Any route with DELETE | SELECT checks shop_id but DELETE doesn't |
| SMS test always returns 200 | routes/sms.js `/test` | Error path never returned HTTP 502 |
| Tracking token gate killing SMS | routes/ros.js | Hard bail if no tracking token |
| Twilio API Key not supported | services/sms.js | Only Auth Token was handled |

---

## QA Checklist — Check Every Diff

- [ ] Every DELETE/UPDATE includes `AND shop_id = $N` (not just the SELECT)
- [ ] No `catch (_) {}` or `catch (e) {}` with empty body
- [ ] No `catch` that only does `console.log` with no error return
- [ ] Input validation on all user-facing fields (phone numbers, amounts, text)
- [ ] SMS sends log their outcome (success SID or error reason)
- [ ] New routes have `auth` middleware
- [ ] Admin-only routes have `requireAdmin` middleware
- [ ] No hardcoded shop IDs or user IDs
- [ ] New DB queries parameterized (no string interpolation)

---

## Updates: 2026-03-22 to 2026-03-23

### Role/Access Behavior (Global, not sample-user specific)

- Access controls are role-based (`owner`, `admin`, `assistant`, `employee`, `staff`, `technician`) and apply to any shop/user created in production.
- Assistant restrictions were tightened in multiple views (cannot access owner-only settings/admin management paths).
- Technician/employee flows were updated to remove finance-sensitive actions from their RO experience.

### RO Detail / Header / Workflow

- RO header was redesigned into a cleaner card layout with better spacing and visual hierarchy.
- `Download Invoice` button was removed from RO header.
- Invoice open action remains via `Invoice` button (`/invoice/:id`) for shared viewing flow.
- Tech assignment behavior supports override warning when a tech is not currently assigned and proceeds with admin notification.
- Full vehicle editing support was expanded in RO edit mode (year/make/model/color/plate/mileage/VIN fields).
- RO progress strip now shows all stage labels under color segments (not only intake/delivery endpoints).

### Storage Hold

- Storage Hold page now supports edit-in-place flow for owner/admin/assistant roles.
- Non-admin financial totals in storage views were reduced for staff-facing access.

### ADAS / Operations Click-through

- ADAS queue cards are now clickable and route directly to the target RO.
- Technician-role nav handling includes `technician` in the restricted employee-role pathing logic where applicable.

### Language / Localization

- Language system now supports whole-app translation pass (not sidebar-only) by combining:
  - Key-based translations (`t('...')`) and
  - Literal UI text mapping pass for non-keyed strings.
- Global translation runs on render/mutation updates and applies to visible text and key attributes.
- Language toggle is explicitly excluded from auto-translation (`data-no-auto-i18n`) so it always shows the correct flag/code state.
- Language toggle rendering now uses emoji font fallbacks for reliable `US/MX` flag visibility across owner/assistant/tech views.

### Notes for Future Builders

- Do not reintroduce sample-account assumptions in frontend conditionals.
- Keep role gating centralized around role values from JWT payload, not user IDs or seeded demo emails.
- Any new user-facing literal text should either:
  - use `t('...')` keys, or
  - be added to the literal map if immediate full-page bilingual behavior is required.

---

## QA Report — 2026-03-23

**Commit:** 595b5bb — QuickBooks, SMS provisioning, dark/light theme, grouped nav, schedule overnight, RO detail enhancements
**Reviewer:** CW2 Claude Code | **Verdict: RELEASE READY** (3 MEDIUM items to track)

### Checklist Results

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Backend routes scoped to shop_id | PASS | All new routes (accounting.js, QB service, SMS provisioning) use req.user.shop_id throughout |
| 2 | bcryptjs only (no bcrypt) | PASS | timeclock.js and auth.js both use `require('bcryptjs')` |
| 3 | Missing error handling / server crash risk | PASS | All new routes have try/catch; setImmediate QB sync has console.error logging |
| 4 | QuickBooks OAuth state validated | PASS | HMAC-SHA256 signed state via JWT_SECRET + 10-min TTL; callback verifies before using shop_id |
| 4b | QB tokens stored securely / no leaks | PASS | Tokens stored only in shops table; connectionStatus() returns metadata only, never raw tokens |
| 4c | QB shop_id scoped | PASS | Every QB DB query uses shopId parameter |
| 5 | SMS provisioning scoped per shop | PASS | provisionSmsSenderForShop() queries and updates only the given shopId |
| 6 | ThemeContext null check | WARN | useTheme() returns null if called outside ThemeProvider; no guard in hook itself. Low risk: ThemeProvider wraps entire app in App.jsx |
| 7 | Route guards edge cases | WARN | See issues below |
| 8 | Schedule overnight shifts edge cases | PASS | addDaysIso uses UTC; midnight boundary handled; same-time validation added |
| 9 | console.log in production files | PASS | Only console.error calls present (error logging, acceptable) |
| 10 | Hardcoded URLs / test credentials | PASS | All credentials via env vars; DEFAULT_APP_URL is production URL, not a credential |
| 11 | DB schema backward compatible | WARN | See schema issue below |
| 12 | Frontend dist updated correctly | PASS | Old index-Cwv63eNs.js/css removed; new index-BFejelpL.js/css added |

### MEDIUM Findings

**M1 — Schema type mismatch: `unscheduled_approved_at`**
- `db/index.js:228` CREATE TABLE defines it as `TEXT`
- `db/index.js:379` and `schema.pg.sql:214` define it as `TIMESTAMPTZ`
- **Impact:** Fresh installs get wrong column type. Production (Railway) is unaffected — ALTER TABLE IF NOT EXISTS runs correctly on existing DB. Fix before next fresh-install or developer onboarding.

**M2 — ADAS Calibration lost AdminRoute guard (frontend only)**
- Old: `<AdminRoute><ADASCalibration /></AdminRoute>`
- New: `<ADASCalibration />` — accessible to all authenticated users including technicians/employees
- `App.jsx` line for `adas` route. Backend doesn't gate ADAS data, so technicians can now view the ADAS queue. Likely intentional per ADAS clickthrough update but worth confirming.

**M3 — `assistant` role promotion opens subscriptions/settings-reset backend routes**
- `roles.js`: assistant promoted from rank 1 → rank 3 (same as admin). `requireAdmin` middleware now passes for assistants.
- `subscriptions.js`: assistants can now hit `/status`, `/checkout`, `/portal` endpoints
- `settings.js`: assistants can now hit `/reset/:section` (bulk data reset)
- Frontend gatekeeps Settings behind `OwnerRoute`, so no UI exposure. But backend is permissive.
- If an assistant account were compromised or used with a custom client, they could initiate billing changes or reset shop data.
- **Recommendation:** Add `disallowAssistant` to subscriptions.js and settings.js reset endpoint, matching the pattern used in users.js.

### INFO

- `smsProvisioning.js` is a complete service but not wired to any route yet. It's dead code until a provisioning endpoint is added. No security risk, just incomplete feature.
- `createNotification` helper is duplicated locally in `timeclock.js` vs `services/notifications.js`. Minor code smell.
- `goals.js` local `requireAdmin` explicitly checks `['owner', 'admin']` only (assistant blocked). Good defensive pattern that others should follow.

### Recently Fixed in This Build (add to fixed bugs table)

| Date | Issue | Commit | Type |
|------|-------|--------|------|
| 2026-03-23 | Assistant role-rank raised to 3 (admin-level); users.js gates added via disallowAssistant | 595b5bb | Security/Access |
| 2026-03-23 | RO assign endpoint: tech override sends admin notification instead of silently proceeding | 595b5bb | Audit |
| 2026-03-23 | Schedule: time validation rejects same-start-as-end, invalid format; overnight shifts detected | 595b5bb | Validation |

---

## Dispatch Log — 2026-04-05 (America/New_York)

### DONE + VERIFIED

1. **RO Calendar month label stuck on April**
   - Scope: month label did not update when navigating months.
   - Files: `frontend/src/contexts/LanguageContext.jsx`, `frontend/src/pages/Dashboard.jsx`
   - Verification: live `revvshop.app` probe confirmed label moves (`April -> May`, `April -> March`).
   - Status: DONE + VERIFIED

2. **Dashboard Active/Completed parity**
   - Scope: dashboard totals must match open/closed RO counts.
   - Files: `frontend/src/pages/Dashboard.jsx`, `backend/src/routes/ros.js`
   - Verification: live dashboard checks + RO list logic validation.
   - Status: DONE + VERIFIED

3. **Dynamic UI shield from auto-i18n rewrites**
   - Scope: prevent auto-translation from freezing dynamic text.
   - Files: `frontend/src/pages/Dashboard.jsx`
   - Verification: month nav and dynamic counters remain stable after translation pass.
   - Status: DONE + VERIFIED

4. **Regression tests for calendar/count logic**
   - Scope: lock in month-nav and active/completed behavior.
   - Files: `frontend/vite.config.js`, `frontend/package.json`, `frontend/src/test/setupTests.js`, `frontend/src/pages/__tests__/Dashboard.regression.test.jsx`
   - Verification: `cd frontend && npm run test:run` (2 passing tests).
   - Status: DONE + VERIFIED

5. **Triage bundle command**
   - Scope: one-command diagnostics package to speed future issue reports.
   - Files: `scripts/triage-bundle.sh`, `package.json`, `scripts/README.md`
   - Verification: `npm run triage:bundle -- --no-network --issue "self-test triage"` generated bundle + tarball in `~/triage-bundles`.
   - Status: DONE + VERIFIED

---

## Dispatch Log — 2026-05-27 Approval Link Clipboard Fallback

**Status:** DONE + VERIFIED + DEPLOYED

**Scope:** Fix false "Could not generate approval link" failures when the backend generated the link successfully but browser clipboard access was denied/unavailable.

**Files changed**
- `frontend/src/pages/RODetail.jsx` — approval-link generation now keeps the generated link visible and only downgrades the success alert if clipboard copy fails.
- `frontend/src/lib/clipboard.js` — safe clipboard helper that returns false instead of throwing.
- `frontend/src/lib/__tests__/clipboard.test.js` — regression coverage for success, denied clipboard access, and unavailable Clipboard API.

**Verification**
```
cd frontend && npm run test:run  # 11/11 passed
cd frontend && npm run build     # clean production build
```

---

## Dispatch Log — 2026-05-27 Feedback b7f286d6 Assistant Access Required

**Status:** Shipped. Fixed the Parts On Order route returning `assistant access required` for technician/employee-level roles by using the existing technician access gate instead of the assistant/admin gate.

**Files changed**
- `backend/src/routes/parts.js` — changed `/api/parts/all-pending` authorization from `requireAssistant` to `requireTechnician`, matching the page's intended owner/admin/technician/employee/staff access.

**Verification**
```
node --check backend/src/routes/parts.js
cd frontend && npm run test:run   # 11/11 passed
cd frontend && npm run build      # clean production build
```

---

## Dispatch Log — 2026-05-31 Phase 31 User Feedback Fixes

**Status:** Shipped from clean `origin/main` worktree for Railway deployment.

**Scope**
- Total loss now moves into storage/pickup handling: `claim_status = total_loss` sets `status = total_loss`, enables `storage_hold`, and stamps `storage_start_date` only when empty.
- Total-loss UI now says `Total Loss — Storage + Pickup / Release`, explains that repair labor/deductible are not collected, and opens the Storage Hold tab.
- RO photos now resolve relative `/uploads/...` URLs against the app origin and show `Photo unavailable` on image load failure.
- Estimate AI import now sanitizes provider/auth errors at the backend and again in frontend display code. The raw provider 401/key-help text from the user screenshot is no longer rendered or returned.

**Files changed**
- `backend/src/routes/ros.js`
- `backend/src/routes/insuranceOcr.js`
- `frontend/src/components/ClaimStatusCard.jsx`
- `frontend/src/components/ROPhotos.jsx`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/pages/RODetail.jsx`
- `frontend/src/pages/EstimateBuilder.jsx`
- `frontend/src/lib/mediaUrls.js`
- `frontend/src/lib/safeErrors.js`
- Phase 31 regression tests under `frontend/src/**/__tests__`

**Verification**
```
node --check backend/src/routes/ros.js backend/src/routes/photos.js backend/src/routes/insuranceOcr.js backend/src/app.js  # PASS
cd frontend && npm run test:run  # 10 files, 18 tests passed
cd frontend && npm run build     # PASS
rg "sk-proj|platform.openai.com/account/api-keys|Incorrect API key provided" backend/src frontend/src  # zero matches
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist  # clean, no tracked dist
```

**Data safety**
- No local backend boot against protected DB.
- No seed/reset/delete commands.
- Miles Automotive data untouched.

**Railway verification**
- Pushed commit `c1b2b5c` to `main`; Railway deployment `8490c6e5-0156-418d-ab16-26f9f3926aef` is SUCCESS for commit `c1b2b5cee823cc3e552bdbc6d7575b492d0da789`.
- `curl https://revv-production-ffa9.up.railway.app/api/health` → HTTP 200.
- `./scripts/smoke-test.sh https://revv-production-ffa9.up.railway.app` → 6 PASS + 1 WARN (`RESEND_API_KEY` not present in local shell env).
- Live OCR probe with demo auth + synthetic image upload returns `503 {"success":false,"error":"AI estimate extraction is not configured correctly. Please contact support."}`.
- Railway logs for the live probe show sanitized structured OCR logging only: `[InsuranceOCR] Error: { code: 'invalid_api_key' }`.

## Dispatch Log — 2026-05-31 Phase 32 Pre-Launch Hardening

**Status:** shipped; awaiting verification

**Time**
- 2026-05-31 20:59:13 EDT
- 2026-06-01 00:59:13 UTC

**Scope**
- Assistant-role backend bypass patched for subscription and settings reset gates.
- ADAS backend reads patched with admin authorization; frontend `/adas` route was already wrapped in `AdminRoute` at dispatch start.
- `unscheduled_approved_at` schema drift patched with an idempotent TIMESTAMPTZ migration guard; `db/index.js` and `schema.pg.sql` already matched.
- Claim-status banners patched to derive Total Loss and SIU warnings from either workflow status or claim status.
- ROPhotos load failures now render visibly, stale failed-photo state resets on RO changes, and backend-derived photo alerts use sanitized external error messaging.
- OCR provider failure monitoring shipped through `notifyOps`, with throttled Discord webhook delivery and sanitized context only.

**Files changed**
- `backend/src/middleware/roles.js`
- `backend/src/routes/subscriptions.js`
- `backend/src/routes/settings.js`
- `backend/src/routes/adas.js`
- `backend/src/db/migrate.js`
- `backend/src/routes/insuranceOcr.js`
- `backend/src/services/notifyOps.js`
- `frontend/src/components/ClaimStatusCard.jsx`
- `frontend/src/components/ROPhotos.jsx`
- Backend tests under `backend/src/__tests__`
- Frontend regression tests under `frontend/src/components/__tests__`

**Verification**
```
node --check backend/src/routes/subscriptions.js backend/src/routes/settings.js backend/src/routes/adas.js backend/src/middleware/roles.js backend/src/db/index.js backend/src/db/migrate.js backend/src/routes/insuranceOcr.js backend/src/services/notifyOps.js  # passed
node --test backend/src/__tests__/role-guards.test.js backend/src/__tests__/insuranceOcr.notifyOps.test.js  # 4 tests passed
cd frontend && npm run test:run  # 11 files, 20 tests passed
cd frontend && npm run build  # production build passed with existing chunk-size warnings
rg "sk-proj|platform.openai.com/account/api-keys|Incorrect API key provided" backend/src frontend/src  # zero matches
git diff --check  # passed
```

**Data safety**
- No production DB writes, seed/reset commands, or destructive SQL were run.
- Miles Automotive data untouched.
- No push performed from this branch.

## Dispatch Log — 2026-06-01 Feedback 6d314a80 OpenAI 401 Auto-Report Sanitization

**Status:** built + verified; ready to ship

**Time**
- 2026-06-01 12:43:16 EDT
- 2026-06-01 16:43:16 UTC

**Scope**
- Auto-feedback reporter now sanitizes provider credential errors before Sentry breadcrumbs, feedback payloads, and alert display.
- Feedback API now sanitizes inbound OpenAI/API-key failure text before inserting feedback rows, preventing raw provider key fragments from being stored if a caller misses frontend wrapping.
- Added frontend and backend regressions for the exact `[AUTO] 401 Incorrect API key provided: sk-proj-...` feedback shape.

**Files changed**
- `backend/src/routes/feedback.js`
- `backend/src/__tests__/feedback.sanitize.test.js`
- `frontend/src/lib/errorReporter.js`
- `frontend/src/lib/__tests__/errorReporter.test.js`
- `CLAUDE.md`

**Verification**
```
node --test src/__tests__/feedback.sanitize.test.js src/__tests__/insuranceOcr.notifyOps.test.js src/__tests__/role-guards.test.js  # 5 tests passed
cd frontend && npm run test:run -- src/lib/__tests__/errorReporter.test.js src/lib/__tests__/phase31Safety.test.js  # 2 files, 5 tests passed
npm run build  # production build passed with existing chunk-size warnings
node --check backend/src/routes/feedback.js && git diff --check  # passed
rg "Incorrect API key provided|platform\\.openai\\.com/account/api-keys|sk-proj" backend/src frontend/src -g '!**/__tests__/**'  # zero production-code matches
```

**Data safety**
- No production DB writes, seed/reset commands, or destructive SQL were run.
- No customer/shop production data was mutated.

## Dispatch Log — 2026-06-01 Dashboard Supplement Access + RO Resume Scoping

**Status:** built + verified; commit blocked by sandbox `.git` write restriction

**Time**
- 2026-06-01 12:54:21 EDT
- 2026-06-01 16:54:21 UTC

**Scope**
- Dashboard supplement monthly opportunity aggregate is restricted to `owner`, `admin`, and `superadmin`; authenticated non-admin roles receive 403.
- SIU/total-loss resume read-back now includes `AND shop_id = $2` with `req.user.shop_id` after the shop-scoped update.

**Files changed**
- `backend/src/routes/dashboard.js`
- `backend/src/routes/ros.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/dashboard.js backend/src/routes/ros.js
cd backend && node --test src/__tests__/feedback.sanitize.test.js src/__tests__/insuranceOcr.notifyOps.test.js src/__tests__/role-guards.test.js  # 5/5 passed
cd frontend && npm run test:run  # 11 files, 21/21 tests passed
git diff --check
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Phase 3 Floor Mode

**Status:** built + verified

**Time**
- 2026-06-01 13:05:22 EDT
- 2026-06-01 17:05:22 UTC

**Scope**
- Added `/floor` technician tablet route showing the logged-in tech's active assigned ROs grouped by parts, repair, paint, and QC.
- Added one-tap optimistic status advance through parts -> repair -> paint -> QC -> delivery using the existing status-update endpoint with rollback/error handling.
- Added floor clock in/out control via existing timeclock endpoints and quick photo access via `ROPhotos`.
- Added technician-only nav entry and aligned technician role access for the existing tech route guard.

**Files changed**
- `frontend/src/pages/FloorMode.jsx`
- `frontend/src/pages/__tests__/FloorMode.test.jsx`
- `frontend/src/App.jsx`
- `frontend/src/components/Layout.jsx`
- `frontend/src/pages/TechView.jsx`
- `CLAUDE.md`

**Verification**
```
cd frontend && npm run test:run  # 12 files, 23/23 tests passed
cd backend && node --test src/__tests__/*.test.js  # 5/5 tests passed
cd frontend && npm run build  # production build passed with existing chunk-size warnings
cd frontend && npm run test:run -- FloorMode.test.jsx  # 1 file, 2/2 tests passed after final text tweak
git diff --check  # passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Phase 4 Owner Truth / KPI Dashboard

**Status:** built + verified

**Time**
- 2026-06-01 15:29:29 EDT
- 2026-06-01 19:29:29 UTC

**Scope**
- Added owner/admin-gated `/api/dashboard/owner-kpis` aggregate for missing KPI data only: cycle time by stage from `job_status_log`, supplement captured/requested totals, and tech throughput.
- Added `/owner-kpis` frontend view that composes the new aggregate with existing supplement opportunity, job-costing, carryover, and turnaround-estimator APIs.
- Added owner/admin nav entry under Financial and route guard using existing `OwnerRoute`.

**Files changed**
- `backend/src/routes/dashboard.js`
- `frontend/src/pages/OwnerKpis.jsx`
- `frontend/src/App.jsx`
- `frontend/src/components/Layout.jsx`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/dashboard.js  # passed
cd backend && node --test src/__tests__/*.test.js  # 5/5 passed
cd frontend && npm run test:run  # 12 files, 23/23 passed
cd frontend && npm run build  # production build passed with existing chunk-size warnings
git diff --check  # passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- New backend queries are parameterized and scoped through `req.user.shop_id`.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Phase 4 Owner KPI QA Fixes

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 15:38:40 EDT
- 2026-06-01 19:38:40 UTC

**Scope**
- Fixed Owner KPIs supplement capture card to render backend `supplement_capture.capture_rate` directly.
- Allowed `superadmin` through the Owner KPI frontend route path to match the backend owner KPI guard.
- Added explicit KPI period labels for the backend query windows.
- Added frontend regression coverage for backend-provided supplement capture rate rendering.

**Files changed**
- `frontend/src/pages/OwnerKpis.jsx`
- `frontend/src/pages/__tests__/OwnerKpis.test.jsx`
- `frontend/src/App.jsx`
- `CLAUDE.md`

**Verification**
```
cd frontend && npm run test:run -- OwnerKpis.test.jsx  # 1 file, 1/1 passed
cd frontend && npm run test:run  # 13 files, 24/24 passed
cd backend && node --test src/__tests__/*.test.js  # 5/5 passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- No backend query changes were made.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Consolidated Hardening Backlog

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 22:34:58 EDT
- 2026-06-02 02:34:58 UTC

**Scope**
- Forced technician-rank `/ros` list callers to their own `assigned_to` filter while preserving owner/admin/manager/superadmin filtering within shop scope.
- Updated insurance OCR rate-limit IP fallback to use express-rate-limit `ipKeyGenerator`, preserving the primary `shop_id:user_id` key path and eliminating the IPv6 key-generator validation warning.
- Rewrote Owner KPI tech-efficiency join to cast guarded `job_status_log.changed_by` UUID values instead of casting `users.id`.
- Added FloorMode regression coverage for failed optimistic `qc -> delivery` advancement restoring the card and surfacing the API error.
- Skipped optional OwnerKpis dependency/i18n items to avoid behavior drift and broader string-scope changes.

**Files changed**
- `backend/src/routes/ros.js`
- `backend/src/routes/insuranceOcr.js`
- `backend/src/routes/dashboard.js`
- `backend/src/__tests__/insuranceOcr.notifyOps.test.js`
- `frontend/src/pages/__tests__/FloorMode.test.jsx`
- `CLAUDE.md`

**Verification**
```
cd backend && node --test src/__tests__/*.test.js  # 7/7 passed; no ERR_ERL_KEY_GEN_IPV6 output
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Backend query changes remain parameterized and scoped through `req.user.shop_id`.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 ROS Assigned-To Role-Rank QA Fix

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 22:41:43 EDT
- 2026-06-02 02:41:43 UTC

**Scope**
- Changed GET `/ros` assigned-to filtering permission from a hardcoded role list to role-rank based admin-tier access, preserving explicit `superadmin` filtering.
- Added regression coverage that assistant callers can filter arbitrary `assigned_to` values within shop scope while technician callers are forced to their own user id.

**Files changed**
- `backend/src/middleware/roles.js`
- `backend/src/routes/ros.js`
- `backend/src/__tests__/ros.assignedToScope.test.js`
- `CLAUDE.md`

**Verification**
```
node --check src/routes/ros.js src/middleware/roles.js src/__tests__/ros.assignedToScope.test.js  # passed
cd backend && node --test src/__tests__/*.test.js  # 9/9 passed
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- GET `/ros` query remains parameterized and scoped through `req.user.shop_id`.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Dashboard Live 500 Fixes

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 23:36:44 EDT
- 2026-06-02 03:36:44 UTC

**Scope**
- Fixed GET `/api/dashboard/weekly` top-tech query by casting legacy/text `actual_delivery` values to `timestamptz` before the fallback to `updated_at`.
- Cast weekly `assigned_to`/`users.id` comparison through text to avoid schema-history UUID/text join failures.
- Fixed GET `/api/dashboard/owner-kpis` cycle-time timestamp expressions by normalizing `job_status_log.created_at` and `repair_orders.updated_at` to `timestamptz`.
- Changed owner KPI tech-efficiency user join to compare text IDs after UUID-format validation instead of casting `job_status_log.changed_by` to UUID.
- Added backend dashboard smoke coverage for empty-shop JSON responses and Postgres-safe query shape.

**Files changed**
- `backend/src/routes/dashboard.js`
- `backend/src/__tests__/dashboard.postgresShape.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/dashboard.js backend/src/__tests__/dashboard.postgresShape.test.js  # passed
node --test backend/src/__tests__/*.test.js  # 11/11 passed
cd frontend && npm run test:run  # 14 files, 26/26 passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Dashboard queries remain parameterized and scoped through `req.user.shop_id`.
- Owner/admin and technician gating remain intact.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Owner KPI Timestamp Cast QA Fix

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 23:44:07 EDT
- 2026-06-02 03:44:07 UTC

**Scope**
- Fixed GET `/api/dashboard/owner-kpis` tech-efficiency date window to cast `job_status_log.created_at` through `NULLIF(l.created_at::text, '')::timestamptz` before comparing to `DATE_TRUNC('month', NOW())`.
- Extended dashboard Postgres shape coverage to assert the tech-efficiency predicates are cast and that no raw `l.created_at` comparisons remain in the owner KPI SQL captured by the route.

**Files changed**
- `backend/src/routes/dashboard.js`
- `backend/src/__tests__/dashboard.postgresShape.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/dashboard.js backend/src/__tests__/dashboard.postgresShape.test.js  # passed
node --test backend/src/__tests__/dashboard.postgresShape.test.js  # 2/2 passed
node --test backend/src/__tests__/*.test.js  # 11/11 passed
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Dashboard queries remain parameterized and scoped through `req.user.shop_id`.
- Owner/admin gating remains intact.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-02 SMS Compliance Footer + Consent Capture

**Status:** DONE + VERIFIED

**Time**
- 2026-06-02 12:11:19 EDT
- 2026-06-02 16:11:19 UTC

**Scope**
- Added centralized outbound customer-facing SMS opt-out footer handling in `sendSMS`, with dedupe-safe detection for existing STOP opt-out language.
- Marked the late clock-in admin SMS as internal so it does not receive customer compliance language.
- Added `customers.sms_consent BOOLEAN DEFAULT TRUE` through the idempotent PostgreSQL migration path and fresh schema.
- Added RO intake consent capture in `AddROModal` for new and existing customers, persisting the value without changing SMS send gating.
- Stored the final footer-appended outbound SMS body in SMS thread routes when messages are logged.

**Files changed**
- `backend/src/services/sms.js`
- `backend/src/routes/sms.js`
- `backend/src/routes/timeclock.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/ros.js`
- `backend/src/db/migrate.js`
- `backend/src/db/schema.pg.sql`
- `backend/src/__tests__/sms-compliance.test.js`
- `frontend/src/components/AddROModal.jsx`
- `CLAUDE.md`

**Verification**
```
cd backend && node --test src/__tests__/*.test.js  # 15/15 passed
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No seed, reset, or destructive scripts were run.
- Schema change is additive and idempotent: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT TRUE`.
- Customer consent updates remain parameterized and scoped through `req.user.shop_id`.
- Existing SMS send behavior is unchanged except for required compliance footer content.

## Dispatch Log — 2026-06-02 One-Time SMS Opt-In Confirmation

**Status:** DONE + VERIFIED

**Time**
- 2026-06-02 13:34:46 EDT
- 2026-06-02 17:34:46 UTC

**Scope**
- Added a reusable customer opt-in confirmation send helper using the existing SMS send path and shop-scoped Twilio lookup.
- Sent the confirmation only when a newly created customer is opted in and has a non-empty phone number.
- Routed estimate-import RO customer creation through the same helper after transaction commit.
- Verified the exact confirmation text does not receive a duplicate STOP/HELP footer.

**Files changed**
- `backend/src/services/customerOptInConfirmation.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/ros.js`
- `backend/src/__tests__/customerOptInConfirmation.test.js`
- `backend/src/__tests__/sms-compliance.test.js`
- `CLAUDE.md`

**Verification**
```
cd backend && node --test src/__tests__/*.test.js  # 20/20 passed
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- New calls reuse existing parameterized customer insert paths and `req.user.shop_id`.
- SMS send failures are logged with `[SMS Opt-In Confirmation]` and do not fail create requests.

## Dispatch Log — 2026-06-03 Inspection Photo + Claim Evidence Fixes

**Status:** DONE + VERIFIED

**Scope**
- Fixed claim tracker `users` joins by comparing `users.id::text` to text audit columns, resolving the live `operator does not exist: text = uuid` failure without schema changes.
- Stopped claim tracker routes from returning raw internal database errors to the browser; user-facing responses now use safe messages while server logs keep the diagnostic context.
- Resolved relative claim evidence media URLs with `resolveUploadedMediaUrl`, and added image/video fallback UI for missing Railway upload files.
- Resolved relative pre-dropoff inspection photo URLs in RO Detail, including the full-screen lightbox, and replaced broken-image tiles with a clean `Photo unavailable` fallback.
- Added a focused claim tracker regression test for relative upload URLs, broken evidence fallback, and no browser alerts.

**Files changed**
- `backend/src/routes/claimTracker.js`
- `frontend/src/components/ClaimTrackerPanel.jsx`
- `frontend/src/components/__tests__/ClaimTrackerPanel.phase32.test.jsx`
- `frontend/src/pages/RODetail.jsx`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/claimTracker.js backend/src/app.js backend/src/db/index.js backend/src/services/email.js backend/src/lib/devSafety.js
cd backend && node --test src/__tests__/*.test.js  # 20/20 passed
cd frontend && npm run test:run  # 15 files, 28/28 tests passed
cd frontend && npm run build
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Miles Automotive data was not touched.
- Fix is query/UI only; historical DB rows remain intact.
- Historical upload rows whose local files were already lost by an earlier Railway container/deploy now render a clean unavailable state instead of a broken browser icon. Persistent media storage is still the durable prevention path for future deploys.

## Dispatch Log — 2026-06-18 iPad Landscape Keyboard Visibility

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Added a touch-device landscape fallback for sheet modals so focused RO-entry fields stay visible when iPad Safari's keyboard leaves only a narrow usable viewport.
- When a modal field is focused on touch landscape screens, REVV now compacts the modal, top-aligns the sheet, and pins the active input/select/textarea as a visible typing strip above the keyboard.
- This targets the Add Repair Order workflow shown in Miles Automotive iPad screenshots without changing RO data, customer data, or backend behavior.

**Files changed**
- `frontend/src/index.css`
- `CLAUDE.md`

**Verification**
```
cd frontend && npm run test:run -- src/lib/__tests__/viewport.test.js src/lib/__tests__/keyboardFocus.test.js  # 2 files, 4/4 tests passed
cd frontend && npm run test:run  # 16 files, 33/33 tests passed
cd frontend && npm run build
node --check backend/src/app.js backend/src/db/index.js backend/src/services/email.js backend/src/lib/devSafety.js
rm -rf frontend/dist && git diff --check
curl https://revvshop.app/api/health  # commit 6ca49ab1a7a8753d228734787b9d3c8b03049c77
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
```

## Dispatch Log — 2026-06-23 Estimate Import Reconciliation

**Status:** DONE + VERIFIED

**Scope**
- Reconciled production `main` against the earlier Phase 31 estimate/OCR work before adding more estimate-import code.
- Confirmed the production line already contains the core estimate stack:
  - `/api/insurance-ocr/parse` multi-photo upload via `estimate_image` and `estimate_images`.
  - PDF text extraction with PDF-to-image fallback.
  - Safe AI configuration errors that do not expose provider keys.
  - Mitchell/CCC totals parsing with gross estimate, net estimate, deductible, tax, parts, and labor buckets.
  - Totals fallback line-item generation when detailed OCR rows are unreadable.
  - CIECA BMS XML parse/create flow through `/api/estimate-import`.
  - Import-financials path that maps stored adjuster totals back into RO financial fields.
- No duplicate estimate-import spec/code was added. Next estimate work should extend these existing files/tests instead of rebuilding parallel import paths.
- No backend data changes, migrations, seed, reset, or destructive scripts were run. Miles Automotive data was not touched.

**Files reviewed**
- `backend/src/routes/insuranceOcr.js`
- `backend/src/routes/estimateImport.js`
- `backend/src/routes/estimateLineItems.js`
- `backend/src/routes/ros.js`
- `backend/src/lib/bmsParser.js`
- `backend/test/bmsParser.test.js`
- `backend/test/estimateImport.test.js`
- `backend/test/estimateTotals.test.js`
- `backend/test/estimateFinancials.test.js`
- `frontend/src/components/EstimateImportWizard.jsx`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/pages/EstimateBuilder.jsx`

**Verification**
```
node --check backend/src/routes/insuranceOcr.js
node --check backend/src/routes/estimateImport.js
node --check backend/src/routes/estimateLineItems.js
node --check backend/src/routes/ros.js
node --test backend/test/*.test.js  # 16/16 passed
cd frontend && npm run test:run  # 18 files, 37/37 tests passed
```

## Dispatch Log — 2026-06-23 Master Feedback Agent Workflow

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Turned the `master@revv` help desk from a read-only inbox into a workflow board.
- Added feedback workflow fields for support notes, linked fix/reference, assignment timestamps, resolution timestamps, and update timestamps.
- Added superadmin PATCH workflow endpoint for feedback issues:
  - assign/reassign agent via `routed_to`
  - move status through `new`, `triaged`, `assigned`, `in_progress`, `fixed`, `qa_passed`, `closed`, `wont_fix`
  - store support notes and linked fix references
  - return a paste-ready agent prompt for Codex/Claude/Hermes review
- Updated the master dashboard:
  - open/assigned/closed summary counts
  - open issue alerts instead of all historical feedback
  - status and issue-type filters
  - agent picker
  - Send button that assigns and copies an agent prompt
  - Copy Prompt button
  - Close button
  - support note and linked fix fields
- Completed/closed feedback remains searchable but no longer counts as active owner alerts.
- Legacy feedback rows with status `shipped` are also treated as resolved, preventing already-handled historical items from reappearing as open work.
- Live read-only audit after deployment found 12 resolved `shipped` rows and 10 remaining open `new` rows. The remaining open rows are six estimate-import success notifications stored as bug reports, two customer-delete errors, one supplement-amount validation error, and one Add RO customer-selection validation item.
- No customer, shop, RO, seed, reset, or destructive data scripts were run. Miles Automotive data was not touched.

**Files changed**
- `backend/src/db/index.js`
- `backend/src/db/migrate.js`
- `backend/src/routes/superadmin.js`
- `backend/src/__tests__/superadmin.feedbackWorkflow.test.js`
- `frontend/src/pages/SuperAdminDashboard.jsx`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/superadmin.js
node --check backend/src/db/index.js
node --check backend/src/db/migrate.js
node --check backend/src/__tests__/superadmin.feedbackWorkflow.test.js
node --test backend/src/__tests__/superadmin.feedbackWorkflow.test.js backend/src/__tests__/feedback.sanitize.test.js  # 3/3 passed
node --test backend/test/*.test.js  # 16/16 passed
cd frontend && npm run test:run  # 18 files, 37/37 tests passed
cd frontend && npm run build
curl https://revv-production-ffa9.up.railway.app/api/health  # commit 18b1bdf79646ac7126d9f271978741bb5034d029
curl https://revvshop.app/api/health  # commit 18b1bdf79646ac7126d9f271978741bb5034d029
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
curl https://revv-production-ffa9.up.railway.app/api/health  # commit d1e9f1ae0756c680c298f9d7f1be48065b8e642b
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
Live read-only feedback audit  # 12 resolved shipped rows, 10 open new rows
```

## Dispatch Log — 2026-06-23 Daily Feedback Audit Automation

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Added a daily feedback audit job that runs once after backend startup and then every 24 hours.
- Daily audit auto-closes false-positive estimate-import success notifications that were stored as bug feedback.
- Daily audit auto-assigns remaining unassigned open feedback:
  - feature/idea/question rows route to `Hermes`
  - bug/missing/general rows route to `Codex`
- Daily audit also normalizes legacy agent labels such as lowercase `codex` and moves pre-routed `new` rows into `assigned`, preventing stale routed-but-unworked feedback from sitting open.
- The job only updates `feedback` workflow fields (`status`, `routed_to`, `support_note`, `linked_ref`, `assigned_at`, `resolved_at`, `updated_at`).
- No shop, customer, vehicle, RO, estimate, payment, seed, reset, or destructive data scripts are touched.
- This keeps the `master@revv` command center refreshed daily and prevents open feedback from sitting unassigned.

**Files changed**
- `backend/src/app.js`
- `backend/src/jobs/feedbackDailyAudit.js`
- `backend/src/__tests__/feedbackDailyAudit.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/app.js
node --check backend/src/jobs/feedbackDailyAudit.js
node --check backend/src/__tests__/feedbackDailyAudit.test.js
node --test backend/src/__tests__/feedbackDailyAudit.test.js backend/src/__tests__/superadmin.feedbackWorkflow.test.js backend/src/__tests__/feedback.sanitize.test.js  # 4/4 passed
node --test backend/test/*.test.js  # 16/16 passed
cd frontend && npm run test:run  # 18 files, 37/37 tests passed
cd frontend && npm run build
curl https://revv-production-ffa9.up.railway.app/api/health  # commit 77154d939fd4331ffc7c5334a3a7548d8d752c0a
curl https://revvshop.app/api/health  # commit 77154d939fd4331ffc7c5334a3a7548d8d752c0a
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
Live read-only feedback audit  # 6 estimate-import noise rows closed, 4 open rows assigned to Codex
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Miles Automotive data was not touched.
- Daily automation only updates `feedback` workflow fields.

## Dispatch Log — 2026-06-18 Estimate OCR Provider Fallback

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Confirmed Railway had `OPENAI_API_KEY` present, but provider validation returned 401 invalid key.
- Added Anthropic fallback for estimate OCR when OpenAI is unavailable or misconfigured.
- The fallback covers all estimate extraction paths in `backend/src/routes/insuranceOcr.js`: PDF text extraction, PDF image extraction, and direct image/photo uploads.
- Both user-facing upload flows use this route, so Estimate Builder import and RO Insurance import now share the same fallback behavior.

**Files changed**
- `backend/src/routes/insuranceOcr.js`
- `backend/src/__tests__/insuranceOcr.notifyOps.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/insuranceOcr.js backend/src/app.js backend/src/db/index.js backend/src/services/email.js backend/src/lib/devSafety.js
cd backend && node --test src/__tests__/*.test.js  # 27/27 tests passed
cd frontend && npm run test:run  # 16 files, 33/33 tests passed
cd frontend && npm run build
rm -rf frontend/dist && git diff --check
curl https://revvshop.app/api/health  # commit 05ea7e3324e93a97af44df69e9bc36934572ed3a
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
POST /api/insurance-ocr/parse with synthetic estimate image  # success:true, 3 line items, claim/vehicle/VIN parsed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Miles Automotive data was not touched.
- Live OCR probe used a synthetic estimate image and demo auth only.

## Dispatch Log — 2026-06-18 Estimate OCR Zero-Line Retry

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Added a second-pass estimate OCR prompt when the first extraction returns zero line items.
- Added backend normalization for AI line-item output so empty descriptions are dropped and operation-code classification still applies.
- Added totals-derived fallback rows when the detailed estimate table is unreadable but totals are visible, preventing the frontend from immediately showing "No line items were extracted" for summary-only or hard-to-read uploads.
- Covers both Supplement Finder upload and RO Insurance import because both use `/api/insurance-ocr/parse`.

**Files changed**
- `backend/src/routes/insuranceOcr.js`
- `backend/src/__tests__/insuranceOcr.notifyOps.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/insuranceOcr.js backend/src/app.js backend/src/db/index.js backend/src/services/email.js backend/src/lib/devSafety.js
cd backend && node --test src/__tests__/*.test.js  # 28/28 tests passed
cd frontend && npm run test:run  # 16 files, 33/33 tests passed
cd frontend && npm run build
rm -rf frontend/dist && git diff --check
curl https://revvshop.app/api/health  # commit de7ba1b1cbcfbb71e2e41a506dc0ad1db0b035e4
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
POST /api/insurance-ocr/parse with synthetic detailed estimate image  # success:true, 3 line items
POST /api/insurance-ocr/parse with synthetic totals-only estimate image  # success:true, 5 line items
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Miles Automotive data was not touched.
- Live OCR probes used synthetic estimate images and demo auth only.

## Dispatch Log — 2026-06-18 Multi-Photo Estimate Import

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Updated `/api/insurance-ocr/parse` to accept up to 12 files via `estimate_image` and `estimate_images`, while preserving the old single-file field name.
- Combined multiple estimate photos/PDF pages into one AI extraction request so multi-page estimates can be captured/imported together.
- Updated estimate import surfaces to allow multi-select uploads:
  - RO Insurance import panel
  - Supplement Finder upload
  - Estimate Builder import
  - Estimate Import Wizard
- Added an "Add another photo / PDF" loop in the RO Insurance import panel for iPad/Safari camera capture flows that return one photo at a time.

**Files changed**
- `backend/src/routes/insuranceOcr.js`
- `backend/src/__tests__/insuranceOcr.notifyOps.test.js`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/components/SupplementFinderPanel.jsx`
- `frontend/src/pages/EstimateBuilder.jsx`
- `frontend/src/components/EstimateImportWizard.jsx`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/insuranceOcr.js backend/src/app.js backend/src/db/index.js backend/src/services/email.js backend/src/lib/devSafety.js
cd backend && node --test src/__tests__/*.test.js  # 28/28 tests passed
cd frontend && npm run test:run  # 16 files, 33/33 tests passed
cd frontend && npm run build
rm -rf frontend/dist && git diff --check
curl https://revvshop.app/api/health  # commit 58d063c3efcf410ae9fe0552eeed54cf62dc06d0
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
POST /api/insurance-ocr/parse with two synthetic estimate page photos in one request  # success:true, 4 line items, claim/vehicle parsed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Miles Automotive data was not touched.
- Live OCR probe used synthetic estimate images and demo auth only.

## Dispatch Log — 2026-06-18 Estimate Import Modal Sidebar Visibility

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Fixed the Estimate Builder insurance import review modal rendering underneath the desktop sidebar on iPad/tablet landscape.
- Raised that modal overlay above app chrome so the full line-item selection modal is visible, including the left side hidden in Miles Automotive's screenshot.

**Files changed**
- `frontend/src/pages/EstimateBuilder.jsx`
- `CLAUDE.md`

**Verification**
```
cd frontend && npm run test:run -- src/pages/__tests__/EstimateBuilder.phase31.test.jsx  # 1/1 test passed
cd frontend && npm run build
node --check backend/src/app.js backend/src/db/index.js backend/src/services/email.js backend/src/lib/devSafety.js
rm -rf frontend/dist && git diff --check
curl https://revvshop.app/api/health  # commit beb3f191879814db743b84806d6bac9eb248f422
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Miles Automotive data was not touched.
- UI-only z-index fix.

## Dispatch Log — 2026-06-18 Estimate Profit + Deductible Fixes

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Fixed Mitchell/NY-market estimate totals parsing so `Gross Total`, `Net Estimate Total`, negative deductible adjustments, taxable parts, paint materials, and body/refinish/frame/glass/mechanical labor map into the correct OCR totals.
- Updated imported estimate financials to prefer stored adjuster totals when present, writing RO `parts_cost`, `labor_cost`, `sublet_cost`, `tax`, gross `total`, `estimate_amount`, and `deductible` from the estimate totals page instead of relying only on line-item rollups.
- Fixed deductible save from the RO insurance panel: deductible is now sent/stored as dollars, not multiplied into cents.
- Added Profit (NY Market) edit/display fields for tax, gross estimate, deductible, and net estimate directly on the RO.
- Kept Miles Automotive data untouched; no seed/reset/destructive scripts were run.

**Expected screenshot case**
- Labor: `$2,790.00`
- Gross estimate: `$9,969.25`
- Deductible: `$1,000.00`
- Net estimate: `$8,969.25`

**Files changed**
- `backend/src/routes/insuranceOcr.js`
- `backend/src/routes/estimateLineItems.js`
- `backend/src/routes/ros.js`
- `backend/test/estimateTotals.test.js`
- `backend/test/estimateFinancials.test.js`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/components/__tests__/InsurancePanel.phase31.test.jsx`
- `frontend/src/pages/RODetail.jsx`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/insuranceOcr.js
node --check backend/src/routes/estimateLineItems.js
node --check backend/src/routes/ros.js
node --test backend/test/*.test.js  # 10/10 passed
cd frontend && npm run test:run  # 16 files, 34/34 tests passed
cd frontend && npm run build
rm -rf frontend/dist && git diff --check
curl https://revv-production-ffa9.up.railway.app/api/health  # commit 2c5afd60a40fc283afda2ccc574b8f5bb95d113b
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
POST /api/insurance-ocr/parse with synthetic Mitchell totals image  # success:true, gross 9969.25, deductible 1000, net/revenue 8969.25, labor_sum 2790
```

## Dispatch Log — 2026-06-19 Claim Tracker + Bulk Status ID Cast Fixes

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Fixed Claim Tracker load failures caused by mixed TEXT/UUID production columns by comparing RO, shop, user, evidence, contact, and dispute IDs as text on both sides.
- Fixed Repair Orders bulk status update failures by removing `::uuid[]` casts and comparing selected RO IDs as text.
- Stopped bulk status failures from leaking raw PostgreSQL operator errors into the frontend toast; the API now logs the internal error and returns `Bulk status update failed`.
- No data changes, migrations, seed, reset, or destructive scripts were run. Miles Automotive data was not touched.

**Files changed**
- `backend/src/routes/claimTracker.js`
- `backend/src/routes/ros.js`
- `backend/test/typeCastRoutes.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/claimTracker.js
node --check backend/src/routes/ros.js
node --test backend/test/*.test.js  # 12/12 passed
cd frontend && npm run test:run  # 16 files, 34/34 tests passed
cd frontend && npm run build
rm -rf frontend/dist && git diff --check
curl https://revv-production-ffa9.up.railway.app/api/health  # commit 004c6f12e86c5d8d340fac334cadc877b2fbfc11
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
GET /api/claim-tracker/ro/<demo-ro-id>  # 200 JSON with evidence/contacts/disputes arrays
POST /api/repair-orders/bulk-status with fake non-UUID id  # 200 JSON, no uuid/text operator error, no real RO mutation
```

## Dispatch Log — 2026-06-23 Closed Total Loss Display

**Status:** DONE + VERIFIED + DEPLOYED

**Scope**
- Added a derived display status for ROs whose workflow status is `closed` and claim status is `total_loss`.
- Repair Orders and RO Detail now show `Total Loss Closed` for closed total-loss ROs, so closed totals are visually distinct from normal closed repair jobs.
- Normal closed repair jobs still show `Closed`; active total-loss ROs still show `Total Loss`.
- Hid the Mark Total Loss action for already-closed total-loss ROs and kept the total-loss explanatory panel visible after closeout.
- No backend data changes, migrations, seed, reset, or destructive scripts were run. Miles Automotive data was not touched.

**Files changed**
- `frontend/src/components/StatusBadge.jsx`
- `frontend/src/components/__tests__/StatusBadge.totalLoss.test.jsx`
- `frontend/src/pages/RepairOrders.jsx`
- `frontend/src/pages/RODetail.jsx`
- `CLAUDE.md`

**Verification**
```
cd frontend && npm run test:run -- src/components/__tests__/StatusBadge.totalLoss.test.jsx  # 2/2 passed
cd frontend && npm run test:run  # 18 files, 37/37 tests passed
cd frontend && npm run build
node --check backend/src/routes/ros.js
node --test backend/test/*.test.js  # 16/16 passed
rm -rf frontend/dist && git diff --check
curl https://revv-production-ffa9.up.railway.app/api/health  # commit 6092f77ce92a57ae9504f5f3d07949c48427265f
curl https://revvshop.app/api/health  # commit 6092f77ce92a57ae9504f5f3d07949c48427265f
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
```

## Dispatch Log — 2026-06-24 Codex Feedback Inbox Fixes

**Status:** DONE + VERIFIED

**Scope**
- Addressed the 4 remaining real open feedback rows assigned to Codex by the daily feedback audit.
- Customer delete failures now stay inline in Customers instead of falling back to a browser alert, and the delete route compares mixed UUID/TEXT customer/shop IDs as text to avoid production operator-mismatch failures.
- Add RO customer-selection validation now renders inside the modal with `role="alert"` instead of blocking the user with a browser alert.
- Supplement requests validate amount before hitting the API, avoid exposing the internal "in cents" wording, and compare mixed RO/shop IDs as text on the backend.
- No customer, shop, RO, seed, reset, or destructive data mutation was performed. Miles Automotive data was not touched.
- Live feedback records for the 4 Codex-assigned rows were marked `shipped` with linked ref `4ce405f`; the feedback inbox now has 0 `new`/`assigned` rows.

**Files changed**
- `backend/src/routes/customers.js`
- `backend/src/routes/ros.js`
- `frontend/src/components/AddROModal.jsx`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/components/__tests__/AddROModal.feedback.test.jsx`
- `frontend/src/components/__tests__/InsurancePanel.phase31.test.jsx`
- `frontend/src/pages/Customers.jsx`
- `frontend/src/pages/__tests__/Customers.mobile.test.jsx`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/customers.js
node --check backend/src/routes/ros.js
cd frontend && npm run test:run -- src/pages/__tests__/Customers.mobile.test.jsx src/components/__tests__/InsurancePanel.phase31.test.jsx src/components/__tests__/AddROModal.feedback.test.jsx  # 3 files, 7/7 passed
node --test backend/test/*.test.js  # 16/16 passed
cd frontend && npm run test:run  # 19 files, 40/40 passed
cd frontend && npm run build
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist | wc -l  # 0
curl https://revvshop.app/api/health  # commit 4ce405f01418a62d05408f629db7e4dd412fa4ee
curl https://revv-production-ffa9.up.railway.app/api/health  # commit 4ce405f01418a62d05408f629db7e4dd412fa4ee
./scripts/smoke-test.sh  # 6 PASS + 1 documented RESEND_API_KEY local-env WARN
Live feedback audit  # shipped: Codex 4, closed: Codex 6, shipped legacy routed rows 12, open/assigned 0
```

## Dispatch Log — 2026-06-24 Feedback Worker Claude QA Gate

**Status:** READY FOR CLAUDE CODE QA — NOT DEPLOYED

**Scope**
- Closed the QA gap found in Claude's feedback-fixes QA: the feedback marker now has a runtime `QA-PASS-GATE`.
- Updated `/Users/zordon/.openclaw/bin/revv-feedback-mark.sh` and `/Users/zordon/.openclaw/bin/revv-feedback-mark.js` so `shipped` requires a `qa_pass_ref` found near a Claude Code QA PASS entry in this file.
- Added `ready_for_qa` as a bounded feedback status in the marker and triage dispatch flow.
- Updated `/Users/zordon/.openclaw/bin/revv-feedback-triage.sh` so Codex dispatches stop at `ready_for_qa`, post BUILD READY for Claude QA, and do not mark feedback shipped directly.
- Updated REVV SuperAdmin status handling so `ready_for_qa` is accepted by the API, counted with assigned work, and visible in the dashboard.
- No customer, shop, RO, seed, reset, migration, or destructive data mutation was performed. Miles Automotive data was not touched.

**Files changed**
- `/Users/zordon/.openclaw/bin/revv-feedback-mark.sh`
- `/Users/zordon/.openclaw/bin/revv-feedback-mark.js`
- `/Users/zordon/.openclaw/bin/revv-feedback-triage.sh`
- `backend/src/routes/superadmin.js`
- `backend/src/__tests__/superadmin.feedbackWorkflow.test.js`
- `frontend/src/pages/SuperAdminDashboard.jsx`
- `CLAUDE.md`

**Verification**
```
bash -n /Users/zordon/.openclaw/bin/revv-feedback-mark.sh
bash -n /Users/zordon/.openclaw/bin/revv-feedback-triage.sh
node --check /Users/zordon/.openclaw/bin/revv-feedback-mark.js
/Users/zordon/.openclaw/bin/revv-feedback-mark.sh 00000000-0000-0000-0000-000000000000 shipped Codex  # exits 4 with QA-PASS-GATE before DB update
node --check backend/src/routes/superadmin.js
node --test backend/src/__tests__/superadmin.feedbackWorkflow.test.js backend/src/__tests__/feedbackDailyAudit.test.js  # 4/4 passed
node --test backend/test/*.test.js  # 16/16 passed
cd frontend && npm run test:run  # 19 files, 40/40 passed
cd frontend && npm run build
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist | wc -l  # 0
```

**Claude Code QA Prompt**
```text
TASK: REVV — QA feedback worker Claude-QA gate

CONTEXT
Repo: /Users/zordon/.openclaw/workspace/Revv

This change responds to Claude QA's Area 3 partial verification finding: the feedback automation policy said Codex must not mark shipped without Claude QA PASS, but the runtime marker did not enforce that gate.

SCOPE — read-only QA. Do not edit code. Do not mutate customer/shop/RO data. Do not run seed/reset/destructive scripts.

Review these changed files:
- /Users/zordon/.openclaw/bin/revv-feedback-mark.sh
- /Users/zordon/.openclaw/bin/revv-feedback-mark.js
- /Users/zordon/.openclaw/bin/revv-feedback-triage.sh
- backend/src/routes/superadmin.js
- backend/src/__tests__/superadmin.feedbackWorkflow.test.js
- frontend/src/pages/SuperAdminDashboard.jsx
- CLAUDE.md

Verify:
1. `revv-feedback-mark.sh` allows only `ready_for_qa|shipped|new|blocked`.
2. `revv-feedback-mark.js` rejects `NEW_STATUS=shipped` unless `QA_PASS_REF` is provided and appears near a Claude Code QA PASS entry in CLAUDE.md.
3. The no-ref shipped negative test exits with code 4 before any DB update.
4. `revv-feedback-mark.js` compares feedback IDs as text (`id::text = $2::text`).
5. `revv-feedback-triage.sh` tells Codex to stop at `ready_for_qa`, post BUILD READY for Claude QA, and only lets the QA/ship lane call shipped with a QA ref.
6. SuperAdmin backend accepts `ready_for_qa` and counts it with assigned/in-progress work.
7. SuperAdmin dashboard shows `Ready for QA` as a selectable/status badge.
8. No deploy/main push is required until this QA passes.

Commands:
- bash -n /Users/zordon/.openclaw/bin/revv-feedback-mark.sh
- bash -n /Users/zordon/.openclaw/bin/revv-feedback-triage.sh
- node --check /Users/zordon/.openclaw/bin/revv-feedback-mark.js
- /Users/zordon/.openclaw/bin/revv-feedback-mark.sh 00000000-0000-0000-0000-000000000000 shipped Codex ; echo $?
- node --check backend/src/routes/superadmin.js
- node --test backend/src/__tests__/superadmin.feedbackWorkflow.test.js backend/src/__tests__/feedbackDailyAudit.test.js
- node --test backend/test/*.test.js
- cd frontend && npm run test:run
- cd frontend && npm run build
- rm -rf frontend/dist && git diff --check && git ls-files frontend/dist

Expected:
- All checks pass.
- The no-ref shipped command prints QA-PASS-GATE and exits 4.
- No production customer/shop/RO data is touched.
- Verdict should say whether this closes the Area 3 enforcement gap and whether Hermes can review after QA.
```
