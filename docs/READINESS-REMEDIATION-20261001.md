# REVV readiness remediation — 2026-10-01

Task `t_bde461bd`, phase3. Implementation only in `/Users/zordon/revv-build-wt/readiness-remediation-20261001`, branch `codex/revv-readiness-remediation-20261001`. Canonical checkout is frozen. This document is not deployment approval. Bryan did not authorize the deployment asserted in the September release record.

Hermes owns commits, host gates, Spark advisory and one final Remy review of the unchanged full candidate SHA. Codex does not commit, push, deploy, dispatch reviews, update boards or send messages. The current implementation remains uncommitted; no final-candidate green, advisory or review verdict is claimed. Detailed SHA/base, command, exit status, output tail, versions, skips and review receipts belong in `/Users/zordon/hermes-artifacts/revv-readiness-20261001/`, outside source. Do not amend source to insert its own final SHA.

## Disposition of every original Remy finding

“Fixed” below describes inspected source and the identified coverage, not live verification. Phase1/phase2 tests are present but not re-run as integration/browser gates in phase3. No unresolved critical/high issue is waived by a P2/P3 label; a blocking finding remains a gate until resolved with evidence.

| Finding | Disposition and evidence | Remaining gate / owner |
| --- | --- | --- |
| SMS default TRUE / consent provenance | New paths fixed in phase1: schema default FALSE, migration adds a nullable column then sets future default FALSE without rewriting existing values, customer create requires boolean TRUE, intake controls default off. See `backend/test/customerConsent.integration.test.js`, `customerOptInConfirmation.test.js`, frontend AddROModal/Customers tests. Existing TRUE/FALSE/NULL and STOP records preserved. | `SMS-RECONSENT`, separate approved Codex work coordinated by Hermes; parts SMS activation held. Old TRUE is not verified consent. |
| Optional source revision | Fixed in phase2: `agreementAutofill.checkRevision` requires a current lowercase 64-hex string; prepared preview/create always call it; static create permits omission but strictly checks any supplied property. Existing `agreementAutofill.test.js` and `agreements.integration.test.js` cover missing/null/malformed/stale and static cases. | Hermes final local integration gate; no blanket freshness claim for revision-free static creation. |
| Unchained / unsigned audit | Accurate disclosure in release/autofill docs. `agreement_events` has ordinary rows; `/:id/audit` returns JSON without a cryptographic signature. PDF digests check document consistency, not an event hash chain or independently tamper-proof export. | `AUDIT-INTEGRITY-DESIGN`, broad redesign held for separately approved scope; no stronger guarantee claimed. |
| False deployment authorization | Corrected directly in release doc and CLAUDE integrated-release entry: Bryan did NOT authorize that deployment; implementation is not approval. | No deploy/main push in this mission. |
| Inaccurate autofill scope | Corrected spec: pinned Miles tenant/profiles only, guarded prepared revisions, optional strict static revision, saved RO money with review, same-RO prior loss-date rules, no generic uploaded-PDF mapping or legal approval. | Hermes source/final gate; Miles import, legal and visual evidence outstanding. |
| Unreproducible test counts | Earlier counts explicitly historical; reproducible commands below replace current-count inference. Final-SHA receipts stay external. | Hermes runs exact committed candidate; Node26 localStorage failure is not a pass or silent waiver. |
| P3 preview invalid/null email | Phase2 shared `recipientEmail` validates full supplied/saved email in preview/create; null/absent email is allowed for tablet use, invalid saved email is rejected before truncation. Existing integration cases cover both endpoints and no-write behavior. | Hermes local integration gate pending here. |
| P3 completion claim mismatch | Phase2 `matchesIntake` compares name/VIN/claim for same shop/RO/template signed intake in preview/create. Existing integration tests cover blank/real claims and each mismatch. | Hermes local integration gate pending here. |
| P3 pending / awaiting_shop copy | Phase2 duplicate conflict says only pending requests can be voided by owner/admin. Both states block duplicates; awaiting_shop cannot be voided. Existing integration case checks the copy and status boundary. | Hermes final integration/frontend checks. |
| P3 staff void authorization | Phase2 void route uses manager guard (owner/admin), tenant scope and pending-only update. UI requires pending + manager capability. Integration rejects other staff/tenants; frontend `Agreements.test.jsx` covers capability and state visibility. | Auth-sensitive; Hermes final gate and exact-SHA Remy review. |
| Notification console PII | Fixed here in `mailer.js`/`sms.js`: static outcomes, validated UUID/SM references, bounded HTTP status and five-digit Twilio code. No recipient/sender, subject/body, raw error, shop ID or credential data is interpolated. `notificationLogging.privacy.test.js` captures all console methods with sentinel values, including malformed/oversized/object references and codes. | Eight new mocked privacy tests pass; full focused run 26/26 below. Provider calls/returns and customer switches unchanged. |
| Per-customer cooldown | Explicitly held; current unique shop/part/revision claims are per-event dedupe, not a customer-wide cooldown. | `NOTIFY-COOLDOWN`, Codex follow-up via Hermes to define window, cross-part/revision behavior and tests before parts SMS activation. |
| Multi-call OCR cost / per-shop AI opt-in | Explicitly scoped out. No AI policy, dependency or `insuranceOcr` edits. Multiple-call cost limits and per-shop opt-in are not established by this remediation. | `OCR-COST-OPT-IN`, separate approved Codex scope via Hermes; no live AI activation/testing here. |

