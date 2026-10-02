# Remy remediation — t_3ead3bd0, Phases 3–5

Phase 5 starts clean at `05153fb000b4fb8aa8feee222ad180622c0ec875` on
`codex/revv-panel-estimator-20261001`. This is not a release receipt.
The Phase 3/4 gate, pending-work and commit-block statements below are historical
receipts for those working trees, not current state. Phase 5 status is at the end.
The parent diagnostic host run includes the Phase 4 lifecycle pass; its minimal
schema failures and older consent fixture failures are the Phase 5 correction scope.
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
unavailable while OFF: **staff cannot revoke issued estimator links while
PANEL_ESTIMATOR_ENABLED is off**. To revoke one, briefly re-enable the flag and
restart all backend processes, revoke via the existing authenticated staff endpoint,
then disable the flag and restart all backend processes again. Public links continue
working during the OFF period unless expired, revoked or blocked by existing conflict
rules. No public approval or financial service was changed here.

## Phase 3 historical verification and remaining scope

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
**At Phase 4 completion these real-DB assertions were pending host execution.
The supplied diagnostic host run subsequently passed lifecycle; no Phase 5 DB
rerun is claimed. The failure-injection and paid-role matrix are unchanged.**

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


## Legacy consent migration operations — final runbook

`backend/src/db/customerConsent.js` exports `up(db)` and `down(db)`; `db` must
provide `query`. The existing DB startup/migration paths call `up`. Each direction
submits one multi-statement query on one connection, atomically, with a
`SHARE ROW EXCLUSIVE` lock on customers. For an explicitly authorized migration,
use those exports with the intended database adapter; do not copy individual SQL
statements or run the customer-consent down operation as estimator rollback.
No migration was executed in Phase 5.

`up` adds provenance and `sms_consent_revision`, sets default FALSE, and installs
the revision trigger. The `customer_consent_migrations` entry
`explicit_sms_consent_v1` marks the one-time reset. `customer_consent_resets`
retains customer/shop identity, prior consent/provenance, reset revision/time,
reason and restoration time. Only legacy TRUE lacking complete valid provenance
is audited and reset to FALSE. Existing confirmed consent is preserved.

Repeated `up` is idempotent: the migration ledger prevents another reset. It does
not overwrite subsequent STOP or re-confirmation. Any UPDATE naming a consent or
provenance column advances the revision, even a redundant FALSE STOP update;
unrelated writes must omit those columns. Preserve both audit tables and the
trigger. Never delete the ledger to force a rerun. Running `up` after `down` also
does not reset again: the original migration marker remains.

`down` is a conditional data restoration, not schema removal. It restores only
unrestored audit rows whose customer/shop, reset revision, FALSE consent and prior
provenance still match, and only while the migration is not marked rolled back.
It NEVER overwrites a subsequent STOP/reconfirmation or other consent write.
It records `restored_at` and `rolled_back_at`; repeated `down` does nothing further.
It retains provenance columns, default FALSE, revision trigger and audit tables.
A restored historical TRUE still lacks eligible provenance: down restoration alone
cannot make it eligible for SMS. Keep the complete-provenance send guard and STOP
checks in place; do not roll back to boolean-only send eligibility.

Hermes should verify both audit tables and customer revision/evidence in an
isolated test database using `backend/test/customerConsent.integration.test.js`
and `backend/test/smsConsent.phase2.test.js`, including repeated up/down, later STOP,
later reconfirmation and restored-TRUE suppression. Do not export customer evidence
into ordinary logs. Retain audit history through any operational rollback.

## Phase 5 — regression correction and gate handoff

Source diagnostic receipts (read, not rerun):
`/Users/zordon/hermes-artifacts/revv-panel-estimator-20261001/gates-remy-fail-15114f26/20261002-003938-05153fb000b4/`.
At the unchanged base SHA, backend had 602 tests (523 pass, 79 fail), frontend
376 tests (371 pass, 5 fail); parser 7 pass and build/diff passed. These are
historical diagnostic results, not final candidate gates.

The production trigger reads optional balance fields through `to_jsonb`, enters
the balance exception only for that changed field, and queries optional
`ro_payments` only after `to_regclass` confirms it exists. Gross or remaining
balance is still bound to the immutable selected accounting total and tenant;
unexpected SQL failures propagate. The existing TEXT/UUID revisions suite adds
missing-column, absent-ledger, arbitrary-balance and broken-ledger regressions.
No fixture columns were added to hide the panel schema regression.

