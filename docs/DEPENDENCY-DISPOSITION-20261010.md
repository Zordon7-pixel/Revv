# Phase G dependency disposition — t_3ae3ac28

Implementation input only, 2026-10-10. **BLOCKED remediation; not security clean or release acceptance.**
Sole source: `/Users/zordon/.hermes/kanban/workspaces/t_3ae3ac28/recovery-run/source`,
branch `codex/revv-all-issues-recovery-20261007`, unchanged HEAD
`acab277609586ad10b534292f688f4b989e1c31b`.
Compared with supplied main `3e6541127de55cef569c61abdf893eceb7fcbd8f`.
No commit, board mutation, delegation, review request, provider request, private data,
secret/.env read, deployment, production database access, or configuration change.
Hermes owns installation on host, full gates, scoped commit, exact-SHA review and shipping.

## Result and blockers

Only the two allowed dependency tests and this document changed. Manifests and locks
are unchanged: no unverified versions, integrity hashes, overrides, forced topology,
Nodemailer major, Router major, or unrelated dependency updates were introduced.

The first registry check and the first requested compatible update both failed:

```sh
# cwd: source/backend; both exit 1
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin npm view proxy-addr@2.0.8 version dist.integrity --json --fetch-retries=0 --fetch-timeout=15000 --cache /tmp/revv-phase-g-npm-cache
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin npm update proxy-addr --package-lock-only --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000 --cache /tmp/revv-phase-g-npm-cache
# npm error code ENOTFOUND
# request to https://registry.npmjs.org/proxy-addr failed,
# reason: getaddrinfo ENOTFOUND registry.npmjs.org
```

No alternate network route or sandbox bypass was attempted. **No proposed registry
version was verified in this run.** Targets below remain proposals from the supplied
triage; a semver-compatible range is not proof that the version exists or is compatible.
The task-generated npm cache/logs were relocated from the command's temporary path
to `backend/node_modules/.cache/revv-phase-g-npm-cache` inside this task workspace.
After this failure, further installs, websocket-driver update, audit and plain `npm ci`
were not attempted. Plain `npm ci` remains a required host gate, not a pass; destroying
the available installed tree with registry access unavailable would not establish it.
There is no fresh audit count or audit exit status. The npm errors above are not audit
vulnerability counts.

Baseline saved audit (October 9, original audit exit codes unavailable): frontend
31 packages = 1 low / 12 moderate / 17 high / 1 critical; backend 19 packages =
1 low / 6 moderate / 11 high / 1 critical. Retain genuine nonzero audits after host
remediation; never suppress, relabel or convert nonzero to success. The matrix below
rechecks all 187 advisory occurrences, 135 unique IDs, and 50 component/package
findings against this candidate using **npm semver 7.7.4**, not the historical custom
numeric checker. All 187 occurrences still match at least one locked node. Nothing
here claims these 187 matches are 187 independently exploitable vulnerabilities.

## Provenance and candidate-specific graph

Consumed `HANDOFF-20261010.md` and actual
`/Users/zordon/hermes-artifacts/revv-all-issues-20261003/dependency-triage/completed-20261009/DISPOSITION.json`.
Disposition JSON SHA256: `8986c291bf6e33fcf1fad70d4c3061c27047fed7d030dc13f3c786a7a97b62b4`.
Backend lock SHA256: `0627de875945eb95a1a758c7a56e32b7419b8ce23ffb96cd4a17af04fd6032c6`.
Candidate frontend lock SHA256: `7c5430218507b7e9462ab2d1888ab8a1db814cf8c229246ec57767b2dea91f73`.
Saved/main frontend hash is `24deb58a6fbbd68272122350ad3ff6b50c3110e341ef593e67062e11f33341c6`.
The actual candidate moved esbuild 0.21.5 from `node_modules/esbuild` to
`node_modules/vite/node_modules/esbuild`; copying the saved path would be wrong.
Backend lock and both manifests match supplied main. The matrix inventories the
current locks and actual installed package manifests, including nested nodes.

`npm ls vite esbuild --all` in frontend exits 0: plugin-react 4.7.0 uses root
Vite 5.4.21 with its nested esbuild 0.21.5; Vitest 4.1.2 uses nested Vite 8.0.3.
No top-level esbuild is locked; the nested Vite's optional esbuild peer is absent.
Do not restore the obsolete main topology. If root Vite moves to proposed 6.4.3,
let npm resolve its actual esbuild dependency separately from Vitest's Vite and
optional peers; require a valid tree and plain `npm ci` without force or legacy peers.
Installed plugin-react 4.7.0 declares Vite `^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0`:
6.4.3 fits; 8.x does not fit this plugin as a root replacement. Backend Vite is
already 8.1.3; do not downgrade it to the historical 8.0.16 proposal.

## Bounded validation receipts

Node v22.23.2, sanitized environment (`env -i`), no credentials. Test bodies use
synthetic addresses/tokens only. The application bootstrap is never imported.

| Command / cwd | Exit | Evidence |
| --- | --- | --- |
| `env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 node --test backend/test/dependencySecurity.integration.test.js backend/src/__tests__/email.production.test.js` / source | 1 | 13 tests, 8 pass, 5 fail, 0 skipped/cancelled. All 5 failures are `listen EPERM: operation not permitted 127.0.0.1`; no bypass or fake skips. |
| `env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 npm run test:run -- src/lib/__tests__/dependencySecurity.test.js` / frontend | 0 | 1 file, 5 tests passed. |
| `env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin CI=1 npm run build` / frontend | 0 | Vite 5.4.21, 1871 modules, built in 3.38s; existing browser-data age and large-chunk warnings. |
| Instrumented Vite/Rollup build below / frontend | 0 | 1871 resolved modules, 377 emitted modules; Firestore browser entry included, inspected Node transports absent. |
| `env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin npm ls vite esbuild --all` / frontend | 0 | Current separate Vite/esbuild topology described above. |

Backend test coverage: actual proxy-addr trusted/untrusted/mapped IPv6 selection;
IPv6 subnet rate-limit key grouping; bounded real HTTP Express forwarding,
spoofed leftmost XFF rate-limit buckets, JSON 400/413, form parameter limits,
raw webhook byte preservation; actual offline Nodemailer stream serialization,
subject newline sanitization and address parsing; real email service through actual
JSON transport with no recipient/body logging; actual Twilio signature helpers with
tampered-body/URL rejection; npm-semver immediate-parent compatibility checks.
The five HTTP cases must execute on host. No deployed proxy topology is inferred
from fixture success. Stream/JSON transports are not SMTP/TLS verification.

Frontend tests use actual Axios transforms, XHR adapter, error handling and the real
`src/lib/api.js` interceptors. Only XHR/fetch network boundaries are replaced; they
test bearer auth, token removal, 401 login selection, 503/network errors, FormData
identity and browser-owned multipart boundary. The actual Privacy page's internal
Router link is clicked with a synthetic external `next` query. This proves that
page's behavior, not all Router navigation sinks or all advisories.

Tested installed versions: Express 4.22.1, proxy-addr 2.0.7, body-parser 1.20.4,
qs 6.14.2, express-rate-limit 8.3.1, ip-address 10.1.0, Twilio 5.12.2,
Nodemailer 8.0.4, Axios 1.13.5, React Router/DOM 6.30.3, frontend Vitest 4.1.2,
root Vite 5.4.21, nested Vite 8.0.3, Firebase 12.12.1 / Firestore 4.14.0.
**Nodemailer 10 migration is not approved by this evidence:** it was not installed
or tested. Host must verify Node22 CommonJS and rerun actual offline transports,
recipient parsing and privacy tests on the proposed 10.0.6 before accepting it.

## Exposure evidence and remaining gates

**HTTP runtime (H).** `backend/src/app.js:20` sets numeric `trust proxy = 1`, not
an IPv4-mapped short-prefix subnet; the critical proxy-addr advisory's subnet
precondition is absent from this source setting. Trusting one hop still requires
the host to verify actual proxy ingress and spoof stripping. Update compatible
proxy-addr 2.0.8 first when registry works; do not change trust policy here.
`app.js:43-45` installs raw webhook parsers before JSON with a 1mb limit.
Express 4.22.1 accepts body-parser 1.20.6 (`~1.20.3`), but Express and installed
body-parser each constrain qs to `~6.14.0`, which rejects 6.16.0. Twilio's `^6.14.1`
accepts it. Inspect a same-major Express/parser release whose actual manifest admits
the qs fix; do not override incompatible pins. express-rate-limit 8.3.1 pins
ip-address **10.1.0 exactly**, so proposed 10.7.1 needs a compatible parent release.
HTTP high findings remain blocked pending these updates and host HTTP/full tests.

**Backend outbound libraries (O).** `backend/src/services/sms.js` and
`backend/src/routes/sms.js` use Twilio; its Axios 1.13.5 is real backend HTTP code,
not browser-excluded. Twilio 5.12.2's `^1.12.0` admits proposed Axios 1.20.0;
installed Axios admits form-data 4.0.6 and follow-redirects 1.15.12. Their high
findings remain blocked pending verified targeted updates. Provider calls are
forbidden for these gates; use existing synthetic signature/consent suites.

**Email (E).** `backend/src/services/email.js:12-20` constructs SMTP transport
from server-owned host/port/user/pass with no `name`, OAuth2, arbitrary TLS
servername, or caller-supplied transport options. `:37-42` supplies only from/to/
subject/html, not List-* options, attachment paths or plugin content resolution.
Those particular advisory prerequisites are absent in this service's API.
Recipient address parsing is still exercised for caller-supplied recipients;
parser exhaustion/normalization risks are not cleared by that scope limitation.
The 8.0.4 runtime remains blocked for migration verification. Never infer TLS/DNS
credential-isolation fixes from stream transport tests or use real SMTP to test them.

