# Internal test shops — t_6002e02f staged implementation

Base: `35e49ddc01d6ef7605f602d85faa9591308915ff` (`origin/main`).
Lane: `codex/t_6002e02f-revv-test-shop`. **Foundation + phase-2 SMS + phase-3 email/notification safety; NOT feature-complete or release-ready.**
Phase 2 starts at `67dbe8fdfa362c5fdb264870fdd4c9ff25f6c1aa` and changes exactly ten files.
No account installation or designation is included. Phase-2/3 dispatch/validation logs are
kept here within the user's ten-file cap; the phase-1 `CLAUDE.md` log remains historical.

## Implemented safety boundary

- `shops.is_internal_test_shop BOOLEAN NOT NULL DEFAULT FALSE` is present in both fresh schema declarations and a required, transactional, idempotent startup initializer.
- Public `/api/auth/shop-register` explicitly inserts SQL `FALSE`. Test fields and aliases in requests are ignored, never copied into SQL, JWT claims or roles. The resulting tenancy remains `owner`.
- Existing allowlists/destructuring in onboarding, market shop settings, settings and user updates cannot write the flag. Executed handler tests cover both mixed ordinary/forged fields and designation-only updates.
- **`shops_internal_test_shop_hold CHECK (is_internal_test_shop IS FALSE)` deliberately prohibits all true flags**, including direct inserts/updates. There is no provisioning script, API, environment enable switch or supported setter in this candidate. Do not remove the hold to test this incomplete feature.
- The initializer rejects incompatible types, nulls, existing true values or a weakened hold, rolls back, and reports only a fixed error. Both startup paths propagate that required failure; the app cannot listen/start jobs after it. No row UPDATE, backfill, type conversion, deletion or credential handling is added.
- PostgreSQL default semantics make existing unflagged shops ordinary without rewriting their tuples. Real synthetic TEXT/UUID tests verify unchanged `xmin` and name. Existing true/null policy is refused, never silently rewritten.

The hold is an implementation gate, **not a substitute for per-consumer exclusions**. Acceptance 1 and the default-false portion of 2 are implemented. Acceptance 3–6 and full ordinary-behavior parity remain incomplete. Acceptance 7 is established only for this slice; 8 is this inventory. No flagged shop can be enabled in this candidate while those gaps remain.

## Phase 2 — outbound SMS and autoprovision (2026-10-21)

- `services/shopPolicy.js` queries only `id::text` and `is_internal_test_shop` by the
  authoritative shop ID. Exactly one matching row with a strict Boolean FALSE is
  required to allow an external effect. TRUE suppresses with `INTERNAL_TEST_SHOP`;
  missing/duplicate/mismatched rows, invalid IDs/types and query failures suppress
  with `SHOP_POLICY_UNAVAILABLE`. No request/JWT/client policy fields, email rules,
  cache, environment switch, or caller-supplied shop object authorizes an effect.
  Callers must supply authenticated tenancy or a persisted resource/job identity.
  The optional row-reader is a server-owned DB adapter, not a request option; locked
  queue work uses the same PostgreSQL connection and existing shop lock.
- `sendSMS` checks policy before consent/config lookup and again before loading
  Twilio/constructing its client. Caller-supplied config and the private staff
  capability cannot bypass policy. Suppression has a local enum log and
  `provider_attempted: false`. Ordinary consent, STOP, footer, entitlement and
  provider-result handling remain in their existing order after the new guard.
- Manual/force and automatic provisioning entry points enforce policy. The legacy
  manual path also checks before client construction and every provider request,
  including service/number fallbacks, purchase and attachment. Policy errors cannot
  be swallowed into those fallbacks. Its **pre-existing unexported
  `createTwilioClient` defect is unchanged**; synthetic manual tests supply that
  existing dependency seam, and do not claim the legacy entry works in production.
- Queue discovery, due enumeration and attention enumeration exclude flagged shops.
  Direct claims check policy after acquiring the session lock; all locked
  transactions check again, including failure saves. `processJob` independently
  checks before mapping and every guarded step, covering preexisting jobs, purchase
  intents, inventory reconciliation, retries and publication. Factory and retained
  provider adapters check before SDK access, including each prerequisite request.
  Flagged shops remain OFF even with global autoprovision ON, pro/agency or SMS comp.
- Policy suppression does not save a new retry/error state, consume acquisition
  budget, erase intent/resources, or request admin alerts. Existing jobs/resources
  remain held; no cleanup/release/provisioning is introduced. Queue alerts check
  current policy before cooldown writes and again before notifyOps. Policy-error
  alerts and queue-wide errors lacking trusted tenancy stay local; there is no
  global external-alert fallback. Ordinary scoped alerts retain enum/cooldown
  behavior. Missing/ambiguous policy is deliberately fail-closed, including when
  an otherwise ordinary shop cannot be resolved.
