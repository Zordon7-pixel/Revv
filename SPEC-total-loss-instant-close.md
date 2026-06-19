# SPEC: Total Loss to Instant Close (REVV)

## Goal
Mark an RO Total Loss in one click and immediately close out the workflow (bypass parts/repair/paint/qc/delivery) while KEEPING the financials/profit box editable so the shop can still bill teardown/storage/admin. Option B.

## Pre-flight findings (already true in repo)
- total_loss is ALREADY a valid status: backend/src/routes/ros.js:24 STATUSES array.
- Open-RO count already excludes it: ros.js:1108 status NOT IN (closed,total_loss).
- GAP 1: PUT /:id/status (ros.js:2117) special-cases delivery + closed only. total_loss gets no terminal timestamp or close handling.
- GAP 2: completed/closed list filters (ros.js:824-830) only match closed/completed. total_loss ROs become invisible (neither open nor completed).
- total_loss is NOT in STATUS_SMS_LABELS, so no customer SMS fires. Keep that.

## Non-negotiables
- All writes scoped to shop_id. Never touch Miles or other shops data.
- Reversible: total_loss is just a status; reopening to any pipeline status must work.
- Financials/profit box stay EDITABLE after total_loss (Option B). Do NOT lock invoice or force zero.
- No ready-for-pickup customer SMS on total_loss.

## Phase 1: Backend terminal close
WHAT: Treat total_loss like a terminal/closed state in PUT /:id/status.
HOW: When status==total_loss, stamp a close date (set actual_delivery=today like delivery/closed path). job_status_log already logged. Do NOT call sendClosedPaidInvoiceEmail or paid-invoice (financials stay open). Skip closed-side side-effects except the timestamp. Confirm queueStatusSMS sends nothing for total_loss; add explicit guard if needed.
GATE: PUT status=total_loss returns 200, row shows total_loss + close date, job_status_log row written, no SMS, financials untouched.

## Phase 2: Backend filter/reporting parity
WHAT: total_loss counts as terminal everywhere open/closed is computed.
HOW: ros.js:824-830 and sibling list/count queries include total_loss with closed/completed in the completed bucket and exclude from open/active. Verify dashboard + JobCosting/accounting counts do not drop or double-count total_loss.
GATE: total_loss RO shows in Completed filter, not in open list, open-count math correct.

## Phase 3: Frontend one-click action
WHAT: Mark Total Loss action on RODetail with confirm modal.
HOW: frontend/src/pages/RODetail.jsx add a warning/red Total Loss button available at any pipeline stage. Confirm modal explains it closes the RO and skips repair steps but financials remain editable; optional note textarea sent as note. On confirm PUT /api/ros/:id/status with body status=total_loss and note, refresh RO, show total_loss badge/banner, keep financials panel editable. Reopen via existing status control.
GATE: From any stage Total Loss then confirm shows total_loss, profit box editable, RO leaves active board and shows in completed.

## Phase 4: Tests
- Backend: total_loss sets timestamp, writes log, no paid-invoice email, no SMS, financials row unchanged, shop_id scoping enforced (cannot total another shop RO).
- Filter test: total_loss in completed bucket, out of open bucket, counts correct.
- Frontend: button renders, confirm flow calls endpoint with total_loss, profit box editable after.
GATE: new tests pass, existing ros/status/dashboard tests green.

## Out of scope
No insurer payout accounting. No salvage-value tracking. Future.
