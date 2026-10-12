# Automatic SMS provisioning — phase 1

Default OFF. Only `REVV_SMS_AUTOPROVISION=true` (case-sensitive string) enables the
scheduler, discovery, claims, or automatic provider operations. No route or send
path changes. Manual `provisionSmsSenderForShop` behavior, including its existing
force option, is unchanged. Automatic callers use that entry with `mode:
'automatic'` and an internal claimed-session context; force is rejected.

**Phase 1 cannot activate newly acquired numbers in production.** A trustworthy
number-level registration adapter is still missing. The production adapter
returns `UNAVAILABLE`; jobs remain `pending / REGISTRATION_SOURCE_REQUIRED` and
never publish new sender columns. Mock `REGISTERED` results test the activation
boundary only. This is not live readiness or permission to enable purchases.

## Discovery and prerequisites

Inspected paths: `routes/auth.js` inserts shops at `/shop-register`;
`routes/subscriptions.js` commits plan changes on Stripe created/updated/deleted
subscription events. This tree has no admin route writing `sms_comp`; the existing
migration can set it. A full committed-shop reconciliation runs immediately at
startup and every 60 seconds. It inserts eligible shops once (`shop_id` primary
key), including later admin/database comp changes and commits preceding a crash.
Entitled means plan exactly `pro` or `agency`, OR boolean `sms_comp === true`.
No route hooks are needed for authoritative discovery; phase 2 may add latency
optimizations. Each tick processes the oldest 25 due jobs. Discovery cadence is
60 seconds when DB is healthy; processing latency includes backlog and provider
latency and has no unconditional wall-clock completion guarantee.

Operators must establish a legitimate per-shop mapping in `sms_provision_mapping`:
opaque shop ID, AC account SID, MG existing Messaging Service SID, QE campaign
resource SID, BN brand SID, and nonempty authorization reference to reviewed ISV
onboarding evidence. No private documents or credentials belong in the reference.
Service and campaign are unique across these mappings; phase 1 does not support
sharing one unrelated campaign across shops. Syntax and Twilio binding are checked;
the authorization reference is an operator prerequisite, not an automated legal
validation. Credential account resolution must match; dormant per-shop account
configuration cannot change the account when a new phone is published.

Before buying, fetch the existing service and its exact `usAppToPerson(QE).fetch()`:
account, service, campaign and brand must match; `campaignStatus` must be `VERIFIED`.
The existing service must already use the canonical APP_URL/PUBLIC_URL
`/api/sms/webhook`, POST, and `useInboundWebhookOnNumber=false`. Neither automatic
service creation nor brand/campaign registration exists here. Automatic operations
use a 10-second Twilio HTTP timeout and `autoRetry:false`.

## Budget and crash safety

Every worker and restart must have the SAME explicitly supplied
`REVV_SMS_AUTOPROVISION_RUN_ID` (8–80 ASCII letters/digits/underscore/hyphen, starting
with a letter/digit) and `REVV_SMS_AUTOPROVISION_PURCHASE_CAP` (canonical integer
0–1000). There are no defaults. The first configuration is persisted in the
singleton control row. Any subsequent ID/cap mismatch fails closed. Timers,
restarts, retries and different worker IDs never replenish budget. Phase 1 has no
automatic run rotation or budget reset; a future operator workflow must preserve
all old run evidence. Do not edit/reset consumed counters to retry jobs.

A dedicated PostgreSQL session advisory lock owns each shop across transactions.
It never expires while its connection survives; it releases on session death.
Connections are destroyed after claims, so locks cannot leak into a pooled session.
No process memory is the authority. A stalled owner must be diagnosed; workers do
not steal leases. Hash collisions only serialize unrelated shops.

The exact candidate phone and UUID purchase identity (`REVV-AUTO:<UUID>` friendly
name), immutable binding, and run ID are committed with atomic budget consumption
BEFORE the create request. The account/candidate uniqueness index prevents
colliding queued intentions. Reservations are conservative: they count even if the
process dies before sending the request. Existing-number reuse does not charge.

