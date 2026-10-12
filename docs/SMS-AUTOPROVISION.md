# Automatic SMS provisioning — phase 2 candidate

Default OFF. Only `REVV_SMS_AUTOPROVISION=true` enables discovery, workers and the
new `/api/sms/provisioning-events` receiver. OFF acknowledges events without DB or
provider work; it does not revoke existing senders. Manual provisioning and send/
consent/STOP paths are unchanged. `pro`, `agency`, or boolean `sms_comp=true` grants
eligibility. Committed entitlements are reconciled at startup and every 60 seconds;
25 due jobs are processed per tick. Latency also depends on backlog/provider time.
The existing provisioning entry accepts explicit internal automatic mode only.

The production registration adapter now reads authenticated, durable Twilio event
receipts. A signed, exact-bound successful registration can reach active. This is
implementation evidence, **not release readiness, real account validation, or
authorization to turn on purchases**. Hermes owns host gates, Spark advisory, ONE
Remy review of the unchanged full SHA, and subsequent shipping decisions.

## Operator prerequisites (not performed by this build)

Before enabling automatic work, establish all of the following through separately
authorized operations. There is no automatic service, brand, campaign, Event
Streams sink/subscription creation, or number release in this implementation.

1. Legitimate customer/ISV onboarding and an existing approved, nonmock campaign.
   Populate `sms_provision_mapping` with shop ID, `account_sid` AC,
   `service_sid` MG, `campaign_sid` QE, `brand_sid` BN, and a nonempty
   `authorization_ref` to reviewed onboarding evidence (no private data/secrets).
   Services and QE campaigns are unique per shop; unrelated shops cannot share one.
2. Separately verify and persist `event_campaign_sid` CM. The Usa2p QE resource SID
   **is not** the event CM campaign SID. No official QE-to-CM conversion was
   verified or invented. AC/CM is unique in the mapping. Missing mapping is pending
   and cannot spend. Never change a saved job's binding to retarget its resource.
3. Persist the actual matching account SID and **account Auth Token** in that
   shop's existing credential columns. API-key secrets are not webhook tokens.
   Automatic work does not fall back to server/shared credentials. Outbound SDK
   authentication may use that shop's API key/secret, but a matching persisted
   account/token is required before acquisition. Tokens are neither copied into
   jobs/receipts nor logged. This build did not read any real credentials.
4. Configure APP_URL (or PUBLIC_URL if APP_URL is absent) as a public HTTPS origin,
   with no credentials, query, fragment or base path. The existing service must
   use `<origin>/api/sms/webhook`, POST, `useInboundWebhookOnNumber=false`.
   The configured inbound override, if any, must match exactly.
5. Configure a Twilio Event Streams webhook sink at exactly
   `<origin>/api/sms/provisioning-events` and subscribe to **all six** schema-v1
   types below, using the matching account's signed JSON webhook delivery.
   Confirm delivery/retries and operational monitoring outside this build. Only
   then populate `event_callback_url` with that exact URL as the operator's setup
   attestation. The worker verifies local URL/mapping/token prerequisites; it does
   not query whether a real sink/subscription exists. Absent/mismatched setup
   prevents acquisition. No unsigned admin status or operator REGISTERED flag exists.
6. Supply an explicit stable run ID and cap shared by all workers/restarts.
   `REVV_SMS_AUTOPROVISION_RUN_ID`: 8–80 ASCII letters/digits/underscore/hyphen,
   starting alphanumeric. `REVV_SMS_AUTOPROVISION_PURCHASE_CAP`: canonical integer
   0–1000. Missing or changed values fail closed against the persisted control row.

Campaign preflight fetches the exact service and `usAppToPerson(QE)`: account, MG,
QE, BN, `campaignStatus=VERIFIED`, and `mock=false` must all match. Unknown/missing
mock state is also rejected. Number identity, US E.164 format, SMS capability,
account, exact attachment `serviceSid`, and callbacks are verified. Approval and
attachment alone never mean the number is registered.

## Signed receiver and receipt semantics

The route is mounted before generic JSON parsing. Raw JSON is bounded to 128 KiB
and 1–100 events; compressed bodies are rejected. The request must have exactly
one `bodySHA256=<64 lowercase hex>` query parameter and the canonical path.
Additional/duplicate query parameters and alternate paths are rejected. Signature
validation uses the installed Twilio SDK's
`validateRequestWithBody(authToken, signature, configuredURLWithHash, rawBody)`,
which checks signature **and** body SHA256. Request Host/forwarded headers cannot
supply the verification URL. No parsed JSON is treated as form parameters.

Each CloudEvent must have specversion 1.0, a bounded safe ID, the matching official
schema-v1 URL, `datacontenttype=application/json`, a valid occurrence time and exact
AC/MG/CM/PN identities. `time` must match the millisecond `timestamp`;
`updateddate` must be positive and no later than `timestamp`.

