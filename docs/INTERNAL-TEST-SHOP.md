# Internal test shops — t_6002e02f

## Phase-9 source-only provisioning receipt — 2026-10-21 13:24 EDT / 17:24 UTC

Task `t_6002e02f`, sole implementation lane, clean starting SHA
`c1704619988e63625a861776bd6ae443ca07347f`, branch
`codex/t_6002e02f-revv-test-shop`, verified canonical REVV linked worktree.
Read current CLAUDE.md, QA-CHECKLIST.md, this document and ACTIVE-WORK.md.
Phase8C's accepted closure is retained; no phases1–8 policy boundary was relaxed.
Hermes/Oracle owns board/lifecycle, independent QA/review and release. No such
calls, delegation or messaging occurred here.

### Installation contract (source only; never executed in this phase)

The only production entry is `node backend/scripts/provision-internal-test-shop.js`.
There is no package/install hook, HTTP route, self-service setter, seed/demo reuse,
JWT/role/plan authority or email-domain authorization. An authorized installer must
later supply `REVV_INTERNAL_TEST_SHOP_EMAIL` and
`REVV_INTERNAL_TEST_SHOP_PASSWORD` in its process environment. No example password,
installation account or environment file is created here. The requested
`zordon+revvqa@mail.grokbot.com` account remains **HELD**.

All CLI arguments are refused. Password input comes only from the one environment
entry, which is deleted immediately after capture and again at cleanup. No argv,
stdin, prompt, file, default or receipt password input exists. The existing auth
minimum (six characters) and bcrypt implementation/cost 10 are used; NUL and inputs
exceeding bcrypt's 72-byte limit are refused. Email is trimmed/lowercased, ASCII
validated with bounded total/local lengths, and control characters are rejected.
Importing the CLI/core reads no environment/config/DB/secrets and runs nothing.
The CLI lazily obtains the normal server `db/postgres` pool only after validation;
no app bootstrap, startup migration, seed, public-slug service or provider loads.
The existing SQL public-intake slug default supplies the unused local slug.

Provisioning uses one explicit READ COMMITTED transaction (independent of server
isolation defaults), a transaction-scoped PostgreSQL advisory lock
from normalized email, and a shops/users table lock that also serializes ordinary
registration writes. Deterministic, non-secret, versioned email-derived UUID-shaped
IDs work with TEXT/UUID/VARCHAR(36). This is a dedicated identity namespace, not a
conversion of existing ordinary IDs. Existing email matches, either deterministic
ID and all users of the target shop are checked under locks. Only the complete
one-shop/one-owner fixture with matching IDs, normalized email, safe fields and a
valid cost-10 bcrypt hash is idempotent. Partial/orphan/duplicate/cross-tenant,
ordinary, wrong-role, trial/paid, provider/SMS identity and unknown populated fields
are collisions. No password comparison, rehash/reset, role/settings update or
unrelated-row mutation occurs on rerun.

The only data writes are one shops INSERT and one users INSERT. Plan is explicitly
free, role owner, trial/expiry NULL, SMS comp FALSE, SMS/email notifications FALSE,
onboarded FALSE and internal designation TRUE. No global/admin grant, customer,
demo, provider, subscription, billing or SMS row is created. Before creation and
before COMMIT, catalog-derived tenant/user references (including foreign keys and
optional provider tables) are locked and required empty. Every ID is bound and
catalog identifiers are quoted. Persisted rows are reread after INSERT, so an
unexpected populated default or changed identity rolls back. Row-security-filtered
reads fail closed; unsupported target-table RLS, rules or INSERT triggers are
refused. This conservative mechanism supports a pristine fixture only: populated
business/identity rows or changed fixture settings require refusal and review,
never cleanup/backfill. It does not authorize using public Firestore flows.

Success is one stable JSON line, only persisted normalized email, shop/user IDs,
owner role, TRUE flag, exclusion version/list, and the explicit limitation:
**Public Firestore lead flows are not supported for fixture validation until
separately isolated.** No password/hash/token/provider ID or secret-derived value
appears. IDs depend on email/version only, never password. All failures emit fixed
enums; DB/hash/release/pool-error details are discarded. A failure after COMMIT
(e.g. connection close) is reported as failure, never a successful receipt; a later
separately authorized retry must verify persisted state. No effects are retried.

### Hold transition and preserved boundaries

Both fresh declarations retain `BOOLEAN NOT NULL DEFAULT FALSE`, without the old
blanket TRUE hold. Startup takes its advisory lock and shops table lock, adds the
column only if absent, then validates existing Boolean type, FALSE default,
NOT NULL, non-generated shape and constraints without repairing or rewriting data.
Only the exact validated, local, non-inherited historical
`shops_internal_test_shop_hold CHECK (is_internal_test_shop IS FALSE)` may be dropped.
Unknown/weakened/unvalidated/inherited constraints fail before DROP; absence is
idempotent. It validates again after DROP and checks every persisted TRUE fixture's
complete safe ownership/state before COMMIT. Failure rolls back the entire
transition. The CLI itself cannot drop the hold or migrate schema.

Public registration still explicitly inserts SQL FALSE. Ordinary updates still
cannot write designation; their actual-handler tests are retained. Persisted
consumer exclusions from phases1–8 are unchanged. Lead/waitlist backend notifications
remain fail-closed. The frontend direct Firestore lead write/read/export residual
is unsupported; Firebase configuration/credentials were not opened and no runtime
Firestore coverage is claimed. No fixture or existing account has been designated.

### Canonical verification

Node v22.23.2, `env -i`, only synthetic input/adapters, deny-network preload,
no dotenv reads and pg query/connect denied. All tests execute tracked canonical
paths, with no test-source substitutions. The startup suite's subprocesses use
its existing closed-import fake runtime and empty synthetic environment. The
synthetic SQL adapter models transactions/serialization and inspects emitted SQL;
it is not PostgreSQL and is not proof of real SQL/locking behavior.

| Final receipt | Exit | Tests | Pass | Fail | Skip |
| --- | ---: | ---: | ---: | ---: | ---: |
| focused-complete-final | 0 | 158 | 158 | 0 | 0 |
| policy-complete-final (11 files) | 0 | 1715 | 1715 | 0 | 0 |
| affected-complete-final (10 files) | 0 | 646 | 646 | 0 | 0 |

The policy set includes remainingParityPolicy and the prior eleven-file canonical
set. The affected set includes the prior 635 checks plus 11 phase8C checks in
ros.totalLoss, status.gates and panelEstimator.economics. Counts across commands
overlap and must not be summed as unique tests. No broad/full-host green claim.

Exact commands, cwd/environment JSON, full logs and exit files are in
`/private/tmp/revv-phase9/`. Commands from the assigned worktree:

```sh
# focused-complete-final
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 TZ=UTC NODE_OPTIONS=--require=/private/tmp/revv-phase9/deny-network.cjs /opt/homebrew/opt/node@22/bin/node --test --test-reporter=tap --test-concurrency=1 '--test-skip-pattern=real PostgreSQL' backend/test/internalTestShopProvisioning.test.js backend/test/internalTestShop.test.js backend/test/productionStartup.test.js backend/test/idTypeCastGuard.test.js
# policy-complete-final
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 TZ=UTC NODE_OPTIONS=--require=/private/tmp/revv-phase9/deny-network.cjs /opt/homebrew/opt/node@22/bin/node --test --test-reporter=tap --test-concurrency=1 '--test-skip-pattern=real PostgreSQL' backend/test/internalTestShop.test.js backend/test/remainingParityPolicy.test.js backend/test/ordinarySurfacesPolicy.test.js backend/test/billingShopPolicy.test.js backend/test/emailShopPolicy.test.js backend/test/metricsShopPolicy.test.js backend/test/payments.phase4.test.js backend/test/partsNotifications.test.js backend/src/__tests__/publicIntake.test.js backend/src/__tests__/trueShopProfit.costProfile.test.js backend/src/__tests__/trueShopProfit.engine.test.js
# affected-complete-final
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 TZ=UTC NODE_OPTIONS=--require=/private/tmp/revv-phase9/deny-network.cjs /opt/homebrew/opt/node@22/bin/node --test --test-reporter=tap --test-concurrency=1 '--test-skip-pattern=real PostgreSQL' backend/test/paymentReservations.remyA.test.js backend/test/smsConsent.phase2.test.js backend/src/__tests__/redesign.phase4.test.js backend/test/estimateImport.test.js backend/src/__tests__/ros.roleVisibility.test.js backend/src/__tests__/ros.assignedToScope.test.js backend/test/remainingParityPolicy.test.js backend/src/__tests__/ros.totalLoss.test.js backend/src/__tests__/status.gates.test.js backend/test/panelEstimator.economics.test.js
```

Dedicated real PostgreSQL: **NOT RUN**. Eleven top-level gates across the selected
files are name-filtered (their nested real-PG cases are not executed or counted).
No PostgreSQL instance, socket, server or psql process was accessed. Exact names:

- `real PostgreSQL refuses wrong true default without rewriting existing policy`
- `real PostgreSQL refuses existing null without rewriting existing policy`
- `real PostgreSQL refuses wrong type without rewriting existing policy`
- `real PostgreSQL refuses weakened constraint without rewriting existing policy`
- `real PostgreSQL fresh shops declaration in db/index.js defaults false before migrations`
- `real PostgreSQL fresh shops declaration in db/schema.pg.sql defaults false before migrations`
- `real PostgreSQL TEXT: defaults, repeat migration, row preservation, NULL rejection`
- `real PostgreSQL UUID: defaults, repeat migration, row preservation, NULL rejection`
- `real PostgreSQL payment reservations, parallel creation and settlement (mock Stripe only)`
- `real PostgreSQL mounted ready -> auto link -> cash, audit/tenant/concurrency witnesses`
- `real PostgreSQL phone/shop matching, STOP revocation and reconfirmation suppression`

Seven touched JS files receive Node22 `--check`; `git diff --check` and the
changed-path/secret-pattern scan are recorded in `checks.json`. Canonical tests
verify import isolation, environment-only input, fixed output, post-write rollback,
12 concurrent synthetic attempts converging to one shop/owner, zero rerun writes
or hashing, collisions, identity types, strict schema transition, and preserved
public/update and consumer gates. No real password/hash/identity was used.

Exactly ten changed paths:

- `CLAUDE.md`
- `backend/scripts/provision-internal-test-shop.js`
- `backend/src/db/index.js`
- `backend/src/db/internalTestShop.js`
- `backend/src/db/schema.pg.sql`
- `backend/src/services/internalTestShopProvisioning.js`
- `backend/test/emailShopPolicy.test.js`
- `backend/test/internalTestShop.test.js`
- `backend/test/internalTestShopProvisioning.test.js`
- `docs/INTERNAL-TEST-SHOP.md`

### Failure history, limits and handoff

