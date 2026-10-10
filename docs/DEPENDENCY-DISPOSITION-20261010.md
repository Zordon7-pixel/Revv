# Phase G5 dependency disposition — t_3ae3ac28

2026-10-10. **Scoped uncommitted two-file completion; nested Vite cache blocker resolved.
Not security clean; final installed-graph/full-suite acceptance pending.**
Base: `7fb862b09a519dd4f713bc3a28421a64da239340`, branch
`codex/revv-all-issues-recovery-20261007`, supplied `recovery-run/source`.
Only `frontend/package-lock.json` and this document change in G5. All committed
G2/G3/Codex source, manifests and tests are preserved. The existing 38-issue recovery
scope and original A–F requirements remain. Hermes owns board, commits, host gates,
exact-SHA review and shipping. This is security-sensitive dependency work; G5 is two
files, while the prior G3 navigation/dependency candidate exceeded two files.
The supplied full-scope Spark result explicitly failed `empty_or_excessive_review_scope`;
no advisory PASS or reviewer verdict is claimed and no review was requested here.

## Current result and evidence

- Supplied host G2 receipt: ordinary `npm ci` **both roots PASS**; **78 backend + 5
  frontend PASS on actual upgraded dependencies**, including Nodemailer **10.0.6**
  offline transports/service/recipient/privacy checks. Installed G2 includes Express
  **4.22.3**, rate-limit **8.7.1**, Axios **1.20.0**, Router **6.30.6**, Vitest **4.1.11**.
- Supplied host G3 continuation receipt: ordinary `npm ci` **PASS**; actual **13 backend
  + 47 frontend PASS**, including **42 Layout navigation + 5 dependency tests**;
  source committed at the base above. These supersede the prior G3 stale-install-only
  wording. They do not validate the new G5 nested Vite install. Final full suite pending.
- Last recorded pre-G3 fresh-ci audits: backend **7 (4 moderate, 3 high)**; frontend
  **14 (7 moderate, 7 high)**. No fresh G5 audit was run; saved-range reconciliation
  below is not a new audit and does not assert that the final graph is security clean.
- Preserved G3 lock: coherent Sentry **7.119.1**, including integrations/localforage
  **1.8.1 → lie 3.1.1 → immediate 3.0.6**; root Vite **6.4.3**, private esbuild
  **0.25.0**, all 25 esbuild platform packages and plugin-react **4.7.0**.
- G5 upgrades only nested Vitest Vite **8.0.3 → 8.0.16** and its required closure:
  **rolldown 1.0.3**, all **15** optional platform bindings (including WASM),
  `@oxc-project/types` **0.133.0**, pluginutils **1.0.1**, emnapi core/runtime **1.10.0**,
  wasi-threads **1.2.1**, and compatible reused wasm-runtime **1.1.6**, wasm-util
  **0.10.3**, tslib **2.8.1**. The selected full Rolldown closure is **24 nodes**.
  New Vite also resolves tinyglobby **0.2.17** with fdir **6.5.0**. No manifest,
  override, incompatible range, existing-package downgrade or unrelated upgrade.
  npm normalization removed **22 obsolete nodes** from the old Rolldown closure.
- Validation command `/opt/homebrew/opt/node@22/bin/node node_modules/.cache/g5/check.cjs`
  exited **0**: cached registry dist/integrity and dependency/optional/peer/engine/
  platform metadata checked for **26 changed nodes**; npm Arborist `loadVirtual`
  **891 edges, 0 invalid**, including **82 resolved optional dependency edges**.
  **36 absent optional peers** are permitted; no required/optional dependency omitted.
  Evidence: task-local ignored `node_modules/.cache/g5/verification.json`.
- Peer/engine graph: plugin-react **4.7.0** accepts root Vite **6.4.3**; Vitest/mocker
  **4.1.11** accept nested Vite **8.0.16**. Root Vite's `esbuild ^0.25.0` resolves
  its private **0.25.0**; nested Vite's optional esbuild peer `^0.27.0 || ^0.28.0`
  is absent, not incorrectly satisfied by root Vite's private esbuild. Node **22.23.2**
  satisfies the Vite8/Rolldown engine floor.