Each provider operation and publication is guarded by a DB transaction: lock the
control row, then shop row, then mapping row; recheck flag, entitlement, run and
binding. This intentionally serializes automatic operations globally and blocks
concurrent shop UPDATE/DELETE (including plan or comp changes) while a provider
effect is in progress. The operation linearizes before any waiting downgrade.
Do not use transaction-pooling proxies for the dedicated session lock connection.
Concurrent rollback acquires the same control lock. HTTP requests can outlive a
lost DB connection; the already-committed intent prevents a second create.

On a timeout, collision, crash, or uncertain commit, the next attempt searches
account inventory for the exact persisted phone AND friendly identity. Only a
unique verified match resumes. Absence does NOT prove that purchase failed:
`PURCHASE_UNCERTAIN` is terminal with admin attention. Never clear an intent,
refund its budget, select another number, or reissue create as automated recovery.
An operator must reconcile the original request; phase 2 needs a safe recovery UI.

After acquisition, retry configuration using the same PN SID. Attach, fetch the
exact service attachment, set/verify the number callback, and obtain trustworthy
number registration evidence before publishing. No pending/failed number is copied
to shops. Existing sender columns and shared fallback remain unchanged. Downgrade
retains acquired numbers and history with admin attention. No release API exists.

## State, alerts and rollback

`pending` plus an enum reason distinguishes cap, campaign, mapping and registration
deferrals; these do not consume retry attempts. Other transient errors use durable
attempts and 2/4/8/16-minute backoff; attempt five is `failed / RETRIES_EXHAUSTED`.
Permanent configuration/provider failures and uncertainty are failed immediately.
Attachment failures retry the acquired SID. Registration `FAILURE` is terminal;
`PENDING_REGISTRATION` stays pending. `sms_provision_history` retains transitions,
binding, intent and acquisition evidence; its phone data must stay local/private.

Actionable reason groups:

- `MAPPING_REQUIRED`, `ACCOUNT_MISMATCH`, `CONFIG_DRIFT`, `BINDING_MISMATCH`,
  `RUN_CONFIG`: inspect approved mapping, credential account, callback and run
  configuration; never retarget an acquired number by changing the saved binding.
- `CAP_DEFERRED`: budget reserved/exhausted; defer, do not replenish on restart.
- `CAMPAIGN_PENDING` / `CAMPAIGN_FAILED`: resolve existing onboarding outside this worker.
- `REGISTRATION_SOURCE_REQUIRED` / `REGISTRATION_PENDING` / `REGISTRATION_FAILED`:
  supply a reviewed trustworthy status integration, wait, or investigate failure.
- `PURCHASE_UNCERTAIN`, `NUMBER_MISMATCH`, `ATTACHMENT_MISMATCH`,
  `CALLBACK_MISMATCH`: operator reconciliation of the exact retained identities.
- `PROVIDER_TRANSIENT`, `PROVIDER_PERMANENT`, `RETRIES_EXHAUSTED`, `QUEUE_FAILURE`:
  inspect service/DB health and permissions without logging provider bodies.

`notifyOps` receives only `SMS_AUTO_<enum>` plus opaque shop ID. A DB atomic
per-enum cooldown permits at most one alert per hour across workers/shops/restarts.
Reservation precedes notification, preventing storms but allowing a missed alert
if the worker dies at that point. The existing notifyOps transport does not confirm
HTTP success; delivery is NOT guaranteed. During DB failure, local sanitized
`QUEUE_FAILURE`/`ALERT_UNAVAILABLE` logs replace unverifiable delivery claims.

Both startup migration paths call `db/smsProvisioning.up` only with exact true.
The migration supports UUID and TEXT parent IDs using durable TEXT identities and
no cascading foreign keys. `down(db)` is a logical rollback: pause control and mark
admin attention, retaining all tables, sender values, intent/acquisition history
and budget evidence. Re-running `up` does not resume a paused control row. Disable
all workers first when rolling back. No DROP, sender clearing, or provider release.