Initial combined historical-document reads and one follow-up search output were
truncated; bounded reads recovered relevant current instructions before editing.
A password-module filename search had no matches (policy is inline in auth.js),
and a speculative db/subscriptions.js path was absent (definitions are in
migrate.js). No code decision relied on missing output. No test assertion has failed.
Focused runs progressed 142/142, 152/152, 156/156, then final 158/158 as cases were
added. Initial policy/affected runs also passed 1715/1715 and 646/646. Inspection
caught and removed an unnecessary public-slug helper DB import before final gates.
The first final-rerun wrapper incorrectly sliced argv and omitted each group's
first file: focused 41, policy 1686, affected 579, all exit0 but incomplete and
not accepted as final verification (`*-verified-final` logs retained). Reported
immediately, corrected by selecting explicit `.test.js` argv entries and asserting
4/11/10 files. Verified recovery is `*-complete-final`: 158/1715/646, all exit0.
No supplied deadline is at risk; Bryan needs no action for these source changes.

Safety-sensitive tenant/auth/schema transition and more than two files: Hermes
must route the required independent exact-SHA review after its commit guard and
host QA. Real PostgreSQL transition/locking/concurrency, final host/browser QA,
Spark/Remy verdicts, installation/account creation, deployment and release are
unperformed, not claimed. No production/customer/account/provider/network actions,
secrets/.env/vault/keychain reads, credential generation, sends, config/profile/
provider/model/cron changes, push/merge/deploy/install or lifecycle calls occurred.
`job5feaddc2bfaf` is preserved; `t_59894b65` remains **DO NOT APPLY**.
Final commit status follows.

### Commit-blocked final state

`git add -- <the exact ten paths above>` exited **128** before staging:

```text
fatal: Unable to create '/Volumes/Zordon Storage /openclaw-workspace/Revv/.git/worktrees/source2/index.lock': Operation not permitted
```

Exact argv/stdout/stderr: `/private/tmp/revv-phase9/commit-add.json`.
No commit command ran; no escalation, retry, lock bypass or shared-metadata edit.
Intended narrow non-amending message: `Add server-only internal test shop provisioning`.
HEAD remains `c1704619988e63625a861776bd6ae443ca07347f`; worktree is **dirty**:
seven modified tracked files, three new source/test files, zero staged paths.
All ten paths are listed above. Hermes commit guard owns the non-amending commit
and subsequent exact-SHA gates. This is a verified source handoff, not a reviewed,
installed, provisioned, deployed or released result. The blocker was reported as
soon as observed; no Bryan action or additional permission is requested.


## Historical phase1–8 inventory and receipts

The following inventory/holds/pending statements are historical. The phase-9
source-only receipt above supersedes their provisioning/hold continuation plan;
all real installation, host QA and release remain outside this phase.

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
| `routes/subscriptions.js` status, ensureStripeCustomer, checkout, billing portal, subscription-created/updated/deleted webhooks | Phase 4: strict persisted policy before lazy SDK/client access and each customer/checkout/portal call; status refuses fixture paid-plan representation. Both webhook aliases locally verify signatures, require unique persisted customer ownership, then recheck policy before shop-scoped writes. Suppression is explicit 409/503, never a mutating acknowledgement. Existing remote recurring charges cannot be stopped by local guards; designation remains forbidden. |
| `routes/payments.js` intent/create-intent aliases, links, reconcile, webhook receipts, history/RO totals; `services/stripe.js` | Phase 4: intent/create-intent, link, reconciliation and signed settlement converge on guarded adapter/reservation boundaries. SDK loading/client creation is lazy and allowed only with persisted FALSE; retained methods recheck. History remains readable (reporting exclusion pending). Payment callbacks verify raw signatures without importing Stripe. |
| `services/customerBilling.js` checkout link, tracking token and closed-paid invoice email | Phases 3/4: closed-paid mail and force are guarded; phase 4 also guards direct checkout, standalone tracking-token creation and invoice_emailed_at persistence after send. Stripe payload, cents and reservation key remain unchanged. PDF generation is a separate pending consumer. |
| `services/paymentReservations.js` reserve, settle, reconcileAttempt/reconcileLocked, manual/deletion locks | Phase 4: current policy on the same connection after parent lock, before each service billing mutation, before every reconciliation provider call, and before commit. Direct/locked reconcile, lazy expiry, binding, legacy adoption, settlement, investigations and audit are guarded. Policy refusal is rethrown, never stored as unknown/released. Cash/approval callbacks using withLockedRo reject at entry and roll back at the final policy gate. No standalone scheduled Stripe billing job was found. |
| `routes/invoice.js` authenticated invoice, repair-order PDF and public token invoice; `routes/ros.js` invoice mail, close/paid/manual settlement and queued QB sync | Phase 5: public/authenticated PDF context and final lazy renderer guarded; invoice JSON/email and detached QB queue check persisted policy. Public tenancy comes only from token/RO records. Ordinary content/cents retained. |
| `routes/accounting.js`, `services/quickbooks.js` OAuth/token refresh, qbRequest, customer/item creation, single/batch invoice sync, disconnect | Phase 5: route and service/provider policy checks guard OAuth URL/exchange, refresh/save/delete, sync enablement, customer/item/invoice creation and manual/batch/detached sync. Current policy is required after asynchronous preparation and before each provider call/write. |
| `routes/reports.js` summary, monthly JSON/CSV, tech workload, revenue/RO/performance/insurance tabs | Phase 6: strict persisted entry/final guards; explicit 409/503 excluded response before business SQL or CSV headers/bytes. No ordinary zero for a suppressed tenant. |
| `routes/dashboard.js` instruments, monthly supplement opportunity, owner KPIs, weekly revenue/tech/parts/stages | Phase 6: all four routes and supplement helper guarded; ordinary cents, timestamp casts and calculations retained. |
| `routes/performance.js`, `routes/goals.js`, `routes/ros.js` job-costing, carryover/turnaround and active counts; `services/profit.js`, `services/roMoney.js` calculation consumers | Phase 6 covers performance and goal GET/PUT/helper, including lazy goal writes. RO job-cost/carryover-pending/turnaround and direct calculation consumers remain pending. |
| `routes/superadmin.js` shops/detail/stats/ratings/accounts/helpdesk; `routes/diagnostics.js` counts/heal | Phase 6: strict-FALSE membership in every relevant aggregate/list/subquery; selected-shop refusals, linked support-actor guard and diagnostic repair filtering. Filtered absence cannot trigger auto-seeding. Operational user/password/impersonation tools are not a designation mechanism. |
| `routes/customers.js` customer/vehicle/RO counts; `routes/reviews.js` summary; `routes/public.js` public shop ratings | Phase 7: strict persisted entry/final guards on customer reads/counts, reviews and public shop metadata/ratings; public rating SQL independently requires strict FALSE. |
| `middleware/roLimitGuard.js`, `middleware/planGuard.js`, `services/estimateAiPolicy.js` admissions/budgets | Phase 6: RO admission and estimate-AI service reject fixtures before entitlement/count/eligibility/budget work; no paid/admin grant. General planGuard and other provider/usage consumers remain pending. |
| `app.js` runCarryoverForActiveShops; `jobs/monthCarryover.js` | Phase 5: startup SQL requires IS FALSE; direct consumer checks on the same transaction connection, locks parent ROs then policy row, and rechecks before carryover write/commit. No billing_month value is changed. Real SQL concurrency QA remains pending. |
| `jobs/ownerActivityDigest.js`, `services/ownerActivity.js` digest, immediate critical alerts, preference overrides | Phase 3: service entry guard and per-recipient SMTP check cover scheduled/direct digest, overrides and detached critical alerts. Phase 7 filters scheduler enumeration and checks locked persisted policy in the claim transaction; refusals consume no date. Local event writes remain. |
| `jobs/feedbackDailyAudit.js`, `routes/feedback.js`, superadmin helpdesk totals | Phase 6 excludes superadmin helpdesk/feedback aggregates and feedback lookup. Phase 7 guards feedback entry/routing and scoped lists, filters the global list, and audits only strict-FALSE shops with locked per-shop mutation checks. No provider sender is present in this job. |
| `services/shopPolicy.js`; `services/sms.js` sendSMS/sendStaffSMS | Phase 2 implemented: strict persisted resolver, entry/final send guards before config/client/provider resolution, including supplied config and staff capability. Getter-only config/diagnostic APIs do not send. Zero-client synthetic tests and ordinary SMS suites pass. |
| `routes/sms.js` test/direct/thread sends and inbound webhook; `services/smsAutoReply.js` | Outbound paths converge on guarded sendSMS; direct/auto-reply negative tests executed. Inbound signature/callback and local STOP/START processing unchanged; no TwiML outbound reply added. |
| `services/customerOptInConfirmation.js`, `services/partsNotifications.js`, `routes/ros.js` status/tracking/supplement sends, `routes/portal.js` tracking, `routes/timeclock.js` staff SMS | Central exclusion implemented; executed real handler/service tests cover RO, portal, status, opt-in, parts SMS and staff wrapper suppression. Timeclock uses the guarded staff wrapper. Parts email is fail-closed unsupported in phase 3 because its caller omits shop ID; no ordinary send until conversion. |
| `services/smsProvisioning.js` manual/force and automatic entry; `services/smsProvisioningQueue.js` discovery, due/claim, session guard, purchase/retry/publish/alerts; `services/smsProvisioningProvider.js`; `services/smsProvisioningEvents.js` | Phase 2 implemented: discovery/due/attention filters, manual/automatic entry, direct claim, locked transaction/worker checks, provider factory/retained adapter checks and failure/ops-alert suppression. Preexisting jobs, retries/intents, force, late policy changes and ordinary callback/idempotency behavior tested with synthetic adapters. Signed registration receiver itself remains local-only and unchanged. Legacy unexported createTwilioClient defect remains; not counted as a guard. |
| `services/mailer.js` Resend and `services/email.js` SMTP/helpers | Phase 3: mandatory trusted shop ID, persisted policy before provider/client/SDK/network. Missing/ambiguous/unconverted tenancy refuses delivery. See exact transport result contract below. |
| Mail callers: `routes/auth.js`, `routes/ros.js` status/review/invoice/manager approval, `routes/payments.js`, `services/customerBilling.js`, `services/partsNotifications.js`, `services/ownerActivity.js` | Phase 3 converts auth, all four RO mail call sites, closed-paid invoice and owner activity. Payments receipt and parts email intentionally remain unsupported/fail-closed at Resend; see remaining-consumer table below. |
| `utils/discord.js`; callers `routes/auth.js`, `routes/leads.js`, `routes/waitlist.js`, `routes/public.js` estimate intake | Phase 3: Discord requires a separate trusted shop ID. Registration converted. Public lead/waitlist remain disabled at this boundary for all callers; phase 7 converts public estimate intake using persisted link tenancy and fresh pre-notification policy. No body flags or recipient-derived identity. |
| `services/notifyOps.js`; callers `routes/insuranceOcr.js`, `services/smsProvisioningQueue.js` | SMS provisioning caller guarded in phase 2, including error fallback and late checks. Phase 3 guards generic notifyOps using context.shop_id from server-owned callers, covering late OCR failure alerts and rechecking queue alerts. Unresolved/global alerts stay local. |
| Frontend `components/LeadCaptureForm.jsx`, `pages/LeadsDashboard.jsx` | **Additional bypass:** lead form writes directly to Firestore before an unauthenticated backend Discord request; dashboard reads/exports all Firestore leads. Requires separate server-authorized fixture isolation and tests; a backend-only flag cannot cover this direct write. Firebase configuration/credentials were not opened. |
| `services/notifications.js`, `routes/notifications.js`, local notification writes in `routes/timeclock.js`; `routes/comms.js`, `routes/inspections.js` send marker; agreement/approval links | Inspected paths are local rows/link/marker operations, not outbound push transports. No push sender found in backend/frontend source search. Still verify downstream notification consumption before enabling fixtures. |
| `jobs/mediaIntegrity.js`, `services/mediaStorage.js`, upload routes; `services/openai.js`, catalog/tracking provider services and their routes | Broader zero-external-effect requirement: object-store mirror/restore, AI, supplier/tracking calls also need exclusion or a genuinely isolated fixture environment. Global media sweep mirrors files independently of shop-reference queries. Frontend Settings also has direct geocoding. These are not covered by messaging guards. |
| `routes/apiV1.js`, `middleware/apiKeyAuth.js`, `routes/export.js` | Phase 7 guards both JWT exports. Global-key API list filters strict-FALSE membership; direct reads resolve minimal persisted RO tenancy before guarded, shop-bound payload reads. Catalog/inspections mounts remain separate pending consumers. |

