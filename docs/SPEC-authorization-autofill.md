# Authorization autofill - 2026-09-27

Build from verified production 9291a5f in codex/revv-autofill-20260927. Existing Miles original clauses stay active; attorney-review PDFs are not production signing templates. Other shops' static uploads remain unchanged.

## Behavior
A tenant-scoped preparation endpoint supplies customer/vehicle/claim details, source-labelled saved RO total and deductible, an estimate snapshot reference, and date of loss where already recorded. Missing values remain explicit staff inputs. A prior date of loss may be reused only for matching customer, VIN and claim. No unreviewed OCR amount becomes an authorization. Staff see the auto-filled summary, confirm monetary values and stage, preview the exact PDF, then create the immutable signing snapshot. Customer only reviews/consents/signs. A source revision detects changes since staff loaded the RO. Existing links and signed documents remain frozen.

## Files / preflight
Existing: backend/src/routes/agreements.js, backend/src/services/milesAgreements.js, frontend/src/components/ROAgreements.jsx, frontend/src/components/__tests__/Agreements.test.jsx, backend/test/agreements.integration.test.js.
To create: backend/src/services/agreementAutofill.js and backend/test/agreementAutofill.test.js.

## Completion gate
Unit + disposable PostgreSQL integration tests for tenant isolation, zero/missing money, source conflicts, date validation, preview/no-write and frozen signatures. Frontend coverage for autofill, review reset, failed loading and RO switching. Production frontend build, independent review, desktop/mobile screenshots of the real component using clearly synthetic customer data, pushed PR, merge/deploy and live commit verification. No lint/typecheck scripts exist. No real customer signing or notifications during QA.

Pending provider activation: inspect existing access without exposing secrets; no replacement for absent credentials is invented. Supplier sync requires named suppliers/provider access. Automatic customer messages require a separate reviewed integration; none are sent by this build.

## Implementation and remaining boundaries
Preparation, preview and create use repeatable-read transactions to resolve a consistent source snapshot. Create verifies the client revision against that snapshot. The UI drops stale asynchronous responses after RO switches and resets review after edits. Manually overridden defaults are explicitly labelled as staff-entered. Missing loss dates are entered by staff once and reused from matching prior authorization records; no date is inferred from intake or today. Preview produces a PDF without a request, event or customer notification.

Revised legal PDFs remain attorney-review artifacts, not activated templates. Their final approved layout will need an approved profile/map; this release does not claim arbitrary uploaded PDFs acquire field mappings automatically. No shop financial or contract wording is changed by autofill.

Provider check: Railway CLI still reports unauthorized on September 27; no production provider credential was changed or printed. Existing GitHub deployment remains usable. External provider activation and supplier synchronization are separate from this release. Supplier names requested; awaiting response. No live external messages sent.
