# Released payment: late-success investigation

Task `t_3ae3ac28`, phase C; audit criterion `PAYMENT-LATE-SUCCESS-ALERT`.
Implementation is uncommitted for Hermes. Recovery base commit:
`79ec66d3684073fcfbd1f127fe66ef1566ca11dc` on
`codex/revv-all-issues-recovery-20261007`. Local main and origin/main both resolve
to `3e6541127de55cef569c61abdf893eceb7fcbd8f`; no remote refresh was performed.
The saved Phase C patch was applied with workspace-only `git apply`, and the two
new files were copied from the read-only original source. The original source was
not modified. Inspection against main found no demonstrated runtime correctness
gap requiring a change to the restored implementation; this receipt was updated.

A success callback contradicting a released attempt still receives the existing
sanitized HTTP 400 response: `Payment webhook could not be processed`. The service
still refuses settlement. It now records an investigation and individual in-app
notifications atomically before that deliberate refusal.

The registered `/api/payments/webhook` route authenticates the raw body with the
Stripe signature wrapper before entering settlement. Under the tenant-scoped RO
lock, the service checks the attempt's tenant/RO, compatible kind, USD currency,
exact amount and existing provider identities. A Checkout callback must match both
the stored session and intent. An intent callback must match the stored intent,
including when it represents a Checkout attempt. Both intent amount fields must
match. Released attempts cannot acquire a previously missing provider identity
from a late-success callback. Metadata cannot override a stored provider binding.

`ro_payment_investigations` retains the first validated event type, shop, RO,
attempt and timestamp. Its unique `(shop_id, attempt_id)` key deduplicates retries
and intent/Checkout representations regardless of event ID. The existing payment
initializer creates the additive TEXT-keyed table and immutable-history trigger
at startup/migration time. It supports TEXT and UUID parent schemas without parent
rewrites. There is no request-time DDL or destructive down migration.

`createPaymentInvestigationNotifications` uses the same transaction client to
select the shop's exact `owner`/`admin` users and insert one notification each.
There is no shop-wide/null-user alert. With no eligible users, evidence persists
without a broadcast. Recipients are selected when the investigation is first
recorded; repeated callbacks do not resend or reset read notifications.

The helper uses the existing notifications table's common columns; app startup
already initializes that table before the payment initializer. There is no new
notification schema or delivery mechanism. Static title/body guidance asks staff
to review the RO and verify payment records before another payment action. The
existing `ro_id` field drives NotificationBell's `/ros/:ro_id` navigation. Provider
IDs, event IDs, raw payloads, exceptions and private financial details are absent
from this alert. The ordinary notification helper remains unchanged.

The event insert and all notification inserts precede a **returned** PaymentError.
`withLockedRo` commits that result, releases its client, then raises the refusal.
Actual SQL/helper/commit failures throw and roll back the entire transaction;
the route returns non-success, and a retry can safely perform the work again.
The RO lock serializes concurrent callbacks; the unique evidence key is an
additional deduplication constraint. No existing ledger, attempt, reconciliation
audit, balance, capacity or history row is changed by this branch. It invokes no
provider operation, ordinary notification/activity hook, email, SMS, charge,
refund or revival.

## Recovery verification receipt (2026-10-07, Node v22.23.2)

From the recovery repository root, with an empty inherited environment:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 /opt/homebrew/opt/node@22/bin/node --test --test-skip-pattern='real PostgreSQL|TEXT|UUID' backend/test/paymentReservations.remyA.test.js backend/test/payments.phase4.test.js backend/test/paymentLateSuccess.integration.test.js
```

Exit **0**; tail: `tests 463; pass 463; fail 0; cancelled 0; skipped 0`.
Log: `/tmp/revv-phase-c-recovery-offline.log`. The explicit filter excludes all
PostgreSQL/mounted HTTP cases; Node's zero skipped count does not mean those cases
ran. Offline signature validation uses the actual Stripe signing/verification
code with a synthetic secret and mocked SDK constructor.

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 /opt/homebrew/opt/node@22/bin/node --test backend/src/__tests__/notificationLogging.privacy.test.js backend/test/partsNotifications.test.js backend/test/idTypeCastGuard.test.js
```

