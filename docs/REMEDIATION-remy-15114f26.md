# Remy remediation — t_3ead3bd0, Phases 3–4

Implementation on `codex/revv-panel-estimator-20261001`, based on
`32bb393611538aed333cb53667a8edae1afc748d`. This is not a release receipt.
Hermes owns final gates, commit fallback, push, advisory/review routing and shipping.

## Consent re-confirmation

Customer create/edit and RO intake show **Customer agreed to texts**. Checking
requires **Verbal** or **Written**. Legacy TRUE, null, missing, or incomplete/invalid
provenance renders unchecked and unconfirmed. Only complete server provenance can
precheck a form. OCR fields cannot supply consent evidence; changing customer,
starting New, or applying OCR resets the prior attestation and method.

Unrelated saves omit all SMS fields. Returning to the original checkbox/method
also omits them. An intentional changed confirmation sends only `sms_consent: true`
and `sms_consent_method`; an intentional revocation sends only `sms_consent: false`.
Server Phase 1/2 code owns staff identity and timestamp. Frontend never submits
those evidence fields. New-customer intake sends attestation to POST /customers
once and omits it from POST /ros, avoiding a second timestamp/confirmation.
Existing confirmed intake does not refresh the timestamp or request confirmation.
Email consent remains independent; unrelated edits omit email/preferences as well.
STOP enforcement remains unchanged; re-confirmation does not clear a STOP record.

## Product switch and safe operational rollback

`PANEL_ESTIMATOR_ENABLED` is a **server environment variable**, default **ON**.
Trimmed, case-insensitive `false`, `0`, or `off` disables it. Other values, including
unset/empty, preserve ON behavior. **Restart all backend processes after changing
it.** The router resolves the value at startup, and both enforcement and availability
use that same value. Do not use a frontend/Vite variable as the control.

Authenticated `GET /api/estimate-items/panel-estimator/availability` returns
`{ "enabled": true|false }` with `Cache-Control: no-store`. This is the sole
availability exception to the estimator guard. Unauthenticated calls still fail
authentication. When OFF, all 15 estimator work endpoints return HTTP **503** with
`error` and `code` both **PANEL_ESTIMATOR_DISABLED**, before database work:

- Catalog/preset GET, create, version, archive and private cost config.
- Draft GET/save, preview, private cost summary/settings and revision commit.
- Quote JSON/PDF and approval-link creation/revocation.

EstimateBuilder shows only manual/insurance import until availability explicitly
returns boolean true. Disabled, pending, malformed or failed availability responses
hide Visual panels and do not mount PanelEstimator. Availability is checked on page
mount/RO change. Already-open clients may retain their visible editor until reload;
the server still rejects its work after restart. Reload to refresh the UI.

Rollback is **flag OFF + restart**, not database rollback. Preserve estimator tables,
presets, revisions, selected financial authority, payments, approval links/audit and
historical evidence. Do not delete data, clear the selected revision or run down
migrations. Existing money/RO reads keep using the stored selected revision; turning
off does not fall back to manual financial authority or reprice signed records.
Direct estimator quote endpoints are temporarily unavailable, but stored records
remain intact. Re-enable and restart to restore access.

**Existing public customer approval links intentionally continue** through their
separate public router, including reading/signing an already-issued quote. This
switch stops staff estimation/new quote and new link creation; it does not invalidate
issued approvals or roll back signed records. Existing expiry/revocation/conflict
rules remain in force. Staff link revocation on the guarded estimator router is also
unavailable while OFF. No public approval or financial service was changed here.

## Verification and remaining scope

