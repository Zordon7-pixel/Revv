# Phase G2 dependency disposition — t_3ae3ac28

2026-10-10. **Implementation diff only; HOST INSTALL / full acceptance pending. Not security clean.**
Base: `b01753cc7df77819ca57324ecf545469adc4c65c`, branch
`codex/revv-all-issues-recovery-20261007`. Worktree: supplied `recovery-run/source`.
Six files changed within the allowed seven: both package manifests/locks, backend
dependencySecurity test and this document. Frontend dependencySecurity test is unchanged.
No commit, agents, board/message, network/provider, secrets/.env, canonical repository,
production data, global configuration, push or deployment operation. Hermes owns commit,
host gates, independent exact-SHA review and shipping. Changes exceed two files and cover
security-sensitive proxy, dependency, recipient/privacy and API behavior.

## Current result

Backend: Express **4.22.3**, proxy-addr **2.0.8**, body-parser **1.20.6**,
root qs **6.16.0**, parser-private qs **6.15.3**, express-rate-limit **8.7.1**,
ip-address **10.7.1**, Axios **1.20.0**, form-data **4.0.6**,
follow-redirects **1.16.0**, Nodemailer **10.0.6**, Vitest family **4.1.11**.
Backend Vite remains **8.1.3** and backend Sentry remains **7.105.0**.
Frontend: Axios **1.20.0**, Router/DOM **6.30.6**, @remix-run/router **1.23.4**,
Vitest family **4.1.11**, websocket-driver **0.7.5**, protobufjs **7.6.5**,
@protobufjs/utf8 **1.1.1**, and compatible build/test descendants listed below.
No new direct transitive dependencies or overrides were added; no major Router/Tailwind/nodemon migration.

**Cache-blocked groups were rolled back completely:** frontend Sentry remains **7.105.0**;
root Vite remains **5.4.21** with private esbuild **0.21.5**, and Vitest's private Vite
remains **8.0.3**. Plugin-react stays **4.7.0**. Their exact missing metadata specs are below.
Nodemailer 10 is an unaccepted migration candidate until actual Node22 CommonJS,
stream/JSON transport, recipient and privacy tests pass on the installed version.

Registry corrections: follow-redirects 1.15.12 does not exist; verified 1.16.0 is used.
Express 4.22.3 admits qs ~6.16.0 and body-parser ~1.20.5, but body-parser 1.20.6
requires **qs ~6.15.1**. Its highest cached compatible version is 6.15.3, leaving two
moderate ranges. No out-of-range override conceals this. The backend test now resolves
parser/qs from each actual consuming package instead of assuming root hoisting.
Router 6.30.6 does not clear two supplied React Router ranges; no v7 migration inferred.
PostCSS selector parser 6.1.3 clears the older recursion range but not the <7.1.6 range.
Already-newer picomatch 4.0.5 nodes were preserved, not downgraded to 4.0.4.

## Executed validation and provenance