## Next session in this SAME lane

Keep the database hold and account HELD. Phases 5/6 close selected invoice/QuickBooks/carryover and reporting/usage boundaries (receipts below), without claiming full billing/reporting exclusion. Phase 7 closes owner digest claims, feedback routing/audit, public estimate notifications and the selected ordinary route/export surfaces. Next address unsupported payments/parts mail consumers, legacy fixtures, remaining scheduler/reporting/provider exclusions and a reviewed server-authorized public fixture path. Reuse the persisted resolver; do not accept body/JWT policy flags or infer fixture identity from email. Background jobs, public token routes, unscoped mail and direct Firestore writes still need their own boundaries. Billing/reporting/provider/metrics/scheduler rows marked pending above remain acceptance gaps.

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


## Phase-4 dispatch and validation receipt — 2026-10-21 11:02 EDT / 15:02 UTC

Sequential phase 4 of `t_6002e02f`; implementation only. Preflight verified **clean**
`codex/t_6002e02f-revv-test-shop` at exact parent
`d1c38e5e65e0f4f877b0aff188ee414fb7b3ef28` and original base
`35e49ddc01d6ef7605f602d85faa9591308915ff` is an ancestor. Work stayed in
`/Users/zordon/.hermes/kanban/workspaces/t_6002e02f/source`. This receipt is the
phase dispatch log; historical CLAUDE.md is unchanged to respect the path cap.
The local commit containing this receipt is identified by its full SHA in the handoff.

Exactly **10 changed paths**, including tests/docs:

1. `backend/src/routes/subscriptions.js`
2. `backend/src/routes/payments.js`
3. `backend/src/services/paymentReservations.js`
4. `backend/src/services/stripe.js`
5. `backend/src/services/customerBilling.js`
6. `backend/test/billingShopPolicy.test.js`
7. `backend/test/paymentReservations.remyA.test.js`
8. `backend/test/payments.phase4.test.js`
9. `backend/test/emailShopPolicy.test.js`
10. `docs/INTERNAL-TEST-SHOP.md`

### Persisted policy and callback contract

The unchanged `shopPolicy.js` remains authoritative: exactly one matching stored
shop with Boolean `false` permits effects. TRUE returns `INTERNAL_TEST_SHOP`;
missing, invalid, duplicate, mismatched or failed lookup returns
`SHOP_POLICY_UNAVAILABLE`. Caller body/JWT flags, email, plan, admin claims,
provider metadata flags and supplied tracking tokens cannot override that lookup.
No paid-plan privileges, fixture admin role or designation path is introduced.

- `getStripeClient(shopId, readRows)` is now asynchronous and loads the Stripe SDK
  only after current policy allows. All production callers were converted. Its
  retained adapter checks current policy before every SDK method, including nested
  customer/subscription/checkout/portal, intent, refund, invoice and reconciliation
  methods. The transaction reader is an internal server-owned adapter, never a
  request option. `createPaymentIntent` requires a separate trusted shop ID as its
  fifth argument; payload metadata is not policy authority. No raw client export.
- Subscriptions cover status, checkout, customer creation and customer-ID saving,
  portal, `/` and `/webhook`. Subscription callbacks resolve the signed customer
  ID to exactly one persisted shop, then use both customer and shop ID in UPDATE.
  Signed metadata cannot select a different tenant. Customer-mapping query failure
  also fails closed. The original known-price plan mapping and ordinary metadata
  fallback are unchanged; fixtures cannot reach any plan write.
- Payments cover `/intent`, backward-compatible `/create-intent`, `/link/:roId`,
  owner/admin `/reconcile/:roId`, the payment webhook, direct checkout service,
  reservation creation, provider-result binding, direct/locked reconciliation,
  lazy expiry, legacy adoption, settlement/failure/investigation and audit writes.
  The same connection checks policy after the existing tenant-scoped parent lock,
  before each service mutation and before COMMIT. No shop lock is added, avoiding
  inversion with tax edits. Payment policy refusal is explicit and does not become
  a reconciliation unknown/released audit outcome. Ordinary cents, max-paid floor,
  active holds, parent locks, provider keys, tenant checks, exact currency/amount,
  failed-checkout retry behavior and duplicate/stale callback rules remain intact.
- The shared locked wrapper also denies fixture cash/manual mark-paid and estimate
  approval before their callbacks execute; a late policy failure at its final gate
  rolls the transaction back. These routes retain their existing error format.
  Direct tracking-token creation checks before lookup and INSERT; closed-paid invoice
  mail rechecks before persisting its sent marker after the send await.

Webhook signatures are verified **locally before any policy lookup/mutation**, using
Node crypto over exact raw bytes with SHA-256 HMAC, timing-safe v1 comparison, multiple
v1 signatures for rotation, and the existing Stripe 300-second past-age tolerance.
Only raw Buffer/string payloads are accepted; parsed bodies, missing signature/secret,
invalid signature and expired payloads are rejected. Installed Stripe verifier source
was inspected read-only to check the signing/tolerance contract; no SDK was executed
for verification. Duplicate/malformed timestamp headers are conservatively rejected.
Existing raw-body mounts in `app.js` are unchanged. `/api/subscriptions/webhook`
mounts router `/`; the router's `/webhook` alias is also covered. The authenticated
base mount receiving an already-parsed callback still fails closed, as before.

Supported, authenticated fixture callbacks return HTTP **409** with
`{ error: "INTERNAL_TEST_SHOP", reason: "INTERNAL_TEST_SHOP", suppressed: true }`.
Unresolvable policy/ownership returns **503** with the analogous
`SHOP_POLICY_UNAVAILABLE` enum. The selected synchronous routes use the same contract;
checkout service returns `ok: false` plus the enum/suppressed fields. No successful
acknowledgement, subscription/payment/reservation/invoice/identity mutation, provider
follow-up, release, refund, or delivery marker is produced for suppressed callbacks.
Provider retries are deliberately not disguised as success. Unrelated verified event
types and subscription-mode checkout events with no RO identity remain no-op
acknowledgements. Missing Stripe API configuration no longer silently acknowledges an
unverified callback: signing secret and valid signature are required independently.

Late changes are checked at each next boundary. Already completed ordinary effects
cannot be undone: e.g. policy changing during provider creation leaves the previously
committed reservation held, suppresses identity binding, and performs no release or
new provider request. Changing during customer creation suppresses customer-ID save
and checkout; it does not delete the provider customer. These are intentionally
conservative uncertainty outcomes, not a promise of zero earlier ordinary effects.
Policy snapshots do not implement an atomic designation protocol or cancel remote
recurring billing. The database TRUE hold remains mandatory.

### Exact remaining bypasses and release limitations

The following are **pending**, not covered by a full billing-exclusion claim:

| Path / entry | Remaining behavior |
| --- | --- |
| `routes/invoice.js`: GET `/public/:token`, `/:roId/repair-order`, `/:roId`; `loadInvoiceContext` / `streamDocumentPdf` | Invoice/repair-order PDF generation remains available for eligible persisted fixture records, including preexisting public tokens. No provider charge is involved, but the invoice-generation exclusion is unfinished. |
| `routes/ros.js`: GET `/:id/invoice`, POST `/:id/email-invoice` | Invoice JSON/content is still prepared without a fixture exclusion. Phase-3 Resend guard denies external email, but this is not an invoice-generation guard. |
| `routes/accounting.js`: QuickBooks connect-url/callback, disconnect, sync-enabled, sync/ro/:id and sync/batch; `services/quickbooks.js` | `exchangeCodeForTokens`, `refreshTokens`, `saveTokens`, `ensureAccessToken`, `qbRequest`, `ensureIncomeItem`, `ensureCustomer`, `syncInvoiceForRo`, `disconnect` and `setSyncEnabled` still lack persisted fixture policy. They can exchange/store billing credentials, create external customers/items/invoices and sync bookkeeping. The verified OAuth state is not a fixture exclusion. |
| `routes/ros.js`: `queueQuickBooksSync` on PUT `/:id`, POST `/:id/status` and `/:id/mark-paid` | Existing detached QB sync can still reach the unguarded QuickBooks service. Fixture manual settlement is blocked by the shared lock wrapper, but other status/edit callers and policy changes after an ordinary commit are not protected at the QB boundary. |
| `routes/ros.js` cash callback inside `withLockedRo` | Entry and final commit policy gates protect durable cash writes. Individual callback-local writes are not each preceded by policy reads; a change during its balance await may execute SQL before the final rollback. No atomic concurrent designation guarantee is claimed. |
| `routes/payments.js` GET `/history/:shopId`, `routes/export.js`, reporting/dashboard/money aggregation and `jobs/monthCarryover.js` / startup enumeration | Fixture ledger reads, exports, business totals and billing-month writes remain unexcluded; read-only collection behavior is not full reporting isolation. `withLockedRo` now refuses fixture GET `/ro/:roId`. |
| `routes/payments.js` detached receipt email | Still omits the trusted shop argument at sendMail, so ordinary receipts remain explicitly unsupported at the phase-3 mail transport. This phase preserves that held limitation; fixture callbacks now stop before notifications/detached mail. Closed-paid mail uses its guarded helper. |
| Existing remote Stripe identities/subscriptions/links | Local refusal cannot stop a preexisting external subscription from charging. Never attach/convert a shop with live identities to a fixture. Reviewed provisioning and disposition of existing external identities are still absent and not authorized here. |
| Earlier inventory: parts/public-intake mail, direct Firestore, jobs, metrics, AI/media/catalog and entitlements | All earlier uncompleted rows remain pending. No paid-feature/admin bypass was added; general entitlement isolation is still unfinished. |