- Offline lock normalization on isolated manifest/lock copies, with no installed tree,
  exited **0**, tail **“up to date in 237ms”**:
  `npm install --prefix "$PWD/node_modules/.cache/g5" --package-lock-only --offline
  --ignore-scripts --no-audit --no-fund --cache "$PWD/node_modules/.cache/g5/npm"
  --logs-dir="$PWD/node_modules/.cache/g5/logs"`.
  Used Node **22.23.2** / npm **10.9.8**, sanitized `env -i` PATH and task-local TMPDIR.
  npm10 serialization drops six published Linux binding `libc` selectors; the final
  lock restores those exact cached selectors and otherwise equals normalized output.
  Scripts/network were disabled; all temporary files are under ignored task cache.
- `git diff --check` passes. No G5 runtime tests were run against stale node_modules;
  final fresh install, audit, full tests, build, module graph and browser QA remain Hermes
  gates. No commit, board update, provider operation, push or deployment was performed.

Saved `DISPOSITION.json` SHA256:
`8986c291bf6e33fcf1fad70d4c3061c27047fed7d030dc13f3c786a7a97b62b4`.
All **50 rows / 187 saved range occurrences / 135 unique IDs** refreshed with npm semver,
including recursive meta-via descendants: **175 occurrences no longer match, 12 still
match**. G3 was **170/17**; G5 clears all five nested Vite8 saved ranges. These counts
are saved-range reconciliation, not a live audit. Package meta-via rows can share these
occurrences; counts are not independent exploits.

## Source bounds and remaining conditions

- **H — HTTP/parser:** `backend/src/app.js:20` trusts one proxy hop; host ingress/spoof
  stripping remains a deployment check. Raw webhook middleware at `app.js:43-44`
  precedes JSON with a 1mb limit at line45. Root qs **6.16.0** is patched, but Express's
  body-parser **1.20.6** requires `qs ~6.15.1`, leaving private **6.15.3**; no incompatible
  override. GHSA-x5fp-wj9c-mxmx concerns `comma: true` bracket keys bypassing `arrayLimit`/
  `throwOnLimitExceeded`. GHSA-4mjr-xmp4-gh2g concerns parse (`plainObjects: true` or
  `allowPrototypes: true`) → stringify with non-callable `constructor.isBuffer`.
  Source scan finds no direct qs parse/stringify round-trip or comma option; SMS
  `routes/sms.js:220` uses `express.urlencoded({ extended: false })`. Those specific
  options/round-trips are outside known app seams, not universally unreachable; retain
  both ranges and recheck consumers/options or compatible parent updates.
- **O/E — outbound/email:** backend Twilio Axios is patched; browser exclusion does not
  apply. `services/email.js:12-20,37-42` supplies server-owned SMTP options and
  from/to/subject/html, not caller-controlled transport/TLS/OAuth/List-* or attachments.
  G2 installed offline service/recipient/privacy acceptance passed; this does not prove
  live SMTP/TLS credential isolation. No real send/provider operation was performed.
- **B — conditional browser exclusion:** `frontend/src/lib/firebase.js`,
  `LeadCaptureForm.jsx`, `LeadsDashboard.jsx` use browser Firestore. Historical real
  Rollup graph below excluded Node gRPC/protobuf/WebSocket transports. Remaining gRPC
  ranges depend on that exclusion, no SSR/Node execution and no gRPC server/client use.
  Firestore `~1.9.0` rejects 1.13.6; no parent override. Host must recheck actual final graph.
- **A — Sentry:** `frontend/src/main.jsx → src/lib/sentry.js` enables the browser SDK
  when configured. The coherent 7.119.1 lock exits GHSA-593m-55hh-j8gv's saved range;
  G3 host targeted tests passed; final full runtime/build acceptance remains pending.
  Empty synthetic DSN graph is not SDK exclusion.