**Browser graph (B).** Source imports are `frontend/src/lib/firebase.js` (app and
Firestore), `src/components/LeadCaptureForm.jsx` and `src/pages/LeadsDashboard.jsx`
(Firestore APIs). A real production Rollup traversal, not name matching in minified
output, includes `@firebase/firestore/dist/index.esm.js` and
`@firebase/firestore/dist/common-fe7037b3.esm.js`, app/component/logger/util and
webchannel browser modules. It excludes @grpc/grpc-js, @protobufjs/*, protobufjs,
faye-websocket, websocket-driver, undici and ws. Thus the Node gRPC/server WebSocket
advisory paths are outside this candidate browser module graph, conditional on this
entry/config staying unchanged and no SSR/Node execution of frontend dependencies.
Re-run this graph assertion after any lock change on host. This does not clear
installed Node use outside this frontend build. Firestore pins gRPC `~1.9.0`, which
rejects 1.13.6; no incompatible override. websocket-driver 0.7.5 fits faye-websocket's
`>=0.5.1` and is still the next bounded update after proxy-addr.

**Browser Axios/Sentry (A).** `frontend/src/lib/api.js` uses Axios with `/api`, bearer
request interceptor and 401 rejection/redirect. Rollup resolves the browser platform
and XHR/fetch adapters; the Node HTTP adapter is absent. Browser-applicable Axios
advisories still require proposed 1.20.0; a passing happy-path test does not clear them.
`frontend/src/main.jsx` calls `src/lib/sentry.js`; the SDK is in the browser graph.
GHSA-593m-55hh-j8gv needs another prototype pollution vulnerability but is not
dismissed just because none was demonstrated. Align @sentry/react, @sentry/browser,
and backend @sentry/node on a verified v7 7.119.1+ resolution. Keep backend
`src/lib/sentry.js` v7 Handlers and disabled fetch/undici instrumentation intact.
Backend @sentry/node is an alignment action outside the historical 50-package
finding count, not a newly invented audit finding.

**Router (R).** `frontend/src/App.jsx:136` uses declarative BrowserRouter and
`src/main.jsx` uses createRoot, not SSR hydration. The SSR deserializeErrors and
data-router redirect prerequisites do not apply to that entry. Public Privacy and
Landing links are source-owned literals; the added test confirms Privacy navigation.
This is not blanket clearance: `src/components/Layout.jsx:118-123` passes a stored
`revv_prev_path` to navigate, and other pages interpolate record IDs into paths.
Backslash/open-redirect findings remain blocked until a patched 6.x backport is
verified against **every** range, or every relevant sink is independently scoped.
The triage's 7.18.0 proposal is not authorization to migrate. @remix-run/router 1.23.3
does not fit the installed React Router/DOM exact `1.23.2` pins. Registry failure
prevents confirming a patched 6.x release; no claim that a backport does/doesn't exist.

**Trusted build/watch inputs (T).** `frontend/tailwind.config.js:4` restricts content
to `./index.html` and `./src/**/*.{js,jsx}`; it has no plugins. `postcss.config.js`
uses Tailwind/autoprefixer; `vite.config.js` uses the checked-in React plugin.
The braces → chokidar/micromatch → fast-glob/Tailwind chains process these
repository-owned patterns/files, not customer upload paths. Braces 3.0.3's recursive
pattern-walker condition requires attacker-controlled nested patterns. No compatible
patch is established for this chain. Keep Tailwind 3; do not migrate to Tailwind 4
as an audit shortcut. Conditions for the scope disposition: reviewed source/config,
no untrusted repository contributions in credential-bearing builds, no runtime CSS/
glob processing of tenant input, no exposed build/watch server. Host must verify
these operational conditions; this is an explicit conditional disposition, not an
unconditional pass based on the dev flag. The resolved/emitted browser counts below
provide additional evidence that the tool chain itself isn't shipped as app code.

Backend `package.json` starts `node src/app.js`; only `dev` starts nodemon.
`railway.toml:6` also starts Node, not nodemon. Installed
`backend/node_modules/nodemon/lib/config/defaults.js` uses `watch: ['*.*']` and
repository/tool-owned ignore patterns; chokidar calls braces on watch glob patterns
(`node_modules/chokidar/index.js:258`). HTTP file contents do not become watch globs
in these commands. Backend braces/chokidar/nodemon receive the same conditional
trusted-pattern disposition; no nodemon downgrade. Host must confirm no extra
operator-supplied untrusted watch/config input and the deployed command. Do not
execute the startup/seed command as part of this task.

Other Babel/PostCSS/source-map/picomatch/nanoid/browserslist findings are build/test
input risks tied to these checked-in inputs; same-major compatible patches should
still be applied once verified. postcss-selector-parser 7.1.6 is **not** compatible
with Tailwind/postcss-nested's ^6.1.x pins; a 6.1.3 backport only addresses its earlier
recursion range, not the supplied `<7.1.6` quadratic-selector range. Keep the latter
conditional trusted-CSS disposition rather than pretending that 6.1.3 fixes both.

**Test/dev servers (D).** Backend/frontend `package.json` use `vitest run`; no
public mockerPlugin/interceptorPlugin registration is configured in
`frontend/vite.config.js`. Vitest's own RPC and the advisory's unauthenticated
public plugin endpoint differ. Vite is used for static builds in `railway.toml:3`;
the app is served by Express (`backend/src/app.js`), not Vite/esbuild serve.
Local Vite/preview/test server exposure still requires host verification and patches.
Update Vitest and its exact-pinned @vitest/mocker together to verified 4.1.11+;
do not update only the child. ws is under happy-dom, undici under jsdom: this is
specific test-consumer evidence and the browser graph excludes them, not merely
a package-name or dev-flag assertion. Do not run untrusted pages or external URL
fixtures in these DOM test runtimes. Apply same-major ws/undici fixes when available.

**UUID (U).** `backend/src/routes/auth.js:6,55` and the other UUID imports found
under `backend/src` use `v4`, including the direct `require('uuid').v4()` in
`routes/portal.js:248`; no v3/v5/v6 call was found. UUID 9.0.1 remains in the
affected package range, but GHSA-w5hq-g745-h8pq specifically concerns v3/v5/v6
caller-provided output-buffer bounds. These v4() string-returning call sites do not
satisfy that condition. No unrelated UUID major. Re-check if UUID APIs or buffer
arguments change; host full auth/ID tests remain required.

## Host completion gate

1. Verify registry versions, engines, peers and new parent manifests. Start with
   compatible proxy-addr 2.0.8 and websocket-driver 0.7.5. Pin/update only the named
   remediation closures and inspect the resulting diff for unrelated churn.
2. Resolve HTTP/qs/ip-address parent constraints; align v7 Sentry; test any explicit
   Nodemailer 10 candidate before approval; verify Router 6.x backports before
   considering any other scoped decision. Do not apply arbitrary latest versions.
3. Run plain `npm ci` in both roots on Node22, inspect `npm ls`, then rerun focused
   tests and the instrumented browser graph against the installed candidate.
4. Run all backend Node suites with disposable PostgreSQL, parser 7 tests, all
   frontend tests/build and relevant browser QA. Check actual proxy topology and
   trusted build-input/watch/server conditions. Preserve all A–F safeguards.
5. Reconcile all 187 ranges again; retain all remaining unpatched ranges and true
   nonzero audit counts. Unresolved high/runtime findings above prevent security
   acceptance. Hermes records host receipts and routes the resulting exact SHA.

The three changed files exceed the two-file review threshold. These tests cover
security-sensitive proxy, recipient/privacy and auth boundaries, but no application
code or production state changed. Full-host and independent review gates remain.

## Per-package candidate reconciliation

Paths below are relative to the component directory. Each proposal's parent fit is
evaluated independently against every immediate dependency/optional dependency and
root manifest declaration, using Node-style ancestor resolution through the actual
lock. Transitive packages' own development dependencies are not runtime edges.
Peer gates are separate (notably the Vite/plugin decision above). Every affected
range is retained verbatim; `MATCH` means unpatched in this candidate, not proven
exploitable. Meta findings inherit the named descendant advisories. No range is
removed merely because the corresponding browser module is excluded.

### 1. frontend — @babel/core (low)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `7.29.6`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/@babel/core` | `7.29.0` / `7.29.0` | `7.29.6` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/@vitejs/plugin-react` (dependencies) → `node_modules/@babel/core` | `^7.28.0` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) (low): @babel/core: Arbitrary File Read via sourceMappingURL Comment | `<=7.29.0` | MATCH: `node_modules/@babel/core@7.29.0` |

### 2. frontend — @grpc/grpc-js (high)

**Disposition:** CONDITIONAL browser exclusion; upgrade compatible children when registry works; repeat graph on host. Evidence section: **B**. No dependency update applied.

Triage proposal (not registry-verified): `1.13.6`. Remaining regression scope: Firebase lead flows and browser bundle exclusion of Node transport; patched transport resolution. 1.9.16 alone does NOT cover all advisories; 1.13.6 conflicts with ~1.9.0 parent range: compatible Firebase parent upgrade unresolved.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/@grpc/grpc-js` | `1.9.15` / `1.9.15` | `1.13.6` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/@firebase/firestore` (dependencies) → `node_modules/@grpc/grpc-js` | `~1.9.0` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-5375-pq7m-f5r2](https://github.com/advisories/GHSA-5375-pq7m-f5r2) (high): @grpc/grpc-js: A malformed request can cause a server crash | `<1.9.16` | MATCH: `node_modules/@grpc/grpc-js@1.9.15` |
| [GHSA-99f4-grh7-6pcq](https://github.com/advisories/GHSA-99f4-grh7-6pcq) (high): @grpc/grpc-js: An incoming malformed compressed message can cause a client or server crash | `<1.9.16` | MATCH: `node_modules/@grpc/grpc-js@1.9.15` |
| [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j) (high): @grpc/grpc-js: In certain configurations, getAuthContext can return unauthorized certificates as though they were authorized | `<1.13.6` | MATCH: `node_modules/@grpc/grpc-js@1.9.15` |
| [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) (low): @grpc/grpc-js: The server transmits some error messages thrown by method handlers to the client in status messages | `<1.13.6` | MATCH: `node_modules/@grpc/grpc-js@1.9.15` |

### 3. frontend — @protobufjs/utf8 (moderate)

**Disposition:** CONDITIONAL browser exclusion; upgrade compatible children when registry works; repeat graph on host. Evidence section: **B**. No dependency update applied.

Triage proposal (not registry-verified): `1.1.1`. Remaining regression scope: Firestore Unicode roundtrips and validate decoded strings.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/@protobufjs/utf8` | `1.1.0` / `1.1.0` | `1.1.1` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/protobufjs` (dependencies) → `node_modules/@protobufjs/utf8` | `^1.1.0` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-q6x5-8v7m-xcrf](https://github.com/advisories/GHSA-q6x5-8v7m-xcrf) (moderate): protobufjs has overlong UTF-8 decoding | `<=1.1.0` | MATCH: `node_modules/@protobufjs/utf8@1.1.0` |

### 4. frontend — @remix-run/router (moderate)

**Disposition:** BLOCKED open-navigation/backport decision; SSR/data-router conditions scoped above. Evidence section: **R**. No dependency update applied.

Triage proposal (not registry-verified): `1.23.3`. Remaining regression scope: Navigation/editor dirty-state/public portal links; do not convert router mode just to clear audit.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/@remix-run/router` | `1.23.2` / `1.23.2` | `1.23.3` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/react-router` (dependencies) → `node_modules/@remix-run/router` | `1.23.2` | **No — change compatible parent / explicit root decision first** |
| `node_modules/react-router-dom` (dependencies) → `node_modules/@remix-run/router` | `1.23.2` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-2j2x-hqr9-3h42](https://github.com/advisories/GHSA-2j2x-hqr9-3h42) (moderate): React Router's same-origin redirect with path starting // causes open redirect via protocol-relative URL reinterpretation | `>=1.3.0 <1.23.3` | MATCH: `node_modules/@remix-run/router@1.23.2` |

### 5. frontend — @sentry/browser (moderate)

**Disposition:** BLOCKED runtime patch verification. Evidence section: **A**. No dependency update applied.

Triage proposal (not registry-verified): `7.119.1`. Remaining regression scope: Redaction/error capture and disabled-network mock telemetry; no private data sends.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/@sentry/browser` | `7.105.0` / `7.105.0` | `7.119.1` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/@sentry/react` (dependencies) → `node_modules/@sentry/browser` | `7.105.0` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-593m-55hh-j8gv](https://github.com/advisories/GHSA-593m-55hh-j8gv) (moderate): Sentry SDK Prototype Pollution gadget in JavaScript SDKs | `<7.119.1` | MATCH: `node_modules/@sentry/browser@7.105.0` |

### 6. frontend — @sentry/react (moderate)

**Disposition:** BLOCKED runtime patch verification. Evidence section: **A**. No dependency update applied.

Triage proposal (not registry-verified): `7.119.1`. Remaining regression scope: React error boundary/error redaction with matching v7 SDK packages.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/@sentry/react` | `7.105.0` / `7.105.0` | `7.119.1` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (dependencies) → `node_modules/@sentry/react` | `7.105.0` | **No — change compatible parent / explicit root decision first** |