- The deliberate database CHECK hold, initializer, schema, startup ordering and
  public-registration FALSE remain byte-identical to phase 1. No designation path
  is enabled. Inbound registration events remain authenticated local state writes;
  subsequent queue processing/provider/alert paths are guarded.

## Consumer inventory

Paths below are relative to `backend/src/` unless otherwise stated. “Pending” means there is currently no test-shop exclusion in that consumer. No existing consent, plan, environment-OFF or tenant-scoping guard is counted as a test-shop guard.

| Consumer inspected | Finding / coverage / next change |
| --- | --- |
| `routes/auth.js` registration, retired customer registration, onboarding, login, password reset | Registration now forces FALSE; ordinary update allowlists covered. Phase 3: password-reset email resolves policy using the persisted user shop_id; registration Discord uses the newly inserted shop ID. Token issuance/redemption and generic response remain unchanged. Login/JWT does not authorize a designation. |
| `routes/market.js` PUT shop, logo; `routes/settings.js` PATCH, slug rotation; `routes/users.js` create/update/self/assistant; `routes/superadmin.js` account/password/impersonation tooling | No designation setter exists; settings/update allowlists neutralize forged fields. Do not reuse privileged user tooling for designated provisioning. Logo/media and ordinary notification setting behavior require later test-shop policy. |
| `db/index.js`, `db/schema.pg.sql`, `db/migrate.js`, new `db/internalTestShop.js`, `app.js` | Changed: false schema/default, database hold, required migration and startup refusal. UUID/TEXT parent conventions retained. No request-time DDL. |
| `db/seed.js`, `db/seed.pg.js`, repository `scripts/seed-demo.js`; `backend/test/productionStartup.test.js` | Legacy demo/superadmin mechanisms are unsuitable for designated provisioning. Production entrypoint is seedless (8 existing tests pass). None of these seed scripts was executed. New dedicated server-only provisioning is pending. |
| `routes/subscriptions.js` status, ensureStripeCustomer, checkout, billing portal, subscription-created/updated/deleted webhooks | Pending: block customer/subscription/portal creation before Stripe calls; ignore test-shop webhook writes with verified stored tenancy. Stripe owns recurring charging; designated provisioning must never create or attach billing identities. |
| `routes/payments.js` intent/create-intent aliases, links, reconcile, webhook receipts, history/RO totals; `services/stripe.js` | Pending: deny provider charge/intent/checkout/reconciliation for flagged shops at the server boundary. Preserve ordinary integer-cent accounting and verified webhook semantics. |
| `services/customerBilling.js` checkout link, tracking token and closed-paid invoice email | Phase 3: closed-paid invoice mail checks policy before tracking-token preparation and again at transport, including force; suppressed mail cannot set invoice_emailed_at. Direct checkout creation, reservation/provider work and standalone tracking-token calls remain pending. |
| `services/paymentReservations.js` reserve, settle, reconcileAttempt/reconcileLocked, manual/deletion locks | Pending: authoritative shop check under parent locks, including lazy/provider reconciliation. Do not release uncertain ordinary reservations or alter payment history. No standalone scheduled Stripe billing job was found. |
| `routes/invoice.js` authenticated invoice, repair-order PDF and public token invoice; `routes/ros.js` invoice mail, close/paid/manual settlement and queued QB sync | Pending: deny invoice generation/send for test tenancy through both public and authenticated entry points. Preserve ordinary print and money authority. |
| `routes/accounting.js`, `services/quickbooks.js` OAuth/token refresh, qbRequest, customer/item creation, single/batch invoice sync, disconnect | Pending: prevent external invoice/customer/provider effects, including queued sync after RO closure. |
| `routes/reports.js` summary, monthly JSON/CSV, tech workload, revenue/RO/performance/insurance tabs | Pending: exclude flagged tenancy before aggregation/export, with deliberate empty/excluded response contracts. |
| `routes/dashboard.js` instruments, monthly supplement opportunity, owner KPIs, weekly revenue/tech/parts/stages | Pending: exclude all business/revenue/performance aggregates. |
| `routes/performance.js`, `routes/goals.js`, `routes/ros.js` job-costing, carryover/turnaround and active counts; `services/profit.js`, `services/roMoney.js` calculation consumers | Pending: report/goal exclusion without changing ordinary financial math or fixture operational records. |
| `routes/superadmin.js` shops/detail/stats/ratings/accounts/helpdesk; `routes/diagnostics.js` counts/heal | Pending: filter cross-shop business/customer/usage totals; distinguish administrative inspection from business reporting. Global counts currently include all rows. |
| `routes/customers.js` customer/vehicle/RO counts; `routes/reviews.js` summary; `routes/public.js` public shop ratings | Pending: customer/review/business metrics exclusion. Ordinary tenant filtering alone is insufficient. |
| `middleware/roLimitGuard.js`, `middleware/planGuard.js`, `services/estimateAiPolicy.js` admissions/budgets | Pending: usage exclusion and explicit test-shop provider denial; no paid-plan/admin privilege should be granted to bypass ordinary limits. |
| `app.js` runCarryoverForActiveShops; `jobs/monthCarryover.js` | Pending: startup enumerates ALL shops and marks billing-month carryovers. Guard both enumeration and direct consumer. |
| `jobs/ownerActivityDigest.js`, `services/ownerActivity.js` digest, immediate critical alerts, preference overrides | Phase 3: service entry guard and per-recipient SMTP check cover scheduled/direct digest, overrides and detached critical alerts. Scheduler enumeration and pre-service digest-date claim still include fixtures; local event writes remain. |
| `jobs/feedbackDailyAudit.js`, `routes/feedback.js`, superadmin helpdesk totals | Pending: prevent fixture feedback contaminating operational reporting/routing. Job updates feedback only; no provider sends found in the job itself. |
| `services/shopPolicy.js`; `services/sms.js` sendSMS/sendStaffSMS | Phase 2 implemented: strict persisted resolver, entry/final send guards before config/client/provider resolution, including supplied config and staff capability. Getter-only config/diagnostic APIs do not send. Zero-client synthetic tests and ordinary SMS suites pass. |
| `routes/sms.js` test/direct/thread sends and inbound webhook; `services/smsAutoReply.js` | Outbound paths converge on guarded sendSMS; direct/auto-reply negative tests executed. Inbound signature/callback and local STOP/START processing unchanged; no TwiML outbound reply added. |
| `services/customerOptInConfirmation.js`, `services/partsNotifications.js`, `routes/ros.js` status/tracking/supplement sends, `routes/portal.js` tracking, `routes/timeclock.js` staff SMS | Central exclusion implemented; executed real handler/service tests cover RO, portal, status, opt-in, parts SMS and staff wrapper suppression. Timeclock uses the guarded staff wrapper. Parts email is fail-closed unsupported in phase 3 because its caller omits shop ID; no ordinary send until conversion. |
| `services/smsProvisioning.js` manual/force and automatic entry; `services/smsProvisioningQueue.js` discovery, due/claim, session guard, purchase/retry/publish/alerts; `services/smsProvisioningProvider.js`; `services/smsProvisioningEvents.js` | Phase 2 implemented: discovery/due/attention filters, manual/automatic entry, direct claim, locked transaction/worker checks, provider factory/retained adapter checks and failure/ops-alert suppression. Preexisting jobs, retries/intents, force, late policy changes and ordinary callback/idempotency behavior tested with synthetic adapters. Signed registration receiver itself remains local-only and unchanged. Legacy unexported createTwilioClient defect remains; not counted as a guard. |
| `services/mailer.js` Resend and `services/email.js` SMTP/helpers | Phase 3: mandatory trusted shop ID, persisted policy before provider/client/SDK/network. Missing/ambiguous/unconverted tenancy refuses delivery. See exact transport result contract below. |
| Mail callers: `routes/auth.js`, `routes/ros.js` status/review/invoice/manager approval, `routes/payments.js`, `services/customerBilling.js`, `services/partsNotifications.js`, `services/ownerActivity.js` | Phase 3 converts auth, all four RO mail call sites, closed-paid invoice and owner activity. Payments receipt and parts email intentionally remain unsupported/fail-closed at Resend; see remaining-consumer table below. |
| `utils/discord.js`; callers `routes/auth.js`, `routes/leads.js`, `routes/waitlist.js`, `routes/public.js` estimate intake | Phase 3: Discord requires a separate trusted shop ID. Registration converted. Public lead/waitlist and unconverted public-intake notifications are disabled at this boundary for all callers; no body flags or recipient-derived identity. |
| `services/notifyOps.js`; callers `routes/insuranceOcr.js`, `services/smsProvisioningQueue.js` | SMS provisioning caller guarded in phase 2, including error fallback and late checks. Phase 3 guards generic notifyOps using context.shop_id from server-owned callers, covering late OCR failure alerts and rechecking queue alerts. Unresolved/global alerts stay local. |
| Frontend `components/LeadCaptureForm.jsx`, `pages/LeadsDashboard.jsx` | **Additional bypass:** lead form writes directly to Firestore before an unauthenticated backend Discord request; dashboard reads/exports all Firestore leads. Requires separate server-authorized fixture isolation and tests; a backend-only flag cannot cover this direct write. Firebase configuration/credentials were not opened. |
| `services/notifications.js`, `routes/notifications.js`, local notification writes in `routes/timeclock.js`; `routes/comms.js`, `routes/inspections.js` send marker; agreement/approval links | Inspected paths are local rows/link/marker operations, not outbound push transports. No push sender found in backend/frontend source search. Still verify downstream notification consumption before enabling fixtures. |
| `jobs/mediaIntegrity.js`, `services/mediaStorage.js`, upload routes; `services/openai.js`, catalog/tracking provider services and their routes | Broader zero-external-effect requirement: object-store mirror/restore, AI, supplier/tracking calls also need exclusion or a genuinely isolated fixture environment. Global media sweep mirrors files independently of shop-reference queries. Frontend Settings also has direct geocoding. These are not covered by messaging guards. |
| `routes/apiV1.js`, `middleware/apiKeyAuth.js`, `routes/export.js` | Alternate API-key reads/exports inspected; no designation setter found. Include in later reporting/export and fixture coverage, not just JWT routes. |