Node **22.23.2**, npm semver **7.7.4**, sanitized `env -i` with
`PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin`. All npm commands were offline.
Initial targeted npm install (including the full-metadata attempt) exited 1 with
`ENOTCACHED` for express-rate-limit despite its readable cached packument. No network retry.
Used the authorized semantic fallback: read host-cached registry data through npm cacache,
preserve verified dist URLs/integrity and complete dependency/optional/peer metadata,
resolve compatible children, then let npm normalize and validate each final lock.
New child versions are limited to dependency closures required by named targets;
existing compatible metadata is reused when available (including backend's agent-base
6.0.2 for frontend Axios's https-proxy-agent 5.0.1 closure).

Both component roots: this exact final command **exit 0**, “up to date”:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin npm install --package-lock-only --offline --cache /Users/zordon/.hermes/kanban/workspaces/t_3ae3ac28/recovery-run/npm-cache-g --ignore-scripts --no-audit --no-fund --logs-dir=/tmp/revv-g2-npm-logs
```

Independent lock verification using npm Arborist loadVirtual and cached metadata:
backend **696 edges / 0 invalid**, frontend **870 edges / 0 invalid**, including present
optional peers. Verified **29 backend + 37 frontend changed nodes** against cached
registry integrity, URL and full immediate dependency/optional/peer/engine/platform
metadata; **2 backend + 6 frontend** nodes reused identical verified input-lock metadata.
Both dependencySecurity files pass `node --check` (exit 0). `git diff --check` passes.
No upgraded package was installed or executed locally. No new runtime test/build pass,
plain npm ci pass or fresh audit result is claimed. **HOST INSTALL pending.**
The supplied Phase G host receipt is **78/78 backend + 5/5 frontend**, on the prior
installed versions; historical sandbox loopback EPERM is not a host defect.

Input DISPOSITION.json SHA256:
`8986c291bf6e33fcf1fad70d4c3061c27047fed7d030dc13f3c786a7a97b62b4`.
This offline reconciliation covers all **50 package findings / 187 range occurrences /
135 unique IDs**. **165 occurrences no longer match; 22 still match.**
These are saved-range checks, not new audit vulnerability counts or independent exploit counts.
Saved October 9 audit: frontend 31 packages (1 low/12 moderate/17 high/1 critical),
backend 19 (1 low/6 moderate/11 high/1 critical); original audit exit codes unavailable.
A future genuine nonzero audit must remain nonzero and be reported as such.

## Scope evidence and remaining actions

- **H — HTTP/runtime:** `backend/src/app.js:20` uses numeric one-hop proxy trust;
  mapped-subnet critical precondition was absent historically and proxy-addr is now patched.
  Raw webhook parsing precedes JSON at `app.js:43-45` with 1mb limits. Host must verify
  real proxy ingress/spoof stripping and all parser/rate-limit regressions. Parser-private
  qs 6.15.3 retains two moderate ranges: inspect comma-parsing and parse→stringify
  reachability, or update a compatible body-parser parent when available. No blanket dismissal.
- **O/E — outbound/email:** Twilio's real backend Axios path is patched; no browser-exclusion
  claim for backend HTTP. Run synthetic signatures/consent suites without real sends.
  `backend/src/services/email.js:12-20,37-42` supplies server-owned SMTP options and
  from/to/subject/html, not caller-controlled transport/TLS/OAuth/List-* or attachment options.
  **Nodemailer 10 acceptance blocked on installed offline transport/recipient/privacy tests.**
  Stream/JSON tests do not establish SMTP/TLS credential-isolation behavior.
- **B — conditional browser exclusion:** historical real Rollup graph (receipt below) includes
  Firestore browser entry and excludes gRPC, protobufjs, websocket-driver, ws and undici.
  `frontend/src/lib/firebase.js`, `LeadCaptureForm.jsx` and `LeadsDashboard.jsx` use
  browser Firestore. Remaining **high gRPC** findings are conditional on that graph, no SSR/Node
  execution and no Node gRPC server/client use. Firestore's ~1.9.0 rejects proposed 1.13.6;
  no parent mismatch override. Repeat module-graph assertion after host install.
- **A — frontend Sentry BLOCKED:** `frontend/src/main.jsx` calls `src/lib/sentry.js`;
  browser SDK is reachable when enabled. GHSA-593m-55hh-j8gv needs a separate prototype
  pollution condition, but remains high and unremediated. Fetch missing localforage metadata
  and its discovered closure, finish the coherent v7 7.119.1 family, then run host gates.
- **R — Router:** `frontend/src/App.jsx:136` uses declarative BrowserRouter and
  `src/main.jsx` createRoot, so GHSA-337j-9hxr-rhxg's manual SSR hydration prerequisite
  is absent in this entry. GHSA-wrjc-x8rr-h8h6 remains unresolved: `Layout.jsx:118-123`
  sends stored revv_prev_path to navigate, with record-ID navigation elsewhere. Require
  a verified compatible backport or a separately scoped review/fix of all affected sinks.
  The actual Privacy-page navigation test only proves that source-owned link.
- **T — conditional trusted inputs:** Tailwind's `frontend/tailwind.config.js:4`
  content is checked-in index.html/src JS/JSX; PostCSS uses Tailwind/autoprefixer and no
  tenant CSS/globs. Remaining **high braces** and selector-parser ranges require these
  trusted inputs: reviewed repository/config, no untrusted contributions in credential-bearing
  builds, no tenant-controlled runtime pattern/CSS processing and no exposed build/watch server.
  Backend `package.json` and `railway.toml:6` run Node, not nodemon; nodemon dev defaults
  watch repository patterns. Host must confirm no untrusted operator watch/config inputs.
  Keep Tailwind3/nodemon3; no unsupported downgrade or blind major.
- **D — conditional tooling, patch still blocked:** Vite/esbuild servers process local build/test
  workflows, production serves static output through Express (`railway.toml:3`, app.js).
  No public Vitest mocker/interceptor plugin configured in `frontend/vite.config.js`.
  Fetch all missing esbuild platform metadata before root Vite 6.4.3; plugin-react 4.7.0
  admits ^6.0.0. That root can satisfy Vitest and remove the old nested Vite8 path while
  retaining a valid private esbuild resolution. Until then all remaining Vite/esbuild
  ranges stay explicit, conditional on no public dev/preview/test server or untrusted inputs.
  ws/undici consumers are happy-dom/jsdom; use only synthetic/local fixtures.
- **U — conditional UUID:** backend UUID imports use v4() string-returning APIs
  (`routes/auth.js:6,55`, `routes/portal.js:248` and recorded source scan), not
  the advisory's v3/v5/v6 caller-buffer APIs. Keep 9.0.1 and recheck on API/buffer changes.

## Current 50-package matrix

Paths are component-relative lock paths. “Remediated” means no current node matches
that saved ID's ranges, pending host validation. IDs inherited through meta-via packages
are evaluated at their actual descendant, not at a parent's unrelated version.
All remaining range details follow the matrix. H/O/E/B/A/R/T/D/U refer to evidence above.

| Component / package (saved severity) | Exact current nodes | Remediated IDs | Remaining IDs | Disposition / gate |
| --- | --- | --- | --- | --- |
| frontend / **@babel/core** (low) | `node_modules/@babel/core@7.29.6` | `GHSA-4x5r-pxfx-6jf8` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **@grpc/grpc-js** (high) | `node_modules/@grpc/grpc-js@1.9.15` | — | `GHSA-5375-pq7m-f5r2`, `GHSA-99f4-grh7-6pcq`, `GHSA-m9gg-hp2v-232j`, `GHSA-f596-whhp-79r4` | B: conditional browser exclusion; host graph |
| frontend / **@protobufjs/utf8** (moderate) | `node_modules/protobufjs/node_modules/@protobufjs/utf8@1.1.1` | `GHSA-q6x5-8v7m-xcrf` | — | B: patched; repeat host graph |
| frontend / **@remix-run/router** (moderate) | `node_modules/@remix-run/router@1.23.4` | `GHSA-2j2x-hqr9-3h42` | — | R: patched saved ranges; host Router tests |
| frontend / **@sentry/browser** (moderate) | `node_modules/@sentry/browser@7.105.0` | — | `GHSA-593m-55hh-j8gv` | A: BLOCKED missing metadata |
| frontend / **@sentry/react** (moderate) | `node_modules/@sentry/react@7.105.0` | — | `GHSA-593m-55hh-j8gv` | A: BLOCKED missing metadata |
| frontend / **@vitest/mocker** (moderate) | `node_modules/vitest/node_modules/@vitest/mocker@4.1.11` | `GHSA-82fw-gwwq-j7x9` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **axios** (high) | `node_modules/axios@1.20.0` | `GHSA-3p68-rc4w-qgx5`, `GHSA-w9j2-pvgh-6h63`, `GHSA-pmwg-cvhr-8vh7`, `GHSA-3w6x-2g7m-8v23`, `GHSA-xhjh-pmcv-23jw`, `GHSA-445q-vr5w-6q77`, `GHSA-m7pr-hjqh-92cm`, `GHSA-5c9x-8gcm-mpgx`, `GHSA-vf2m-468p-8v99`, `GHSA-pf86-5x62-jrwf`, `GHSA-6chq-wfr3-2hj9`, `GHSA-xx6v-rp6x-q39c`, `GHSA-q8qp-cvcw-x6jj`, `GHSA-fvcv-3m26-pcqx`, `GHSA-62hf-57xw-28j9`, `GHSA-hfxv-24rg-xrqf`, `GHSA-777c-7fjr-54vf`, `GHSA-p92q-9vqr-4j8v`, `GHSA-j5f8-grm9-p9fc`, `GHSA-3g43-6gmg-66jw`, `GHSA-35jp-ww65-95wh`, `GHSA-898c-q2cr-xwhg`, `GHSA-mmx7-hfxf-jppx`, `GHSA-pmv8-rq9r-6j72`, `GHSA-mwf2-3pr3-8698`, `GHSA-7q8q-rj6j-mhjq`, `GHSA-jqh4-m9w3-8hp9`, `GHSA-42h9-826w-cgv3`, `GHSA-vh66-26gq-q6x8`, `GHSA-9fr6-4gfg-395g`, `GHSA-3pq3-5fj3-cg6v`, `GHSA-542g-h47m-68v8`, `GHSA-j8rh-479h-cp32`, `GHSA-4hqw-qxg8-jxx2` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **baseline-browser-mapping** (moderate) | `node_modules/browserslist/node_modules/baseline-browser-mapping@2.11.0` | `GHSA-w5vr-8v7q-w6rv` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **braces** (high) | `node_modules/braces@3.0.3` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **browserslist** (high) | `node_modules/browserslist@4.28.7` | `GHSA-c83g-rgw3-j3cx`, `GHSA-73wf-gq98-2v4g` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **chokidar** (high) | `node_modules/chokidar@3.6.0` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **esbuild** (moderate) | `node_modules/vite/node_modules/esbuild@0.21.5` | — | `GHSA-67mh-4wv8-2f99` | D: missing platform metadata; conditional server exposure |
| frontend / **fast-glob** (high) | `node_modules/fast-glob@3.3.3` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **follow-redirects** (moderate) | `node_modules/follow-redirects@1.16.0` | `GHSA-r4q5-vmmm-2653` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **form-data** (high) | `node_modules/form-data@4.0.6` | `GHSA-hmw2-7cc7-3qxx` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **micromatch** (high) | `node_modules/micromatch@4.0.8` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **nanoid** (high) | `node_modules/postcss/node_modules/nanoid@3.3.18` | `GHSA-28wg-ghj8-5hjv`, `GHSA-2v37-7h3g-55p8`, `GHSA-xwg4-73v4-xw9w` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **picomatch** (high) | `node_modules/picomatch@2.3.2`<br>`node_modules/tinyglobby/node_modules/picomatch@4.0.4`<br>`node_modules/vitest/node_modules/picomatch@4.0.4` | `GHSA-3v7f-55p6-f55p`, `GHSA-c2c7-rcm5-vvqj` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **postcss** (high) | `node_modules/postcss@8.5.23` | `GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-fxqj-rqcc-2cmp`, `GHSA-r28c-9q8g-f849` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **postcss-selector-parser** (moderate) | `node_modules/postcss-selector-parser@6.1.3` | `GHSA-w9m9-85wc-3x92` | `GHSA-rj75-hqrm-r3gf` | T: conditional trusted patterns/CSS |
| frontend / **protobufjs** (high) | `node_modules/protobufjs@7.6.5` | `GHSA-66ff-xgx4-vchm`, `GHSA-2pr8-phx7-x9h3`, `GHSA-fx83-v9x8-x52w`, `GHSA-75px-5xx7-5xc7`, `GHSA-jvwf-75h9-cwgg`, `GHSA-685m-2w69-288q`, `GHSA-q6x5-8v7m-xcrf`, `GHSA-jggg-4jg4-v7c6`, `GHSA-wcpc-wj8m-hjx6`, `GHSA-f38q-mgvj-vph7`, `GHSA-j3f2-48v5-ccww` | — | B: patched; repeat host graph |
| frontend / **react-router** (moderate) | `node_modules/react-router@6.30.6` | `GHSA-2j2x-hqr9-3h42` | `GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg` | R: residual navigation/SSR conditions |
| frontend / **react-router-dom** (moderate) | `node_modules/react-router-dom@6.30.6` | `GHSA-jjmj-jmhj-qwj2`, `GHSA-2j2x-hqr9-3h42` | `GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg` | R: residual navigation/SSR conditions |
| frontend / **source-map-js** (high) | `node_modules/source-map-js@1.2.2` | `GHSA-68fv-2mgg-jv7q` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **tailwindcss** (high) | `node_modules/tailwindcss@3.4.19` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **undici** (high) | `node_modules/undici@7.29.1` | `GHSA-vmh5-mc38-953g`, `GHSA-p88m-4jfj-68fv`, `GHSA-vxpw-j846-p89q`, `GHSA-hm92-r4w5-c3mj`, `GHSA-g8m3-5g58-fq7m`, `GHSA-pr7r-676h-xcf6`, `GHSA-8xcm-r25x-g524`, `GHSA-4cwx-7wf7-3272`, `GHSA-m8rv-5g2x-5cg5`, `GHSA-jr45-8vmc-qm54`, `GHSA-v3r7-h72x-cjcm`, `GHSA-35p6-xmwp-9g52`, `GHSA-pmjh-fq2x-6v4x`, `GHSA-r53p-7pc4-xj5r`, `GHSA-rfgv-xxqx-mfg5`, `GHSA-3xpg-4rpp-hhhm`, `GHSA-2jfj-6hjv-fm6j`, `GHSA-2gqq-gqf2-x968`, `GHSA-w293-vg96-wgc3`, `GHSA-8436-99hf-9mmv`, `GHSA-rx4f-c7p8-82vq` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **vite** (high) | `node_modules/vite@5.4.21`<br>`node_modules/vitest/node_modules/vite@8.0.3` | — | `GHSA-4w7w-66w2-5vf9`, `GHSA-v2wj-q39q-566r`, `GHSA-p9ff-h696-f583`, `GHSA-v6wh-96g9-6wx3`, `GHSA-fx2h-pf6j-xcff`, `GHSA-67mh-4wv8-2f99` | D: missing platform metadata; conditional server exposure |
| frontend / **vitest** (moderate) | `node_modules/vitest@4.1.11` | `GHSA-82fw-gwwq-j7x9` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| frontend / **websocket-driver** (critical) | `node_modules/websocket-driver@0.7.5` | `GHSA-mp7j-qc5w-4988`, `GHSA-xv26-6w52-cph6` | — | B: patched; repeat host graph |
| frontend / **ws** (high) | `node_modules/ws@8.21.0` | `GHSA-58qx-3vcg-4xpx`, `GHSA-96hv-2xvq-fx4p` | — | A/T/D: patched saved ranges; HOST INSTALL/tests |
| backend / **@vitest/mocker** (moderate) | `node_modules/@vitest/mocker@4.1.11` | `GHSA-82fw-gwwq-j7x9` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **axios** (high) | `node_modules/axios@1.20.0` | `GHSA-3p68-rc4w-qgx5`, `GHSA-w9j2-pvgh-6h63`, `GHSA-pmwg-cvhr-8vh7`, `GHSA-3w6x-2g7m-8v23`, `GHSA-xhjh-pmcv-23jw`, `GHSA-445q-vr5w-6q77`, `GHSA-m7pr-hjqh-92cm`, `GHSA-5c9x-8gcm-mpgx`, `GHSA-vf2m-468p-8v99`, `GHSA-pf86-5x62-jrwf`, `GHSA-6chq-wfr3-2hj9`, `GHSA-xx6v-rp6x-q39c`, `GHSA-q8qp-cvcw-x6jj`, `GHSA-fvcv-3m26-pcqx`, `GHSA-62hf-57xw-28j9`, `GHSA-hfxv-24rg-xrqf`, `GHSA-777c-7fjr-54vf`, `GHSA-p92q-9vqr-4j8v`, `GHSA-j5f8-grm9-p9fc`, `GHSA-3g43-6gmg-66jw`, `GHSA-35jp-ww65-95wh`, `GHSA-898c-q2cr-xwhg`, `GHSA-mmx7-hfxf-jppx`, `GHSA-pmv8-rq9r-6j72`, `GHSA-mwf2-3pr3-8698`, `GHSA-7q8q-rj6j-mhjq`, `GHSA-jqh4-m9w3-8hp9`, `GHSA-42h9-826w-cgv3`, `GHSA-vh66-26gq-q6x8`, `GHSA-9fr6-4gfg-395g`, `GHSA-3pq3-5fj3-cg6v`, `GHSA-542g-h47m-68v8`, `GHSA-j8rh-479h-cp32`, `GHSA-4hqw-qxg8-jxx2` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **body-parser** (low) | `node_modules/express/node_modules/body-parser@1.20.6` | `GHSA-v422-hmwv-36x6` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **brace-expansion** (high) | `node_modules/brace-expansion@5.0.12` | `GHSA-jxxr-4gwj-5jf2`, `GHSA-3jxr-9vmj-r5cp`, `GHSA-mh99-v99m-4gvg`, `GHSA-rgw5-rvv9-x895`, `GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, `GHSA-6j4f-fj2g-mc7p` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **braces** (high) | `node_modules/braces@3.0.3` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| backend / **chokidar** (high) | `node_modules/chokidar@3.6.0` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| backend / **express-rate-limit** (moderate) | `node_modules/express-rate-limit@8.7.1` | `GHSA-v2v4-37r5-5v8g`, `GHSA-mwp4-54f8-5fhr`, `GHSA-rpw4-54j3-4h4q`, `GHSA-j6r3-76f7-8jcv`, `GHSA-h3mg-xc3c-68pw` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **follow-redirects** (moderate) | `node_modules/axios/node_modules/follow-redirects@1.16.0` | `GHSA-r4q5-vmmm-2653` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **form-data** (high) | `node_modules/axios/node_modules/form-data@4.0.6` | `GHSA-hmw2-7cc7-3qxx` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **ip-address** (high) | `node_modules/ip-address@10.7.1` | `GHSA-v2v4-37r5-5v8g`, `GHSA-mwp4-54f8-5fhr`, `GHSA-rpw4-54j3-4h4q`, `GHSA-j6r3-76f7-8jcv`, `GHSA-h3mg-xc3c-68pw` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **nanoid** (high) | `node_modules/postcss/node_modules/nanoid@3.3.18` | `GHSA-28wg-ghj8-5hjv`, `GHSA-2v37-7h3g-55p8` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **nodemailer** (high) | `node_modules/nodemailer@10.0.6` | `GHSA-vvjj-xcjg-gr5g`, `GHSA-268h-hp4c-crq3`, `GHSA-wqvq-jvpq-h66f`, `GHSA-p6gq-j5cr-w38f`, `GHSA-8m3c-c648-2xjj`, `GHSA-wmmp-3585-3rmp`, `GHSA-2x7j-588g-ccc2`, `GHSA-cc9r-2j5m-2m83`, `GHSA-6vj9-mwq6-2f5v`, `GHSA-8vvx-rff5-p5rq`, `GHSA-v53p-9fqp-m79j`, `GHSA-r7g4-qg5f-qqm2` | — | E: candidate ONLY; installed transport/privacy gate |
| backend / **nodemon** (high) | `node_modules/nodemon@3.1.14` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| backend / **postcss** (high) | `node_modules/postcss@8.5.23` | `GHSA-fxqj-rqcc-2cmp`, `GHSA-r28c-9q8g-f849` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **proxy-addr** (critical) | `node_modules/proxy-addr@2.0.8` | `GHSA-jqcg-44mw-7w3h` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **qs** (moderate) | `node_modules/express/node_modules/body-parser/node_modules/qs@6.15.3`<br>`node_modules/qs@6.16.0` | `GHSA-q8mj-m7cp-5q26` | `GHSA-x5fp-wj9c-mxmx`, `GHSA-4mjr-xmp4-gh2g` | H: residual parser-private qs; parent/exposure action |
| backend / **source-map-js** (high) | `node_modules/source-map-js@1.2.2` | `GHSA-68fv-2mgg-jv7q` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |
| backend / **uuid** (moderate) | `node_modules/uuid@9.0.1` | — | `GHSA-w5hq-g745-h8pq` | U: conditional v4-only API |
| backend / **vitest** (moderate) | `node_modules/vitest@4.1.11` | `GHSA-82fw-gwwq-j7x9` | — | H/O/D: patched saved ranges; HOST INSTALL/tests |

## All remaining advisory ranges (22 occurrences)

| Component / package | Advisory / severity | Exact affected range | Matching current nodes |
| --- | --- | --- | --- |
| frontend / @grpc/grpc-js | [GHSA-5375-pq7m-f5r2](https://github.com/advisories/GHSA-5375-pq7m-f5r2) (high) | `<1.9.16` | `node_modules/@grpc/grpc-js@1.9.15` |
| frontend / @grpc/grpc-js | [GHSA-99f4-grh7-6pcq](https://github.com/advisories/GHSA-99f4-grh7-6pcq) (high) | `<1.9.16` | `node_modules/@grpc/grpc-js@1.9.15` |
| frontend / @grpc/grpc-js | [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j) (high) | `<1.13.6` | `node_modules/@grpc/grpc-js@1.9.15` |
| frontend / @grpc/grpc-js | [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) (low) | `<1.13.6` | `node_modules/@grpc/grpc-js@1.9.15` |
| frontend / @sentry/browser | [GHSA-593m-55hh-j8gv](https://github.com/advisories/GHSA-593m-55hh-j8gv) (moderate) | `<7.119.1` | `node_modules/@sentry/browser@7.105.0` |
| frontend / braces | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (high) | `<=3.0.3` | `node_modules/braces@3.0.3` |
| frontend / esbuild | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) (moderate) | `<=0.24.2` | `node_modules/vite/node_modules/esbuild@0.21.5` |
| frontend / postcss-selector-parser | [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) (moderate) | `<7.1.6` | `node_modules/postcss-selector-parser@6.1.3` |
| frontend / react-router | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) (moderate) | `>=6.0.0 <7.18.0` | `node_modules/react-router@6.30.6` |
| frontend / react-router | [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) (moderate) | `>=6.4.0 <7.18.0` | `node_modules/react-router@6.30.6` |
| frontend / vite | [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) (moderate) | `<=6.4.1` | `node_modules/vite@5.4.21` |
| frontend / vite | [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) (moderate) | `>=8.0.0 <=8.0.4` | `node_modules/vitest/node_modules/vite@8.0.3` |
| frontend / vite | [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r) (high) | `>=8.0.0 <=8.0.4` | `node_modules/vitest/node_modules/vite@8.0.3` |
| frontend / vite | [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) (high) | `>=8.0.0 <=8.0.4` | `node_modules/vitest/node_modules/vite@8.0.3` |
| frontend / vite | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) (moderate) | `<=6.4.2` | `node_modules/vite@5.4.21` |
| frontend / vite | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) (moderate) | `>=8.0.0 <=8.0.15` | `node_modules/vitest/node_modules/vite@8.0.3` |
| frontend / vite | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) (high) | `<=6.4.2` | `node_modules/vite@5.4.21` |
| frontend / vite | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) (high) | `>=8.0.0 <=8.0.15` | `node_modules/vitest/node_modules/vite@8.0.3` |
| backend / braces | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (high) | `<=3.0.3` | `node_modules/braces@3.0.3` |
| backend / qs | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) (moderate) | `>=6.14.2 <=6.15.3` | `node_modules/express/node_modules/body-parser/node_modules/qs@6.15.3` |
| backend / qs | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) (moderate) | `>=2.2.5 <6.16.0` | `node_modules/express/node_modules/body-parser/node_modules/qs@6.15.3` |
| backend / uuid | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) (moderate) | `<11.1.1` | `node_modules/uuid@9.0.1` |