No direct advisory occurrence in the supplied JSON; this is a meta-vulnerability finding.

Inherited through `@sentry/browser`: `GHSA-593m-55hh-j8gv`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 7. frontend — @vitest/mocker (moderate)

**Disposition:** CONDITIONAL build/test execution only under the specified commands; patch and host server-exposure gate pending. Evidence section: **D**. No dependency update applied.

Triage proposal (not registry-verified): `4.1.11`. Remaining regression scope: Upgrade with matching Vitest4.1.11; run all mocking tests.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/vitest/node_modules/@vitest/mocker` | `4.1.2` / `4.1.2` | `4.1.11` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/vitest` (dependencies) → `node_modules/vitest/node_modules/@vitest/mocker` | `4.1.2` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) (moderate): Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock | `>=2.1.0 <4.1.11` | MATCH: `node_modules/vitest/node_modules/@vitest/mocker@4.1.2` |

### 8. frontend — axios (high)

**Disposition:** BLOCKED runtime patch verification. Evidence section: **A**. No dependency update applied.

Triage proposal (not registry-verified): `1.20.0`. Remaining regression scope: API auth/401/403/error handling, multipart uploads, timeout/cancel, mock Twilio SMS success/failure and signature/STOP/consent; no real sends.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/axios` | `1.13.5` / `1.13.5` | `1.20.0` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (dependencies) → `node_modules/axios` | `^1.6.7` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-3p68-rc4w-qgx5](https://github.com/advisories/GHSA-3p68-rc4w-qgx5) (moderate): Axios has a NO_PROXY Hostname Normalization Bypass that Leads to SSRF | `>=1.0.0 <1.15.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-w9j2-pvgh-6h63](https://github.com/advisories/GHSA-w9j2-pvgh-6h63) (moderate): Axios: Authentication Bypass via Prototype Pollution Gadget in `validateStatus` Merge Strategy | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-pmwg-cvhr-8vh7](https://github.com/advisories/GHSA-pmwg-cvhr-8vh7) (high): Axios: Incomplete Fix for CVE-2025-62718 — NO_PROXY Protection Bypassed via RFC 1122 Loopback Subnet (127.0.0.0/8) in Axios 1.15.0 | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-3w6x-2g7m-8v23](https://github.com/advisories/GHSA-3w6x-2g7m-8v23) (moderate): Axios: Invisible JSON Response Tampering via Prototype Pollution Gadget in `parseReviver` | `>=1.0.0 <1.15.2` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-xhjh-pmcv-23jw](https://github.com/advisories/GHSA-xhjh-pmcv-23jw) (low): Axios: Null Byte Injection via Reverse-Encoding in AxiosURLSearchParams | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-445q-vr5w-6q77](https://github.com/advisories/GHSA-445q-vr5w-6q77) (moderate): Axios: CRLF Injection in multipart/form-data body via unsanitized blob.type in formDataToStream | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-m7pr-hjqh-92cm](https://github.com/advisories/GHSA-m7pr-hjqh-92cm) (moderate): Axios: no_proxy bypass via IP alias allows SSRF | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-5c9x-8gcm-mpgx](https://github.com/advisories/GHSA-5c9x-8gcm-mpgx) (moderate): Axios' HTTP adapter-streamed uploads bypass maxBodyLength when maxRedirects: 0 | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-vf2m-468p-8v99](https://github.com/advisories/GHSA-vf2m-468p-8v99) (moderate): Axios: HTTP adapter streamed responses bypass maxContentLength | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-pf86-5x62-jrwf](https://github.com/advisories/GHSA-pf86-5x62-jrwf) (high): Axios: Prototype Pollution Gadgets - Response Tampering, Data Exfiltration, and Request Hijacking | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-6chq-wfr3-2hj9](https://github.com/advisories/GHSA-6chq-wfr3-2hj9) (high): Axios: Header Injection via Prototype Pollution | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-xx6v-rp6x-q39c](https://github.com/advisories/GHSA-xx6v-rp6x-q39c) (moderate): Axios: XSRF Token Cross-Origin Leakage via Prototype Pollution Gadget in `withXSRFToken` Boolean Coercion | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-q8qp-cvcw-x6jj](https://github.com/advisories/GHSA-q8qp-cvcw-x6jj) (high): Axios has prototype pollution read-side gadgets in HTTP adapter that allow credential injection and request hijacking | `>=1.0.0 <1.15.2` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-fvcv-3m26-pcqx](https://github.com/advisories/GHSA-fvcv-3m26-pcqx) (moderate): Axios has Unrestricted Cloud Metadata Exfiltration via Header Injection Chain | `>=1.0.0 <1.15.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-62hf-57xw-28j9](https://github.com/advisories/GHSA-62hf-57xw-28j9) (moderate): Axios: unbounded recursion in toFormData causes DoS via deeply nested request data | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-hfxv-24rg-xrqf](https://github.com/advisories/GHSA-hfxv-24rg-xrqf) (high): Axios: Regular Expression Denial of Service (ReDoS) via Cookie Name Injection | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-777c-7fjr-54vf](https://github.com/advisories/GHSA-777c-7fjr-54vf) (high): Allocation of Resources Without Limits or Throttling in Axios | `>=1.7.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-p92q-9vqr-4j8v](https://github.com/advisories/GHSA-p92q-9vqr-4j8v) (high): Axios: Proxy-Authorization Credential Leak to Origin Server Across HTTP-to-HTTPS Redirect in Axios Node.js HTTP Adapter | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-j5f8-grm9-p9fc](https://github.com/advisories/GHSA-j5f8-grm9-p9fc) (high): Axios: Proxy-Authorization header leaks to redirect target when proxy is re-evaluated to direct connection | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-3g43-6gmg-66jw](https://github.com/advisories/GHSA-3g43-6gmg-66jw) (high): axios Vulnerable to Credential Theft and Response Hijacking via Prototype Pollution Gadget in Config Merge | `>=1.0.0 <1.15.2` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-35jp-ww65-95wh](https://github.com/advisories/GHSA-35jp-ww65-95wh) (high): axios Vulnerable to Full Man-in-the-Middle via Prototype Pollution Gadget in `config.proxy` | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-898c-q2cr-xwhg](https://github.com/advisories/GHSA-898c-q2cr-xwhg) (moderate): axios has DoS & Header Injection via Prototype Pollution Read-Side Gadgets in axios merge functions | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-mmx7-hfxf-jppx](https://github.com/advisories/GHSA-mmx7-hfxf-jppx) (moderate): Axios: Prototype pollution gadgets can alter axios request construction | `>=1.0.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-pmv8-rq9r-6j72](https://github.com/advisories/GHSA-pmv8-rq9r-6j72) (moderate): Axios: Deep formToJSON Key Recursion Can Cause Denial of Service | `>=1.0.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-mwf2-3pr3-8698](https://github.com/advisories/GHSA-mwf2-3pr3-8698) (moderate): Axios: HTTP/2 streamed uploads bypass `maxBodyLength` | `>=1.13.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-7q8q-rj6j-mhjq](https://github.com/advisories/GHSA-7q8q-rj6j-mhjq) (moderate): Axios: Nested axios option objects can consume polluted prototype values | `>=1.0.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-jqh4-m9w3-8hp9](https://github.com/advisories/GHSA-jqh4-m9w3-8hp9) (moderate): Axios: Fetch adapter `ReadableStream` uploads bypass `maxBodyLength` | `>=1.7.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-42h9-826w-cgv3](https://github.com/advisories/GHSA-42h9-826w-cgv3) (moderate): Axios: Excessive recursion in formDataToJSON can cause denial of service | `>=1.0.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-vh66-26gq-q6x8](https://github.com/advisories/GHSA-vh66-26gq-q6x8) (moderate): Axios: Prototype pollution gadget in fetch adapter can alter outbound requests | `>=1.7.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-9fr6-4gfg-395g](https://github.com/advisories/GHSA-9fr6-4gfg-395g) (moderate): Axios: Prototype-Pollution Gadget in the Default Instance Allows Inherited Object.prototype.method to Override HTTP Method | `>=1.0.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-3pq3-5fj3-cg6v](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v) (high): Axios: HTTP/2 adapter bypasses configured DNS lookup and proxy controls | `>=1.13.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-542g-h47m-68v8](https://github.com/advisories/GHSA-542g-h47m-68v8) (high): Axios: Denial of Service via Unhandled 'error' Event in HTTP/2 ClientHttp2Session Initialization | `>=1.13.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-j8rh-479h-cp32](https://github.com/advisories/GHSA-j8rh-479h-cp32) (moderate): Axios: Header Injection via Inherited headers After Minimal Interceptor | `>=1.0.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-4hqw-qxg8-jxx2](https://github.com/advisories/GHSA-4hqw-qxg8-jxx2) (moderate): Axios: Fetch Adapter Header Injection via Inherited FormData getHeaders | `>=1.12.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |

### 9. frontend — baseline-browser-mapping (moderate)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `2.11.0`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/baseline-browser-mapping` | `2.10.0` / `2.10.0` | `2.11.0` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/browserslist` (dependencies) → `node_modules/baseline-browser-mapping` | `^2.9.0` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) (moderate): baseline-browser-mapping process termination on invalid input causes denial of service | `>=2.0.0 <2.11.0` | MATCH: `node_modules/baseline-browser-mapping@2.10.0` |

### 10. frontend — braces (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Keep glob inputs trusted and bounded; separate parent migration compatibility assessment; Tailwind visual/build and nodemon watcher checks.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/braces` | `3.0.3` / `3.0.3` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/chokidar` (dependencies) → `node_modules/braces` | `~3.0.2` | No target established |
| `node_modules/micromatch` (dependencies) → `node_modules/braces` | `^3.0.3` | No target established |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (high): braces vulnerable to stack-exhaustion denial of service through deeply nested patterns | `<=3.0.3` | MATCH: `node_modules/braces@3.0.3` |

### 11. frontend — browserslist (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `4.28.7`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/browserslist` | `4.28.1` / `4.28.1` | `4.28.7` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/@babel/helper-compilation-targets` (dependencies) → `node_modules/browserslist` | `^4.24.0` | Yes (range only) |
| `node_modules/autoprefixer` (dependencies) → `node_modules/browserslist` | `^4.28.1` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) (high): Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM | `<=4.28.6` | MATCH: `node_modules/browserslist@4.28.1` |
| [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) (high): Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) | `<=4.28.6` | MATCH: `node_modules/browserslist@4.28.1` |