No other production Stripe SDK import/client consumer was found in `backend/src`:
all `getStripeClient` / `createPaymentIntent` / webhook callers there now converge
on this guarded adapter. Scripts, frontend, real providers and account lifecycle
remain outside scope. Full feature and requested account remain **HELD**.

### Deterministic commands and evidence

Node **v22.23.2**. All runs use `env -i` and synthetic DB/provider adapters.
No app bootstrap, dotenv, secret file, real database (including disposable PG),
account or provider was accessed. `/private/tmp/revv-t6002-phase4/deny-network.cjs`
replaces `net.Socket.prototype.connect`, `tls.connect`, `http[s].request/get` and
`globalThis.fetch` with a function throwing `TEST_NETWORK_PROHIBITED`. No dependency,
lockfile, manifest, frontend, seed/demo or production configuration changes.

Focused final command (**exit 0**, log `focused-expanded.log` in that directory):

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase4/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/billingShopPolicy.test.js backend/test/paymentReservations.remyA.test.js backend/test/payments.phase4.test.js backend/test/emailShopPolicy.test.js
```

Tail: **tests 697; pass 697; fail 0; cancelled 0; skipped 0; todo 0**.
Includes **182** new billing policy cases, **4** new actual manual/approval route
cases, existing **469** payment cases and **42** email cases. The two named
real-PostgreSQL payment tests are explicitly excluded, not counted as passing.
Their real-DB fixtures have not been adapted or verified in this phase. The new
suite loads actual resolver/routes/adapter/reservation/billing modules with a closed
import map and explicit stored policy rows; absent rows never default to ordinary.
It verifies initial zero imports/clients/calls/writes, aliases, signed callbacks,
forged fields, all policy failure shapes, retained refund/invoice/subscription
methods, late changes/query failures, direct services, ordinary cents/provider keys,
settlement idempotency and conservative cancellation timeout behavior. Existing
ordinary suites retain transaction identity, accounting, locks and data-loss checks.

Regression command (**exit 0**, log `regression.log`):

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase4/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/smsTestRecipient.test.js backend/test/smsConsent.phase2.test.js backend/test/smsProvisioning.auto.test.js backend/test/smsProvisioning.events.test.js backend/test/internalTestShop.test.js backend/test/productionStartup.test.js backend/test/idTypeCastGuard.test.js backend/test/partsNotifications.test.js
```

Tail: **tests 190; pass 190; fail 0; cancelled 0; skipped 0; todo 0**.
Named real-PostgreSQL consent/foundation cases are excluded, not counted as passing.
Combined final deterministic evidence: **887 passed, zero failed**. Full backend,
real-DB concurrency, frontend/browser QA, Spark advisory and independent exact-SHA
review were not run or claimed. Legacy fixtures elsewhere that omit policy require
separate review; fail-closed production behavior was not weakened for tests.

Each of the nine changed JS paths was checked individually (**9/9 exit 0**):

```sh
for file in backend/src/routes/subscriptions.js backend/src/routes/payments.js backend/src/services/paymentReservations.js backend/src/services/stripe.js backend/src/services/customerBilling.js backend/test/billingShopPolicy.test.js backend/test/paymentReservations.remyA.test.js backend/test/payments.phase4.test.js backend/test/emailShopPolicy.test.js; do
  env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --check "$file" || exit "$?"
done
git diff --check
```

The executed syntax driver used Python `subprocess.run` to run these same nine
`node --check` invocations with exactly the environment above and stop on failure.
`git diff --check`: **exit 0**. `git diff --exit-code d1c38e5e65e0f4f877b0aff188ee414fb7b3ef28 -- backend/src/db/internalTestShop.js backend/src/db/index.js backend/src/db/migrate.js backend/src/db/schema.pg.sql backend/src/app.js backend/src/routes/auth.js backend/src/services/shopPolicy.js`:
**exit 0**, confirming hold/schema/startup/public-FALSE/resolver byte preservation.

### Failure and recovery history

- Initial combined guidance output was truncated. Bounded reads recovered current
  instructions, relevant runtime safeguards, QA checklist and the full phase receipt
  document before implementation. No test result was inferred from truncation.
- First ordinary run (`ordinary-first.log`), same focused command without the new
  billing or email test files: **exit 1, 469 tests, 464 passed / 5 failed**.
  Four manual-payment assertions saw an unrelated notification SELECT after COMMIT
  because the synthetic dbAll adapter newly routed all reads into the transaction
  query log. Restricted that fixture forwarding to actual policy SELECTs, preserving
  the original COMMIT assertion. One Stripe-helper fixture lacked the real policy
  dependency and trusted argument; added explicit strict-FALSE stored rows and the
  fifth shop argument. No production guard was relaxed.
- First combined rerun (`focused-first.log`), same final focused command without
  email suite: **exit 0, 627/627**. Expanded final run above: **697/697**, exit 0.
  No failed syntax/diff/regression check. Every failed test attempt was reported
  promptly and retained here; no retry erased the initial failure.

- Initial local stage/commit command exited **128** before staging: sandbox denied
  `/Volumes/Zordon Storage /openclaw-workspace/Revv/.git/worktrees/source2/index.lock`.
  No commit was created by that attempt. Recovery is the user-authorized narrow
  escalation for `git add` of only the ten paths above and local `git commit` on
  the current branch, with hooks/signing disabled for this invocation. No canonical
  checkout source edit, push, merge or deployment is included. The final handoff
  verifies the resulting full SHA, exact parent, ten paths and clean worktree.

No Hermes/Kanban, messaging, delegation, cron, provider/model/profile/config,
deployment, push, merge, production service, real send, account creation, backfill,
customer-data mutation or secret access occurred. `job5feaddc2bfaf` and `t_59894b65`
remain DO NOT APPLY. Safety-sensitive billing/signature/financial-history changes,
more than two files: Hermes/Oracle owns lifecycle, independent QA, review and release.
No external review verdict is claimed. The deliberate
`shops_internal_test_shop_hold CHECK (is_internal_test_shop IS FALSE)` is unchanged.

## Phase-5 dispatch and validation receipt — 2026-10-21 11:14 EDT / 15:14 UTC

Sequential phase 5 of `t_6002e02f`, implementation only, same isolated worktree
`/Users/zordon/.hermes/kanban/workspaces/t_6002e02f/source` and branch
`codex/t_6002e02f-revv-test-shop`. Preflight verified clean exact parent
`35b3595a724e23440746fca913ed87b32f5d7463` and ancestor
`35e49ddc01d6ef7605f602d85faa9591308915ff`. Required guidance/current runtime
safeguards, QA checklist, phase receipts and ACTIVE-WORK ownership were read.
This receipt is the current dispatch log; historical CLAUDE.md remains unchanged.

Exactly ten tracked paths in this candidate:

1. `backend/src/routes/invoice.js`
2. `backend/src/routes/ros.js`
3. `backend/src/routes/accounting.js`
4. `backend/src/services/quickbooks.js`
5. `backend/src/services/customerBilling.js`
6. `backend/src/jobs/monthCarryover.js`
7. `backend/src/app.js`
8. `backend/src/__tests__/redesign.phase4.test.js`
9. `backend/src/__tests__/status.gates.test.js`
10. `docs/INTERNAL-TEST-SHOP.md`

### Implemented guarantees and ordinary behavior

The existing strict persisted resolver is unchanged: exactly one matching Boolean
FALSE row authorizes effects. TRUE, missing/invalid/mismatched/duplicate rows and
query failures deny. Request/JWT/body/email/token/plan/admin/provider metadata never
designates policy. Internal trusted tenancy arguments only select the persisted row.
No missing synthetic fixture is treated as ordinary.

- Invoice PDF context loading checks authenticated or persisted token tenancy;
  the final renderer rechecks persisted RO tenancy before loading PDFKit, constructing
  a document, setting PDF headers or piping bytes. All callers await the renderer,
  preserving error handling. Public token lookup/expiry and scoped RO lookup remain;
  closed/paid eligibility, PDF content, exact cents, logo/footer and authorization
  signature text are unchanged. Suppression uses the existing route error response
  with fixed policy reason; no invoice bytes or success JSON is emitted.
- RO invoice JSON checks at entry and after asynchronous enrichment before response.
  Explicit invoice mail checks before preparation and before send; the actual mailer
  independently checks at its provider boundary. Existing totals/response semantics
  remain. The existing public-token issuer now rechecks after lookup before returning
  a retained token; INSERT already had its own current-policy gate. Search found no
  other production `portal_tokens` INSERT. Tracking/portal operational reads outside
  public invoice rendering remain a separate inventory item.
- Accounting routes check before status/connect/disconnect/enable/manual/batch work.
  Callback tenancy comes from the existing verified signed OAuth state, then current
  persisted policy; query/provider metadata cannot authorize effects. Connect URL is
  now awaited. Exchange/refresh require a trusted shop argument; missing arguments
  fail closed. The service guards direct calls, token reads/refresh/save/delete,
  access-token return after lookup, customer/item/invoice creation, and every fetch
  after asynchronous preparation. Each provider-derived persistence step rechecks.
  Existing OAuth signature/expiry behavior, credential payloads, 401 bounded retry,
  disconnect semantics, invoice line amounts, and per-RO batch failure isolation
  are retained. QuickBooks uses native fetch, not an SDK/client factory; suppressed
  calls reach neither fetch nor any SDK. No financial authority changes were made.
- Detached RO QuickBooks work checks before connection lookup and again before the
  independently guarded sync service. Existing catch/log handling is retained;
  denied or failed queued calls do not become unhandled rejections.
- Startup carryover SQL now requires `is_internal_test_shop IS FALSE`. Direct job
  invocation begins a transaction, resolves policy on that same connection, locks
  qualifying parent ROs in stable ID order, takes a shared shop-row lock, then
  rechecks policy before UPDATE and COMMIT. The update is restricted to locked IDs
  and repeats eligibility predicates. Return value is actual rowCount, repeated
  invocation is idempotent, failures roll back/release, and policy refusal returns
  zero without a write. The job only marks `carried_over`; it does not rewrite
  `billing_month`, cents, settlement, signatures, reservations or audit history.

Synthetic late changes stop the *next* boundary. A request previously authorized
while FALSE may already have reached the provider before a subsequent TRUE/unavailable
read; later token/accounting writes and calls are suppressed, not compensated by new
provider effects. Synthetic final-commit refusal rolls back carryover writes. No
atomic system-wide designation protocol or cancellation of existing external invoices,
subscriptions, tokens or accounting identities is claimed. The DB TRUE hold remains
mandatory. Production lock/concurrency behavior still needs independent real-DB QA.

### Explicit gaps / HELD scope