## Exact missing-cache request

Missing metadata below blocks only the rolled-back Sentry/Vite groups. The first failed
closure edges were localforage@^1.8.1 and @esbuild/aix-ppc64@0.25.0; enumerating esbuild's
verified optionalDependencies identifies all 25 missing platform names, not just this host's
binary. Esbuild 0.25.0 satisfies Vite 6.4.3's ^0.25.0 and exits the saved <=0.24.2 range.
No platform edge or integrity was fabricated or omitted. Additional localforage descendants
are unknown until its metadata is supplied. Host may choose a verified newer compatible
esbuild with its complete platform family; this request records the actual attempted closure.
The sibling registry-g directory is outside this session's writable roots, so MISSING.json
was not written there; this table contains the complete request without a sandbox bypass.

| Metadata package | Required range/version | Consumer |
| --- | --- | --- |
| `localforage` | `^1.8.1` | @sentry/integrations@7.119.1 |
| `@esbuild/aix-ppc64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-arm` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-x64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/sunos-x64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/win32-x64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/darwin-x64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-ia32` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/netbsd-x64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/win32-ia32` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/android-arm` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/android-x64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/freebsd-x64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-arm64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-ppc64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-s390x` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/openbsd-x64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/win32-arm64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/darwin-arm64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/netbsd-arm64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/android-arm64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/freebsd-arm64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-loong64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-riscv64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/openbsd-arm64` | `0.25.0` | esbuild@0.25.0 |
| `@esbuild/linux-mips64el` | `0.25.0` | esbuild@0.25.0 |

## Historical Phase G graph evidence (not a G2 execution)

Node22/Vite 5.4.21, envDir=false, write=false, existing vite.config.js, real Rollup
getModuleIds()/chunk.modules traversal: 1871 resolved / 377 emitted modules, exit 0.
Sorted project-relative module-ID SHA256:
`5e0850054c54e03bcacdc05535cf4f3e5356874e5a0709674f3f62f96bc355bc`.
Firestore `dist/index.esm.js` and `dist/common-fe7037b3.esm.js`, app/component/logger/util
and webchannel browser modules were included. Node gRPC/protobuf/WebSocket transports,
Node Axios adapter, form-data and follow-redirects were absent. Axios had 50 resolved/emitted
modules; Router/DOM/remix one each. Sentry browser/react resolved 22/10 modules but emitted
zero under the empty synthetic DSN; this does not prove exclusion for an enabled production
SDK. Repeat with host-approved configuration without exposing values. This historical
graph supports conditional exposure only and cannot validate changed G2 packages.

Existing tests exercise real proxy-addr, IPv6 rate-limit keys, bounded loopback Express
forwarding/rate limiting/JSON400/413/form parameter limits/raw bytes; real Nodemailer
stream/JSON/recipient/privacy APIs and synthetic Twilio signature rejection. Frontend
uses real Axios transforms/XHR/interceptors for auth/error/multipart and actual Privacy
Router navigation with only network primitives mocked. These tests remain host gates.

## Hermes completion gate

1. Supply missing metadata, complete Sentry/Vite closures, reassess remaining Router/qs
   actions and conditional exposure. No insecure-green claim; keep true nonzero audit results.
2. Plain `npm ci` in both roots on Node22 (no force/legacy peers), inspect installed tree
   against locks, then run both dependencySecurity suites and email.production tests.
   Accept Nodemailer 10 only after actual installed offline transport/recipient/privacy checks.
3. Run all backend Node tests with disposable PostgreSQL, all 7 parser tests, all frontend
   tests, production build, real browser module graph and relevant browser QA. Preserve A–F.
4. Verify ingress proxy, trusted build/watch inputs and nonpublic tool-server conditions;
   re-evaluate saved ranges and record genuine host audit outcomes.
5. Hermes commits the scoped candidate, records exact SHA/gate receipts and routes independent
   review. No new SHA, independent review, shipping or runtime acceptance is claimed here.