Older SMS/parts fixtures now provide explicit provenance, preserving entitlement,
STOP, malicious-provider logging and zero-leak assertions. No-shop sends expect
`missing_recipient_scope`; separate scoped confirmed-customer coverage reaches
unconfigured suppression. Import tests retain every negative input, reject invalid
methods with 400 before writes, ignore nested OCR consent and verify authenticated
staff/server time against spoofed evidence. Appraisal tests retain payload/upload/
authorization assertions and verify legacy TRUE/null unconfirmed, OCR evidence
ignored, and unchanged confirmed customers omitting consent mutation.

Focused local checks use Node v22.23.2, `env -i`, NODE_ENV=test and CI=1.
A temporary preload (`/tmp/revv-phase5-no-network.cjs`) rejects dotenv loading,
socket connections and unmocked fetch. Vitest uses the existing config through
`/tmp/revv-phase5-vitest.config.mjs`, overriding envDir to an empty temporary
directory so project .env files are not loaded. No external provider is called.

```sh
# From worktree root:
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 NODE_OPTIONS='--require=/tmp/revv-phase5-no-network.cjs' /opt/homebrew/opt/node@22/bin/node --test --test-concurrency=1 backend/src/__tests__/smsTierGate.test.js backend/src/__tests__/notificationLogging.privacy.test.js backend/test/partsNotifications.test.js backend/test/estimateImport.test.js backend/test/payments.phase4.test.js
# From frontend/:
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 NODE_OPTIONS='--require=/tmp/revv-phase5-no-network.cjs' /opt/homebrew/opt/node@22/bin/node node_modules/vitest/vitest.mjs run --config /tmp/revv-phase5-vitest.config.mjs src/components/__tests__/AddROModal.appraisal.test.jsx src/pages/__tests__/ConsentAndAvailability.phase3.test.jsx
```

Backend exit 0: tests 138, pass 138, fail 0, skipped 0 (includes unchanged Phase 4
112 tests). Frontend exit 0: 2 files, 29 tests passed, none skipped. Logs:
`/tmp/revv-phase5-backend.log`, `/tmp/revv-phase5-frontend.log`. Frontend emits
existing Vite deprecation and React Router future-flag warnings.
No DB suites were run or counted as passes/skips in these focused commands.
Hermes owns DB execution (including TEXT/UUID regressions, parts delivery,
approval/quote/economics, consent migration and unchanged lifecycle), full suites,
parser/build and final exact clean SHA gates. No final pass is claimed.
P3 remains deliberately deferred: timeout is an unknown provider outcome;
transport cancellation is not implemented.

Ten files including CLAUDE.md and this runbook; financial guard, consent provenance,
audit/timestamp and data-loss-sensitive regression scope, exceeding two files.
No board/agent/review/deployment/provider/production calls, main/canonical/readiness
changes, amend, rebase or push. Hermes owns subsequent review routing.

Phase 5 static checks: all seven changed backend JS files passed Node22 --check;
`git diff --check` exit 0. Phase 5 staging exited 128:
`fatal: Unable to create '/Volumes/Zordon Storage /openclaw-workspace/Revv/.git/worktrees/panel-estimator-20261001/index.lock': Operation not permitted`.
The chained commit did not run. No files were staged, no new SHA was created,
and HEAD remains `05153fb000b4fb8aa8feee222ad180622c0ec875`. No bypass attempted.
Hermes must inspect these ten files, commit on top without amend/rebase, and run
final gates against that exact clean full SHA. No board write was made, as directed.

## t_6f27a266 Phase A — 2026-10-02

Scope is Remy findings **1, 2, 6 and 7 only**, from clean base
`5ab183e7e816ec9a34bb5b8544bab4083253fb10`. Payment and deletion findings remain
for subsequent work. Hermes owns commits, lifecycle, host gates, push and the
UNSENT packet. No review or final-gate result is claimed here.

`POST /api/sms/webhook` now uses installed Twilio **5.12.2** `validateRequest`
with every form parameter, a server-resolved recipient and the account auth token.
The account SID must match the sole shop owning that exact Twilio recipient number;
duplicate matches reject even if only one account matches. API key/secret alone
cannot validate inbound signatures. A missing shop token can use the environment
auth token only when both the environment account SID and phone match that shop.
No token, missing/invalid signature, unresolved/ambiguous recipient or lookup/config
failure returns **403 before writes, consent changes or auto-replies**.