## Provenance and missing registration integration

Official documentation retrieved October 12, 2026; no account queries:

- [UsAppToPerson](https://www.twilio.com/docs/messaging/api/usapptoperson-resource):
  service-scoped QE campaign resource; `campaignStatus=VERIFIED` is campaign approval.
- [Number registration troubleshooting](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-a2p-phone-number-registration-issues):
  registration is asynchronous and can take days. Console CSV has number-level
  REGISTERED/PENDING_REGISTRATION/FAILURE states; attachment is not proof.
- [ISV onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api):
  individual customer onboarding prerequisites must be established.
- [Service PhoneNumbers](https://www.twilio.com/docs/messaging/api/phonenumber-resource),
  [Services](https://www.twilio.com/docs/messaging/api/service-resource), and
  [IncomingPhoneNumber](https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource):
  exact attachment, account and callback fields. None is treated as a number-level
  REGISTERED API. Installed Twilio 5.12.2 generated JS was also inspected for SDK
  camelCase fields, timeout and disabled automatic retry.

Followup must define authenticated status provenance, exact account/service/campaign/
number binding, freshness, failure/revocation handling and tamper protection before
implementing an adapter. Do not turn an operator flag, attach-success or campaign
approval into fabricated number registration. Routes/UI, safe failed-job recovery,
budget rotation and scale/latency tuning are followup scope. Never add an eleventh
file to this phase.

## Safe verification commands

From this worktree, with dependencies installed by Hermes if needed (no upgrades):

```sh
env -i PATH="$PATH" HOME=/private/tmp APP_URL=https://synthetic.invalid \
  node --test backend/test/smsProvisioning.auto.test.js backend/test/smsProvisioning.pg.test.js

env -i PATH="$PATH" HOME=/private/tmp APP_URL=https://synthetic.invalid \
  node --test backend/test/smsConsent.phase2.test.js \
  backend/src/__tests__/smsTierGate.test.js backend/src/__tests__/smsAutoReply.test.js
```

Real PG is mandatory; a skip is not a pass. In an environment permitted to create
PostgreSQL shared memory and listen on loopback, create only a disposable cluster:

```sh
task_pg_dir=$(mktemp -d /private/tmp/revv-sms-pg.XXXXXX)
env -i PATH="$PATH" HOME=/private/tmp initdb -D "$task_pg_dir/data" -A trust -U postgres
env -i PATH="$PATH" HOME=/private/tmp pg_ctl -D "$task_pg_dir/data" \
  -l "$task_pg_dir/server.log" -o "-h 127.0.0.1 -p 55439 -k $task_pg_dir" -w start
# If startup fails (including occupied port), STOP here; never contact another cluster.
env -i PATH="$PATH" HOME=/private/tmp createdb -h 127.0.0.1 -p 55439 -U postgres revv_sms_provision_test
env -i PATH="$PATH" HOME=/private/tmp APP_URL=https://synthetic.invalid \
  SMS_PROVISION_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/revv_sms_provision_test \
  node --test backend/test/smsProvisioning.pg.test.js
env -i PATH="$PATH" HOME=/private/tmp pg_ctl -D "$task_pg_dir/data" -m fast -w stop
```

Only run subsequent commands after each prerequisite succeeds, and stop your own
cluster even if the test fails. The test rejects nonliteral-loopback hosts, any
other database name, and URL overrides before loading pg. It uses fresh random
schemas with synthetic TEXT/UUID shops, mocks every provider, and cleans up only
its own schemas. Never set DATABASE_URL, import dotenv/app startup, run broad
migrations/seeds, or reuse a production connection. Tests exercise up/down,
duplicate discovery, session locks, concurrent budget, entitlement row locks,
restart recovery, durable alert dedup and OFF. Host execution remains required if
sandbox initdb fails with shared-memory EPERM.