Exit **0**; tail: `tests 29; pass 29; fail 0; cancelled 0; skipped 0`.
Log: `/tmp/revv-phase-c-recovery-notifications.log`. All six changed JavaScript
files passed Node22 `--check`; `git diff --check` passed (each exit 0).

The initial offline command used Node v22.22.3 and
`--test-name-pattern='^(?!real PostgreSQL|TEXT|UUID)'` instead of the skip filter.
It selected the database cases too: exit **1**, `tests 479; pass 463; fail 16`.
All 16 failures were the missing dedicated-database environment guard, before any
connection attempt. Log: `/tmp/revv-phase-c-recovery-focused.log`. The corrected
filter above passed. No PostgreSQL connection or mounted HTTP test was attempted
in this recovery run; the prior EPERM result below is historical evidence only.

## Historical receipt from original Phase C (Node v22.22.3)

From repository root:

```sh
PANEL_ESTIMATOR_TEST_DATABASE_URL=postgresql://revv_panel@127.0.0.1:55459/revv_panel_test node --test backend/test/paymentReservations.remyA.test.js backend/test/payments.phase4.test.js backend/test/paymentLateSuccess.integration.test.js
```

Actual result: **exit 1; 483 tests, 463 passed, 20 failed, 0 skipped**.
All 18 underlying failures are `connect EPERM 127.0.0.1:55459` before database
fixtures execute; the other two failures are their parent suites. The sandbox
prevents loopback connections. No schema was created during this run. Local log:
`/tmp/revv-phase-c-payment.log`.

The passing cases include commit-before-refusal, repeated-callback deduplication,
provider/amount/currency refusal before investigation, thrown notification error
versus deliberate refusal, and the registered route's offline real cryptographic
signature gate (valid, missing, forged and body-tampered signatures).

```sh
node --test backend/src/__tests__/notificationLogging.privacy.test.js backend/test/partsNotifications.test.js backend/test/idTypeCastGuard.test.js
```

Actual result: **exit 0; 29 passed, 0 failed, 0 skipped**. Local log:
`/tmp/revv-notifications-focused.log`. Syntax checks and `git diff --check` pass.

## Required host acceptance

**Real PostgreSQL and mounted HTTP acceptance remain unverified.** Hermes must run
the following command without an offline filter on the disposable database before
marking phase C verified:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 PANEL_ESTIMATOR_TEST_DATABASE_URL=postgresql://revv_panel@127.0.0.1:55459/revv_panel_test /opt/homebrew/opt/node@22/bin/node --test backend/test/paymentReservations.remyA.test.js backend/test/payments.phase4.test.js backend/test/paymentLateSuccess.integration.test.js
```

The new suite uses a separate schema per test, the actual payment and
notification routers, real JWT middleware, raw webhook body parsing, offline
Stripe signing/verification and strictly isolated mock provider methods. It never
loads dotenv, the production DB module, app startup or a real provider client.

The host cases cover TEXT/UUID schemas; released intent and Checkout success;
unchanged financial/history snapshots and reallocated capacity; existing failed
ledger retention; concurrent mixed callbacks; new service/pool durability;
repeated migration and immutable evidence; owner/admin and foreign-tenant
visibility through the existing notifications API; per-user read isolation;
ordinary notification behavior; malformed/forged/cross-tenant/provider/kind/amount
negatives; actual notification-insert and deferred-commit failures; missing users
schema failure; and safe retry after rollback. Database atomicity/concurrency and
API role visibility are test targets, not claimed passing runtime evidence.

Seven files changed. This is a payment/evidence/auth-sensitive change over two
files and requires Hermes's normal review routing and final host gates. Hermes
owns board updates, commit, review and shipping. No board change, commit, push,
deployment, production access, secret read, live provider call or review request
was performed here. `CLAUDE.md` is unchanged.
