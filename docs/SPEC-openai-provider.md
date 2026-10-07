# OpenAI-only REVV AI — 2026-09-26

Bryan requested OpenAI for REVV AI going forward. All runtime AI call sites now use the shared `services/openai.js` client. Supplier/eBay data, tracking, payments and SMS still require their own service connections; an AI model does not replace those systems.

Migrated workloads:
- Part-label photo extraction → OpenAI vision, reviewed JSON candidates.
- Uploaded damage-photo assessment → OpenAI vision, existing optional-assessment behavior.
- Estimate-assistant scan → OpenAI vision, existing zone mapping and suggestion workflow.
- Estimate extraction/recovery → existing OpenAI gpt-4o path only. Removed Anthropic authentication fallback; deterministic parsing, preserved readable rows, PDF text/image fallback and relaxed-prompt retries remain.

Configuration: server-only `OPENAI_API_KEY`, optional `OPENAI_VISION_MODEL` (default gpt-4.1-mini) and `OPENAI_ESTIMATE_MODEL` (default existing gpt-4o). Defaults preserve fast photo assessment and the existing estimate workload rather than changing every workload to a flagship. Calls use the official OpenAI endpoint, JSON response mode, explicit output bounds, `store: false`, 45-second timeout, and one SDK retry. Incomplete/refused responses fail reviewably; no second AI provider receives data. Anthropic dependency removed. No model key or secret is emitted in logs or client responses. `store: false` is not a claim of zero provider retention.

Migration tests: 48 targeted/integration checks plus 7 deterministic-parser checks cover OpenAI client/model settings, request image shape, JSON response handling, refusal/truncation/provider failure, part matching, and estimate upload/intake/recovery/error reporting. Independent review passed, including a final 25-check rerun with real PostgreSQL. Provider fixtures test code paths; live OpenAI quality/billing/access are not verified because no local OpenAI key exists. Railway CLI returned unauthorized, so production configuration could not be inspected. No production configuration was changed and this branch was not deployed.

The eBay developer registration page was opened at https://developer.ebay.com/signin?tab=register. The user must enter a new password and complete license acceptance/account verification. No registration, production keyset, or Browse approval is claimed. Resume the retained browser tab after the user completes that checkpoint; do not invent account details or credentials.

Official reference: https://developers.openai.com/api/docs/guides/images-vision and https://developers.openai.com/api/docs/models/gpt-4.1-mini .

## Estimate fallback policy — E1, 2026-10-07

E1 adds persisted settings and admission infrastructure only. It makes no model
calls and does not yet wire `insuranceOcr.js`; E2 follows sequentially. Do not ship
E1 alone as enforcement of the OCR bounds. Damage-photo assessment, part labels,
suppliers and other AI features retain their existing behavior.

`shops.estimate_ai_enabled BOOLEAN NOT NULL DEFAULT FALSE` is the sole shop opt-in.
There is no inference from old imports, provider keys or historical usage. Existing
settings `GET /api/settings` exposes the field to authenticated staff allowed by
the existing technician-level read guard. Private cost fields remain owner/admin
only. `PATCH /api/settings` accepts this field only for exact signed-JWT roles
`owner` and `admin`, scoped to `req.user.shop_id`. A present field must be a JSON
boolean; null, strings, numbers, arrays and objects reject the entire settings
patch before any write. An omitted field preserves the saved value; an empty
patch still rejects. Body role/shop fields cannot authorize or select a tenant.
The UI label is **AI estimate fallback**. Staff see its state without a toggle;
owners/admins explicitly toggle and save. Unchanged saves omit the field. Missing,
invalid or failed reads show unavailable and disable editing, never inferred On.
The UI explains estimate content sharing with OpenAI and manual/standard parsing.

Both existing startup paths call `db/estimateAiPolicy.up(pool)`; E1 uses the
existing `db/index.js` pool and introduces no connection or provider configuration.
Initialization is additive, transactional and repeatable. It preserves existing
explicit booleans and budget rows; incompatible policy/budget column types or
missing budget primary key reject startup with `ESTIMATE_AI_SCHEMA_REQUIRED`.
It does not convert historical truthy strings or rewrite NULL policy values.
No request-time DDL, production migration or blanket enablement is authorized.
`estimate_ai_budgets` stores `shop_id TEXT PRIMARY KEY`,
`window_started_at TIMESTAMPTZ NOT NULL` and `admission_count INTEGER NOT NULL`
(1–15). Shop identity is canonical `shops.id::text`, supporting both TEXT and UUID
parents without type conversion or a UUID-only foreign key. The service validates
and locks the actual parent on every admission; budget rows persist across app
restarts and initializer reruns.

Exact E2 service API (CommonJS):

```js
const { admitEstimateAi } = require('../services/estimateAiPolicy');
const result = await admitEstimateAi(req.user.shop_id);
// result is exactly { status: 'admitted' | 'off' | 'quota' | 'unavailable' }
```

