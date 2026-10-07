# Parts customer notifications — phase B, 2026-10-03

## Scope and consent limitation

An unchecked Notify customer control requests an outbound update for that save only. Save-only remains default. Only changed customer-visible status, ETA/source, checked quantities or customer note qualify; supplier/internal-only edits and carrier observations do not. Provider acceptance is not confirmed delivery.

`partsNotifications.js` requires literal channel consent TRUE, a compatible contact preference, a contact value and a shop switch that is not explicitly FALSE. Missing shop switch values do not themselves block sends. SMS additionally enforces plan entitlement and STOP suppression. These are boolean gates, **not proof of positive historical SMS consent**. Older defaults allowed TRUE without a recorded choice. New-path defaults are now FALSE, create requires explicit boolean TRUE, and legacy stored TRUE/FALSE/NULL and STOP records are preserved.

Source inspection of customer schema/migrations, customer/RO writes and STOP/START handling found no trustworthy positive historical SMS consent provenance: no durable link from a TRUE value to who consented, when, by what method and to which disclosure. STOP timestamps record opt-out, not opt-in; START removes suppression without creating that provenance. No tenant/database history was inspected. Parts SMS activation is held pending separate approved re-consent work: collect a fresh explicit in-person choice plus provenance, actual time and disclosure version; never fabricate timestamps or bulk-rewrite legacy values or STOP records.

## Delivery behavior and limits

A permanent unique shop/part/revision claim prevents duplicate sends for one event, including ambiguous outcomes and failed history writes. A separate durable `parts_notification_cooldowns` row enforces a rolling window per **shop/customer/channel**, across parts, revisions, repair orders and application processes. The customer ID comes from the tenant-scoped RO/customer join, never from a phone number or request override. SMS and email windows are independent.

The adopted default is **600 seconds**. Server-only `PARTS_NOTIFICATION_COOLDOWN_SECONDS` accepts an integer from **60 through 3600**; absent, malformed, fractional, nonfinite, negative, zero or out-of-range values fall back to 600. Zero cannot disable the guard. An atomic conditional PostgreSQL UPSERT acquires the window before entering the provider adapter. Database time is authoritative in normal execution; tests can supply a clock through the internal provider dependency, which routes never populate from request data. The exact expiry boundary admits a new explicit event. A skipped event itself stays claimed and is not retried later.

Consent, contact preference, shop switches and missing contacts are checked before cooldown acquisition. Definite adapter pre-send denials with `provider_attempted: false` release only the matching attempt token, so a late denial cannot release another request's newer window. An actual attempted send, timeout, unrecognized failure, malformed acceptance or lost write acknowledgement keeps its window. Failure to record the notification result preserves the pending event claim. Expiry permits a later, distinct explicit update; it never schedules or retries an old event. There are no queues or override controls. The editor explains cooldown skips while reporting the delivery save as successful.

History and API results accept only primitive, exact channel-specific references: SMS `sid` must be uppercase `SM` plus 32 hexadecimal characters (34 total); Resend email `id` must be a 36-character hexadecimal UUID in 8-4-4-4-12 form. No field crossover, coercion, trimming or truncation occurs. Missing, malformed, object, array, oversized and control-character references are excluded from results/history/logs. Apparent acceptance without a verifiable reference becomes `unknown / verify_before_retry`; the permanent event claim prevents automatic resend. Format validation is not cryptographic authentication or proof of delivery. No historical production cleanup is included.

An eight-second wait per channel bounds caller waiting, not provider execution or cancellation. Saving the part survives notification failure. Raw recipient/body and provider error messages are excluded from notification results. Existing status messages, STOP/HELP and auto-reply behavior remain outside this cooldown.

The additive cooldown table is installed by the existing `ensureDelivery` initializer called during database startup. It supports TEXT and UUID parent schemas through scoped text IDs. Preserve both notification claims and cooldown rows during rollback; deleting them can allow duplicate sends. No production migration or configuration change is authorized by this implementation.