- `backend/src/jobs/ownerActivityDigest.js` remains unchanged and **pending**: SQL
  enumeration includes fixtures and the INSERT/ON CONFLICT claim can consume
  `owner_activity_last_digest_date` before the service. The existing guarded
  `services/ownerActivity.js` and SMTP boundary still prevent fixture sending.
  No zero-claim guarantee is claimed for that scheduler. Its proposed edit was
  removed before the candidate, reserving two paths for required ordinary invoice
  and paid-close regression fixtures. The comprehensive new tests were consolidated
  into the existing invoice test file to stay within ten paths; no new test file remains.
- `src/__tests__/moneyAuthority.phase1.test.js` has two pre-existing missing-policy
  payment fixtures (named below) that return 503 instead of expected 400/200. Both
  reproduce against exact parent source; they are excluded from the final passing
  regression run, not fixed or represented as passing.
- Legacy `test/payments.phase4.test.js` detached RO mocks lack `../services/shopPolicy`.
  Four queued QB calls log that caught dependency error in the passing regression
  run. One legacy status-email fixture also logs `SHOP_POLICY_UNAVAILABLE`. Those
  mocks do not prove delivery. The new actual-service/queue tests and updated
  `status.gates.test.js` independently verify ordinary FALSE queue success, policy
  suppression and provider-error handling. No guard was weakened for legacy mocks.
- Remaining earlier inventory is still pending: reporting/export/metrics and ledger
  reads, broader schedulers, unsupported payments/parts/public-intake mail, public
  fixture designation, direct Firestore, other AI/media/catalog providers, and full
  entitlement isolation. No provisioning/designation was added. Requested account
  and full feature remain **HELD**, not release-ready.

### Exact deterministic commands and results

Node **v22.23.2**. All tests use scrubbed `env -i`, synthetic DB/providers only,
no dotenv/secret files, real DB/accounts, listeners or network. Preload
`/private/tmp/revv-t6002-phase5/deny-network.cjs` replaces `net.Socket.prototype.connect`,
`tls.connect`, `http[s].request/get` and global fetch with throwing
`TEST_NETWORK_PROHIBITED`. VM tests have a closed import map and an explicit local
fetch mock. No package install, manifest/lockfile, frontend or config changes.
Commands below were executed through Python subprocess with the exact shown env;
individual return codes were captured and raw logs retained in that temporary directory.

Focused final (`focused-final.log`), **exit 0: tests 310, pass 310, fail 0,
cancelled 0, skipped 0, todo 0**. Includes 304 new synthetic cases plus 2 existing
invoice/logo and 4 existing status-gate cases:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase5/deny-network.cjs --test --test-concurrency=1 backend/src/__tests__/redesign.phase4.test.js backend/src/__tests__/status.gates.test.js
```

Coverage includes actual public/auth invoice routes, direct renderer, actual RO
JSON/mail routes, actual QuickBooks routes/service, verified callbacks, manual/batch/
detached sync, direct token issuer, actual carryover job and exact startup-enumeration
function executed without booting app/config. Counts assert zero PDF import/construction/
stream, provider calls and token/accounting/carryover writes for initial suppression;
late changes/query failures, forged metadata, strict cardinality, ordinary exact
content/cents, state rejection, refresh/401, entity creation, batch isolation,
queue errors, parent-lock ordering, rollback/release and repeat idempotency are covered.
There were no pre-existing standalone accounting or carryover unit suites; the new
cases execute those actual modules with synthetic adapters.

Regression final (`regression-final.log`), **exit 0: tests 717, pass 717, fail 0,
cancelled 0, skipped 0, todo 0**:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase5/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL|payment intent rejects underpayment unless explicitly partial|payment webhook reconciles partial and paid statuses from cents' backend/test/billingShopPolicy.test.js backend/test/emailShopPolicy.test.js backend/test/paymentReservations.remyA.test.js backend/test/payments.phase4.test.js backend/src/__tests__/ros.assignedToScope.test.js backend/src/__tests__/ros.totalLoss.test.js backend/src/__tests__/ros.roleVisibility.test.js backend/src/__tests__/moneyAuthority.phase1.test.js backend/src/__tests__/roMoney.unit.test.js
```

Node omits name-filtered tests from its counts: the two named legacy payment tests
and real-PostgreSQL tests were explicitly excluded, not passed. Caught legacy
notification/queue fixture errors above remain visible in the log.

Foundation final (`foundation-final.log`), **exit 0: tests 57, pass 57, fail 0,
cancelled 0, skipped 0, todo 0**:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase5/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/internalTestShop.test.js backend/test/productionStartup.test.js backend/test/idTypeCastGuard.test.js backend/test/partsNotifications.test.js
```

Real-PostgreSQL foundation cases excluded, not counted as passes. Final selected
commands total **1,084 passed, zero failed** with those explicit exclusions.
Full backend, real-DB locking/concurrency, browser/frontend, Spark advisory and
independent exact-SHA review were not run or claimed.

Nine changed JS paths individually syntax-checked (**9/9 exit 0**); diff check
**exit 0**. Equivalent exact shell invocations:

```sh
for file in backend/src/routes/invoice.js backend/src/routes/ros.js backend/src/routes/accounting.js backend/src/services/quickbooks.js backend/src/services/customerBilling.js backend/src/jobs/monthCarryover.js backend/src/app.js backend/src/__tests__/redesign.phase4.test.js backend/src/__tests__/status.gates.test.js; do
  env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --check "$file" || exit "$?"
done
git diff --check
git diff --exit-code 35b3595a724e23440746fca913ed87b32f5d7463 -- backend/src/db/internalTestShop.js backend/src/db/index.js backend/src/db/migrate.js backend/src/db/schema.pg.sql backend/src/routes/auth.js backend/src/services/shopPolicy.js backend/src/jobs/ownerActivityDigest.js
```

The byte comparison exited **0**: hold/schema/initializer/public FALSE/resolver and
pending digest scheduler are preserved. The sole app.js change is the carryover
enumeration SQL; startup validation/hold ordering and scheduler configuration stay intact.

### Failure and recovery history

- Combined initial guidance reads and a few subsequent oversized reads were
  truncated. Bounded reads recovered current instructions, required safeguards,
  phase-4 gaps and relevant code before implementation; no result inferred from
  truncated output.
- First focused run (`focused-first.log`): **296 tests, 292 passed / 4 failed**.
  Three new queue tests counted the mailer's configuration log as a second error;
  assertions now count only the queue-error log. One 401 mock assumed query text
  existed in every `/query` URL; now models the empty query too. Initial shell
  wrapper ended with `tail` (wrapper exit 0 did not mean the failed Node tests
  passed); all subsequent drivers captured individual Node exit codes explicitly.
  Exact initial command used the same scrubbed env/preload and
  `--test --test-concurrency=1 backend/test/invoiceAccountingPolicy.test.js backend/src/__tests__/redesign.phase4.test.js`.
  The temporary new suite was later consolidated into redesign.phase4.test.js.
- Focused recovery (`focused-recovery.log`): **exit 0, 296/296**. Same initial
  command plus `--test-skip-pattern='real PostgreSQL'`; no exclusions matched.
- First regression (`regression-first.log`): **exit 1, 723 tests, 720 passed /
  3 failed**. Command was final regression above with only skip pattern
  `real PostgreSQL` and with `backend/src/__tests__/status.gates.test.js` also
  included. Two pre-existing missing-policy payment fixtures failed 503 vs 400/200;
  paid-close's old fixture had no stored FALSE row and its QB count was zero.
  Added explicit matching persisted FALSE only to the paid-close synthetic adapter.
- Exact-parent diagnostic (`parent-money.log`): **exit 1, 4 tests, 2 passed /
  2 failed**, same two named moneyAuthority payment cases. A temporary
  `parent-source.cjs` preload substitutes `git show` exact-parent text for the
  changed production JS modules during CommonJS compilation, preserving their
  original filenames/import paths. No checkout/worktree change, config, provider
  or real DB access. Exact command:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase5/deny-network.cjs --require /private/tmp/revv-t6002-phase5/parent-source.cjs --test backend/src/__tests__/moneyAuthority.phase1.test.js
```

- After consolidation and paid-close fixture repair (`focused-consolidated.log`):
  **exit 0, 300/300**, same command as focused final. Ten additional boundary/parity
  cases yielded final **310/310**. Final regression/foundation results are above.
  No failed syntax or diff check. Failures were reported as they occurred;
  two baseline failures and legacy mocked delivery gaps remain explicit.

Safety-sensitive invoice/accounting/scheduled-billing changes across more than two
files. No financial-authority, cents, settlement, signature or data-loss rule was
altered. No Hermes/Kanban/messaging/delegation call, push/merge/deploy, real account,
provider effect, secret read, cron/provider/model/profile/config change, seed/demo,
production mutation or protected-task/job change. `job5feaddc2bfaf` is preserved;
`t_59894b65` remains DO NOT APPLY. Hermes/Oracle owns lifecycle, independent QA,
review and release. No external review verdict is claimed. The requested account
and full feature remain **HELD** under the unchanged deliberate database TRUE hold.

Local commit recovery: the initial narrow `git add`/`git commit` command exited
**128** before staging because the sandbox denied creation of
`/Volumes/Zordon Storage /openclaw-workspace/Revv/.git/worktrees/source2/index.lock`.
No commit was created by that attempt. Recovery uses the expressly authorized
narrow Git escalation to stage only the ten listed paths and create one local
commit on the current branch, with hooks/signing disabled for that invocation.
No canonical source edit, push, merge or deployment is included. Final handoff
verifies the resulting full SHA, exact parent, ten paths and clean worktree.

## Phase-6 dispatch and validation receipt — 2026-10-21 11:27 EDT / 15:27 UTC

Sequential phase 6, implementation lane only, task `t_6002e02f`. Preflight verified
clean exact parent `36cfb23a6ddce1ceb1dc40ed79423b9887032832`, original ancestor
`35e49ddc01d6ef7605f602d85faa9591308915ff`, current branch
`codex/t_6002e02f-revv-test-shop`, and isolated worktree
`/Users/zordon/.hermes/kanban/workspaces/t_6002e02f/source`. Common Git metadata
resolves to canonical REVV. Read current CLAUDE.md dispatch/safeguards,
QA-CHECKLIST.md, this inventory and ACTIVE-WORK ownership; no duplicate dispatch.
This section is the phase dispatch log; CLAUDE.md is unchanged to honor the cap.

Exactly ten tracked paths:

1. `backend/src/routes/reports.js`
2. `backend/src/routes/dashboard.js`
3. `backend/src/routes/performance.js`
4. `backend/src/routes/goals.js`
5. `backend/src/routes/superadmin.js`
6. `backend/src/routes/diagnostics.js`
7. `backend/src/middleware/roLimitGuard.js`
8. `backend/src/services/estimateAiPolicy.js`
9. `backend/test/metricsShopPolicy.test.js`
10. `docs/INTERNAL-TEST-SHOP.md`

### Contracts and complete selected-file trace