| Event suffix after `com.twilio.messaging.compliance.` | Required externalstatus | Receipt state |
| --- | --- | --- |
| number-registration.successful | registered | registered |
| number-registration.pending | pending_registration | pending |
| number-registration.failed | failure | failed |
| number-deregistration.successful | unregistered | unregistered |
| number-deregistration.pending | pending_deregistration | pending |
| number-deregistration.failed | failure | failed |

Every object is mapped by exact persisted AC/MG/CM and verified using that shop's
matching account token before any batch writes. Unknown mappings/accounts/tokens,
invalid signatures and a PN already owned by another job or shop sender reject the whole batch.
A batch spanning accounts must authenticate every account; there is no trust
inherited from its first event. Errors return generic text; raw payloads, provider
errors, headers and credentials are not logged. DB/runtime failures return 503
and a sanitized local failure marker, so delivery can retry. Invalid requests
return 403, oversize 413, and parser/encoding errors 400.

Only event ID, shop/AC/MG/CM/PN, normalized binding, enum kind/status, provider
`updateddate` (ordering), emission `timestamp`, and receipt time are persisted.
The event's phone number, data.id, source and arbitrary/error fields are omitted.
Job acquisition history still contains the previously required local/private
candidate and acquired phone evidence; it is not a raw event log.

Event ID is idempotent. A duplicate with differing retained facts rejects and
rolls back the entire batch. Latest status is selected by provider `updateddate`,
not arrival order. Older receipts cannot regress it. Conflicting kinds/statuses
at the latest equal timestamp fail closed; a newer consistent success can resolve
the conflict. Receipts can precede the purchase DB write and remain usable only
for the later exact acquired PN and complete saved binding, including QE, BN,
authorization reference and both callbacks. Wrong/changed mapping receipts cannot
activate or clear a different binding. No matching receipt means pending, even
when attachment succeeds. Pending callbacks do not terminate a preactivation job.

## Publication, revocation and manual custody

The worker verifies campaign, attachment, number and callbacks, reads receipt
status, then rechecks approved nonmock campaign, exact number/attachment/callback
and REGISTERED status in the final publication transaction. The receiver and
worker acquire the same control/shop/mapping locks, serializing final status and
publication. Dedicated session advisory locks still prevent duplicate workers for
one shop across committed purchase intent and provider request.

Publication records the same database timestamp in shop routing and the job's
`routing_published_at`. A later authenticated nonregistered status (including an
equal-time conflict) clears only the exact automatically published shop PN, phone,
MG and managed mode when that timestamp still matches. It marks the published job
failed with admin attention. It retains acquired numbers, binding, intent, budget,
receipts/history and consent, and never releases a provider resource. A manually
replaced sender, including the same PN/MG rewritten with a new timestamp or mode,
is retained and cannot be reclaimed on a later worker tick. An unchanged legacy
sender with no automatic publication marker cannot be cleared by a callback.
Manual database writers must preserve the existing convention of updating
`twilio_sender_updated_at`; an indistinguishable rewrite cannot establish new custody.

Plain entitlement downgrade retains sender assignment and acquisition history,
sets admin attention, and prevents subsequent provider effects. Reconciliation
also detects downgrades/deletions for already-failed jobs holding acquired numbers.
Mapping removal/change alone never authorizes clearing legacy/manual routing.

## Budget, recovery, alerts and rollback

Reserve the exact candidate and UUID intent (`REVV-AUTO:<UUID>`) with atomic
persisted cap consumption before create. US number and account/candidate uniqueness
checks remain enforced. Retry/restart/worker/cadence changes cannot reset budget.
A timeout or crash reconciles inventory by exact candidate AND friendly identity;
absent/ambiguous inventory is terminal PURCHASE_UNCERTAIN and never triggers a
second create. Attach/configuration retries use the acquired PN. SDK requests use
10-second timeout and `autoRetry=false`. Entitlement/config checks hold shop locks
through each provider effect; waiting downgrades linearize afterward.

There is **no automatic new-run rotation or cap reset**. A new budget run or failed
job recovery requires an explicit operator-controlled procedure preserving all
prior evidence and resolving uncertain purchases; this phase supplies no reset UI
or SQL shortcut. A new success receipt never resets a failed job by itself.

Pending mapping/setup/cap/campaign/registration deferrals do not consume attempts.
Transient failures have durable 2/4/8/16-minute backoff; attempt five exhausts to
failed. Permanent provider/configuration and purchase uncertainty fail immediately.
Actionable enums include EVENT_SETUP_REQUIRED, MAPPING_REQUIRED, CONFIG_DRIFT,
CAMPAIGN_PENDING/FAILED, REGISTRATION_SOURCE_REQUIRED/PENDING/FAILED/REVOKED,
INELIGIBLE, CAP_DEFERRED, PURCHASE_UNCERTAIN and RETRIES_EXHAUSTED.