The one argument is the authenticated shop ID string. There are no request/body
options, injected time, user budget or provider configuration arguments. Only
`admitted` permits E2 to enter its bounded model-call path. `off` means persisted
boolean false; `quota` means the shared shop window is full; `unavailable` covers
missing/invalid identity or policy, missing/incompatible schema, invalid budget,
backwards clock and database/transaction failure. No database details or private
budget internals are returned. Provider errors and failed/ambiguous commits never
refund an admission or authorize a model call.

Admission uses a READ COMMITTED transaction and `SELECT ... FOR UPDATE` on the
shop, then reads PostgreSQL `clock_timestamp()` after the lock. All users and
processes share a fixed 10-minute window anchored to the first admitted request:
15 admissions maximum before `window_started_at + 600000ms`; equality starts the
next window with count 1. It is not a rolling-window or dollar-spend guarantee.
A settings disable serializes on the same shop row. Already admitted in-flight
requests are not cancelled by disabling; off/on does not reset the budget.
Tests replace only the DB clock query in an isolated module fixture; production
has no time override. The budget write must commit before returning `admitted`.

E2 integration contract, still pending:

- Keep the existing per-user 15 requests/10 minutes limiter and deterministic
  CCC/Mitchell-first parsing. Call admission at most once per request, only when
  model fallback is needed, before the first actual model call. Do not admit each
  repair/recovery/retry separately or call the provider on other statuses.
- Bound the entire request to **2 actual model attempts including transport/SDK
  retries**, across JSON repair, relaxed text, zero-line and visual recovery paths.
- Bound all model input across files to **12 image pages** and **120000 text
  characters total**, retaining the existing 4096 output-token cap. These are
  admission/request/call/input bounds, not a guaranteed dollar-spend cap.
- On off/quota/unavailable, retain honest summary/manual fallbacks and saved-upload
  behavior; never fabricate line items. Add E2 provider-boundary tests with zero
  provider calls for denied admissions. E1 tests do not claim route enforcement.

E1 verification commands (Node 22; disposable loopback PostgreSQL, standard PG
variables only; no application startup, dotenv, provider clients or live data):

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 PGHOST=127.0.0.1 PGPORT=55461 PGUSER=revv_e1 PGDATABASE=revv_estimate_ai_test node --test backend/test/estimateAiPolicy.integration.test.js
cd frontend
env -i PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test CI=1 node node_modules/vitest/vitest.mjs run src/pages/__tests__/Settings.estimateAi.test.jsx src/pages/__tests__/WorkSurfaces.test.jsx src/pages/__tests__/Phase4.branding.test.jsx src/pages/__tests__/PublicIntake.routing.test.jsx
```

The backend suite creates/drops only uniquely named schemas within a database
whose name starts `revv_estimate_ai_test`. It exercises real SQL, mounted settings
HTTP/auth, role/tenant/privacy/no-write behavior, TEXT/UUID defaults, concurrency,
separate processes, restart/boundary cases, schema/DB failures and provider import
exclusion. A test-only admission HTTP harness consumes the service, not the E2 OCR
route. Provider clients are forbidden by the fixture dependency allowlist.

E1 worker verification (Node v22.23.2, this implementation; not release approval):

- Frontend command above: exit 0, 4 files / 66 tests passed (20 new policy UI
  cases); `/private/tmp/revv-e1-frontend.log`.
- `node --test --test-name-pattern='isolated:' backend/test/estimateAiPolicy.integration.test.js`:
  exit 0, 17 passed, 0 failed/skipped; `/private/tmp/revv-e1-isolated.log`.
- `node --test backend/src/__tests__/trueShopProfit.costProfile.test.js backend/src/__tests__/role-guards.test.js backend/src/__tests__/publicIntake.test.js`:
  exit 0, 29 passed, 0 failed/skipped; `/private/tmp/revv-e1-backend-regression.log`.
- From `frontend`, `node node_modules/vite/bin/vite.js build --outDir /private/tmp/revv-e1-dist`:
  exit 0; existing Browserslist/chunk-size warnings; `/private/tmp/revv-e1-build.log`.
- Node `--check` on all six changed backend JS files and `git diff --check`: exit 0.
- Full PG command above: **exit 1, 17 isolated checks passed, all 7 real-PG cases
  blocked by `connect EPERM 127.0.0.1:55461`**, before fixture SQL/HTTP execution;
  `/private/tmp/revv-e1-pg-tests.log`. Disposable `initdb` also failed with
  `shmget: Operation not permitted`; `/private/tmp/revv-e1-init.log`.
  Real SQL, mounted HTTP, cross-process and startup compatibility verification
  therefore remain pending a host run with the disposable DB. No PG pass is claimed.

All test/build commands used the sanitized `env -i` prefix above. Changes touch
nine files and are safety-sensitive access, opt-in and admission enforcement.
Hermes must retain the missing PG gate and E2 route-enforcement gate. No independent
review, provider use, production mutation, board update, push or deployment was
performed. No dollar-spend or live-enforcement guarantee is claimed.