## Next session in this SAME lane

Keep the database hold and account HELD. Phase 3 adds transport boundaries and selected caller conversion (receipt below). Next convert unsupported payments/parts/public-intake consumers and legacy test fixtures, finish scheduler exclusion and design a reviewed server-authorized public fixture path. Reuse the persisted resolver; do not accept body/JWT policy flags or infer fixture identity from email. Background jobs, public token routes, unscoped mail and direct Firestore writes still need their own boundaries. Billing/reporting/provider/metrics/scheduler rows marked pending above remain acceptance gaps.

Subsequent billing/reporting and scheduler batches must cover the rows above. Only after all exclusions and zero-provider tests are complete may a candidate replace the hold and add designated provisioning. That mechanism must use a dedicated server-side script, runtime env/vault password only, transaction + normalized-email concurrency protection, deterministic idempotent receipt, and one owner tenancy with no global/admin role. Refuse collisions with an existing ordinary account/shop; never convert/backfill customers or attach Stripe/Twilio identities. Repeating provisioning must not reset a password or mutate unrelated data. The receipt must contain only identity, true flag and verified exclusions, never credentials. Creating `zordon+revvqa@mail.grokbot.com` remains outside this build and HELD for separately authorized reviewed installation.

## Phase-1 validation receipt (2026-10-21; historical)

