## Dispatch Log — 2026-10-21 REVV P3 public prospects (t_0c57ea82)

15:45 EDT / 19:45 UTC. Sole implementation writer in the assigned
`codex/t_0c57ea82-p3` worktree, exact base
`8bd29f13fb6f17d5979115acdbab89ccaf71c765`. Implementation and local mocked
checks complete; no independent review, deployment or live verification claimed.
Hermes retains QA/review/release/lifecycle ownership. No board calls, outbound
messages, provider/DB access, account provisioning, push or service/config changes.

Public leads/waitlist optional invalid, expired, revoked or malformed credentials
now proceed anonymously; protected auth keeps its 401/signature/revocation gates.
Successful verification resolves current persisted user/shop policy for alerts;
body/query/email/source/JWT flags cannot establish fixture suppression or privilege.
A verification-store outage suppresses alerts instead of assuming ordinary traffic.
Prospect alerts run without awaiting them in the HTTP handler. A five-second
abort plus promise race contains webhook hangs and late rejections without retry.
Policy failures suppress transport and log a fixed sanitized message. A saved
waitlist row survives subsequent policy failure; actual insert failure still fails.
All touched failure logs omit PII, tokens, raw errors and stack traces.

Seven paths: this log; backend/src/middleware/auth.js;
backend/src/routes/leads.js; backend/src/routes/waitlist.js;
backend/src/utils/discord.js; backend/test/prospectDiscord.test.js;
backend/test/emailShopPolicy.test.js (VM AbortController support).
Safety-sensitive auth and external-effect suppression; exceeds two files.

Validation: Node v22.23.2 with scrubbed env (NODE_ENV=test, CI=1), NODE_PATH
`/Users/zordon/revv-build-wt/sms-dryrun-rebase-20261013/backend/node_modules`
(read-only existing dependencies; JWT/Express/UUID/rate-limit match lock versions),
NODE_OPTIONS=`--require=/private/tmp/revv-phase9/deny-network.cjs` (blocks sockets,
fetch, dotenv and real pg), and PATH containing Node22/Homebrew/system binaries.
- `node --unhandled-rejections=strict --test backend/test/prospectDiscord.test.js`:
  exit 0; 71 passed, zero failed/cancelled/skipped. Includes real Express stream
  serialization without listening sockets, pending/late webhook settlement,
  stored-policy rejection after insert, protected auth and zero-transport fixtures.
- `node --unhandled-rejections=strict --test --test-concurrency=1
  backend/test/prospectDiscord.test.js backend/test/emailShopPolicy.test.js
  backend/test/billingShopPolicy.test.js backend/test/metricsShopPolicy.test.js
  backend/test/ordinarySurfacesPolicy.test.js backend/test/remainingParityPolicy.test.js
  backend/src/__tests__/publicIntake.test.js`: exit 0; 1,319 passed, zero failures/skips.
- Each of the six changed JS paths: `node --check` exit 0. `git diff --check`: exit 0.

Reported/recovered hiccups: guidance output truncation; unmatched search glob;
missing local jsonwebtoken (first focused run exit 1), resolved via existing local
dependencies; five anonymous mock failures resolved by retaining the no-auth fast
path; two new Express harness serialization failures corrected and rerun green.
The additional existing `backend/src/__tests__/feedback.auth.test.js` run has
5 pass / 2 fail (exit 1: expected 200/201, got 503). Both reproduce with the exact
base auth source loaded in memory; the feedback fixtures/anonymous-policy
expectations are unrelated to P3 and unchanged. This is not a full-suite pass.

Residuals: process-local best-effort alerts are not durable or retried; shutdown
can lose a pending alert. A failed trusted policy lookup deliberately loses that
alert while retaining form success. The existing direct frontend Firestore
isolation gap and held account remain out of scope. No production behavior,
Railway pause state or external delivery was probed or changed.

## Diagnostic follow-up — 2026-10-21 (t_c71bda55)

The preceding 57 lines were moved verbatim from the start of `CLAUDE.md` at
`9cd507a9fc0674805f214345bc74c64123819e89`. All remaining bytes of `CLAUDE.md`,
including the next dispatch log and standing guidance, are unchanged.