The existing `services/shopPolicy.js` resolver is byte-identical. Exactly one
matching persisted row with Boolean FALSE authorizes tenant metrics/admission.
TRUE denies with `INTERNAL_TEST_SHOP`; missing, mismatched, duplicate, NULL,
omitted, numeric/string flags, invalid IDs/results and query errors deny with
`SHOP_POLICY_UNAVAILABLE`. No request/body/JWT/email/plan/admin flag determines
policy. Authenticated tenancy selects the row; support target IDs select rows only
after existing superadmin authentication. No entitlement exception was added.

Tenant HTTP suppression is **409** (fixture) or **503** (unavailable), JSON
`{ "error": "INTERNAL_TEST_SHOP" | "SHOP_POLICY_UNAVAILABLE", "excluded": true }`.
There is no successful business payload, synthetic ordinary zero, CSV header or
export body on refusal. Entry guards precede business reads/aggregation; successful
HTTP metric responses recheck after preparation. Existing auth/role middleware
still runs first. Ordinary data shapes, calculations, cents, tenant bindings,
order/limits and CSV escaping remain unchanged; tests compare actual results and
report SQL against exact-parent handlers.

| Consumer | Entry points / functions traced and disposition |
| --- | --- |
| `reports.js` | GET `/summary` (month/all, revenue/profit/status/type/insurance/recent), `/monthly/:yearMonth`, `/monthly/:yearMonth/csv`, `/tech-workload`, `/:tab` revenue/ros/performance/insurance and unknown-tab branch. All guarded. `toCsvValue` remains the same pure formatter, only reached by authorized export. Economics/redaction dependencies are reached only after entry authorization. |
| `dashboard.js` | GET `/instruments`, `/supplements/monthly-opportunity`, `/owner-kpis`, `/weekly`; all guarded. Internal `getMonthlySupplementOpportunity` independently checks policy before SQL. `requireOwnerAdminOnly` is unchanged; integer cents, economics metadata, cast-safe timestamps, cycle/tech/supplement/parts/revenue math remain unchanged. |
| `performance.js` | GET `/` checks before closed-RO/time-entry/user reads and before response; original monthly dates, technician grouping, averages and decimal strings unchanged. |
| `goals.js` | GET/PUT `/:yearMonth`, `ensureGoalForMonth` (existing/default/copied goal), prior-month RO count and lazy INSERT/upsert guarded. Recheck before writes, including PUT's existing/insert branches. Existing-goal UPDATE now repeats `shop_id` ownership in its WHERE. `requireAdmin`, `isValidYearMonth`, `previousMonth` retain original behavior. No fixture lazy goal write. |
| `superadmin.js` | GET `/accounts`, `/helpdesk`, `/shops`, `/shops/:shopId`, `/stats`, `/ratings`: strict-FALSE SQL membership at every independent child grouping, feedback summary, joined list, parent shop list and global shop/user/RO/customer count. Feedback TEXT identity compares with shop `id::text`; existing joins retain native types elsewhere. `EXISTS`/inner joins prevent NULL/missing-shop leakage; no `IS NOT TRUE` or coalesced policy. Selected query/parameter shop IDs also get explicit resolver refusals. Helpdesk owner list, issue/error/status counts, team users and bounded pagination are covered. |
| `superadmin.js` support operations | Existing `superadmin` middleware remains first. A linked support actor must resolve FALSE; an existing global unscoped superadmin identity retains existing authentication. This does not mint or upgrade any role. PATCH `/feedback/:feedbackId` lookup also uses strict-FALSE inner membership. POST `/users/:userId/set-password`, DELETE `/users/:userId`, POST `/impersonate`, `issueImpersonationToken` and feedback normalization/prompt helpers retain their existing operational target semantics; all are behind the linked-actor guard. These are not new provisioning/designation tools or a complete support-target isolation feature. |
| `diagnostics.js` | GET `/`: schema/connectivity checks retained; shop/user/admin/invalid-RO counts filter strict-FALSE membership. POST `/heal`: entry/pre-repair policy, UPDATE eligibility filters and reported rowCount exclude fixtures. A filtered zero cannot trigger seed/demo creation: legacy automatic reseeding is replaced with an explicit suppressed-seeding action. Existing activity logging remains. No real filesystem activity path or seed was invoked in QA. |
| `roLimitGuard.js` | Direct middleware checks policy before reading plan/trial or monthly RO count, then before `next()`. Fixtures cannot acquire pro/agency/trial/admin exceptions. Ordinary free cap 25, active trial, paid plans and monthly count SQL are preserved. Missing auth remains 401. |
| `estimateAiPolicy.js` | Direct `admitEstimateAi` checks policy before pool connection, then on the same connection after the existing parent shop lock, before budget INSERT/UPDATE and before COMMIT. Locked shop cardinality/identity are also strict. Initial denial touches no eligibility, DB clock, counter, budget or provider. Return is `{status:'excluded',reason:'INTERNAL_TEST_SHOP',excluded:true}` or `{status:'unavailable',reason:'SHOP_POLICY_UNAVAILABLE',excluded:true}`; existing off/quota/admitted and transaction-failure contracts remain. Ordinary 15-admission/10-minute window behavior is unchanged. The actual OCR `createEstimateBudget` rejects every non-admitted result before provider factory/call/counter. |

No initial suppression causes a goal, diagnostic, counter or budget write. AI
late locked/prewrite refusals perform no budget write; precommit refusal rolls
back the synthetic pending write and consumes no durable budget. HTTP final
refusal suppresses prepared data; it does not undo previously authorized local
goal/repair work. These guards are not an atomic system-wide designation protocol.
The database TRUE hold remains necessary; real PostgreSQL concurrency and SQL
execution are not claimed by synthetic membership/SQL-contract tests.

### Remaining unexcluded surfaces / HELD scope

- `routes/customers.js` GET `/` vehicle/RO/active counts and customer full/history/
  detail operational payloads still lack policy. `routes/reviews.js` GET `/summary`
  average/count/rating groups, GET `/`, and public review token context/submit remain
  pending. `routes/public.js` GET `/shop/:shopId` average/count/review listing,
  intake metadata and estimate intake remain outside this phase.
- `routes/export.js` GET `/ro/:id` bundle and `/shop/ros` CSV remain pending.
  `routes/apiV1.js` GET `/estimates`, `/estimates/:id`, `/jobs/:id/status` and API-key
  middleware have no fixture reporting boundary. Report-route CSV coverage does
  **not** cover these exports/APIs.
- `routes/ros.js` GET `/job-cost/summary`, `/carryover-pending`,
  `/turnaround-estimate` active-RO count, lists/details/labor summaries and direct
  `services/panelEstimatorEconomics.js` / `profit.js` calculation consumers remain
  unexcluded outside guarded callers. `routes/payments.js` history/ledger reads
  remain as previously documented. No full revenue/reporting exclusion is claimed.
- `jobs/ownerActivityDigest.js` enumeration and digest-date claim still include
  fixtures before the guarded sending service. `jobs/feedbackDailyAudit.js`
  feedback routing/status counts, `routes/feedback.js` consumers and
  `jobs/mediaIntegrity.js` cross-shop media enumeration/repair counts remain pending.
  Existing guarded mail/SMS transports do not establish zero local job claims.
- `middleware/planGuard.js` and other AI/media/catalog/provider/usage consumers
  remain pending. Only estimate-AI admission and RO-limit consumers are covered
  here. Other earlier gaps (unsupported ordinary payments/parts/public-intake mail,
  direct Firestore reads/exports, general entitlement isolation and remote existing
  billing identities) remain. No designated account or setter is enabled.
- Unmodified dashboard/AI legacy test fixtures still need migration in a later
  slice; their raw candidate run is **RED**, detailed below. The temporary adapted
  run verifies compatibility but is not a claim that unchanged suites pass.
- Full backend, real-DB SQL/locking/concurrency, frontend/browser, Spark advisory,
  independent exact-SHA review and release verification were not run or claimed.

The unchanged `shops_internal_test_shop_hold CHECK (is_internal_test_shop IS FALSE)`
continues to prohibit designation. Requested account and full feature remain
**HELD**. No fixture is granted paid/admin access as a workaround.

### Exact deterministic commands, counts and evidence

Node **v22.23.2**. All test processes use the scrubbed environment below; no dotenv,
secrets, real DB/accounts/providers, listeners, network or dependency installation.
Preload `/private/tmp/revv-t6002-phase6/deny-network.cjs` throws
`TEST_NETWORK_PROHIBITED` for net connect/listen, TLS, HTTP(S) request/get and fetch.
New tests execute actual source via closed-import VM adapters, real policy resolver
and roles, synthetic DB/providers, and exact-parent read-only `git show` comparisons.
The cross-shop mixed-population adapter models membership; it is not a SQL engine.

Focused final (`focused-final.log`): **exit 0; 510 tests, 510 passed, 0 failed,
0 cancelled/skipped/todo**:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase6/deny-network.cjs --test --test-concurrency=1 backend/test/metricsShopPolicy.test.js
```

Existing policy/foundation (`policy-regression.log`): **exit 0; 265 tests,
265 passed, 0 failed/cancelled/skipped/todo**:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase6/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/billingShopPolicy.test.js backend/test/emailShopPolicy.test.js backend/test/internalTestShop.test.js backend/test/productionStartup.test.js backend/test/idTypeCastGuard.test.js
```

Relevant existing reports/dashboard/admin/AI/economics run, unmodified fixtures
(`regression-first.log`): **exit 1; 62 tests, 9 passed / 53 failed**, including one
failed parent test containing fourteen failed subtests. No cancelled/skipped/todo.

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase6/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PG|real PostgreSQL' backend/src/__tests__/dashboard.postgresShape.test.js backend/src/__tests__/redesign.phase2.test.js backend/src/__tests__/superadmin.feedbackWorkflow.test.js backend/src/__tests__/insuranceOcr.costPolicy.test.js backend/test/estimateAiPolicy.integration.test.js backend/test/panelEstimator.economics.test.js
```

There are no standalone existing goals/performance/diagnostics/RO-limit test files
in the searched backend test directories; all are exercised by the new suite.
Node omits name-filtered cases from counts. The real-PG estimate-AI cases and the
real-PostgreSQL panel-economics test, plus optional real-PostgreSQL foundation
cases, were excluded, not passed. No PostgreSQL server or app listener was started.

Exact-parent comparison (`parent-regression.log`): the same six-file command with
`--require /private/tmp/revv-t6002-phase6/parent-source.cjs` immediately after the
deny-network preload: **exit 0; 62/62 passed**, no failures/skips. The preload
substitutes only the eight production files' exact-parent text in CommonJS and VM
reads, preserving paths and all fixtures/assertions. This establishes that the
legacy failures are caused by the new dependency/contract, not pre-existing RED.

Synthetic fixture migration experiment (`regression-adapted.log`): the same
six-file candidate command with
`--require /private/tmp/revv-t6002-phase6/legacy-fixtures.cjs` immediately after the
deny-network preload: **exit 0; 62/62 passed**, no failures/skips. This temporary
preload changes only test source: dashboard DB adapters answer policy SELECTs with
matching stored FALSE; AI fixture loaders allow the **actual** shopPolicy module,
with synthetic FALSE rows in both default and locked-connection adapters. Existing
AI-enabled flags, failure paths, providers, quota/counter assertions and all other
assertions are retained. The invalid-ID assertion is updated to the new explicit
unavailable/reason/excluded contract. No production policy is mocked to allow.
This is separately labeled evidence, not a repair of the unchanged legacy files.
Those files were not edited because the ten-path cap is already occupied.

Nine changed JS paths individually checked (**9/9 exit 0**); `git diff --check`
**exit 0**. Exact equivalent shell commands (the executed Python driver ran each
with its own return-code capture):

```sh
for file in backend/src/routes/reports.js backend/src/routes/dashboard.js backend/src/routes/performance.js backend/src/routes/goals.js backend/src/routes/superadmin.js backend/src/routes/diagnostics.js backend/src/middleware/roLimitGuard.js backend/src/services/estimateAiPolicy.js backend/test/metricsShopPolicy.test.js; do
  env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --check "$file" || exit "$?"