Node v22.23.2; PostgreSQL 17.11. Only generated synthetic data, a disposable private UNIX-socket cluster, VM handler mocks and deny-by-default imports. No app bootstrap, production services, SDK calls or live sends. Password input in registration tests is generated in memory and never logged; no designated password was read.

Exact focused command (exit **0**):
```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 REVV_INTERNAL_TEST_PG_SOCKET=/private/tmp/revv-t6002-pg/socket node --test backend/test/internalTestShop.test.js backend/test/productionStartup.test.js backend/test/idTypeCastGuard.test.js
```
Tail: **tests 49; pass 49; fail 0; cancelled 0; skipped 0; todo 0**.
The disposable server was stopped and shutdown verified after testing. Recreate/start the isolated fixture before rerunning the socket command. The disposable cluster uses role `revv_test`, DB `revv_internal_test_shop_test`, socket port 55462, TCP disabled. The test suite requires this task-only socket shape and does not accept `DATABASE_URL`. Running without the socket variable intentionally skips eight real-PG checks, not a full pass.

Broader final commands (all scrubbed with `env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1`):

- `node --test --test-concurrency=1 --test-skip-pattern='full initDb on guarded real PostgreSQL' backend/src/__tests__/*.test.js` — exit **0**, tests **283**, pass **283**, fail **0**, skipped **0**. The named pre-existing real-DB startup test was explicitly excluded by name (Node omits it from the count); full app init against its separate DB remains host QA.
- `node --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/marketShop.phaseB.test.js backend/test/smsTestRecipient.test.js backend/test/smsProvisioning.auto.test.js backend/test/smsConsent.phase2.test.js backend/test/payments.phase4.test.js backend/test/partsNotifications.test.js` — exit **0**, tests **560**, pass **560**, fail **0**, skipped **0**. Pre-existing real-PostgreSQL consent/payment cases were explicitly excluded, not counted as passed. This run verifies ordinary settings, SMS/provisioning, payments and parts notification behavior with mocks.
- In `backend/`: `npm run test:run` — exit **0**, **3 files / 7 tests passed**.
- Seven changed JavaScript files: individual `node --check`; `git diff --check` — exit **0**. Frontend unchanged; no frontend build/browser QA claimed.

Failure/recovery history (not hidden by final passes):