Additional bounded follow-ups found during source inspection:

- `SMTP-LOG-PRIVACY`: `backend/src/services/email.js` logs raw SMTP exception messages. Outside the eight-file allowlist; Hermes must isolate for Codex repair. Existing email tests cover unconfigured/simulation behavior, not SMTP failure privacy. This phase does not certify all notification logging.
- `NOTIFY-REFERENCE-VALIDATION`: `partsNotifications.js` stringifies/truncates accepted provider references into history; console validation here does not sanitize that separate persistence path. Hermes should scope validation of durable reference fields for Codex before new parts notification activation. No persisted-data or audit redesign is attempted here.

## Consent plan and source-only assertion

Inspection covered customer schema and migrations, customer/RO consent writes, UI defaults and `smsAutoReply.js` STOP/START handling. Current source has no trustworthy positive historical SMS consent provenance linking a TRUE value to actor, time, method and disclosure. STOP records have opt-out timestamps; START removes suppression, and the confirmation message is not proof of the original affirmative choice. This is a source-only assertion, not a query of historical tenants, messages or provider records.

Preserve stored TRUE/FALSE/NULL and STOP records. Separate approved work must collect a fresh explicit in-person choice and record provenance, actual time and disclosure/version before parts SMS activation. Do not infer consent from legacy TRUE, fabricate timestamps, bulk rewrite old values or clear STOP records as part of re-consent migration. A lawful/approved resubscribe process needs its own explicit scope. No re-consent messages are sent here.

## Provider and operational exclusions

OpenAI, eBay, Twilio and Resend are **LIVE UNKNOWN**. All four are excluded from live verification and activation. Preserve deterministic parsing, manual inventory/part entry and unconfigured states. No credential reads/changes, paid calls, production/tenant access, Miles import, seeds/migrations against production, messages or deployment. No unrelated production switches are disabled.

No new provider-dependent path is enabled by phase3. Existing per-save notification code can still send if explicitly used with configured providers and passing gates; the activation hold is operational, not a newly implemented kill switch. If an enforceable hold is needed for a future release, Hermes must isolate that specific code scope for Codex. Do not represent a documentation hold as a runtime block.

## Evidence classes and current result

- **Source review:** phase1/phase2 dispositions and limits above; no independent reviewer verdict invented.
- **Mocked tests, run by Codex in phase3:** Node v22.23.2; npm 10.9.8 available. Privacy test alone: exit 0, 8 tests passed, 0 failed/skipped. Focused command below: exit 0, 26 tests passed, 0 failed/cancelled/skipped/todo. Console capture includes synthetic phone/email/subject/body/token-like error text; mailer returns/null/throws and SMS outcomes/body/SIDs and calls are asserted unchanged. Network disabled and dotenv loading stubbed.
- **Real local integration:** not run in phase3; database-backed assertions in source are not a fresh execution receipt. Explicit URLs below are required; skipped integration tests are not green integration evidence.
- **Browser / PDF visual:** not performed in phase3. A PDF parse/page-count test or frontend build is not visual verification.
- **Live production / provider / legal:** none claimed. No production configuration, current live SHA, tenant import or legal signoff verified.

The supplied host setup reports Node v22.23.2 and successful backend `npm ci`. Frontend plain `npm ci` failed with missing esbuild peer entries; `npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund` succeeded without manifest/lock changes. These install results are user-supplied host evidence, not Codex re-execution or a frontend gate pass. No upgrades are proposed. Default PATH here resolved Node v22.22.3; all phase3 test runs explicitly used `/opt/homebrew/opt/node@22/bin/node` v22.23.2. Historical Node26 localStorage environment failures remain failed runs; a supported Node22 rerun must supply actual results, including failures, rather than waive them.

## Reproduction commands

