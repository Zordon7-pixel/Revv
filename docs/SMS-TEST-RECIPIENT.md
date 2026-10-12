# SMS test recipient guard — PREP ONLY

Task `t_e147d8b2`, run501: implementation in the isolated worktree only. This
change authorizes no production writes, installed configuration changes, feature
enablement, provider calls or live messages. The integrated 52-file baseline is
under Remy HOLD, not release PASS. Hermes owns the board and release.

## Policy

`REVV_SMS_TEST_RECIPIENT` names exactly one permitted recipient. Its **presence**
activates the restriction, including an empty or malformed value and regardless
of `REVV_SMS_TEST_MODE=false`. After trimming surrounding whitespace, the value
must be a single E.164 string: `+`, a nonzero first digit, and 8–15 total digits.
Lists, JSON arrays, separators, internal whitespace, letters and suffixes fail
closed. No actual recipient or asserted owner last four digits are stored here.

`REVV_SMS_TEST_MODE=true` activates fail-closed test context even when the
recipient setting is missing. Mode values are case-sensitive: absent, empty,
or exactly `false` do not activate mode alone. Any other nonempty value is invalid
and denies all sends, including when the recipient itself is valid.

With both settings absent, ordinary behavior is unchanged. Absence is **not** a
safe test configuration or authorization to send. In active context, the outbound
target must itself be a strict, trim-only E.164 string exactly equal to the
configured canonical recipient. A disallowed target is never rewritten to the
allowed recipient. A permitted target is sent using the exact validated, trimmed
string; arbitrary characters are never stripped for allowlist matching.

The centralized `sendSMS` boundary checks at entry and again after asynchronous
consent/configuration lookups, before constructing Twilio or calling the provider.
There is no await between the final check and provider invocation. Restriction
activation is latched for the current send: removing its setting during an await
fails closed. A restriction introduced during an await is also enforced. Request
JSON, caller test flags, `customerFacing`, and supplied `twilioConfig` cannot
disable it. `sendStaffSMS` reaches the same guard through its existing scoped
staff lookup and private capability.

Existing shop scope, customer confirmed-consent evidence, STOP, plan entitlement,
footer and audit behavior remain mandatory and unchanged. The existing internal
staff capability retains its established audience semantics and STOP/entitlement
checks; this guard adds no consent or plan bypass, test-send route, or audit write.
Restriction exits return `provider_attempted: false`, with static reasons
`sms_test_recipient_config_invalid` or `sms_test_recipient_denied`; reasons and
suppression logs contain no target or configuration value.

## Inspection: configuration proof only

`backend/scripts/inspect-sms-test-recipient.js` provides **configuration proof,
not delivery, recipient ownership/provenance, authorization or consent proof**.
It imports only the pure policy module, reads the current process's two settings,
prints one JSON object, and never loads dotenv/app startup, connects, sends or
mutates configuration. It has no provider/database/network imports or dependencies.

Output is limited to `setting`, `enabled`, `configured`, `valid`,
`recipient_count` (0 or 1), `last4` (valid only; otherwise null), and `guard`
(`sms_test_recipient`). `configured` means the setting is present, even if empty;
`valid` requires a valid single recipient and a valid mode. No full value or
secret is printed. Missing/invalid configuration exits 1; valid configuration
exits 0. A valid result says nothing about Twilio readiness or successful delivery.

Safe PREP ONLY demonstration with an empty process environment (expected exit 1):

```sh
env -i /opt/homebrew/opt/node@22/bin/node backend/scripts/inspect-sms-test-recipient.js
```

Do not copy a real recipient into source, shell history, logs, or a report.
The main session separately assists read-only recipient provenance discovery;
these synthetic tests do not establish it. Do not invent owner last4 or consent.
Setting this variable alone is neither permission nor consent.

## Later live execution remains separate

Before any later live test, Professor X must confirm Bryan's direct OK. A future
authorized executor must independently verify the owner recipient and existing
consent/STOP/entitlement gates, and enforce **at most three owner-only messages
cumulatively**, including applicable retries and concurrent attempts. This guard
does **not** implement or claim that cumulative three-message budget. Live
authorization, budget accounting and execution require separate enforcement;
passing inspection or these tests cannot authorize a live send.

Required workflow remains Codex implementation → deterministic QA → Spark
advisory → ONE Remy exact-SHA review, routed by Hermes. Historical Claude QA
instructions do not replace this workflow. This PREP ONLY task requests no review
and performs no push, deployment, configuration change or live verification.

## Focused deterministic checks

The new suite injects a minimal environment, pure consent/policy modules, mocked
database lookups and mocked Twilio construction/calls. Unknown imports throw;
the inspection subprocess receives only synthetic settings, with no shell or
inherited environment. No installed dependencies, real database or network are
needed. Test names/assertions avoid full phone output.

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 \
  /opt/homebrew/opt/node@22/bin/node --test backend/test/smsTestRecipient.test.js
```

Coverage includes inactive baseline, fail-closed configuration/mode parsing,
strict targets and international collisions, caller/staff bypass attempts,
consent/STOP/plan denials, provider target fidelity, environment changes across
async gates, private inspection JSON and a closed import boundary. Full shared
database and release checks remain Hermes's responsibility.

An additional existing `smsConsent.phase2.test.js` run with the real PostgreSQL
case excluded failed before its scenarios could execute: all 49 selected cases
reported missing `uuid` in this dependency-free worktree. No package install or
test weakening was performed; that suite remains unverified here.