### 12. frontend — chokidar (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/chokidar` | `3.6.0` / `3.6.0` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/tailwindcss` (dependencies) → `node_modules/chokidar` | `^3.6.0` | No target established |

No direct advisory occurrence in the supplied JSON; this is a meta-vulnerability finding.

Inherited through `braces`: `GHSA-vfj7-8cjw-p6xm`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 13. frontend — esbuild (moderate)

**Disposition:** CONDITIONAL build/test execution only under the specified commands; patch and host server-exposure gate pending. Evidence section: **D**. No dependency update applied.

Triage proposal (not registry-verified): `0.25.0`. Remaining regression scope: Build output/import semantics and fresh npm ci; 0.21 to0.25 minor is potentially breaking and parent Vite range must change.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/vite/node_modules/esbuild` | `0.21.5` / `0.21.5` | `0.25.0` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/vite` (dependencies) → `node_modules/vite/node_modules/esbuild` | `^0.21.3` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) (moderate): esbuild enables any website to send any requests to the development server and read the response | `<=0.24.2` | MATCH: `node_modules/vite/node_modules/esbuild@0.21.5` |

### 14. frontend — fast-glob (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/fast-glob` | `3.3.3` / `3.3.3` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/tailwindcss` (dependencies) → `node_modules/fast-glob` | `^3.3.2` | No target established |

No direct advisory occurrence in the supplied JSON; this is a meta-vulnerability finding.

Inherited through `micromatch`: `GHSA-vfj7-8cjw-p6xm`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 15. frontend — follow-redirects (moderate)

**Disposition:** CONDITIONAL Node adapter exclusion; compatible patch still pending. Evidence section: **A/B**. No dependency update applied.

Triage proposal (not registry-verified): `1.15.12`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/follow-redirects` | `1.15.11` / `1.15.11` | `1.15.12` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/axios` (dependencies) → `node_modules/follow-redirects` | `^1.15.11` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-r4q5-vmmm-2653](https://github.com/advisories/GHSA-r4q5-vmmm-2653) (moderate): follow-redirects leaks Custom Authentication Headers to Cross-Domain Redirect Targets | `<=1.15.11` | MATCH: `node_modules/follow-redirects@1.15.11` |

### 16. frontend — form-data (high)

**Disposition:** CONDITIONAL Node adapter exclusion; compatible patch still pending. Evidence section: **A/B**. No dependency update applied.

Triage proposal (not registry-verified): `4.0.6`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/form-data` | `4.0.5` / `4.0.5` | `4.0.6` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/axios` (dependencies) → `node_modules/form-data` | `^4.0.5` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) (high): form-data: CRLF injection in form-data via unescaped multipart field names and filenames | `>=4.0.0 <4.0.6` | MATCH: `node_modules/form-data@4.0.5` |

### 17. frontend — micromatch (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/micromatch` | `4.0.8` / `4.0.8` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/fast-glob` (dependencies) → `node_modules/micromatch` | `^4.0.8` | No target established |
| `node_modules/tailwindcss` (dependencies) → `node_modules/micromatch` | `^4.0.8` | No target established |

No direct advisory occurrence in the supplied JSON; this is a meta-vulnerability finding.

Inherited through `braces`: `GHSA-vfj7-8cjw-p6xm`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 18. frontend — nanoid (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `3.3.18`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/nanoid` | `3.3.11` / `3.3.11` | `3.3.18` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/postcss` (dependencies) → `node_modules/nanoid` | `^3.3.11` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) (high): nanoid: non-secure generators can loop indefinitely with negative size | `<3.3.16` | MATCH: `node_modules/nanoid@3.3.11` |
| [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) (high): nanoid: custom generators can loop indefinitely when size is zero | `<3.3.18` | MATCH: `node_modules/nanoid@3.3.11` |
| [GHSA-xwg4-73v4-xw9w](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) (high): nanoid: Integer Overflow or Wraparound | `<3.3.12` | MATCH: `node_modules/nanoid@3.3.11` |

### 19. frontend — picomatch (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `2.3.2 / 4.0.4 according to installed major`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/picomatch` | `2.3.1` / `2.3.1` | `2.3.2` |
| `node_modules/tinyglobby/node_modules/picomatch` | `4.0.3` / `4.0.3` | `4.0.4` |
| `node_modules/vitest/node_modules/picomatch` | `4.0.4` / `4.0.4` | `4.0.4` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/anymatch` (dependencies) → `node_modules/picomatch` | `^2.0.4` | Yes (range only) |
| `node_modules/micromatch` (dependencies) → `node_modules/picomatch` | `^2.3.1` | Yes (range only) |
| `node_modules/readdirp` (dependencies) → `node_modules/picomatch` | `^2.2.1` | Yes (range only) |
| `node_modules/tinyglobby` (dependencies) → `node_modules/tinyglobby/node_modules/picomatch` | `^4.0.3` | Yes (range only) |
| `node_modules/vitest` (dependencies) → `node_modules/vitest/node_modules/picomatch` | `^4.0.3` | Yes (range only) |
| `node_modules/vitest/node_modules/vite` (dependencies) → `node_modules/vitest/node_modules/picomatch` | `^4.0.4` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) (moderate): Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching | `<2.3.2` | MATCH: `node_modules/picomatch@2.3.1` |
| [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) (moderate): Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching | `>=4.0.0 <4.0.4` | MATCH: `node_modules/tinyglobby/node_modules/picomatch@4.0.3` |
| [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) (high): Picomatch has a ReDoS vulnerability via extglob quantifiers | `<2.3.2` | MATCH: `node_modules/picomatch@2.3.1` |
| [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) (high): Picomatch has a ReDoS vulnerability via extglob quantifiers | `>=4.0.0 <4.0.4` | MATCH: `node_modules/tinyglobby/node_modules/picomatch@4.0.3` |

### 20. frontend — postcss (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `8.5.23`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/postcss` | `8.5.8` / `8.5.8` | `8.5.23` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (devDependencies) → `node_modules/postcss` | `^8.4.35` | Yes (range only) |
| `node_modules/tailwindcss` (dependencies) → `node_modules/postcss` | `^8.4.47` | Yes (range only) |
| `node_modules/vite` (dependencies) → `node_modules/postcss` | `^8.4.43` | Yes (range only) |
| `node_modules/vitest/node_modules/vite` (dependencies) → `node_modules/postcss` | `^8.5.8` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) (moderate): PostCSS has XSS via Unescaped </style> in its CSS Stringify Output | `<8.5.10` | MATCH: `node_modules/postcss@8.5.8` |
| [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) (high): PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments | `<=8.5.11` | MATCH: `node_modules/postcss@8.5.8` |
| [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) (moderate): PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset | `<=8.5.22` | MATCH: `node_modules/postcss@8.5.8` |
| [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) (high): PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure | `<=8.5.17` | MATCH: `node_modules/postcss@8.5.8` |

### 21. frontend — postcss-selector-parser (moderate)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `7.1.6`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/postcss-selector-parser` | `6.1.2` / `6.1.2` | `7.1.6` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/postcss-nested` (dependencies) → `node_modules/postcss-selector-parser` | `^6.1.1` | **No — change compatible parent / explicit root decision first** |
| `node_modules/tailwindcss` (dependencies) → `node_modules/postcss-selector-parser` | `^6.1.2` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92) (low): postcss-selector-parser allows denial of service through uncontrolled AST recursion | `>=6.1.0 <6.1.3` | MATCH: `node_modules/postcss-selector-parser@6.1.2` |
| [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) (moderate): PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion | `<7.1.6` | MATCH: `node_modules/postcss-selector-parser@6.1.2` |

### 22. frontend — protobufjs (high)

**Disposition:** CONDITIONAL browser exclusion; upgrade compatible children when registry works; repeat graph on host. Evidence section: **B**. No dependency update applied.