`notifyOps` receives only enum plus opaque shop ID. Durable per-enum hourly cooldown
covers failed/revoked/downgraded jobs across workers/restarts. Notification delivery
is not guaranteed; DB outages log sanitized QUEUE_FAILURE/ALERT_UNAVAILABLE.
Receipt endpoint DB errors log EVENT_RECEIVER_FAILURE. No uninterrupted monitoring
or notification delivery is claimed. This route has size/count bounds but no new
request-rate limiter; deployment edge rate/abuse controls remain an operator check.

Startup migration stays exact-true only. Idempotent additions support TEXT and UUID
shop IDs without cascading deletion. `down()` pauses control and marks attention;
all senders, job/receipt tables, acquired evidence and budget survive. `up()` does
not unpause it. Disable all workers before rollback. OFF does not revoke senders or
consume events; reconcile missed delivery/status before reenabling. A missing event
cannot prove current provider status: sink delivery/retention monitoring is required.

## Evidence and provenance

Official sources retrieved by Hermes via browser October 12, 2026; supplied full
Event Streams text and retrieval evidence were read locally. No real account query,
subscription setup, token validation, purchase or provider network request occurred.

- [A2P Event Streams](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/event-streams-setup):
  six number event types, CloudEvents JSON arrays and AC/MG/CM/PN/status/time fields.
- [Webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security):
  raw JSON signature/body-hash verification.
- [UsAppToPerson](https://www.twilio.com/docs/messaging/api/usapptoperson-resource),
  [number registration](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-a2p-phone-number-registration-issues),
  [ISV onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api):
  campaign approval differs from asynchronous number registration.
- Installed Twilio 5.12.2 `lib/webhooks/webhooks.js` was inspected for
  `validateRequestWithBody`, `getExpectedBodyHash`, `getExpectedTwilioSignature`;
  generated `messaging/v1/service/{usAppToPerson,phoneNumber}.js` was inspected for
  `mock`, `campaignStatus`, `messagingServiceSid`, `brandRegistrationSid`,
  `serviceSid`, account and number fields. No registration SDK method was invented.

## Acceptance matrix and gates

| Gate | Evidence required |
| --- | --- |
| OFF, entitlement, budget/restarts, uncertainty, alerts | auto tests; durable PG tests |
| Signed raw JSON, hash/query/Host/unknown-token rejection, bounds | events tests and real PG receiver |
| Whole-batch rollback, exact tenant/PN, duplicates/order/equal conflict | disposable TEXT and UUID PG tests |
| Callback before DB write, inventory recovery, production adapter to active | signed HTTP receiver + fake Twilio + real PG |
| All five nonregistered outcomes revoke automatic routing only | real PG, retained consent/resource/history |
| Manual replacement, failed-job downgrade, missing/new mapping | real PG; legacy/consent regressions |
| Campaign mock/binding/callback and final status recheck | synthetic provider tests |
| Migration up/up/down/up and receipt retention | real PG; no skips accepted |
| Release gate | full exact-SHA gates, Spark advisory, ONE Remy by Hermes |

Synthetic tests use real Express middleware, Node IncomingMessage/ServerResponse
and Twilio signing helpers over an in-memory HTTP transport, not a listening socket.
Every provider client is fake. Real-PG suites add actual persistence/transactions.

```sh
env -i PATH="$PATH" APP_URL=https://synthetic.invalid \
  node --test backend/test/smsProvisioning.auto.test.js backend/test/smsProvisioning.events.test.js

env -i PATH="$PATH" APP_URL=https://synthetic.invalid \
  SMS_PROVISION_TEST_DATABASE_URL=postgresql://zordon@127.0.0.1:55462/revv_sms_provision_test \
  node --test backend/test/smsProvisioning.auto.test.js backend/test/smsProvisioning.events.test.js backend/test/smsProvisioning.pg.test.js

env -i PATH="$PATH" APP_URL=https://synthetic.invalid \
  node --test backend/test/smsConsent.phase2.test.js \
  backend/src/__tests__/smsTierGate.test.js backend/src/__tests__/smsAutoReply.test.js
```

The shown DSN is the expressly supplied disposable host database. Never substitute
production. PG tests reject nonliteral-loopback hosts, other database names and URL
query overrides, use random synthetic schemas, and remove only their own schemas.
They do not load dotenv/app startup or the generic production migration runner.
If sandbox networking returns EPERM, record the failure and have Hermes rerun on
the host; neither a skipped suite nor phase-one results verify this candidate.
