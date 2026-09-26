# Parts delivery and customer visibility — 2026-09-26

## Scope and completion gate

Build on photo-to-stock PR16 in an isolated worktree. Keep supplier details inside REVV: staff record vendor, supplier order reference, shipment tracking, expected date and its source. Support ordered, backordered, shipped, partially received, received and cancelled orders. Received quantity is shop-confirmed, never inferred from carrier delivery. ETA is an estimate for parts, not a repair completion promise. A staff edit publishes a safe status/ETA/customer note to the existing customer tracking portal; private notes, vendor references, costs and carrier event text stay internal. Portal updates do not send SMS or email. Supplier feeds and automatic outbound notifications require a separate provider/consent integration.

## Files (existing unless marked new)

- backend/src/services/partsDelivery.js (new): idempotent additive schema, validation, transactional saves, revision checks, safe customer projection and summary.
- backend/src/routes/parts.js: staff CRUD, delivery history, pending board.
- backend/src/routes/tracking.js: tenant-safe carrier observations; never auto-receive; discard responses for replaced tracking numbers.
- backend/src/routes/portal.js: safe parts snapshot on customer and token routes.
- frontend/src/components/PartDeliveryEditor.jsx (new): supplier/ETA/receipt editor and history.
- frontend/src/components/CustomerPartsStatus.jsx (new): portal ETA/waiting summary.
- frontend/src/pages/RODetail.jsx, PartsOnOrder.jsx, TrackPortal.jsx: integrate workflow.
- backend/test/partsDelivery.test.js (new), backend/test/partsDelivery.integration.test.js (new), frontend/src/components/__tests__/PartDelivery.test.jsx (new).

## Validation and boundaries

Use disposable localhost revv_parts_test database with isolated schemas for lifecycle, concurrency, tenant/auth and projection tests. Run frontend regression suite/build and independent QA. Push a draft PR stacked on PR16. No production data changes or real customer messages. E-signature PR15 stays separately reviewed and awaiting the shop's agreement PDF. OpenAI remains the only AI provider; this deterministic delivery workflow needs no AI or eBay credentials.

## Delivered and verified

- Supplier order references, ETA/source, shipment number, explicit checked receipt counts, internal notes and separate customer-visible notes are editable from RO Parts and the shop-wide Parts on Order board.
- Partial receipts stay pending; shipped/partially received rows remain in Dashboard pending counts. Closed, completed and total-loss ROs are excluded from the pending board.
- The additive migration runs at startup and on first parts/portal access. Legacy received rows retain their quantity; no historical event is invented. New delivery events record staff/carrier source and before/after snapshots, with a 50-event staff history view. Include this table in database backups/retention.
- Staff updates lock each order and the new editor supplies its loaded revision. Stale edits return 409. Carrier responses apply only if the original tracking number and revision still match; replacing/removing tracking clears old carrier observations. Delivered packages require explicit shop receipt confirmation.
- Both customer portal APIs project only safe parts fields. Token access also verifies token/RO shop ownership. The public tracking page shows confirmed quantities, source-labelled estimated arrival, uncertainty/backorder messaging, and current customer note; a Refresh updates button reloads it. Private notes, purchase costs, supplier references, shipment numbers and provider event text are excluded from parts projections. Parts request payloads are scrubbed from backend/frontend telemetry.
- The workflow does not order from a supplier, infer ETA with AI, promise a vehicle completion date, reserve/increment inventory, or send SMS/email. Existing carrier refresh remains optional and needs the shop's tracking-provider credentials; live external tracking was not exercised.

Verification: 23 new backend tests (including real disposable PostgreSQL with TEXT and UUID IDs), 153 existing backend regression tests, 134 frontend tests, and production frontend build passed. No standalone lint/typecheck scripts exist. Independent review verified the lifecycle and reviewed editor/portal behavior; all findings were fixed. Browser QA used synthetic local data and real PostgreSQL: saved a two-of-four receipt, confirmed customer-visible note/ETA/count, and checked the editor and portal at desktop and 390px phone width. No real customer or production record was touched.

Deployment remains pending with PR16 as this branch's base; e-signatures remain in independent PR15. Rollback tag: phase-parts-delivery-pre-20260926. Retain new columns/history on rollback; do not mix legacy auto-receive tracking writers with this version.