- Initial native run: exit **1**, 53 passed / 50 failed because dependencies were absent. Initial parser invocation: exit **127**, vitest missing.
- Offline exact-lockfile npm ci: exit **1**, ENOTCACHED for xmlbuilder 13.0.2. Clean public-registry retry initially exited **1** because npm cannot use the same `/dev/null` file for user/global config. Retry with two distinct empty task-local configs succeeded: **327 packages installed**, exit **0**, scripts/audit disabled. No credential-bearing npm config, version upgrade or package/lockfile edit. Exact install command used `npm ci --ignore-scripts --no-audit --no-fund --userconfig=/private/tmp/revv-t6002-pg/npm-user.conf --globalconfig=/private/tmp/revv-t6002-pg/npm-global.conf --cache=/private/tmp/revv-t6002-pg/npm-cache --registry=https://registry.npmjs.org` in a scrubbed environment with HOME pointing to that temporary directory.
- Recovered native run: **282 passed / 1 failed**, exit **1**, because the existing public-intake assertion pinned the former registration INSERT. Updated only its expected SQL to include FALSE; retained slug/parameter assertions. One patch attempt used the wrong local variable name and did not apply; exact-line correction succeeded.
- Initial ordinary-path run: **559 passed / 1 failed**, exit **1**, because the new initializer ran before the pre-existing mandatory Twilio check. Preserved that check's original order, then ran the new mandatory initializer; both focused and ordinary-path reruns passed.
- PostgreSQL bootstrap initially failed on sandbox shared memory; narrow escalation recovered. Server then failed without LC_ALL; `LC_ALL=C` recovered. Sandbox socket denial required the same narrow escalation for local tests. Truncated/mistyped reads were corrected. No existing database was accessed.

Raw task-local logs: `/private/tmp/revv-t6002-pg/focused.log`, `native-suite.log`, `native-suite-recovered.log`, `native-suite-final.log`, `ordinary-paths.log`, `ordinary-paths-final.log`, `parser-suite.log`, `init.log`, `server.log`; npm failure log under `/tmp/revv-t6002-npm-logs/`. These are local evidence, not a review verdict. Hermes/Oracle owns host QA, Spark disposition, exact-SHA review, lifecycle and release. This is safety-sensitive schema/auth/billing-policy preparation and changes more than two files.

## Phase-2 dispatch and validation receipt — 2026-10-21 10:36 EDT / 14:36 UTC

Same task `t_6002e02f`, same isolated source/branch, no delegation or lifecycle calls.
Preflight verified clean status, branch `codex/t_6002e02f-revv-test-shop` and exact
HEAD `67dbe8fdfa362c5fdb264870fdd4c9ff25f6c1aa`. Immutable original base remains
`35e49ddc01d6ef7605f602d85faa9591308915ff` and is an ancestor. The phase-2 commit
is the local commit containing this receipt; the final handoff supplies its full SHA.

Exactly ten changed files (paths relative to repository root):

1. `backend/src/services/shopPolicy.js`
2. `backend/src/services/sms.js`
3. `backend/src/services/smsProvisioning.js`
4. `backend/src/services/smsProvisioningQueue.js`
5. `backend/src/services/smsProvisioningProvider.js`
6. `backend/test/smsTestRecipient.test.js`
7. `backend/test/smsConsent.phase2.test.js`
8. `backend/test/smsProvisioning.auto.test.js`
9. `backend/test/smsProvisioning.events.test.js`
10. `docs/INTERNAL-TEST-SHOP.md`

Node v22.23.2, scrubbed environment, synthetic rows and provider clients only.
No real database (including disposable PostgreSQL) was used in phase 2. The final
commands additionally load `/private/tmp/revv-t6002-phase2/deny-network.cjs`, whose
entire behavior is to replace `net.Socket.prototype.connect`, `tls.connect`,
`http.request/get`, `https.request/get` and global `fetch` with a function throwing
`TEST_NETWORK_PROHIBITED`. The existing event tests run Express handlers with
synthetic request/response objects, without listening or calling a network service.

Exact final SMS/autoprovision command — **exit 0**:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase2/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/smsTestRecipient.test.js backend/test/smsConsent.phase2.test.js backend/test/smsProvisioning.auto.test.js backend/test/smsProvisioning.events.test.js
```

Tail: **tests 133; pass 133; fail 0; cancelled 0; skipped 0; todo 0**.
Includes 23 added policy/SMS/provisioning tests plus the existing ordinary suites.
The real-PostgreSQL consent case is explicitly excluded by name (not counted as
passed). All existing tests in the four selected suites otherwise run. Verified:
strict resolver cardinality/identity/type/query failure; flagged staff/customer/
caller-config sends; late policy changes; actual RO/portal/direct/status/opt-in/
parts/autoreply callers; zero SDK loads/constructions for suppressed SMS; manual
and force suppression; automatic new/preexisting/intent/acquired/active/failed jobs;
claims and locked rollback; every retained adapter operation; zero acquisition/
publication for flagged shops; no ops alerts; preserved ordinary callback,
consent/STOP, footer, entitlement, idempotency, retries, registration and provider
parameters. Manual ordinary-provider tests use the pre-existing mocked factory
seam, not a repaired/exported production client factory.

Exact foundation/startup/parts command — **exit 0**:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase2/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/internalTestShop.test.js backend/test/productionStartup.test.js backend/test/idTypeCastGuard.test.js backend/test/partsNotifications.test.js
```