Triage proposal (not registry-verified): `7.6.5`. Remaining regression scope: Firestore schema/serialization and lead UI with bounded malformed synthetic data; verify descriptor trust and output bundle.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/protobufjs` | `7.5.5` / `7.5.5` | `7.6.5` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/@grpc/proto-loader` (dependencies) → `node_modules/protobufjs` | `^7.2.5` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-66ff-xgx4-vchm](https://github.com/advisories/GHSA-66ff-xgx4-vchm) (high): protobuf.js: Code injection through bytes field defaults in generated toObject code | `<=7.5.5` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-2pr8-phx7-x9h3](https://github.com/advisories/GHSA-2pr8-phx7-x9h3) (moderate): protobuf.js: Denial of service from crafted field names in generated code | `<=7.5.5` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-fx83-v9x8-x52w](https://github.com/advisories/GHSA-fx83-v9x8-x52w) (moderate): protobuf.js: Prototype injection in generated message constructors | `<=7.5.5` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-75px-5xx7-5xc7](https://github.com/advisories/GHSA-75px-5xx7-5xc7) (high): protobuf.js: Code generation gadget after prototype pollution | `<=7.5.5` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-jvwf-75h9-cwgg](https://github.com/advisories/GHSA-jvwf-75h9-cwgg) (high): protobuf.js: Process-wide denial of service through unsafe option paths | `<=7.5.5` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-685m-2w69-288q](https://github.com/advisories/GHSA-685m-2w69-288q) (high): protobuf.js: Denial of service through unbounded protobuf recursion | `<=7.5.5` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-q6x5-8v7m-xcrf](https://github.com/advisories/GHSA-q6x5-8v7m-xcrf) (moderate): protobufjs has overlong UTF-8 decoding | `<=7.5.5` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-jggg-4jg4-v7c6](https://github.com/advisories/GHSA-jggg-4jg4-v7c6) (moderate): protobufjs: Denial of Service via unbounded recursive JSON descriptor expansion | `<=7.5.7` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-wcpc-wj8m-hjx6](https://github.com/advisories/GHSA-wcpc-wj8m-hjx6) (high): protobufjs: Denial of service through unbounded Any expansion during JSON conversion | `<=7.6.0` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-f38q-mgvj-vph7](https://github.com/advisories/GHSA-f38q-mgvj-vph7) (moderate): protobufjs : Schema-derived names can shadow runtime-significant properties | `<=7.6.2` | MATCH: `node_modules/protobufjs@7.5.5` |
| [GHSA-j3f2-48v5-ccww](https://github.com/advisories/GHSA-j3f2-48v5-ccww) (moderate): protobufjs: Denial of Service via infinite loop in .proto option parsing | `>=7.5.0 <=7.6.4` | MATCH: `node_modules/protobufjs@7.5.5` |

### 23. frontend — react-router (moderate)

**Disposition:** BLOCKED open-navigation/backport decision; SSR/data-router conditions scoped above. Evidence section: **R**. No dependency update applied.

Triage proposal (not registry-verified): `7.18.0`. Remaining regression scope: Desktop/mobile public/staff links, back navigation, dirty editor guard; validate local destinations. v7 is a major, do not blindly migrate.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/react-router` | `6.30.3` / `6.30.3` | `7.18.0` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/react-router-dom` (dependencies) → `node_modules/react-router` | `6.30.3` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) (moderate): React Router: Open redirect via backslash in <Link> and useNavigate (CVE-2025-68470 bypass) | `>=6.0.0 <7.18.0` | MATCH: `node_modules/react-router@6.30.3` |
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) (moderate): React Router: Arbitrary Constructor Injection via deserializeErrors() in React Router SSR Hydration | `>=6.4.0 <7.18.0` | MATCH: `node_modules/react-router@6.30.3` |
| [GHSA-2j2x-hqr9-3h42](https://github.com/advisories/GHSA-2j2x-hqr9-3h42) (moderate): React Router's same-origin redirect with path starting // causes open redirect via protocol-relative URL reinterpretation | `>=6.7.0 <6.30.4` | MATCH: `node_modules/react-router@6.30.3` |

Inherited through `@remix-run/router`: `GHSA-2j2x-hqr9-3h42`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 24. frontend — react-router-dom (moderate)

**Disposition:** BLOCKED open-navigation/backport decision; SSR/data-router conditions scoped above. Evidence section: **R**. No dependency update applied.

Triage proposal (not registry-verified): `7.18.0`. Remaining regression scope: Public portal links, Link/useNavigate and browser back/dirty-editor regressions; confirm maintained v6 backport before v7 migration.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/react-router-dom` | `6.30.3` / `6.30.3` | `7.18.0` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (dependencies) → `node_modules/react-router-dom` | `^6.22.0` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2) (moderate): React Router: Open redirect leading to XSS | `>=6.30.2 <=6.30.5` | MATCH: `node_modules/react-router-dom@6.30.3` |

Inherited through `@remix-run/router`, `react-router`: `GHSA-2j2x-hqr9-3h42`, `GHSA-337j-9hxr-rhxg`, `GHSA-wrjc-x8rr-h8h6`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 25. frontend — source-map-js (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `1.2.2`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/source-map-js` | `1.2.1` / `1.2.1` | `1.2.2` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/css-tree` (dependencies) → `node_modules/source-map-js` | `^1.2.1` | Yes (range only) |
| `node_modules/postcss` (dependencies) → `node_modules/source-map-js` | `^1.2.1` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) (high): source-map-js allows event-loop denial of service through indexed source-map section offsets | `>=1.0.0 <1.2.2` | MATCH: `node_modules/source-map-js@1.2.1` |

### 26. frontend — tailwindcss (high)

**Disposition:** CONDITIONAL trusted build inputs; targeted compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/tailwindcss` | `3.4.19` / `3.4.19` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (devDependencies) → `node_modules/tailwindcss` | `^3.4.1` | No target established |

No direct advisory occurrence in the supplied JSON; this is a meta-vulnerability finding.

Inherited through `chokidar`, `fast-glob`, `micromatch`: `GHSA-vfj7-8cjw-p6xm`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 27. frontend — undici (high)

**Disposition:** CONDITIONAL build/test execution only under the specified commands; patch and host server-exposure gate pending. Evidence section: **D**. No dependency update applied.

Triage proposal (not registry-verified): `7.29.1`. Remaining regression scope: Test DOM/fetch/WebSocket behavior; verify final graph and no unexpected runtime bundle. Package update does not patch Node built-in fetch.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/undici` | `7.24.7` / `7.24.7` | `7.29.1` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/jsdom` (dependencies) → `node_modules/undici` | `^7.24.5` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-vmh5-mc38-953g](https://github.com/advisories/GHSA-vmh5-mc38-953g) (high): undici vulnerable to TLS certificate validation bypass via dropped requestTls in SOCKS5 ProxyAgent | `>=7.23.0 <7.28.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv) (moderate): undici vulnerable to HTTP header injection via Set-Cookie percent-decoding | `>=7.0.0 <7.28.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) (high): undici WebSocket client vulnerable to denial of service via fragment count bypass | `>=7.0.0 <7.28.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-hm92-r4w5-c3mj](https://github.com/advisories/GHSA-hm92-r4w5-c3mj) (high): undici vulnerable to cross-origin request routing via SOCKS5 proxy pool reuse | `>=7.23.0 <7.28.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-g8m3-5g58-fq7m](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) (low): undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching | `>=7.0.0 <7.28.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-pr7r-676h-xcf6](https://github.com/advisories/GHSA-pr7r-676h-xcf6) (moderate): undici vulnerable to cross-user information disclosure via shared cache whitespace bypass | `>=7.0.0 <7.28.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) (moderate): undici vulnerable to downstream response desynchronization via retry interceptor | `>=7.0.0 <7.29.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) (high): undici vulnerable to cross-user information disclosure and parse-time crash via degenerate private cache directives | `>=7.0.0 <7.29.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) (moderate): undici vulnerable to CRLF Injection via blob-like body 'type' property | `>=7.0.0 <7.29.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-jr45-8vmc-qm54](https://github.com/advisories/GHSA-jr45-8vmc-qm54) (moderate): undici vulnerable to cross-user information disclosure via whitespace around equals in Cache-Control directives | `>=7.0.0 <7.29.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) (moderate): undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields | `>=7.0.0 <7.29.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-35p6-xmwp-9g52](https://github.com/advisories/GHSA-35p6-xmwp-9g52) (low): undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse | `>=7.0.0 <7.28.0` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-pmjh-fq2x-6v4x](https://github.com/advisories/GHSA-pmjh-fq2x-6v4x) (moderate): undici vulnerable to Denial of Service via orphaned RetryHandler response body | `>=7.11.0 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) (low): undici vulnerable to downstream response splitting via retry interceptor | `>=7.0.0 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) (high): undici vulnerable to Denial of Service via unrequested WebSocket subprotocol | `>=7.0.0 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-3xpg-4rpp-hhhm](https://github.com/advisories/GHSA-3xpg-4rpp-hhhm) (moderate): undici vulnerable to Denial of Service via unbounded decompression of compressed responses | `>=7.15.0 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-2jfj-6hjv-fm6j](https://github.com/advisories/GHSA-2jfj-6hjv-fm6j) (moderate): undici vulnerable to cross-user cookie disclosure via Set-Cookie caching in shared caches | `>=7.0.0 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-2gqq-gqf2-x968](https://github.com/advisories/GHSA-2gqq-gqf2-x968) (low): undici vulnerable to response truncation via oversized chunked responses in the dump interceptor | `>=7.1.0 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3) (high): undici vulnerable to TLS certificate validation bypass via dropped connect options in BalancedPool | `>=7.24.1 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-8436-99hf-9mmv](https://github.com/advisories/GHSA-8436-99hf-9mmv) (low): undici vulnerable to caching and replay of unsafe HTTP method responses | `>=7.0.0 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |
| [GHSA-rx4f-c7p8-82vq](https://github.com/advisories/GHSA-rx4f-c7p8-82vq) (moderate): undici vulnerable to Denial of Service via WebSocketStream unclean close | `>=7.0.0 <7.29.1` | MATCH: `node_modules/undici@7.24.7` |

### 28. frontend — vite (high)

**Disposition:** CONDITIONAL build/test execution only under the specified commands; patch and host server-exposure gate pending. Evidence section: **D**. No dependency update applied.

Triage proposal (not registry-verified): `6.4.3 (root 5.x major); 8.0.16 (nested 8.x) `. Remaining regression scope: Fresh plain npm ci retaining esbuild topology repair, dev loopback serving/HMR, Node22 test suite and production build; root5 to6 major requires plugin compatibility.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/vite` | `5.4.21` / `5.4.21` | `6.4.3` |
| `node_modules/vitest/node_modules/vite` | `8.0.3` / `8.0.3` | `8.0.16` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (devDependencies) → `node_modules/vite` | `^5.1.4` | **No — change compatible parent / explicit root decision first** |
| `node_modules/vitest` (dependencies) → `node_modules/vitest/node_modules/vite` | `^6.0.0 &#124;&#124; ^7.0.0 &#124;&#124; ^8.0.0` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) (moderate): Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling | `<=6.4.1` | MATCH: `node_modules/vite@5.4.21` |
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) (moderate): Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling | `>=8.0.0 <=8.0.4` | MATCH: `node_modules/vitest/node_modules/vite@8.0.3` |
| [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r) (high): Vite: `server.fs.deny` bypassed with queries | `>=8.0.0 <=8.0.4` | MATCH: `node_modules/vitest/node_modules/vite@8.0.3` |
| [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) (high): Vite Vulnerable to Arbitrary File Read via Vite Dev Server WebSocket | `>=8.0.0 <=8.0.4` | MATCH: `node_modules/vitest/node_modules/vite@8.0.3` |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) (moderate): launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows | `<=6.4.2` | MATCH: `node_modules/vite@5.4.21` |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) (moderate): launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows | `>=8.0.0 <=8.0.15` | MATCH: `node_modules/vitest/node_modules/vite@8.0.3` |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) (high): vite: `server.fs.deny` bypass on Windows alternate paths | `<=6.4.2` | MATCH: `node_modules/vite@5.4.21` |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) (high): vite: `server.fs.deny` bypass on Windows alternate paths | `>=8.0.0 <=8.0.15` | MATCH: `node_modules/vitest/node_modules/vite@8.0.3` |

Inherited through `esbuild`: `GHSA-67mh-4wv8-2f99`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 29. frontend — vitest (moderate)

**Disposition:** CONDITIONAL build/test execution only under the specified commands; patch and host server-exposure gate pending. Evidence section: **D**. No dependency update applied.