Focused tests use Node **v22.23.2**, `env -i`, `NODE_ENV=test`, `CI=1`, mocked APIs/DB,
and no listening socket or external provider. Commands from repository root:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 /opt/homebrew/opt/node@22/bin/node --test backend/test/panelEstimator.switch.test.js
cd frontend
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 /opt/homebrew/opt/node@22/bin/node node_modules/vitest/vitest.mjs run src/components/__tests__/AddROModal.feedback.test.jsx src/pages/__tests__/ConsentAndAvailability.phase3.test.jsx src/pages/__tests__/Customers.mobile.test.jsx src/pages/__tests__/EstimateBuilder.gapReview.test.jsx src/pages/__tests__/EstimateBuilder.phase31.test.jsx
```

Backend coverage traverses every actual estimator route's middleware/handler stack
for four OFF spellings (zero queries), authentication, default/explicit ON catalog
and normal validation/role rejection. Frontend rendered checks cover create/edit/
intake, exact consent payloads, legacy/provenance, unchanged confirmation, revocation,
method validation, customer/OCR reset, preserved email and editor non-mounting.
Final output and exit status are recorded in the CLAUDE.md phase log.

Ten changed files, including three focused test files. Safety-sensitive consent
provenance/timestamp behavior and access enforcement; exceeds the two-file review
threshold. No review requested by Codex. This phase does not resolve transactional
RO deletion, paid-RO technician deletion, payment overcharge or optional provider
abort (P3). Those remain subsequent remediation phases. Full gates, build/browser/
real-DB checks and broader older fixture updates remain Hermes/final-phase work.
In particular, `AddROModal.appraisal.test.jsx` still has older boolean-copy payload
expectations; update those in the deferred fixture pass. The prior 13+25 host checks
are parent-provided history, not rerun evidence for this phase.

Commit guard: `git add` failed with exit 128: unable to create
`/Volumes/Zordon Storage /openclaw-workspace/Revv/.git/worktrees/panel-estimator-20261001/index.lock`:
Operation not permitted. No staging/commit completed; HEAD remains the Phase 2 base.
Hermes must inspect the ten-file working diff, stage and commit on top (no amend or
rebase), then bind final gates to the resulting full SHA. No sandbox bypass attempted.

## Phase 4 — t_3ead3bd0, 2026-10-02

Started clean on `f2cf34506db4e12b2cc2aa56070a4bb88af44585`, branch
`codex/revv-panel-estimator-20261001`. This section supersedes the Phase 3
remaining-scope notes for deletion/payments only. Hermes retains lifecycle,
exact-SHA gates, push and handoff; no review or release verdict is claimed.

### Deletion provenance and safeguards

The READ COMMITTED transaction, tenant-scoped parent FOR UPDATE lock, draft guard,
scoped dependent deletes, rollback and commit already existed at this base.
`git blame` attributes them to ancestor
`2b80fef002cd836dfa36f9b551e4af8a5a7333d8`; Phase 4 does not claim new transaction
code. It adds a paid-state check on the same locked parent and transaction client,
before any DELETE. Technician-rank roles (`technician`, `employee`, `staff`) get
403 if successful (`paid`/`succeeded`) tenant ledger payments sum positive, or the
RO says paid/partial, payment_received is positive/true, or amount_paid_cents is
positive. A stale unpaid RO cannot hide successful payments. Actual middleware
already rejects `tech` (unknown rank); it remains rejected, including unpaid ROs.
Owner/admin/superadmin and the existing admin-ranked assistant retain permitted
behavior, subject to unchanged panel draft and immutable-history protection.

The loopback PostgreSQL lifecycle test now installs a BEFORE DELETE trigger on
ro_payments (second dependent table). It raises after confirming status logs from
the first dependent DELETE are absent; the adapter also observes that first
DELETE completing. Post-error snapshots must restore RO, logs, payments, photos,
line items, parts orders and portal tokens exactly. Existing late-parent trigger
coverage additionally exercises rollback after payments and other children have
already been deleted. Guard rejection, successful deletion, cross-shop isolation,
role/payment-state matrix and draft/delete serialization remain covered.
**These real-DB assertions are pending host execution, not verified in sandbox.**

### Intent balance and panel integration

Both `/intent` and `/create-intent` use getRoMoneySummary unchanged and subtract
successful tenant payments via getPaidCents. Failed/pending payments do not count.
The larger of ledger paid and legacy amount_paid_cents is used conservatively
(without double counting). Paid/payment_received legacy records are refused even
without ledger rows. Default amount is remaining; non-partial must equal remaining;
positive integer partial amounts may not exceed it. Fully paid/overpaid and invalid
amounts are refused before mocked Stripe creation. Response amountOwedCents,
provider metadata and the intent's RO amount_owed_cents write all use remaining.

Necessary scoped integration: panelEstimator's RO trigger now accepts only the
selected immutable quote total or its derived remaining balance for amount_owed_cents.
The total form preserves existing settlement/webhook/mark-paid behavior; those
routes still store gross owed and are not redesigned here. Arbitrary balance edits,
quote/insurer totals, approval fields and revision evidence remain guarded. This
function is refreshed by the existing startup initializer; no production initializer
or migration was executed. Both routes and this guard change belong in the same
candidate. Do not deploy the intent balance write without its guard integration.

Residual: these checks do not reserve provider balances. Concurrent intents can
observe the same remaining amount, and payments/quote changes between the read and
provider creation remain possible. Provider success followed by a DB failure can
leave an outstanding provider intent. No cancellation, idempotency redesign or
cross-provider transaction guarantee is claimed. P3 deferred: current Twilio and
mailer wrappers do not expose a shared cancellable transport; timeout still means
provider outcome unknown, not an aborted send.

### Evidence and Hermes host command

Node v22.23.2; sanitized environment, no .env or external provider calls. From root:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 /opt/homebrew/opt/node@22/bin/node --test backend/test/payments.phase4.test.js
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 PANEL_ESTIMATOR_TEST_DATABASE_URL=postgresql://revv_panel@127.0.0.1:55459/revv_panel_test /opt/homebrew/opt/node@22/bin/node --test backend/test/panelEstimator.lifecycle.test.js
```

Mocked command exit 0: tests 112, pass 112, fail 0, skipped 0; output
`/tmp/revv-phase4-mocked.log`. Executes production handlers and role middleware
without sockets; financial summary inputs are mocked, successful ledger SQL uses
the actual helper. Real-DB command exit 1: tests 2, pass 1, fail 1, skipped 0;
`connect EPERM 127.0.0.1:55459 - Local (0.0.0.0:0)` before schema creation.
No sandbox bypass. Hermes must run that exact loopback command; it tests real
selected-panel money, SQL and triggers with mocked Stripe and isolated disposable
schema cleanup. Full gate fixture repairs remain a separate phase.

Rollback safeguards: preserve all customer, payment, panel and audit records.
Use the Phase 3 product switch to stop estimator work without reverting data.
A code rollback must keep paid-delete/overcharge protection or suspend those routes;
restoring the vulnerable intent handler is not a safe financial rollback. Do not
run data-down migrations or erase records to satisfy a prior trigger definition.
Seven files changed; financial/access-control/data-loss-sensitive scope and over
two files. Hermes owns subsequent review routing; Codex requested no review.

Phase 4 static checks: all five changed JavaScript files passed Node22 --check;
`git diff --check` exit 0. These are working-tree checks, not exact-SHA host gates.

Phase 4 commit guard: `git add` of the seven listed files exited 128, unable to
create `/Volumes/Zordon Storage /openclaw-workspace/Revv/.git/worktrees/panel-estimator-20261001/index.lock`:
Operation not permitted. Nothing staged or committed by Codex. HEAD remains
`f2cf34506db4e12b2cc2aa56070a4bb88af44585`. Hermes must inspect the diff and commit
on top (no amend/rebase), then run host gates against that new full SHA. No push
or sandbox bypass attempted.