- **R — Router scoped mitigation:** Router/DOM **6.30.6 remains inside both saved ranges**.
  `Layout.jsx` now validates `sessionStorage.revv_prev_path` immediately before navigate:
  single-root local destination, at most 8192 characters, no external/protocol-relative
  URL, backslash, raw whitespace/control characters, encoded controls/backslashes,
  malformed escapes or URL-normalized authority-like path. Valid original pathname,
  query/hash and encoded spaces/Unicode remain unchanged; fallback stays `/dashboard`.
  Tests render actual Layout/Router, click both real back controls, and assert final
  location for safe and malicious storage values. Auth, tenant rules and dirty-editor
  behavior are untouched. This mitigates this seam; **GHSA-wrjc-x8rr-h8h6 is not package
  patched or wholly cleared**. `App.jsx:136` declarative BrowserRouter and `main.jsx`
  createRoot lack GHSA-337j-9hxr-rhxg's manual SSR hydration prerequisite.
  Remaining Link/NavLink/Navigate/navigate scan: Layout's `allNav` and OwnerKpis KpiLink
  callers use local literals; Dashboard `item.path` is built at lines150/161/172 as
  `/ros/${ro.id}` with fixed tabs, not an API path field. NotificationBell:89,
  CommandPalette:85, record/detail/inspection/editor pages prefix IDs with `/ros/`,
  `/inspection/` or `/estimate-builder/`; filters use fixed `/ros?…` prefixes and
  ShopProfile:41 encodes slug after `/book?shop=`. Auth/public redirects are literals.
  No additional arbitrary full-destination Router seam was found in this source scan;
  interpolated record values are not a general sanitizer proof. Reassess on new sinks.
- **T — trusted input conditions:** frontend Tailwind3 → fast-glob/micromatch → braces
  **3.0.3**, and chokidar; backend nodemon3 → chokidar3 → braces
  **3.0.3** retain GHSA-vfj7-8cjw-p6xm. `frontend/tailwind.config.js:4` scans checked-in
  index.html/src JS/JSX; PostCSS uses Tailwind/autoprefixer, no tenant CSS/globs.
  Selector-parser **6.1.3** retains `<7.1.6`. Backend package start and `railway.toml:6`
  run Node, not nodemon. Require reviewed repo/config and trusted build/watch patterns,
  no untrusted contribution processing with credentials, no exposed build/watch servers,
  no tenant-controlled pattern/CSS processing; recheck operator watch configuration.
- **D — tooling:** static production output is served by Express; no public Vitest
  mocker/interceptor plugin is configured in `frontend/vite.config.js`. Root Vite/esbuild
  and nested Vite8 saved ranges are patched in the final lock; G5 installed-graph
  acceptance remains pending. Remaining
  tooling exposure is conditional on no public dev/preview/test server and trusted inputs.
  ws/undici consumers happy-dom/jsdom must use synthetic/local fixtures.
- **U — UUID:** backend **9.0.1** stays in `<11.1.1`; `routes/auth.js:6,55`,
  `routes/portal.js:248` and source scan use string-returning v4(), not advisory
  v3/v5/v6 caller-buffer APIs. Keep the explicit v4-only condition; recheck API/buffer changes.

## Current 50-package matrix

Paths are component-relative lock paths. “Remediated” means no current node matches
that saved ID's ranges, pending host validation. IDs inherited through meta-via packages
are evaluated at their actual descendant, not at a parent's unrelated version.
All remaining range details follow the matrix. H/O/E/B/A/R/T/D/U refer to evidence above.