The signed URL is the configured `APP_URL` (fallback `PUBLIC_URL`) base plus
`/api/sms/webhook` and the incoming query string. A base must be explicitly configured;
missing/invalid bases reject. Credentials, query and fragment are forbidden in the
base. Host, forwarded host/protocol and request protocol never set the verification
origin. Configure Twilio to use that exact public webhook URL; this change does not
change provisioning or add an `/inbound` alias. Webhook logs are static event names,
including authentication, lookup, persistence and auto-reply failures. Existing
SMS provider logs retain validated references/codes and no phone/body/exception text.

Customer PUT detects normalized phone changes under its existing tenant row lock.
Punctuation and optional US country prefix do not count as changes. A changed or
cleared number resets consent and all provenance even if the same request sends
TRUE (including TRUE without a method). Only a subsequent explicit verbal/written
attestation can restore confirmation; STOP records are preserved. Unchanged phone
and omitted consent preserve evidence/revision. The edit form explains that staff
must save the number and reopen Edit Customer before fresh attestation.

`customerConsent.up` idempotently creates `customer_consent_phone_changes` in both
startup/migration paths, independent of the later superadmin audit schema. Each phone
change inserts customer/shop IDs, old/new masks, authenticated staff, database time
and `phone_changed` in the same transaction. A failed insert rolls back the edit.
Mask constraints prohibit raw numbers; short/empty numbers use `***`. TEXT IDs support
fresh UUID and legacy TEXT customer schemas without destructive conversion or
cascading deletion. `down` retains this table; existing reset/STOP/reconfirmation
revision protection remains. No production migration was run.

Focused commands actually executed (Node **v22.23.2**, repository root unless noted):

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 NODE_OPTIONS=--require=/tmp/revv-phaseA-no-network.cjs /opt/homebrew/opt/node@22/bin/node --test --test-skip-pattern='real PostgreSQL' backend/src/__tests__/smsAutoReply.test.js backend/test/consentPhone.phaseA.test.js backend/src/__tests__/notificationLogging.privacy.test.js backend/src/__tests__/customerOptInConfirmation.test.js backend/test/smsConsent.phase2.test.js
# From frontend/:
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 NODE_OPTIONS=--require=/tmp/revv-phaseA-no-network.cjs /opt/homebrew/opt/node@22/bin/node node_modules/vitest/vitest.mjs run --config /tmp/revv-phaseA-vitest.config.mjs src/pages/__tests__/ConsentAndAvailability.phase3.test.jsx src/pages/__tests__/Customers.mobile.test.jsx
# From repository root, dedicated disposable loopback DB only:
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 CUSTOMER_CONSENT_TEST_DATABASE_URL=postgresql://revv_panel@127.0.0.1:55459/revv_customer_consent_test /opt/homebrew/opt/node@22/bin/node --test backend/test/customerConsent.integration.test.js
```

The temporary preload rejects dotenv, socket connections and unmocked fetch. The
Vitest wrapper imports the existing config with `envDir` set to the empty
`/tmp/revv-phaseA-empty-env`. Neither mocked run loads .env, binds a listener or
contacts a provider. Backend exit **0: 82 tests, 82 pass, 0 fail, 0 skipped**;
the named Phase 2 real-PostgreSQL case is explicitly excluded, not a DB pass.
Frontend exit **0: 2 files, 30 tests passed**. Logs:
`/tmp/revv-phaseA-backend.log`, `/tmp/revv-phaseA-frontend.log`.
The earlier combined backend attempt had 9 fixture dependency-load failures;
scoping the Twilio validator import to webhook authentication resolved those,
with the existing Phase 2 tests unchanged.

DB command exit **1: 8 tests, 2 pass, 6 fail, 0 skipped**. All six fresh/legacy
UUID/TEXT cases hit `connect EPERM 127.0.0.1:55459` before schema creation.
Log: `/tmp/revv-phaseA-db.log`. No bypass attempted. Hermes must run this command
on the host to verify SQL, repeated migration/up/down history retention, masked audit
and injected audit-failure rollback; mocked checks do not establish those DB results.
The lifecycle host-gate runner was not invoked. No staging/commit was attempted;
Hermes retains the ten-file working tree for its commit and subsequent gates.
Safety-sensitive signature/auth, consent/audit/timestamps; exceeds two changed files.