done
git diff --check
git diff --exit-code 36cfb23a6ddce1ceb1dc40ed79423b9887032832 -- backend/src/services/shopPolicy.js backend/src/db/internalTestShop.js backend/src/db/index.js backend/src/db/migrate.js backend/src/db/schema.pg.sql backend/src/app.js backend/src/routes/auth.js
```

The byte-preservation comparison exited **0**: resolver, database hold/schema,
startup and public-registration FALSE unchanged. No manifest/lockfile, frontend,
seed/demo file, production config or unrelated tracked path changed.

Raw logs and temporary harnesses are retained in `/private/tmp/revv-t6002-phase6/`.
SHA-256 identities:

```text
deny-network.cjs       db8a29cfa68f51eecaa7e5f8b89e0e7ce4d6ca806cc644b85ceed7501c88a099
parent-source.cjs      0d235e67750f60dbb3bf75b615bdba200eae71285b5b618754aca7de0e3304f5
legacy-fixtures.cjs    f07129cbf019ad4e76b7d49fc6177aa5025858da7a7e3f30c2c586d0acf256e8
focused-final.log      9869974b154a9c4270b235b517f7cd773a9c91b84fef3d9b3c9cdf6b19cabd69
policy-regression.log  2d56c61c19cf1669308a5587636a6212c222cbdc8066be3c76d0188af6396916
regression-first.log   0582aad727104dcd0693061812781b44a4e899adf84857599893c040a44965e7
parent-regression.log  632f0a3ed56496d977f0cd3dc72ae2c1371bb4b535704caf05097b6b89573779
regression-adapted.log 5b9e949ae41b73f49725b5c91613e97c9327f20851716b7d6084818fff8f6364
```

### Failures and verified recovery

- Initial combined guidance/current-code output was truncated; bounded reads
  recovered the relevant instructions, safeguards, phase inventory and all selected
  source before edits. No result was inferred from truncation.
- First focused run (`focused-first.log`), same focused command: **exit 1,
  420 tests, 410 passed / 10 failed**. The new OCR-wrapper extraction used the wrong
  function name (`createEstimateAiBudget` instead of actual `createEstimateBudget`).
  Corrected only the test harness. Recovery (`focused-recovery.log`): **exit 0,
  420/420**; expanded (`focused-expanded.log`): **exit 0, 463/463**; final **510/510**.
- Raw existing-suite run failed as above: three dashboard assertions got 503 because
  synthetic dbAll returns no stored policy; 34 OCR cost-policy cases and fifteen
  isolated AI test/subtest results failed on forbidden `./shopPolicy`, plus the
  failed enclosing test. Exact-parent **62/62** and temporary fixture-adapted
  candidate **62/62** confirm the cause and compatibility. Raw candidate suites
  remain RED until those separate fixture files are migrated; no guard was relaxed
  and no failing result is hidden behind the adapted run.
- No syntax, diff, new-suite final or existing policy/foundation failure. Every
  failure was reported when observed; recovery was reported only after verification.

Safety-sensitive metric/usage/budget policy changes across more than two paths.
Hermes/Oracle owns lifecycle, independent QA, review and release; no Spark/Remy
verdict is claimed. No Hermes/Kanban/messaging/delegation calls, push/merge/deploy,
real account/data/provider effects, secret/.env reads, cron/provider/model/profile/
config changes, provisioning/designation or protected changes occurred.
`job5feaddc2bfaf` is preserved; `t_59894b65` remains **DO NOT APPLY**.
Full feature and requested account remain **HELD**.

Local commit uses the user's expressly authorized narrow Git escalation because
this linked worktree index lives under canonical REVV `.git/worktrees/source2`,
outside the writable source root (the known index-lock sandbox boundary). Scope is
only `git add` of the ten paths above and one local, non-amending commit on the
current branch, with hooks/signing disabled for that invocation. No push, merge,
canonical checkout edit or release is included. Final handoff verifies full SHA,
exact parent, ten committed paths and clean worktree.


## Phase-7 dispatch and validation receipt — 2026-10-21

Sequential phase 7, task `t_6002e02f`, implementation lane only. Preflight found
clean exact parent `c9c4e9d64d46ebb8ec719c46066c2b6f5b8faee1` on
`codex/t_6002e02f-revv-test-shop` in the assigned isolated worktree
`/Users/zordon/.hermes/kanban/workspaces/t_6002e02f/source`.
`git merge-base --is-ancestor 35e49ddc01d6ef7605f602d85faa9591308915ff HEAD`
exited 0. Common Git metadata resolves to canonical REVV. Read the current
CLAUDE.md dispatch/runtime safeguards, QA-CHECKLIST.md, this inventory/receipts
and ACTIVE-WORK ownership. This is the phase dispatch log within the path cap;
historical CLAUDE.md remains unchanged. No duplicate worker or lifecycle call.

Exactly ten paths: the eight requested production files below,
`backend/test/ordinarySurfacesPolicy.test.js`, and this document. Every named
production file has a relevant consumer; none was omitted.

### Contracts and selected-file coverage

The existing `services/shopPolicy.js` is unchanged. Exactly one matching persisted
shop row with Boolean FALSE is required. TRUE gives `INTERNAL_TEST_SHOP`; missing,
duplicate, mismatched, null, omitted, string/numeric flags, invalid IDs/results and
query failures give `SHOP_POLICY_UNAVAILABLE`. No client/body/JWT policy flag,
email, plan, role, force field or provider option authorizes ordinary behavior.

Tenant HTTP refusal is 409 for fixtures or 503 for unavailable policy, with
`{error:reason,excluded:true}`. API-v1 retains its error envelope:
`{success:false,error:{code:reason,message:reason},excluded:true}`. No successful
business/export payload, ordinary zero, file header or provider call accompanies
initial refusal. Read responses recheck policy after preparation. Existing auth,
roles, token signatures, validation, pagination and ordinary response structures
are retained. Anonymous feedback now explicitly returns unavailable rather than
inserting a globally routed row. Unknown well-formed public profile IDs likewise
return unavailable; malformed IDs still return 404 before SQL.

| File (relative to backend/src) | Exact scope and identity |
| --- | --- |
| `routes/customers.js` | All five GET handlers: list/counts, full, history, autofill, detail. Entry checks precede customer/vehicle/RO queries; final checks precede response. DELETE checks before connection and its RO count, so an initially excluded fixture cannot be deleted. Existing local POST/PUT consent behavior is untouched; the policy import is lazy for these unaffected paths. |
| `routes/reviews.js` | Authenticated list and summary average/count/distribution are guarded before reads and response. Public context/submit use the verified signed token's shop ID, then persisted policy; submit rechecks the stored RO shop before INSERT. Existing token expiry, rating validation, duplicates and ordinary review values are retained. |
| `routes/public.js` | Intake metadata resolves the persisted link before policy. Public profile checks before business reads; shop query, rating AVG/COUNT query and recent-review query each independently require strict FALSE. Estimate intake checks after persisted link resolution, before INSERT, after INSERT, and in the detached notification callback. Discord receives a separate trusted persisted shop argument and only the existing ID/type fields. Caller body/email flags cannot select or authorize a shop. Initial refusal creates no intake row or notification. |
| `routes/export.js` | Both `/ro/:id` complete JSON bundle and `/shop/ros` JSON index check authenticated `req.user.shop_id` before any business read and before response. Child reads, monetary calculations, role-based notes, since filter, order, 500-row cap and response shape are unchanged. The earlier inventory's description of this index as CSV was incorrect; this file returns JSON. |
| `routes/apiV1.js` | Actual API-key middleware authenticates a global service key and supplies **no tenant identity**. The global `/estimates` list preserves its scope with strict-FALSE persisted shop membership in SQL. Detail/status first read only the stored RO's `shop_id`, check its policy, then repeat that identity in the business WHERE and final policy check. Body/query/header shop IDs are ignored. No synthetic tenant configuration or arbitrary first-shop fallback was introduced. Missing resources retain their 404 contract. |
| `routes/feedback.js` | POST obtains shop identity only from the verified auth token and checks before INSERT/routing. Scoped GET checks before reads and final response. Superadmin `/all` filters strict-FALSE shop membership, preserving limit/offset, and checks linked actor policy; an authenticated global superadmin remains global. Existing fixture/null-shop feedback is retained locally but excluded from this operational list and audit. |
| `jobs/feedbackDailyAudit.js` | Both exported operations and their coordinator accept an optional direct shop ID; absent target enumerates only strict-FALSE shops. Each target independently checks policy before connection, takes a shop FOR SHARE lock and rechecks on that transaction connection before UPDATE and COMMIT. Every UPDATE repeats shop binding and strict-FALSE membership. Suppressed targets produce no committed status/routing/date mutation or operational rowCount. Noise rules, assigned routes and aggregate result shape remain. No external escalation sender exists in this file. |
| `jobs/ownerActivityDigest.js` | Enumeration requires strict FALSE and existing enabled preference. Before the claim, current policy is checked again on the same transaction connection under a shop FOR SHARE lock. The date upsert still serializes daily claims and now rechecks enabled/time preferences. A pre-service policy check and post-service policy check, plus inspection of service/individual transport refusal results, roll back the pending date on suppression. Ordinary provider exceptions retain the daily attempted date as before; ordinary skipped/no-recipient results retain existing claim behavior. |

Digest policy stays locked through its claim and service call so designation cannot
race a committed claim. No initial or locked refusal consumes a date or invokes
the service; a synthetic later refusal rolls back the pending claim. No fixture
records are deleted, rewritten, cleaned up or designated by these jobs. Transaction
rollback on unavailable policy is deliberate, including uncertainty after a send.
An external provider send and a DB commit cannot be made atomic by this change:
a provider success followed by a DB/connection failure can remain uncertain and
needs operational reconciliation. Real PostgreSQL concurrency/locking/provider
failure QA is still pending; no exactly-once delivery guarantee is claimed.

HTTP read guards are current entry/final boundaries, not a global atomic
designation protocol. A policy change after an authorized local intake INSERT
suppresses subsequent notification but retains that local row; the tests pin this
behavior. Detached notification suppression logs only the enum reason. The database
TRUE hold remains necessary. No new supported fixture creation path exists.

### Deterministic evidence and exact commands

Node **v22.23.2**, synthetic data/adapters only, scrubbed environment. No app
bootstrap, actual DB/account/provider, secret/.env read, listener, network access
or dependency installation. `/private/tmp/revv-t6002-phase7/deny-network.cjs`
throws `TEST_NETWORK_PROHIBITED` on net connect/listen, TLS, HTTP(S) request/get
and fetch. It also substitutes no-read dotenv and an unused synthetic pg Pool
that throws on query/connect, because two legacy pure-helper suites import db/index.
The focused suite uses closed-import VM adapters, the actual policy resolver,
roles, public-shop resolver, review-token crypto and API-key middleware. SQL
membership/transaction adapters are synthetic models, **not a SQL engine**.

Focused final (`focused-final.log`): **exit 0, 298/298 passed, 0 failed/skipped**.
Tests cover all selected handlers, forged ordinary fields, ten denied policy
variants, no export/business payload/provider/notification mutation, persisted
API tenancy, global SQL membership, public AVG/COUNT filters, pagination, exact
parent response parity, direct jobs, stale enumeration/locked/pre-service policy,
rolled-back routing/dates, duplicate claims, preferences and ordinary failure
idempotency. The API key invalid-case test runs the actual middleware.

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase7/deny-network.cjs --test --test-concurrency=1 backend/test/ordinarySurfacesPolicy.test.js
```