Tail: **tests 57; pass 57; fail 0; cancelled 0; skipped 0; todo 0**.
The eight phase-1 real-PostgreSQL cases are explicitly excluded, not counted as
passed or rerun. Hold source assertions, public FALSE/update allowlists, startup
refusal, seedless startup, TEXT/UUID code conventions and ordinary parts tests pass.

Each of the nine changed JavaScript paths listed above was checked individually
with `node --check` in the same scrubbed environment: **9/9, exit 0**.
`git diff --check`: **exit 0**. Byte comparison against phase-1 HEAD confirms
`backend/src/db/{internalTestShop.js,index.js,migrate.js,schema.pg.sql}`,
`backend/src/app.js` and `backend/src/routes/auth.js` are all unchanged.

Failure/warning history for this phase (distinct from phase 1):

- No failed test, syntax check or diff check. Initial four-suite run before adding
  negative cases: **110/110**, exit 0 (`ordinary-first.log`). First expanded run:
  **132/132**, exit 0 (`focused-first.log`). Final run adds the failed-save policy
  suppression case and network denial: **133/133**, exit 0 (`sms-final.log`).
- Initial combined guidance output and subsequent oversized reads were truncated;
  bounded reads recovered the required guidance and relevant code. No edits were
  based on an assumed successful/truncated test result.
- Git under the scrubbed environment emitted macOS `confstr()` temporary-directory
  lookup warnings and used `/tmp`; all commands still exited 0. Subsequent normal
  local Git status/diff checks completed without that warning. No permission or
  provider/configuration change was used to suppress it.

- Initial local commit attempt exited **128**: sandbox denied creation of shared
  Git worktree metadata `index.lock` at the canonical repository's
  `.git/worktrees/source2/`. Staging had succeeded; no commit was created by that
  attempt. Restaging this receipt then hit the same index-lock denial; narrow
  escalation successfully staged the receipt. Recovery uses narrow escalation for the explicitly requested local
  commit only, with hooks/signing disabled for this invocation. No source edit in
  the canonical checkout, push, merge or deploy is authorized by that escalation.
  The final handoff reports the verified commit result and clean status.

Raw final test logs: `/private/tmp/revv-t6002-phase2/sms-final.log` and
`/private/tmp/revv-t6002-phase2/foundation-parts.log`. Broader native backend,
frontend/browser, and real-DB/autoprovision SQL concurrency suites were **not run
or claimed passed** in this phase. Legacy fixtures outside the four updated SMS
suites that omit persisted policy columns/rows need policy-aware fixture review
before full-suite host QA; absence must never default to ordinary in production.
No Spark/Remy/Grok verdict is claimed. This is safety-sensitive outbound/provider
and alert policy across more than two files; Hermes owns independent exact-SHA
review, host QA and release. Email/mailer and all other pending inventory rows
remain unresolved, so account designation and release remain held by the CHECK.

No real account created/designated/enabled, deployment, push, merge, live provider
call/send, credential access, production/customer-data mutation, cron/provider/
model/profile configuration change, board/messaging call, canonical repository
edit, or change to `job5feaddc2bfaf` / `t_59894b65` occurred.


## Phase-3 dispatch and validation receipt — 2026-10-21

Task `t_6002e02f`, SAME isolated source and branch. Preflight verified clean exact
HEAD `ce8d869bf55c79b090b525229dae97c9ac15f202` on
`codex/t_6002e02f-revv-test-shop`. This is the new candidate's parent;
immutable base `35e49ddc01d6ef7605f602d85faa9591308915ff` remains an ancestor.
No lifecycle/board/messaging/delegation calls. Hermes owns QA, review and release.
This receipt serves as the phase-3 dispatch log within the ten-file cap;
`CLAUDE.md` remains the historical phase-1 log.

Exactly ten changed files:

1. `backend/src/services/mailer.js`
2. `backend/src/services/email.js`
3. `backend/src/utils/discord.js`
4. `backend/src/services/notifyOps.js`
5. `backend/src/routes/auth.js`
6. `backend/src/routes/ros.js`
7. `backend/src/services/customerBilling.js`
8. `backend/src/services/ownerActivity.js`
9. `backend/test/emailShopPolicy.test.js`
10. `docs/INTERNAL-TEST-SHOP.md`