| Component / package (saved severity) | Exact current nodes | Remediated IDs | Remaining IDs | Disposition / gate |
| --- | --- | --- | --- | --- |
| frontend / **@babel/core** (low) | `node_modules/@babel/core@7.29.6` | `GHSA-4x5r-pxfx-6jf8` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **@grpc/grpc-js** (high) | `node_modules/@grpc/grpc-js@1.9.15` | — | `GHSA-5375-pq7m-f5r2`, `GHSA-99f4-grh7-6pcq`, `GHSA-m9gg-hp2v-232j`, `GHSA-f596-whhp-79r4` | B: conditional browser exclusion; host graph |
| frontend / **@protobufjs/utf8** (moderate) | `node_modules/protobufjs/node_modules/@protobufjs/utf8@1.1.1` | `GHSA-q6x5-8v7m-xcrf` | — | B: patched; repeat host graph |
| frontend / **@remix-run/router** (moderate) | `node_modules/@remix-run/router@1.23.4` | `GHSA-2j2x-hqr9-3h42` | — | R: patched saved ranges; host Router tests |
| frontend / **@sentry/browser** (moderate) | `node_modules/@sentry/browser@7.119.1` | `GHSA-593m-55hh-j8gv` | — | A: lock patched; host install/tests |
| frontend / **@sentry/react** (moderate) | `node_modules/@sentry/react@7.119.1` | `GHSA-593m-55hh-j8gv` | — | A: lock patched; host install/tests |
| frontend / **@vitest/mocker** (moderate) | `node_modules/vitest/node_modules/@vitest/mocker@4.1.11` | `GHSA-82fw-gwwq-j7x9` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **axios** (high) | `node_modules/axios@1.20.0` | `GHSA-3p68-rc4w-qgx5`, `GHSA-w9j2-pvgh-6h63`, `GHSA-pmwg-cvhr-8vh7`, `GHSA-3w6x-2g7m-8v23`, `GHSA-xhjh-pmcv-23jw`, `GHSA-445q-vr5w-6q77`, `GHSA-m7pr-hjqh-92cm`, `GHSA-5c9x-8gcm-mpgx`, `GHSA-vf2m-468p-8v99`, `GHSA-pf86-5x62-jrwf`, `GHSA-6chq-wfr3-2hj9`, `GHSA-xx6v-rp6x-q39c`, `GHSA-q8qp-cvcw-x6jj`, `GHSA-fvcv-3m26-pcqx`, `GHSA-62hf-57xw-28j9`, `GHSA-hfxv-24rg-xrqf`, `GHSA-777c-7fjr-54vf`, `GHSA-p92q-9vqr-4j8v`, `GHSA-j5f8-grm9-p9fc`, `GHSA-3g43-6gmg-66jw`, `GHSA-35jp-ww65-95wh`, `GHSA-898c-q2cr-xwhg`, `GHSA-mmx7-hfxf-jppx`, `GHSA-pmv8-rq9r-6j72`, `GHSA-mwf2-3pr3-8698`, `GHSA-7q8q-rj6j-mhjq`, `GHSA-jqh4-m9w3-8hp9`, `GHSA-42h9-826w-cgv3`, `GHSA-vh66-26gq-q6x8`, `GHSA-9fr6-4gfg-395g`, `GHSA-3pq3-5fj3-cg6v`, `GHSA-542g-h47m-68v8`, `GHSA-j8rh-479h-cp32`, `GHSA-4hqw-qxg8-jxx2` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **baseline-browser-mapping** (moderate) | `node_modules/browserslist/node_modules/baseline-browser-mapping@2.11.0` | `GHSA-w5vr-8v7q-w6rv` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **braces** (high) | `node_modules/braces@3.0.3` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **browserslist** (high) | `node_modules/browserslist@4.28.7` | `GHSA-c83g-rgw3-j3cx`, `GHSA-73wf-gq98-2v4g` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **chokidar** (high) | `node_modules/chokidar@3.6.0` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **esbuild** (moderate) | `node_modules/vite/node_modules/esbuild@0.25.0` | `GHSA-67mh-4wv8-2f99` | — | D: lock patched; host install/build |
| frontend / **fast-glob** (high) | `node_modules/fast-glob@3.3.3` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **follow-redirects** (moderate) | `node_modules/follow-redirects@1.16.0` | `GHSA-r4q5-vmmm-2653` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **form-data** (high) | `node_modules/form-data@4.0.6` | `GHSA-hmw2-7cc7-3qxx` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **micromatch** (high) | `node_modules/micromatch@4.0.8` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **nanoid** (high) | `node_modules/postcss/node_modules/nanoid@3.3.18` | `GHSA-28wg-ghj8-5hjv`, `GHSA-2v37-7h3g-55p8`, `GHSA-xwg4-73v4-xw9w` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **picomatch** (high) | `node_modules/picomatch@2.3.2`<br>`node_modules/tinyglobby/node_modules/picomatch@4.0.4`<br>`node_modules/vite/node_modules/picomatch@4.0.4`<br>`node_modules/vitest/node_modules/picomatch@4.0.4` | `GHSA-3v7f-55p6-f55p`, `GHSA-c2c7-rcm5-vvqj` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **postcss** (high) | `node_modules/postcss@8.5.23` | `GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-fxqj-rqcc-2cmp`, `GHSA-r28c-9q8g-f849` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **postcss-selector-parser** (moderate) | `node_modules/postcss-selector-parser@6.1.3` | `GHSA-w9m9-85wc-3x92` | `GHSA-rj75-hqrm-r3gf` | T: conditional trusted patterns/CSS |
| frontend / **protobufjs** (high) | `node_modules/protobufjs@7.6.5` | `GHSA-66ff-xgx4-vchm`, `GHSA-2pr8-phx7-x9h3`, `GHSA-fx83-v9x8-x52w`, `GHSA-75px-5xx7-5xc7`, `GHSA-jvwf-75h9-cwgg`, `GHSA-685m-2w69-288q`, `GHSA-q6x5-8v7m-xcrf`, `GHSA-jggg-4jg4-v7c6`, `GHSA-wcpc-wj8m-hjx6`, `GHSA-f38q-mgvj-vph7`, `GHSA-j3f2-48v5-ccww` | — | B: patched; repeat host graph |
| frontend / **react-router** (moderate) | `node_modules/react-router@6.30.6` | `GHSA-2j2x-hqr9-3h42` | `GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg` | R: residual navigation/SSR conditions |
| frontend / **react-router-dom** (moderate) | `node_modules/react-router-dom@6.30.6` | `GHSA-2j2x-hqr9-3h42`, `GHSA-jjmj-jmhj-qwj2` | `GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg` | R: residual navigation/SSR conditions |
| frontend / **source-map-js** (high) | `node_modules/source-map-js@1.2.2` | `GHSA-68fv-2mgg-jv7q` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **tailwindcss** (high) | `node_modules/tailwindcss@3.4.19` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| frontend / **undici** (high) | `node_modules/undici@7.29.1` | `GHSA-vmh5-mc38-953g`, `GHSA-p88m-4jfj-68fv`, `GHSA-vxpw-j846-p89q`, `GHSA-hm92-r4w5-c3mj`, `GHSA-g8m3-5g58-fq7m`, `GHSA-pr7r-676h-xcf6`, `GHSA-8xcm-r25x-g524`, `GHSA-4cwx-7wf7-3272`, `GHSA-m8rv-5g2x-5cg5`, `GHSA-jr45-8vmc-qm54`, `GHSA-v3r7-h72x-cjcm`, `GHSA-35p6-xmwp-9g52`, `GHSA-pmjh-fq2x-6v4x`, `GHSA-r53p-7pc4-xj5r`, `GHSA-rfgv-xxqx-mfg5`, `GHSA-3xpg-4rpp-hhhm`, `GHSA-2jfj-6hjv-fm6j`, `GHSA-2gqq-gqf2-x968`, `GHSA-w293-vg96-wgc3`, `GHSA-8436-99hf-9mmv`, `GHSA-rx4f-c7p8-82vq` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **vite** (high) | `node_modules/vite@6.4.3`<br>`node_modules/vitest/node_modules/vite@8.0.16` | `GHSA-67mh-4wv8-2f99`, `GHSA-4w7w-66w2-5vf9`, `GHSA-v2wj-q39q-566r`, `GHSA-p9ff-h696-f583`, `GHSA-v6wh-96g9-6wx3`, `GHSA-fx2h-pf6j-xcff` | — | D: both Vite saved ranges patched; final host install/graph |
| frontend / **vitest** (moderate) | `node_modules/vitest@4.1.11` | `GHSA-82fw-gwwq-j7x9` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| frontend / **websocket-driver** (critical) | `node_modules/websocket-driver@0.7.5` | `GHSA-mp7j-qc5w-4988`, `GHSA-xv26-6w52-cph6` | — | B: patched; repeat host graph |
| frontend / **ws** (high) | `node_modules/ws@8.21.0` | `GHSA-58qx-3vcg-4xpx`, `GHSA-96hv-2xvq-fx4p` | — | A/T/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **@vitest/mocker** (moderate) | `node_modules/@vitest/mocker@4.1.11` | `GHSA-82fw-gwwq-j7x9` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **axios** (high) | `node_modules/axios@1.20.0` | `GHSA-3p68-rc4w-qgx5`, `GHSA-w9j2-pvgh-6h63`, `GHSA-pmwg-cvhr-8vh7`, `GHSA-3w6x-2g7m-8v23`, `GHSA-xhjh-pmcv-23jw`, `GHSA-445q-vr5w-6q77`, `GHSA-m7pr-hjqh-92cm`, `GHSA-5c9x-8gcm-mpgx`, `GHSA-vf2m-468p-8v99`, `GHSA-pf86-5x62-jrwf`, `GHSA-6chq-wfr3-2hj9`, `GHSA-xx6v-rp6x-q39c`, `GHSA-q8qp-cvcw-x6jj`, `GHSA-fvcv-3m26-pcqx`, `GHSA-62hf-57xw-28j9`, `GHSA-hfxv-24rg-xrqf`, `GHSA-777c-7fjr-54vf`, `GHSA-p92q-9vqr-4j8v`, `GHSA-j5f8-grm9-p9fc`, `GHSA-3g43-6gmg-66jw`, `GHSA-35jp-ww65-95wh`, `GHSA-898c-q2cr-xwhg`, `GHSA-mmx7-hfxf-jppx`, `GHSA-pmv8-rq9r-6j72`, `GHSA-mwf2-3pr3-8698`, `GHSA-7q8q-rj6j-mhjq`, `GHSA-jqh4-m9w3-8hp9`, `GHSA-42h9-826w-cgv3`, `GHSA-vh66-26gq-q6x8`, `GHSA-9fr6-4gfg-395g`, `GHSA-3pq3-5fj3-cg6v`, `GHSA-542g-h47m-68v8`, `GHSA-j8rh-479h-cp32`, `GHSA-4hqw-qxg8-jxx2` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **body-parser** (low) | `node_modules/express/node_modules/body-parser@1.20.6` | `GHSA-v422-hmwv-36x6` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **brace-expansion** (high) | `node_modules/brace-expansion@5.0.12` | `GHSA-jxxr-4gwj-5jf2`, `GHSA-3jxr-9vmj-r5cp`, `GHSA-mh99-v99m-4gvg`, `GHSA-rgw5-rvv9-x895`, `GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, `GHSA-6j4f-fj2g-mc7p` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **braces** (high) | `node_modules/braces@3.0.3` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| backend / **chokidar** (high) | `node_modules/chokidar@3.6.0` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| backend / **express-rate-limit** (moderate) | `node_modules/express-rate-limit@8.7.1` | `GHSA-v2v4-37r5-5v8g`, `GHSA-mwp4-54f8-5fhr`, `GHSA-rpw4-54j3-4h4q`, `GHSA-j6r3-76f7-8jcv`, `GHSA-h3mg-xc3c-68pw` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **follow-redirects** (moderate) | `node_modules/axios/node_modules/follow-redirects@1.16.0` | `GHSA-r4q5-vmmm-2653` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **form-data** (high) | `node_modules/axios/node_modules/form-data@4.0.6` | `GHSA-hmw2-7cc7-3qxx` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **ip-address** (high) | `node_modules/ip-address@10.7.1` | `GHSA-v2v4-37r5-5v8g`, `GHSA-mwp4-54f8-5fhr`, `GHSA-rpw4-54j3-4h4q`, `GHSA-j6r3-76f7-8jcv`, `GHSA-h3mg-xc3c-68pw` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **nanoid** (high) | `node_modules/postcss/node_modules/nanoid@3.3.18` | `GHSA-28wg-ghj8-5hjv`, `GHSA-2v37-7h3g-55p8` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **nodemailer** (high) | `node_modules/nodemailer@10.0.9` | `GHSA-vvjj-xcjg-gr5g`, `GHSA-268h-hp4c-crq3`, `GHSA-wqvq-jvpq-h66f`, `GHSA-p6gq-j5cr-w38f`, `GHSA-8m3c-c648-2xjj`, `GHSA-wmmp-3585-3rmp`, `GHSA-2x7j-588g-ccc2`, `GHSA-cc9r-2j5m-2m83`, `GHSA-6vj9-mwq6-2f5v`, `GHSA-8vvx-rff5-p5rq`, `GHSA-v53p-9fqp-m79j`, `GHSA-r7g4-qg5f-qqm2` | — | E: G2 gates passed on 10.0.6; 10.0.9 host rerun pending; retain service bounds |
| backend / **nodemon** (high) | `node_modules/nodemon@3.1.14` | — | `GHSA-vfj7-8cjw-p6xm` | T: conditional trusted patterns/CSS |
| backend / **postcss** (high) | `node_modules/postcss@8.5.23` | `GHSA-fxqj-rqcc-2cmp`, `GHSA-r28c-9q8g-f849` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **proxy-addr** (critical) | `node_modules/proxy-addr@2.0.8` | `GHSA-jqcg-44mw-7w3h` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **qs** (moderate) | `node_modules/express/node_modules/body-parser/node_modules/qs@6.15.3`<br>`node_modules/qs@6.16.0` | `GHSA-q8mj-m7cp-5q26` | `GHSA-x5fp-wj9c-mxmx`, `GHSA-4mjr-xmp4-gh2g` | H: residual parser-private qs; parent/exposure action |
| backend / **source-map-js** (high) | `node_modules/source-map-js@1.2.2` | `GHSA-68fv-2mgg-jv7q` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |
| backend / **uuid** (moderate) | `node_modules/uuid@9.0.1` | — | `GHSA-w5hq-g745-h8pq` | U: conditional v4-only API |
| backend / **vitest** (moderate) | `node_modules/vitest@4.1.11` | `GHSA-82fw-gwwq-j7x9` | — | H/O/D: patched saved ranges; G2 host targeted pass; final full gates |


## All remaining advisory ranges (12 occurrences)

| Component / package | Advisory / severity | Exact affected range | Matching current nodes |
| --- | --- | --- | --- |
| frontend / @grpc/grpc-js | [GHSA-5375-pq7m-f5r2](https://github.com/advisories/GHSA-5375-pq7m-f5r2) (high) | `<1.9.16` | `node_modules/@grpc/grpc-js@1.9.15` |
| frontend / @grpc/grpc-js | [GHSA-99f4-grh7-6pcq](https://github.com/advisories/GHSA-99f4-grh7-6pcq) (high) | `<1.9.16` | `node_modules/@grpc/grpc-js@1.9.15` |
| frontend / @grpc/grpc-js | [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j) (high) | `<1.13.6` | `node_modules/@grpc/grpc-js@1.9.15` |
| frontend / @grpc/grpc-js | [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) (low) | `<1.13.6` | `node_modules/@grpc/grpc-js@1.9.15` |
| frontend / braces | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (high) | `<=3.0.3` | `node_modules/braces@3.0.3` |
| frontend / postcss-selector-parser | [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) (moderate) | `<7.1.6` | `node_modules/postcss-selector-parser@6.1.3` |
| frontend / react-router | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) (moderate) | `>=6.0.0 <7.18.0` | `node_modules/react-router@6.30.6` |
| frontend / react-router | [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) (moderate) | `>=6.4.0 <7.18.0` | `node_modules/react-router@6.30.6` |
| backend / braces | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (high) | `<=3.0.3` | `node_modules/braces@3.0.3` |
| backend / qs | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) (moderate) | `>=6.14.2 <=6.15.3` | `node_modules/express/node_modules/body-parser/node_modules/qs@6.15.3` |
| backend / qs | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) (moderate) | `>=2.2.5 <6.16.0` | `node_modules/express/node_modules/body-parser/node_modules/qs@6.15.3` |
| backend / uuid | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) (moderate) | `<11.1.1` | `node_modules/uuid@9.0.1` |

## Cache blocker resolved

The host supplied `../registry-g/rolldown-1.0.3-complete-closure.json` (24 manifests)
and full public packuments in `../npm-cache-g`. G4 made no changes because WASM
metadata was missing; G5 now resolves the entire closure offline, including all 15
optional bindings and the WASM descendants. **No missing metadata remains.**
The helper reused already-compatible cached/locked wasm-runtime **1.1.6** and wasm-util
**0.10.3**, rather than the host prefetch receipt's **1.2.5**/**0.10.4** selections;
the actual selected versions' registry metadata and all Arborist edges were verified.
No invented integrity, omitted platform dependency or new metadata request.

## Historical Phase G graph evidence (not a G2/G3 execution)

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
graph supports conditional exposure only and cannot validate changed G2/G3/G5 packages.

Existing tests exercise real proxy-addr, IPv6 rate-limit keys, bounded loopback Express
forwarding/rate limiting/JSON400/413/form parameter limits/raw bytes; real Nodemailer
stream/JSON/recipient/privacy APIs and synthetic Twilio signature rejection. Frontend
uses real Axios transforms/XHR/interceptors for auth/error/multipart and actual Privacy
Router navigation with only network primitives mocked. These tests remain host gates.

## Hermes completion gate

1. G5 lock/cache completion and saved-range validation are complete locally; Hermes
   verifies this two-file diff and preserves the recorded registry/Arborist evidence.
2. Plain fresh `npm ci` in both roots on Node22; inspect installed versions against locks.
   Rerun frontend dependencySecurity + Layout.navigation and backend dependencySecurity
   + email.production on the final installed graph. Preserve genuine nonzero audit results.
3. Full backend suite with disposable PostgreSQL, all 7 parser tests, full frontend suite,
   production build, actual final Rollup module graph and relevant browser QA are mandatory.
   Recheck ingress/trusted-input/tool-server conditions and retain all original A–F gates.
4. Hermes commits and records exact SHA/gate receipts, obtains valid Spark advisory and
   routes the independent exact-SHA review. The saved full-scope Spark result failed scope binding; no standalone
   security PASS, reviewer verdict, final full acceptance or shipping is claimed here.

## G6 fresh-audit addendum — 2026-10-10

The supplied fresh final audit identified additional moderate **GHSA-g57g-f23g-4646**,
quoted-local-part comment parsing, affecting Nodemailer **>=9.1.0 <10.0.9**.
This ID was **not included in the original 187 saved range occurrences**. The original
**50 rows / 187 occurrences / 135 unique IDs**, **175 nonmatches / 12 conditional
matches**, and their saved-ID dispositions remain unchanged; this additional ID is
tracked separately here. Nodemailer **10.0.6** is affected; **10.0.9** exits this range.
The available compatible patch is applied now, with no deferral or override.

G6 starts from `6900cad9728dd82d00a1ed4fbd92d684a8677913` on the same branch and
changes only `backend/package.json`, `backend/package-lock.json`, and this document.
The manifest and lock root require **^10.0.9**; the sole Nodemailer lock node is
**10.0.9**. Tarball URL and SHA512 integrity come directly from the supplied exact
`../registry-g/nodemailer-10.0.9.json` and match the full public registry packument
in `../npm-cache-g`, whose cached content digest was verified offline. No runtime,
optional, or peer dependencies are declared; license **MIT-0** and Node engine
**>=20.0.0** are unchanged. All other dependency nodes and all frontend files remain
unchanged. No network access, package installation, or runtime tests were performed.

The supplied prior-SHA host results (1475 backend, 7 parser, 658 frontend, production
build, disposable PostgreSQL, and both fresh npm ci exits 0) and module graph
(1889 resolved / 440 emitted, real Firestore browser modules, no Node gRPC transports)
apply to the prior candidate. They do **not** validate Nodemailer 10.0.9; neither do
the historical G2 checks against installed 10.0.6. Hermes must rerun fresh installation,
audit, and the required host gates on the final candidate, then own commit, exact-SHA
review, board reporting and shipping. This security-sensitive dependency correction
spans **three files**; no new test PASS, fresh audit execution, reviewer verdict,
commit, push, or deployment is claimed by this local metadata-only change.