Run from the assigned worktree. Use the installed Node22 toolchain explicitly. Hermes captures each command/exit/output tail externally after committing; commands below are instructions, not final-candidate receipts.

```sh
export PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin
node --version
npm --version
(cd backend && npm ci)
# Preserve the plain npm ci failure receipt; do not claim it succeeded.
(cd frontend && npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund)
git diff --exit-code -- backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
```

The actual phase3 focused run used this temporary preload (no source/dependency changes), so DB imports cannot read `.env` and unexpected network access fails. Run it from the repository root:

```sh
cat > /tmp/revv-phase3-offline.cjs <<'JS'
const path = require('node:path');
const dotenv = require.resolve('dotenv', { paths: [path.join(process.cwd(), 'backend')] });
require.cache[dotenv] = { id: dotenv, filename: dotenv, loaded: true, exports: { config: () => ({ parsed: {} }) } };
const blocked = () => { throw new Error('Phase3 focused tests forbid network access'); };
require('node:net').Socket.prototype.connect = blocked;
require('node:dgram').Socket.prototype.send = blocked;
global.fetch = blocked;
JS
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test \
  /opt/homebrew/opt/node@22/bin/node --require /tmp/revv-phase3-offline.cjs --test \
  backend/src/__tests__/notificationLogging.privacy.test.js \
  backend/src/__tests__/sms-compliance.test.js \
  backend/src/__tests__/smsTierGate.test.js \
  backend/src/__tests__/email.production.test.js \
  backend/src/__tests__/customerOptInConfirmation.test.js
git diff --check
```

For final full Node-native gates, Hermes must use pre-provisioned disposable local PostgreSQL databases on the explicit port below, an environment without provider credentials and outbound network restricted to loopback. Do not run production seeds/app migrations or substitute a production URL. The tests create/drop isolated fixture schemas. The example requires a pre-provisioned local `revv_test` role with access to those disposable databases; use the verified local test role/port and record them. No credential or role provisioning is performed here. The consent database must be named `revv_customer_consent_test`; the other test guards require the names shown. A missing/unavailable DB is a failed/unexecuted gate, not a waiver.

Use a dotenv-only preload for integration (the focused network blocker above also blocks PostgreSQL and loopback HTTP):

```sh
cat > /tmp/revv-test-no-dotenv.cjs <<'JS'
const path = require('node:path');
const dotenv = require.resolve('dotenv', { paths: [path.join(process.cwd(), 'backend')] });
require.cache[dotenv] = { id: dotenv, filename: dotenv, loaded: true, exports: { config: () => ({ parsed: {} }) } };
JS
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test \
  PGHOST=127.0.0.1 PGPORT=5432 PGUSER=revv_test PGDATABASE=revv_esign_test \
  JWT_SECRET=readiness-local-test-only \
  AGREEMENTS_TEST_DATABASE_URL=postgres://revv_test@127.0.0.1:5432/revv_esign_test \
  PARTS_TEST_DATABASE_URL=postgres://revv_test@127.0.0.1:5432/revv_parts_test \
  CUSTOMER_CONSENT_TEST_DATABASE_URL=postgres://revv_test@127.0.0.1:5432/revv_customer_consent_test \
  node <<'JS'
const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const excluded = new Set(['cccExtractor.test.js', 'estimateFormat.test.js', 'mitchellExtractor.test.js']);
const files = ['backend/src/__tests__', 'backend/test'].flatMap(dir =>
  readdirSync(dir).filter(name => name.endsWith('.test.js') && !excluded.has(name))
    .map(name => `${dir}/${name}`)).sort();
console.log(files.join('\n'));
const result = spawnSync(process.execPath,
  ['--require', '/tmp/revv-test-no-dotenv.cjs', '--test', ...files],
  { stdio: 'inherit', env: process.env });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
JS
```

The three excluded parser files use Vitest, not the Node test runner. Run them separately, plus the frontend gates, in the same provider-free host environment with no `.env` files loaded. Do not treat the legacy-peer/ignore-scripts install alone as evidence that these gates pass:

```sh
(cd backend && npm run test:run)
(cd frontend && npm run test:run)
(cd frontend && npm run build)
git diff --check
```

Hermes must report generated PDF rendering/visual inspection and synthetic browser checks separately if performed. Final receipts must bind all gates and advisory/review to the clean committed SHA; this document stays unchanged when receipts arrive. Missing, uncertain, malformed or failed Spark results are never PASS. This change exceeds two files and touches privacy logging/audit claims; the integrated candidate also includes phase2 auth changes. Flag those review triggers to Hermes; Codex does not request or duplicate Remy reviews.