### Transport contract and converted callers

All four boundaries use the unchanged phase-2 `resolveShopPolicy`. Only exactly
one matching persisted Boolean FALSE authorizes an external effect. TRUE yields
`INTERNAL_TEST_SHOP`; absent/invalid/duplicate/mismatched/failed policy yields
`SHOP_POLICY_UNAVAILABLE`. No caller policy flag, email spelling, recipient
override, environment enable flag or object-shaped tenancy can bypass it.
Authenticated tenancy IDs and persisted resource/user/job shop IDs identify the
lookup; JWT policy claims are never consulted. These are internal functions, not
new public APIs. Never pass a body-supplied shop ID to them.

`sendMail(to, subject, html, shopId)` throws an Error with fixed `reason`,
`suppressed: true` and `provider_attempted: false` on suppression, before the
Resend configuration/send path. This preserves existing rejection handling and
prevents a truthy suppression object from being mistaken for provider success.
`sendEmail(..., shopId)`, `sendDiscordEmbed(embed, shopId)` and
`notifyOps(severity, code, { shop_id, ro_id })` return
`{ ok: false, suppressed: true, provider_attempted: false, reason }`.
SMTP loads nodemailer only after policy allows; no SDK import, client construction
or provider call occurs on suppression. Missing tenancy is unsupported even when
no provider is configured. There is **no non-shop operational bypass**: no
inspected unscoped caller established genuinely non-fixture provenance. Ops
failures retain local sanitized diagnostics, without external fallback or throttle
consumption. Every send resolves current policy; there is no cache.

- Auth: forgot-password selects the stored user's `shop_id`, retaining token
  creation, expiry, generic response, password validation/redemption and ordinary
  recipients/content. Accounts without a resolvable shop cannot receive reset
  mail in this candidate. Registration Discord receives the newly persisted ID;
  public FALSE remains mandatory and caller flags cannot designate a fixture.
- RO: queued status mail uses its authenticated shop argument, checks before
  preparation and again before the unpaid delivery payment-link branch, then
  rechecks at Resend. Closed review uses stored RO tenancy. Explicit invoice and
  asynchronous manager approval use the persisted scoped RO's shop ID. Every
  manager send checks separately; no recipient-derived policy.
- Customer billing: closed-paid invoice (including force) checks before tracking
  token preparation and again at send; rejection prevents the emailed marker.
  Existing ordinary eligibility/idempotency checks and payloads remain intact.
- Owner: digest and immediate alert check before preference/recipient work, then
  SMTP rechecks each send. Overrides cannot bypass. Detached critical activity and
  scheduled digest converge on these service guards. Suppressed/failed recipients
  are not counted as sent; ordinary recipients/content remain unchanged.
- Ops: existing insurance OCR late error callbacks already supply authenticated
  `req.user.shop_id`; queue alerts supply persisted job identity. The transport
  rechecks current policy after upstream asynchronous work. Discord registration
  is scoped; all other inspected Discord callers currently fail closed.

### Remaining consumers and release limitations

| Consumer | Exact remaining behavior / next work |
| --- | --- |
| `routes/payments.js` detached payment confirmation | Still calls sendMail without shop ID. Resend rejects `SHOP_POLICY_UNAVAILABLE` for ordinary and fixture shops; existing catch logs failure. Synthetic real-handler test proves zero external calls after mocked settlement. Forward the already verified settlement shop ID in a later batch. Closed-paid invoice in that callback uses the converted service. Stripe webhook parsing/settlement itself is not excluded by this phase. |
| `services/partsNotifications.js` email | Still omits shop ID. Resend logs/throws explicit `SHOP_POLICY_UNAVAILABLE`, never sends. Existing catch persists `unknown / verify_before_retry` and retains cooldown/event claim; it does not expose the enum or falsely record acceptance. Synthetic real-service test verifies this conservative outcome. Later convert trusted tenancy and map marked suppression explicitly. Ordinary parts email is also disabled until then. Existing SMS remains guarded independently. |
| `routes/public.js` estimate notification | Has a server-resolved shop but does not yet pass it to Discord; external notification is disabled for ordinary and fixture callers. Existing local intake behavior is unchanged. |
| Public lead/waitlist and direct Firestore | Discord without trusted tenancy is disabled, including forged body IDs/flags and fixture-looking emails. Local waitlist storage and frontend direct `addDoc` are NOT isolated by this backend guard. No designated fixture may use these public flows, and no fixture account can be enabled under the unchanged DB TRUE hold. Tests pin that hold and explicitly identify the unresolved Firestore bypass; they do not claim runtime Firestore isolation. A reviewed server-authorized fixture path is required before enabling/designating accounts. No unsafe public test flag was added. |
| Owner digest job | Service guards block email, but enumeration and pre-service digest-date claim still include fixtures; local event capture remains. Scheduler/reporting isolation is pending. |
| Other provider/billing/reporting inventory | Direct checkout/Stripe, reservations/reconciliation, invoice generation, QuickBooks, AI/media/catalog, reporting/metrics/export and other rows above remain open. The status email guards do not constitute an atomic or system-wide billing exclusion. |
| Legacy test fixtures | `src/__tests__/email.production.test.js` and `notificationLogging.privacy.test.js` omit mail tenancy/persisted policy; `test/paymentReservations.remyA.test.js` has a closed import map lacking the new billing policy dependency. They were inspected, not run or claimed passing in this phase. Adapt their synthetic fixtures in a later batch; never weaken production fail-closed behavior to satisfy an unscoped fixture. Full backend/frontend/browser and real-DB QA remain Hermes-owned. |