## Evidence and activation boundary

The September 27 record reported 15 focused backend tests, 18 disposable PostgreSQL integration tests, 149 frontend tests and a build. These are historical reports, not final-candidate evidence. Current commands and the phase3 mocked privacy result are in [readiness remediation](READINESS-REMEDIATION-20261001.md); final-SHA receipts remain outside source.

OpenAI/eBay/Twilio/Resend remain **LIVE UNKNOWN**, excluded from live verification and activation. No provider calls, real messages, production access or configuration changes occur in this mission. This implementation does not add a runtime activation switch: existing explicit notification requests can still reach configured providers if someone activates/uses them. No newly enabled provider path is introduced here; keep activation held operationally. If future rollout needs an enforceable parts-specific hold, isolate that code scope for Codex rather than disabling unrelated messaging. Hermes owns commit/gates/advisory/final exact-SHA review; implementation and historical QA do not authorize deployment.

## Focused verification commands

Use Node 22 and synthetic providers only. The PG suites create and drop unique per-test schemas in the specified disposable loopback database; never substitute an application database.

```sh
node --test backend/test/partsNotifications.test.js backend/test/partsDelivery.test.js backend/src/__tests__/notificationLogging.privacy.test.js
node --test --test-skip-pattern='real PostgreSQL' backend/test/smsConsent.phase2.test.js
PARTS_TEST_DATABASE_URL=postgresql://revv_panel@127.0.0.1:55459/revv_parts_test node --test backend/test/partsDelivery.integration.test.js backend/test/partsCooldown.integration.test.js
npm --prefix frontend run test:run -- src/components/__tests__/PartDeliveryEditor.test.jsx
```

The cooldown suite covers separate Node processes and pools, restart, tenant/customer/channel isolation, deterministic window boundaries, known eligibility and adapter denials, untrusted references, timeouts, lost claim acknowledgement and failed history persistence. The existing lifecycle suite retains TEXT/UUID, no-op revision and API/history assertions. These commands are implementation checks, not Hermes's final exact-SHA gates or a release verdict.

### Phase B2 adapter evidence

`backend/src/services/sms.js` now emits `provider_attempted: false` on definite local pre-provider denials: missing recipient scope, STOP, absent/unconfirmed consent or provenance, consent/STOP lookup failure, entitlement, missing configuration and missing staff recipient. Existing `ok`, `reason` and body behavior is preserved. Successful sends and caught provider exceptions receive no false marker, even when an exception's text equals a known denial reason or its own properties claim no attempt. The parts consumer still requires both the false marker and its unchanged reason allowlist before releasing only the matching cooldown claim.

`backend/test/smsConsent.phase2.test.js` executes the real SMS module with mocked DB/provider dependencies and an empty adapter environment. It covers every returned denial branch, unchanged valid send/body behavior, provider initialization/send exceptions spoofing denial reasons, and the real parts consumer releasing marked denials while retaining windows for provider failures. Its existing parts acceptance fixture includes the scoped customer ID required by cooldown acquisition. These tests verify adapter integration without external provider access; they do not replace PostgreSQL concurrency tests.

The B2 focused mocked run on Node v22.23.2 passed 49/49 (exit 0); the named real PostgreSQL case was explicitly excluded. A separate `backend/src/__tests__/notificationLogging.privacy.test.js` run returned 8 passed, 1 failed (exit 1): the exact denial-object expectation at line 193 lacks the new `provider_attempted: false` field. That test file is outside B2's three authorized files and remains unchanged for Hermes follow-through. This assertion update and host gates remain pending; no full-suite pass is claimed.

The earlier phase B sandbox PG attempt failed with `connect EPERM 127.0.0.1:55459` before reaching database cases. Hermes subsequently reported 44 backend and 6 frontend checks passing with real loopback PostgreSQL for phase B. Those are prior-phase receipts, not B2 final-candidate evidence. Hermes owns the B2 host parts-PG rerun, complete suite and final exact-SHA gates.