Implementation is confined to branch `codex/t_c71bda55-p3-diagnostics` in
`/Users/zordon/.hermes/kanban/workspaces/t_c71bda55/source`. The worktree started
clean at that exact base. The current host work ledger identifies this task and
the separate feedback repair; no ownership collision was found. Process listing
was sandbox-denied, so live writer verification relies on the supplied host
preflight. Guidance/test output truncations were recovered with targeted reads
and captured test summaries. No implementation or test failure occurred.

Prospect diagnostics are exactly `[Discord] ` followed by one fixed code:

| Code | Reachable condition |
| --- | --- |
| `PROSPECT_IDENTITY_UNAVAILABLE` | Signed identity cannot complete token or user revocation-store verification; middleware supplies the existing null sentinel. |
| `PROSPECT_POLICY_UNAVAILABLE` | Persisted user/shop lookup rejects or cannot establish one matching user and Boolean shop policy. |
| `PROSPECT_DELIVERY_TIMEOUT` | The existing five-second deadline wins the transport race. |
| `PROSPECT_DELIVERY_NON_2XX` | Fetch resolves with `response.ok === false`. |
| `PROSPECT_DELIVERY_FAILED` | Transport throws/rejects for another reason; no inference from provider error text, name or code. |

Invalid-signature, expired, malformed and revoked optional credentials still
proceed anonymously; those outcomes are not newly classified as outages. Trusted
fixtures still suppress transport. Exported return contracts, including the
legacy `SHOP_POLICY_UNAVAILABLE` suppression result, remain unchanged. Only the
private delivery helper now accepts explicit timeout/prospect options. Tenant
alert logs remain unchanged. No raw error/object, stack, response body, URL,
token, name, email, phone, IP or user/shop identifier is logged by these prospect
failure paths. Tests assert exact messages and absence of synthetic private data.

Detached HTTP success, persisted waitlist success after lookup/delivery failure,
one transport attempt, the five-second abort/race, timer cleanup and late
rejection observation remain covered. Tests also cover abort-triggered rejection,
a transport error mimicking timeout metadata, and unchanged helper results.

Validation: Node v22.23.2, existing read-only dependencies, no installation.
Both test commands below were prefixed with this scrubbed deny-network environment:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin \
  NODE_ENV=test CI=1 \
  NODE_PATH=/Users/zordon/revv-build-wt/sms-dryrun-rebase-20261013/backend/node_modules \
  NODE_OPTIONS=--require=/private/tmp/revv-phase9/deny-network.cjs
```

```sh
node --unhandled-rejections=strict --test backend/test/prospectDiscord.test.js
# exit 0: 81 passed; 0 failed/cancelled/skipped
node --unhandled-rejections=strict --test --test-concurrency=1 \
  backend/test/prospectDiscord.test.js backend/test/emailShopPolicy.test.js \
  backend/test/billingShopPolicy.test.js backend/test/metricsShopPolicy.test.js \
  backend/test/ordinarySurfacesPolicy.test.js backend/test/remainingParityPolicy.test.js \
  backend/src/__tests__/publicIntake.test.js
# exit 0: 1329 passed; 0 failed/cancelled/skipped
```

Each syntax command below used
`env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin`:

```sh
node --check backend/src/utils/discord.js
node --check backend/test/prospectDiscord.test.js
# each exit 0: both changed JavaScript files
git diff --check
# exit 0
```

The inherited feedback.auth 5-pass/2-fail 503 baseline was not rerun or changed.
Existing process-local best-effort delivery and the frontend Firestore isolation
gap remain unchanged. Four changed paths: `CLAUDE.md`, this evidence document,
`backend/src/utils/discord.js`, and `backend/test/prospectDiscord.test.js`.
This touches the alert suppression/identity boundary and exceeds two paths;
Hermes retains final commit, QA, independent review, integration and release.
No commit, board/message operation, live outbound, real DB access, secret access,
push, deployment, restart, provisioning or configuration change was performed.