Triage proposal (not registry-verified): `4.1.11`. Remaining regression scope: Full frontend/backend suites, mocking, worker isolation; do not expose test server.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/vitest` | `4.1.2` / `4.1.2` | `4.1.11` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (devDependencies) → `node_modules/vitest` | `^4.1.2` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) (moderate): Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock | `>=2.1.0 <4.1.11` | MATCH: `node_modules/vitest@4.1.2` |

Inherited through `@vitest/mocker`: `GHSA-82fw-gwwq-j7x9`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 30. frontend — websocket-driver (critical)

**Disposition:** CONDITIONAL browser exclusion; upgrade compatible children when registry works; repeat graph on host. Evidence section: **B**. No dependency update applied.

Triage proposal (not registry-verified): `0.7.5`. Remaining regression scope: Firebase lead create/list and build bundle inspection; isolated protocol compatibility tests, no live exploit.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/websocket-driver` | `0.7.4` / `0.7.4` | `0.7.5` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/faye-websocket` (dependencies) → `node_modules/websocket-driver` | `>=0.5.1` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-mp7j-qc5w-4988](https://github.com/advisories/GHSA-mp7j-qc5w-4988) (moderate): websocket-driver: Resource limit bypass via message compression | `<0.7.5` | MATCH: `node_modules/websocket-driver@0.7.4` |
| [GHSA-xv26-6w52-cph6](https://github.com/advisories/GHSA-xv26-6w52-cph6) (critical): websocket-driver: Message corruption via abuse of protocol length headers | `<0.7.5` | MATCH: `node_modules/websocket-driver@0.7.4` |

### 31. frontend — ws (high)

**Disposition:** CONDITIONAL build/test execution only under the specified commands; patch and host server-exposure gate pending. Evidence section: **D**. No dependency update applied.

Triage proposal (not registry-verified): `8.21.0`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/ws` | `8.20.0` / `8.20.0` | `8.21.0` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/happy-dom` (dependencies) → `node_modules/ws` | `^8.18.3` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) (moderate): ws: Uninitialized memory disclosure | `>=8.0.0 <8.20.1` | MATCH: `node_modules/ws@8.20.0` |
| [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) (high): ws: Memory exhaustion DoS from tiny fragments and data chunks | `>=8.0.0 <8.21.0` | MATCH: `node_modules/ws@8.20.0` |

### 32. backend — @vitest/mocker (moderate)

**Disposition:** CONDITIONAL non-public test runner; exact-pinned parent update and host tests pending. Evidence section: **D**. No dependency update applied.

Triage proposal (not registry-verified): `4.1.11`. Remaining regression scope: Upgrade with matching Vitest4.1.11; run all mocking tests.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/@vitest/mocker` | `4.1.10` / `4.1.10` | `4.1.11` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/vitest` (dependencies) → `node_modules/@vitest/mocker` | `4.1.10` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) (moderate): Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock | `>=2.1.0 <4.1.11` | MATCH: `node_modules/@vitest/mocker@4.1.10` |

### 33. backend — axios (high)

**Disposition:** BLOCKED backend HTTP patch verification. Evidence section: **O**. No dependency update applied.

Triage proposal (not registry-verified): `1.20.0`. Remaining regression scope: API auth/401/403/error handling, multipart uploads, timeout/cancel, mock Twilio SMS success/failure and signature/STOP/consent; no real sends.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/axios` | `1.13.5` / `1.13.5` | `1.20.0` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/twilio` (dependencies) → `node_modules/axios` | `^1.12.0` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-3p68-rc4w-qgx5](https://github.com/advisories/GHSA-3p68-rc4w-qgx5) (moderate): Axios has a NO_PROXY Hostname Normalization Bypass that Leads to SSRF | `>=1.0.0 <1.15.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-w9j2-pvgh-6h63](https://github.com/advisories/GHSA-w9j2-pvgh-6h63) (moderate): Axios: Authentication Bypass via Prototype Pollution Gadget in `validateStatus` Merge Strategy | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-pmwg-cvhr-8vh7](https://github.com/advisories/GHSA-pmwg-cvhr-8vh7) (high): Axios: Incomplete Fix for CVE-2025-62718 — NO_PROXY Protection Bypassed via RFC 1122 Loopback Subnet (127.0.0.0/8) in Axios 1.15.0 | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-3w6x-2g7m-8v23](https://github.com/advisories/GHSA-3w6x-2g7m-8v23) (moderate): Axios: Invisible JSON Response Tampering via Prototype Pollution Gadget in `parseReviver` | `>=1.0.0 <1.15.2` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-xhjh-pmcv-23jw](https://github.com/advisories/GHSA-xhjh-pmcv-23jw) (low): Axios: Null Byte Injection via Reverse-Encoding in AxiosURLSearchParams | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-445q-vr5w-6q77](https://github.com/advisories/GHSA-445q-vr5w-6q77) (moderate): Axios: CRLF Injection in multipart/form-data body via unsanitized blob.type in formDataToStream | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-m7pr-hjqh-92cm](https://github.com/advisories/GHSA-m7pr-hjqh-92cm) (moderate): Axios: no_proxy bypass via IP alias allows SSRF | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-5c9x-8gcm-mpgx](https://github.com/advisories/GHSA-5c9x-8gcm-mpgx) (moderate): Axios' HTTP adapter-streamed uploads bypass maxBodyLength when maxRedirects: 0 | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-vf2m-468p-8v99](https://github.com/advisories/GHSA-vf2m-468p-8v99) (moderate): Axios: HTTP adapter streamed responses bypass maxContentLength | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-pf86-5x62-jrwf](https://github.com/advisories/GHSA-pf86-5x62-jrwf) (high): Axios: Prototype Pollution Gadgets - Response Tampering, Data Exfiltration, and Request Hijacking | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-6chq-wfr3-2hj9](https://github.com/advisories/GHSA-6chq-wfr3-2hj9) (high): Axios: Header Injection via Prototype Pollution | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-xx6v-rp6x-q39c](https://github.com/advisories/GHSA-xx6v-rp6x-q39c) (moderate): Axios: XSRF Token Cross-Origin Leakage via Prototype Pollution Gadget in `withXSRFToken` Boolean Coercion | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-q8qp-cvcw-x6jj](https://github.com/advisories/GHSA-q8qp-cvcw-x6jj) (high): Axios has prototype pollution read-side gadgets in HTTP adapter that allow credential injection and request hijacking | `>=1.0.0 <1.15.2` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-fvcv-3m26-pcqx](https://github.com/advisories/GHSA-fvcv-3m26-pcqx) (moderate): Axios has Unrestricted Cloud Metadata Exfiltration via Header Injection Chain | `>=1.0.0 <1.15.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-62hf-57xw-28j9](https://github.com/advisories/GHSA-62hf-57xw-28j9) (moderate): Axios: unbounded recursion in toFormData causes DoS via deeply nested request data | `>=1.0.0 <1.15.1` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-hfxv-24rg-xrqf](https://github.com/advisories/GHSA-hfxv-24rg-xrqf) (high): Axios: Regular Expression Denial of Service (ReDoS) via Cookie Name Injection | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-777c-7fjr-54vf](https://github.com/advisories/GHSA-777c-7fjr-54vf) (high): Allocation of Resources Without Limits or Throttling in Axios | `>=1.7.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-p92q-9vqr-4j8v](https://github.com/advisories/GHSA-p92q-9vqr-4j8v) (high): Axios: Proxy-Authorization Credential Leak to Origin Server Across HTTP-to-HTTPS Redirect in Axios Node.js HTTP Adapter | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-j5f8-grm9-p9fc](https://github.com/advisories/GHSA-j5f8-grm9-p9fc) (high): Axios: Proxy-Authorization header leaks to redirect target when proxy is re-evaluated to direct connection | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-3g43-6gmg-66jw](https://github.com/advisories/GHSA-3g43-6gmg-66jw) (high): axios Vulnerable to Credential Theft and Response Hijacking via Prototype Pollution Gadget in Config Merge | `>=1.0.0 <1.15.2` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-35jp-ww65-95wh](https://github.com/advisories/GHSA-35jp-ww65-95wh) (high): axios Vulnerable to Full Man-in-the-Middle via Prototype Pollution Gadget in `config.proxy` | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-898c-q2cr-xwhg](https://github.com/advisories/GHSA-898c-q2cr-xwhg) (moderate): axios has DoS & Header Injection via Prototype Pollution Read-Side Gadgets in axios merge functions | `>=1.0.0 <1.16.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-mmx7-hfxf-jppx](https://github.com/advisories/GHSA-mmx7-hfxf-jppx) (moderate): Axios: Prototype pollution gadgets can alter axios request construction | `>=1.0.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-pmv8-rq9r-6j72](https://github.com/advisories/GHSA-pmv8-rq9r-6j72) (moderate): Axios: Deep formToJSON Key Recursion Can Cause Denial of Service | `>=1.0.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-mwf2-3pr3-8698](https://github.com/advisories/GHSA-mwf2-3pr3-8698) (moderate): Axios: HTTP/2 streamed uploads bypass `maxBodyLength` | `>=1.13.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-7q8q-rj6j-mhjq](https://github.com/advisories/GHSA-7q8q-rj6j-mhjq) (moderate): Axios: Nested axios option objects can consume polluted prototype values | `>=1.0.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-jqh4-m9w3-8hp9](https://github.com/advisories/GHSA-jqh4-m9w3-8hp9) (moderate): Axios: Fetch adapter `ReadableStream` uploads bypass `maxBodyLength` | `>=1.7.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-42h9-826w-cgv3](https://github.com/advisories/GHSA-42h9-826w-cgv3) (moderate): Axios: Excessive recursion in formDataToJSON can cause denial of service | `>=1.0.0 <1.18.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-vh66-26gq-q6x8](https://github.com/advisories/GHSA-vh66-26gq-q6x8) (moderate): Axios: Prototype pollution gadget in fetch adapter can alter outbound requests | `>=1.7.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-9fr6-4gfg-395g](https://github.com/advisories/GHSA-9fr6-4gfg-395g) (moderate): Axios: Prototype-Pollution Gadget in the Default Instance Allows Inherited Object.prototype.method to Override HTTP Method | `>=1.0.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-3pq3-5fj3-cg6v](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v) (high): Axios: HTTP/2 adapter bypasses configured DNS lookup and proxy controls | `>=1.13.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-542g-h47m-68v8](https://github.com/advisories/GHSA-542g-h47m-68v8) (high): Axios: Denial of Service via Unhandled 'error' Event in HTTP/2 ClientHttp2Session Initialization | `>=1.13.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-j8rh-479h-cp32](https://github.com/advisories/GHSA-j8rh-479h-cp32) (moderate): Axios: Header Injection via Inherited headers After Minimal Interceptor | `>=1.0.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |
| [GHSA-4hqw-qxg8-jxx2](https://github.com/advisories/GHSA-4hqw-qxg8-jxx2) (moderate): Axios: Fetch Adapter Header Injection via Inherited FormData getHeaders | `>=1.12.0 <1.20.0` | MATCH: `node_modules/axios@1.13.5` |

### 34. backend — body-parser (low)

**Disposition:** BLOCKED runtime patch/parent compatibility and host HTTP tests. Evidence section: **H**. No dependency update applied.

Triage proposal (not registry-verified): `1.20.6`. Remaining regression scope: Mounted HTTP bounded JSON/urlencoded body size, 413, malformed payload and existing webhook raw-body/signature ordering.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/body-parser` | `1.20.4` / `1.20.4` | `1.20.6` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/express` (dependencies) → `node_modules/body-parser` | `~1.20.3` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6) (low): body-parser vulnerable to denial of service when invalid limit value silently disables size enforcement | `<1.20.6` | MATCH: `node_modules/body-parser@1.20.4` |

### 35. backend — brace-expansion (high)

**Disposition:** CONDITIONAL trusted build/watch inputs; compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `5.0.12`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/brace-expansion` | `5.0.5` / `5.0.5` | `5.0.12` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/minimatch` (dependencies) → `node_modules/brace-expansion` | `^5.0.2` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-jxxr-4gwj-5jf2](https://github.com/advisories/GHSA-jxxr-4gwj-5jf2) (moderate): brace-expansion: Large numeric range defeats documented `max` DoS protection | `>=5.0.0 <5.0.6` | MATCH: `node_modules/brace-expansion@5.0.5` |
| [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) (high): brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups | `>=3.0.0 <5.0.7` | MATCH: `node_modules/brace-expansion@5.0.5` |
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) (high): brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash | `>=4.0.0 <5.0.8` | MATCH: `node_modules/brace-expansion@5.0.5` |
| [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) (high): brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation | `>=4.0.0 <5.0.9` | MATCH: `node_modules/brace-expansion@5.0.5` |
| [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) (moderate): brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service | `>=4.0.0 <5.0.12` | MATCH: `node_modules/brace-expansion@5.0.5` |
| [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) (high): brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion | `>=4.0.0 <5.0.11` | MATCH: `node_modules/brace-expansion@5.0.5` |
| [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) (high): brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion | `>=4.0.0 <5.0.10` | MATCH: `node_modules/brace-expansion@5.0.5` |