This candidate is intentionally **not release-ready**: unconverted ordinary mail
and notifications are disabled, and broader fixture exclusions remain incomplete.
The new tests exercise the actual transports/resolver and converted handlers/services
with synthetic rows, including force, override, detached work, late policy changes,
provider failures, no-provider behavior, ordinary payloads/recipients and consent.
Existing provider/idempotency algorithms were not rewritten. No separate global
notification sender or non-shop escape was introduced.

### Deterministic commands and outcomes

Node v22.23.2; scrubbed environment; no real database, SDK or network providers.
The deny-network preload is copied unchanged from phase 2 and replaces
`net.Socket.prototype.connect`, `tls.connect`, `http[s].request/get` and global
`fetch` with `TEST_NETWORK_PROHIBITED`. Test VM fetch/SMTP and DB adapters are
synthetic. No app bootstrap, dotenv/config/credential read or live provider send
is used by the new suite.

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase3/deny-network.cjs --test backend/test/emailShopPolicy.test.js
```

Final exit **0**: **42 tests, 42 passed, 0 failed/cancelled/skipped/todo**.
Log: `/private/tmp/revv-t6002-phase3/focused-final.log`.

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase3/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/smsTestRecipient.test.js backend/test/smsConsent.phase2.test.js backend/test/smsProvisioning.auto.test.js backend/test/smsProvisioning.events.test.js backend/test/internalTestShop.test.js backend/test/productionStartup.test.js backend/test/idTypeCastGuard.test.js backend/test/partsNotifications.test.js
```

Exit **0**: **190 tests, 190 passed, 0 failed/cancelled/skipped/todo**.
Log: `/private/tmp/revv-t6002-phase3/regression.log`. Named real-PostgreSQL cases
are explicitly excluded, not counted as passing. The existing parts suite uses
mock adapters for ordinary behavior; the new suite separately tests the actual
unconverted email caller against the real guarded transport.

Syntax: each of the nine changed `.js` paths above, individually with
`env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --check <path>`.
Final checks and commit identity are verified in the handoff. The database hold,
initializer/schema/startup files and phase-2 policy/SMS/provisioning files remain
byte-identical to parent. No provisioning/designation path is added.

### Failure and recovery history

- Initial combined guidance read exceeded output limits; bounded reads recovered
  required guidance and relevant code. Later oversized inventory output was also
  bounded to the relevant callers. No check result was inferred from truncation.
- One test-file search had a zsh unmatched glob (`backend/test/*auth*`); subsequent
  `rg`/explicit-path searches recovered. No edit or test execution was affected.
- First new-suite run: **35 passed, 1 failed**. The harness used a fixed microtask
  count and inspected the detached owner alert before its second recipient
  completed. Replaced that timing assumption with a host event-loop turn.
  First shell wrapper returned the tail command's status (0), not the test runner's
  failure status; the TAP failure was reported immediately. Subsequent commands
  explicitly capture and return the runner status. Expanded rerun: **40/40**, exit
  0; final with unpaid-status/omitted-helper-scope coverage: **42/42**, exit 0.
- No production behavior was relaxed for a test. Added a second status policy
  check before the payment-link branch after reviewing late-change coverage.

No account was created, designated or enabled. The requested account remains
**HELD** and `shops_internal_test_shop_hold CHECK (is_internal_test_shop IS FALSE)`
remains in force. No push/merge/deploy, live send/provider call, production or
customer DB access/mutation, secrets access, config/cron/model/profile change,
board/messaging call, canonical checkout source edit, or protected job/task change.
Safety-sensitive outbound/auth policy, more than two files: Hermes owns host QA,
Spark disposition, one independent exact-SHA review and release. No reviewer
verdict is claimed; this is a local implementation candidate only.