Policy/foundation regression (`policy-regression.log`): **exit 0, 775/775 passed,
0 failed/skipped**. The named real-PostgreSQL cases are intentionally excluded;
Node omits name-filtered cases from its counts, so they are not passed tests.

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase7/deny-network.cjs --test --test-concurrency=1 --test-skip-pattern='real PostgreSQL' backend/test/metricsShopPolicy.test.js backend/test/emailShopPolicy.test.js backend/test/billingShopPolicy.test.js backend/test/internalTestShop.test.js backend/test/productionStartup.test.js backend/test/idTypeCastGuard.test.js
```

Relevant existing customers/public/feedback/audit/owner suites plus consent PUT:
**raw candidate remains RED: exit 1, 51 tests, 38 passed / 13 failed, 0 skipped**
(`existing-recovery.log`). No standalone legacy reviews/export/api-v1 route suite
or owner-digest scheduler suite was found; these paths have actual-handler/job
coverage in the new focused file. OwnerActivity's existing suite covers helpers.

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --require /private/tmp/revv-t6002-phase7/deny-network.cjs --test --test-concurrency=1 backend/src/__tests__/customerOptInConfirmation.test.js backend/src/__tests__/productionIncidents.jul12.test.js backend/src/__tests__/publicIntake.test.js backend/src/__tests__/feedback.auth.test.js backend/src/__tests__/feedback.sanitize.test.js backend/src/__tests__/feedbackDailyAudit.test.js backend/src/__tests__/ownerActivity.test.js backend/test/consentPhone.phaseA.test.js
```

The same exact existing-suite command with
`--require /private/tmp/revv-t6002-phase7/parent-source.cjs` immediately after the
deny preload: **exit 0, 51/51, 0 failed/skipped** (`existing-parent.log`). This
preload substitutes only the eight production files from exact parent c9c4e9d,
using read-only git show; it does not change tracked files.

The same exact existing-suite command instead adding
`--require /private/tmp/revv-t6002-phase7/legacy-fixtures.cjs` after the deny preload:
**exit 0, 51/51, 0 failed/skipped** (`existing-adapted-recovery.log`). This temporary
adapter changes only test sources: supplies strict-FALSE synthetic persisted rows
without polluting business query-count assertions, supplies the job's transactional
DB fixture, and updates anonymous-feedback/unavailable-profile/error and metadata
SQL expectations to the explicit new contract. It never mocks production policy
as allowed or alters production code. The real rate limiter still reaches 429.
These are separately labeled compatibility results; unchanged tracked legacy
suites remain RED until their fixtures are migrated in a later bounded slice.

Nine changed JS paths individually checked: **9/9 exit 0**. Diff check and
byte-preservation comparison: **exit 0**. Executed each command via a Python driver
with individual return-code capture; equivalent exact shell commands:

```sh
for file in backend/src/routes/customers.js backend/src/routes/reviews.js backend/src/routes/public.js backend/src/routes/export.js backend/src/routes/apiV1.js backend/src/routes/feedback.js backend/src/jobs/feedbackDailyAudit.js backend/src/jobs/ownerActivityDigest.js backend/test/ordinarySurfacesPolicy.test.js; do
  env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --check "$file" || exit "$?"
done
git diff --check
git diff --exit-code c9c4e9d64d46ebb8ec719c46066c2b6f5b8faee1 -- backend/src/services/shopPolicy.js backend/src/db/internalTestShop.js backend/src/db/index.js backend/src/db/migrate.js backend/src/db/schema.pg.sql backend/src/app.js backend/src/routes/auth.js
```

### Failure history and verified recovery

- Combined guidance/search output was truncated; bounded follow-up reads recovered
  relevant current guidance and selected source. The no-AGENTS-file search returned
  no matches. No editing or success decision relied on truncated evidence.
- First focused command: **exit 1, 284/285 passed**, `focused-first.log`. The test
  DB classifier mistook a nested public SQL membership query for scheduler shop
  enumeration. Anchored that synthetic matcher; **285/285 exit 0** in
  `focused-recovery.log`. Expanded coverage passed 297/297, then final 298/298.
- First existing-suite run: **exit 1, 24/51 passed, 27 failed**,
  `existing-first.log`. Fourteen closed-import consent fixtures rejected the eager
  customers policy dependency even though PUT does not use it. Lazy loading at
  the guarded customer read boundary recovered those 14 without changing PUT.
  Raw final remains **38/51**: missing policy rows, absent audit dbAll/transaction
  fixture, and legacy anonymous/unknown-profile assumptions explain the remaining
  failures. Exact-parent 51/51 verifies this comparison.
- First temporarily adapted run: **exit 1, 49/51 passed**,
  `existing-adapted.log`. One repeated anonymous-feedback assertion still expected
  201, and metadata expected the old SQL without the new predicate. Updated those
  two test-only expectations; verified recovery **51/51**. No production guard
  was relaxed to satisfy legacy fixtures.
- Staged review caught a log-hash replacement also changing the historical phase-6
  focused-log hash. Restored it from the exact parent and verified historical
  equality before commit; code/tests were unaffected.
- All observed failures were reported while working. No final focused, policy
  regression, syntax or diff-check failure remains. No full-suite green claim.

### Remaining gaps / HELD scope

- Lead/waitlist backend Discord callers still lack trusted tenancy and remain
  unsupported/fail-closed for ordinary delivery. Frontend lead capture and dashboard
  still write/read/export direct Firestore; that bypass remains unisolated.
- Detached payment receipt and parts email still omit trusted shop identity and
  remain unsupported at the guarded mail transport. No change to these consumers.
- API-v1 mounts `/catalog` and `/inspections` are separate consumers, not covered by
  its three direct read handlers. Other AI, supplier/catalog/tracking/geocoding,
  media/object-store mirrors/restores, uploads and provider/usage consumers remain
  pending. Global API-key credential configuration/authentication is unchanged.
- RO job-cost, carryover-pending, turnaround counts and other RO list/detail/labor
  metrics, payment history/ledger, direct profit/economics helpers, planGuard,
  mediaIntegrity sweep and other previously inventoried unexcluded consumers remain.
  Existing remote Stripe/Twilio identities cannot be isolated by local guards alone.
- Existing local customer POST/PUT, local activity/notifications and other
  unconverted public intake (including appointment paths) are not a reviewed
  fixture-designation or full zero-effect environment. No fixture records were
  deleted/backfilled to satisfy operational counts.
- Legacy fixture migration remains: the 13 raw failures above, earlier dashboard/AI
  fixture debt, and earlier unsupported-email/privacy/money fixture gaps. Temporary
  compatibility adapters are evidence, not committed fixture repairs.
- Real SQL execution, lock contention/concurrency, browser/frontend, full backend,
  Spark advisory, independent exact-SHA review and release verification were not
  performed or claimed. Hermes/Oracle owns those gates and shipping.

Safety-sensitive persisted-policy/tenant/routing changes across more than two
files. `shops_internal_test_shop_hold CHECK (is_internal_test_shop IS FALSE)` is
byte-identical and active in source. Requested account and full feature remain
**HELD**; no provisioning/designation. No frontend, manifest/lockfile, seed/demo,
production configuration, cron/provider/model/profile changes, real DB/account/
customer effects, secret reads, Hermes/Kanban/messaging/delegation, push/merge/
deploy or protected-work edits. `job5feaddc2bfaf` is preserved and `t_59894b65`
remains **DO NOT APPLY**.

Local commit uses only the user's authorized narrow Git escalation for this
linked worktree's canonical `.git/worktrees/source2` index-lock boundary: explicit
add of these ten files and one non-amending local commit, hooks/signing disabled
for that invocation. No canonical checkout/source changes or release. Full SHA,
exact parent, committed path count and clean worktree are verified in the handoff.

Phase-7 temporary evidence SHA-256 identities (no secrets or live data):

```text
deny-network.cjs               9faeaf8417b5c2c46382990e9741bda9df582e2e205baef5938b42b2c1bbd18b
parent-source.cjs              fde72341d98d60e47dd4312573b423ed108228fa18f110d984e0c33e1f7fd08a
legacy-fixtures.cjs            d33d549f75363547c2a83c1b2447c569fb8f62eda9bf27f1f67adcb2341494ab
focused-first.log              f1afbacf7f4cc1b0fa2b8297c5ccb7079f440e8088dae63a283fcdc8a71f226d
focused-recovery.log           fc795eb284b4c21e7c3f2f56af3bfca0a0ea63c1462891a7b9c30cfd685e09a5
focused-final.log              0c7eeb14ea916dcf57919fdbc201f25c92b040afe739629cdfde3f3cbbe07b04
policy-regression.log          0af8bf68881302791303fb6ab434c6ca0723482a38bafd0c75262f319ec170a6
existing-first.log             66e079c61e2871a57e616cc41abe6e24f4e6999f0dfb9209ecea5b399ce7b504
existing-recovery.log          9a8d633bd39ab00855f2dc1f9b64c79a61ec4b0d3fe3b591230165aa18f87d84
existing-parent.log            867ac8f1da7ccac907d77c19ec96e9b443870ba4dc83485c2f6aba4e7a311208
existing-adapted.log           19da1a01249a346e63efc596fb9cb4aad8372234c91825af6737aa9b8e25959f
existing-adapted-recovery.log  dec6198448a0543a61d1037924273cd5763d6987c2e6bdd6ccd3dcccdc88d742
```