### 36. backend — braces (high)

**Disposition:** CONDITIONAL trusted build/watch inputs; compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Keep glob inputs trusted and bounded; separate parent migration compatibility assessment; Tailwind visual/build and nodemon watcher checks.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/braces` | `3.0.3` / `3.0.3` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/chokidar` (dependencies) → `node_modules/braces` | `~3.0.2` | No target established |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (high): braces vulnerable to stack-exhaustion denial of service through deeply nested patterns | `<=3.0.3` | MATCH: `node_modules/braces@3.0.3` |

### 37. backend — chokidar (high)

**Disposition:** CONDITIONAL trusted build/watch inputs; compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/chokidar` | `3.6.0` / `3.6.0` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/nodemon` (dependencies) → `node_modules/chokidar` | `^3.5.2` | No target established |

No direct advisory occurrence in the supplied JSON; this is a meta-vulnerability finding.

Inherited through `braces`: `GHSA-vfj7-8cjw-p6xm`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 38. backend — express-rate-limit (moderate)

**Disposition:** BLOCKED runtime patch/parent compatibility and host HTTP tests. Evidence section: **H**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/express-rate-limit` | `8.3.1` / `8.3.1` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (dependencies) → `node_modules/express-rate-limit` | `^8.2.1` | No target established |

No direct advisory occurrence in the supplied JSON; this is a meta-vulnerability finding.

Inherited through `ip-address`: `GHSA-h3mg-xc3c-68pw`, `GHSA-j6r3-76f7-8jcv`, `GHSA-mwp4-54f8-5fhr`, `GHSA-rpw4-54j3-4h4q`, `GHSA-v2v4-37r5-5v8g`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 39. backend — follow-redirects (moderate)

**Disposition:** BLOCKED backend HTTP patch verification. Evidence section: **O**. No dependency update applied.

Triage proposal (not registry-verified): `1.15.12`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/follow-redirects` | `1.15.11` / `1.15.11` | `1.15.12` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/axios` (dependencies) → `node_modules/follow-redirects` | `^1.15.11` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-r4q5-vmmm-2653](https://github.com/advisories/GHSA-r4q5-vmmm-2653) (moderate): follow-redirects leaks Custom Authentication Headers to Cross-Domain Redirect Targets | `<=1.15.11` | MATCH: `node_modules/follow-redirects@1.15.11` |

### 40. backend — form-data (high)

**Disposition:** BLOCKED backend HTTP patch verification. Evidence section: **O**. No dependency update applied.

Triage proposal (not registry-verified): `4.0.6`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/form-data` | `4.0.5` / `4.0.5` | `4.0.6` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/axios` (dependencies) → `node_modules/form-data` | `^4.0.5` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) (high): form-data: CRLF injection in form-data via unescaped multipart field names and filenames | `>=4.0.0 <4.0.6` | MATCH: `node_modules/form-data@4.0.5` |

### 41. backend — ip-address (high)

**Disposition:** BLOCKED runtime patch/parent compatibility and host HTTP tests. Evidence section: **H**. No dependency update applied.

Triage proposal (not registry-verified): `10.7.1`. Remaining regression scope: IPv4/IPv6 rate-limit key normalization and bounded malformed address handling; inspect consumer callsites before SSRF conclusion.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/ip-address` | `10.1.0` / `10.1.0` | `10.7.1` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/express-rate-limit` (dependencies) → `node_modules/ip-address` | `10.1.0` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-v2v4-37r5-5v8g](https://github.com/advisories/GHSA-v2v4-37r5-5v8g) (moderate): ip-address has XSS in Address6 HTML-emitting methods | `<=10.1.0` | MATCH: `node_modules/ip-address@10.1.0` |
| [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr) (high): ip-address: Address4 decodes leading-zero octets as decimal while resolvers decode them as octal, allowing SSRF and trust-boundary bypass | `<=10.3.0` | MATCH: `node_modules/ip-address@10.1.0` |
| [GHSA-rpw4-54j3-4h4q](https://github.com/advisories/GHSA-rpw4-54j3-4h4q) (moderate): ip-address: Address6.isLinkLocal() recognizes fe80::/64 rather than fe80::/10, allowing SSRF and trust-boundary bypass to on-link hosts | `<=10.5.0` | MATCH: `node_modules/ip-address@10.1.0` |
| [GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv) (moderate): ip-address: isInSubnet() and isHostInSubnet() compare addresses of different families as if they shared an address space, allowing an allowlist check to admit an address outside its range | `<=10.7.0` | MATCH: `node_modules/ip-address@10.1.0` |
| [GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw) (moderate): ip-address: Address6 builds a parse diagnostic proportional to the input with no length bound, allowing a single long string to stall or crash the process | `<=10.7.0` | MATCH: `node_modules/ip-address@10.1.0` |

### 42. backend — nanoid (high)

**Disposition:** CONDITIONAL trusted build/watch inputs; compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `3.3.18`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/nanoid` | `3.3.15` / `3.3.15` | `3.3.18` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/postcss` (dependencies) → `node_modules/nanoid` | `^3.3.12` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) (high): nanoid: non-secure generators can loop indefinitely with negative size | `<3.3.16` | MATCH: `node_modules/nanoid@3.3.15` |
| [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) (high): nanoid: custom generators can loop indefinitely when size is zero | `<3.3.18` | MATCH: `node_modules/nanoid@3.3.15` |

### 43. backend — nodemailer (high)

**Disposition:** BLOCKED major compatibility and recipient/parser patch verification. Evidence section: **E**. No dependency update applied.

Triage proposal (not registry-verified): `10.0.6`. Remaining regression scope: Mocked SMTP configuration/send/error privacy, bounded recipient parsing, reset/estimate/status email templates; Node22 CommonJS loading. Major target requires compatibility gate; no real email.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/nodemailer` | `8.0.4` / `8.0.4` | `10.0.6` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (dependencies) → `node_modules/nodemailer` | `^8.0.1` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-vvjj-xcjg-gr5g](https://github.com/advisories/GHSA-vvjj-xcjg-gr5g) (moderate): Nodemailer Vulnerable to SMTP Command Injection via CRLF in Transport name Option (EHLO/HELO)  | `<=8.0.4` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-268h-hp4c-crq3](https://github.com/advisories/GHSA-268h-hp4c-crq3) (moderate): Nodemailer: CRLF injection in Nodemailer List-* header comments allows arbitrary message header injection | `<=8.0.8` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-wqvq-jvpq-h66f](https://github.com/advisories/GHSA-wqvq-jvpq-h66f) (moderate): Nodemailer jsonTransport bypasses disableFileAccess and disableUrlAccess during message normalization | `<=8.0.8` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-p6gq-j5cr-w38f](https://github.com/advisories/GHSA-p6gq-j5cr-w38f) (high): Nodemailer: Message-level raw option bypasses disableFileAccess/disableUrlAccess, enabling arbitrary file read and full-response SSRF in the delivered message | `<=9.0.0` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-8m3c-c648-2xjj](https://github.com/advisories/GHSA-8m3c-c648-2xjj) (moderate): Nodemailer: resolveContent() on a MailMessage bypasses disableFileAccess/disableUrlAccess when called with the legacy signature | `<=9.1.0` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-wmmp-3585-3rmp](https://github.com/advisories/GHSA-wmmp-3585-3rmp) (moderate): Nodemailer: IDN/Punycode domain allow-list bypass leads to email delivery to an attacker-controlled domain | `<9.1.0` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-2x7j-588g-ccc2](https://github.com/advisories/GHSA-2x7j-588g-ccc2) (high): Nodemailer: Quadratic (O(n²)) time complexity in addressparser allows remote denial of service via a crafted address list | `<9.1.0` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-cc9r-2j5m-2m83](https://github.com/advisories/GHSA-cc9r-2j5m-2m83) (moderate): Nodemailer: Recipient-domain validation bypass via RFC 5322 comment mis-parsing leads to email delivery to an attacker-controlled domain | `>=6.9.16 <9.1.0` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-6vj9-mwq6-2f5v](https://github.com/advisories/GHSA-6vj9-mwq6-2f5v) (moderate): Nodemailer: Process-global DNS cache reuses TLS `servername` across transports, enabling cross-tenant SMTP credential disclosure | `>=5.0.0 <10.0.2` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-8vvx-rff5-p5rq](https://github.com/advisories/GHSA-8vvx-rff5-p5rq) (moderate): Nodemailer: Nested structured recipient arrays bypass the parser depth limit and cause stack exhaustion DoS | `<10.0.2` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-v53p-9fqp-m79j](https://github.com/advisories/GHSA-v53p-9fqp-m79j) (high): Nodemailer: Quadratic backtracking in the addressparser free-text fallback allows remote denial of service | `<=10.0.5` | MATCH: `node_modules/nodemailer@8.0.4` |
| [GHSA-r7g4-qg5f-qqm2](https://github.com/advisories/GHSA-r7g4-qg5f-qqm2) (high): Nodemailer: Improper TLS Certificate Validation in OAuth2 Token Fetch Enables Credential Interception | `<=8.0.7` | MATCH: `node_modules/nodemailer@8.0.4` |

### 44. backend — nodemon (high)

**Disposition:** CONDITIONAL trusted build/watch inputs; compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `UNRESOLVED; upgrade affected descendants through compatible parent, not blind audit fix`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/nodemon` | `3.1.14` / `3.1.14` | `none established` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (devDependencies) → `node_modules/nodemon` | `^3.0.2` | No target established |

No direct advisory occurrence in the supplied JSON; this is a meta-vulnerability finding.

Inherited through `chokidar`: `GHSA-vfj7-8cjw-p6xm`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

### 45. backend — postcss (high)

**Disposition:** CONDITIONAL trusted build/watch inputs; compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `8.5.23`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/postcss` | `8.5.16` / `8.5.16` | `8.5.23` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/vite` (dependencies) → `node_modules/postcss` | `^8.5.16` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) (moderate): PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset | `<=8.5.22` | MATCH: `node_modules/postcss@8.5.16` |
| [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) (high): PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure | `<=8.5.17` | MATCH: `node_modules/postcss@8.5.16` |

### 46. backend — proxy-addr (critical)

**Disposition:** CONDITIONAL numeric-hop source setting excludes the cited subnet precondition; compatible patch and host ingress gate pending. Evidence section: **H**. No dependency update applied.

Triage proposal (not registry-verified): `2.0.8`. Remaining regression scope: Registered HTTP forwarded-IP/rate-limit tests: trusted vs untrusted hops, IPv4/mapped IPv6, XFF spoof rejection; preserve deployment proxy topology.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/proxy-addr` | `2.0.7` / `2.0.7` | `2.0.8` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/express` (dependencies) → `node_modules/proxy-addr` | `~2.0.7` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) (critical): proxy-addr vulnerable to IP spoofing via IPv4-mapped IPv6 trust subnet | `>=1.1.0 <2.0.8` | MATCH: `node_modules/proxy-addr@2.0.7` |

### 47. backend — qs (moderate)

**Disposition:** BLOCKED runtime patch/parent compatibility and host HTTP tests. Evidence section: **H**. No dependency update applied.

Triage proposal (not registry-verified): `6.16.0`. Remaining regression scope: Query/urlencoded parsing, array limits, auth endpoints, raw webhook body signatures; bounded non-exploit negative cases.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/qs` | `6.14.2` / `6.14.2` | `6.16.0` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/body-parser` (dependencies) → `node_modules/qs` | `~6.14.0` | **No — change compatible parent / explicit root decision first** |
| `node_modules/express` (dependencies) → `node_modules/qs` | `~6.14.0` | **No — change compatible parent / explicit root decision first** |
| `node_modules/twilio` (dependencies) → `node_modules/qs` | `^6.14.1` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26) (moderate): qs has a remotely triggerable DoS: qs.stringify crashes with TypeError on null/undefined entries in comma-format arrays when encodeValuesOnly is set | `>=6.11.1 <=6.15.1` | MATCH: `node_modules/qs@6.14.2` |
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) (moderate): qs array-limit bypass via bracket-key comma parsing | `>=6.14.2 <=6.15.3` | MATCH: `node_modules/qs@6.14.2` |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) (moderate): qs: Denial of Service via Attacker Controlled isBuffer | `>=2.2.5 <6.16.0` | MATCH: `node_modules/qs@6.14.2` |

### 48. backend — source-map-js (high)

**Disposition:** CONDITIONAL trusted build/watch inputs; compatible patch where available and host input-boundary gate pending. Evidence section: **T**. No dependency update applied.

Triage proposal (not registry-verified): `1.2.2`. Remaining regression scope: Full relevant component tests/build; add bounded regression for advisory-specific input handling and verify dependency resolution.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/source-map-js` | `1.2.1` / `1.2.1` | `1.2.2` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `node_modules/postcss` (dependencies) → `node_modules/source-map-js` | `^1.2.1` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) (high): source-map-js allows event-loop denial of service through indexed source-map section offsets | `>=1.0.0 <1.2.2` | MATCH: `node_modules/source-map-js@1.2.1` |

### 49. backend — uuid (moderate)

**Disposition:** CONDITIONAL v4-only call sites; no buffer-API major migration. Evidence section: **U**. No dependency update applied.

Triage proposal (not registry-verified): `11.1.1`. Remaining regression scope: Auth IDs/JTI/token creation and DB roundtrip; v11 CommonJS compatibility before considering any major. Do not blindly select audit latest v14.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/uuid` | `9.0.1` / `9.0.1` | `11.1.1` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (dependencies) → `node_modules/uuid` | `^9.0.0` | **No — change compatible parent / explicit root decision first** |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) (moderate): uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided | `<11.1.1` | MATCH: `node_modules/uuid@9.0.1` |

### 50. backend — vitest (moderate)

**Disposition:** CONDITIONAL non-public test runner; exact-pinned parent update and host tests pending. Evidence section: **D**. No dependency update applied.

Triage proposal (not registry-verified): `4.1.11`. Remaining regression scope: Full frontend/backend suites, mocking, worker isolation; do not expose test server.

| Current lock path | Locked / installed | Proposal for this node |
| --- | --- | --- |
| `node_modules/vitest` | `4.1.10` / `4.1.10` | `4.1.11` |

| Immediate parent → resolved node | Declared range | Proposal fits this edge? |
| --- | --- | --- |
| `<root>` (devDependencies) → `node_modules/vitest` | `^4.1.10` | Yes (range only) |

| Advisory ID / severity | Affected range (remaining unpatched) | Matching candidate nodes |
| --- | --- | --- |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) (moderate): Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock | `>=2.1.0 <4.1.11` | MATCH: `node_modules/vitest@4.1.10` |

Inherited through `@vitest/mocker`: `GHSA-82fw-gwwq-j7x9`. Retain the descendant ranges shown in their package sections; do not invent a direct package advisory range.

Matrix verification: **50 package findings, 187 direct advisory occurrences, 187 matching occurrences, 67 immediate-parent edges**, all ranges parsed by npm semver 7.7.4. Parent-edge counts exclude peers; no invalid locked edge found for these packages.

## Final instrumented browser graph receipt

Reproduction of the instrumented assertion (cwd frontend, no persisted config edits):

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin node --input-type=module - <<'JS'
import { build } from 'vite';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
await build({ envDir: false, build: { write: false }, plugins: [{
  name: 'phase-g-browser-transport-evidence',
  generateBundle(_options, bundle) {
    const relative = id => id.replace(process.cwd() + '/', '');
    const ids = [...this.getModuleIds()].map(relative).sort();
    const emitted = [...new Set(Object.values(bundle)
      .filter(x => x.type === 'chunk').flatMap(x => Object.keys(x.modules)))];
    const forbidden = /node_modules\/(?:@grpc\/|@protobufjs\/|protobufjs\/|websocket-driver\/|faye-websocket\/|undici\/|ws\/|form-data\/|follow-redirects\/)|@firebase\/[^/]+\/dist\/.*(?:node\.|node\/)/;
    assert.ok(ids.includes('node_modules/@firebase/firestore/dist/index.esm.js'));
    assert.deepEqual(ids.filter(id => forbidden.test(id)), []);
    assert.equal(ids.includes('node_modules/axios/lib/adapters/http.js'), false);
    console.log(JSON.stringify({ modules: ids.length, emitted: emitted.length,
      hash: createHash('sha256').update(ids.join('\n')).digest('hex'),
      firebase: ids.filter(id => id.includes('node_modules/@firebase/')) }));
  }
}] });
JS
```

This is a sanitized, no-.env build. In particular Sentry is resolved but tree-shaken
from emitted chunks without a configured DSN. It is not evidence that a configured
production Sentry build excludes the SDK. Repeat under the host's approved build
configuration without exposing its values. Firebase's browser entry assertion must
continue to hold after any resolver, entry, SSR or dependency change.

Node22/Vite 5.4.21, envDir=false, write=false, actual existing vite.config.js. 1871 resolved modules; 377 emitted modules. Sorted project-relative ID list SHA256: `5e0850054c54e03bcacdc05535cf4f3e5356874e5a0709674f3f62f96bc355bc`. Exit 0; no evaluated app/provider requests.

The forbidden Node transport, Node Axios adapter, form-data and follow-redirects assertions passed. All package counts are from Rollup getModuleIds() and chunk.modules, not minified text searches. Zero means absent from this graph, not absent from node_modules or every possible execution environment.

| Historical frontend finding | Resolved modules | Emitted modules |
| --- | --- | --- |
| @babel/core | 0 | 0 |
| @grpc/grpc-js | 0 | 0 |
| @protobufjs/utf8 | 0 | 0 |
| @remix-run/router | 1 | 1 |
| @sentry/browser | 22 | 0 |
| @sentry/react | 10 | 0 |
| @vitest/mocker | 0 | 0 |
| axios | 50 | 50 |
| baseline-browser-mapping | 0 | 0 |
| braces | 0 | 0 |
| browserslist | 0 | 0 |
| chokidar | 0 | 0 |
| esbuild | 0 | 0 |
| fast-glob | 0 | 0 |
| follow-redirects | 0 | 0 |
| form-data | 0 | 0 |
| micromatch | 0 | 0 |
| nanoid | 0 | 0 |
| picomatch | 0 | 0 |
| postcss | 0 | 0 |
| postcss-selector-parser | 0 | 0 |
| protobufjs | 0 | 0 |
| react-router | 1 | 1 |
| react-router-dom | 1 | 1 |
| source-map-js | 0 | 0 |
| tailwindcss | 0 | 0 |
| undici | 0 | 0 |
| vite | 0 | 0 |
| vitest | 0 | 0 |
| websocket-driver | 0 | 0 |
| ws | 0 | 0 |

Actual Firebase entries:

- `node_modules/@firebase/app/dist/esm/index.esm.js`
- `node_modules/@firebase/component/dist/esm/index.esm.js`
- `node_modules/@firebase/firestore/dist/common-fe7037b3.esm.js`
- `node_modules/@firebase/firestore/dist/index.esm.js`
- `node_modules/@firebase/logger/dist/esm/index.esm.js`
- `node_modules/@firebase/util/dist/index.esm.js`
- `node_modules/@firebase/util/dist/postinstall.mjs`
- `node_modules/@firebase/webchannel-wrapper/dist/bloom-blob/esm/bloom_blob_es2018.js`
- `node_modules/@firebase/webchannel-wrapper/dist/webchannel-blob/esm/webchannel_blob_es2018.js`
