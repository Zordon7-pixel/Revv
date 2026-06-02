# CLAUDE.md — Revv Project Intelligence

> **Read by: CW3 Codex (before building) AND Claude Code (before QA review)**
> Updated after every build. If you're building or reviewing, read this first.

---

## Dispatch Guard — Prevent Duplicate Jobs

Before starting any new task:

1. Check the newest "Dispatch Log" entry in this file.
2. If a task is marked **DONE + VERIFIED**, do not redispatch it unless there is a new repro with timestamp/evidence.
3. If a task is only partial, mark it **IN PROGRESS** with next action.
4. After finishing work, append/update the log with:
   - date/time (ET + UTC),
   - scope,
   - files touched,
   - verification method,
   - status.

---

## What This App Is

Revv is an **auto body shop management platform** — NOT a general mechanic app.
- Web frontend (React + Vite) + REST backend (Node.js/Express) + PostgreSQL on Railway
- Single Railway deployment: frontend builds to `frontend/dist`, served as static files by backend
- GitHub: `Zordon7-pixel/Revv` | Deploy: `git push origin main` → Railway auto-builds

---

## Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | React + Vite | `frontend/src/` |
| Backend | Node.js + Express | `backend/src/` |
| Database | PostgreSQL (Railway) | `dbGet`, `dbAll`, `dbRun` from `../db` |
| Auth | JWT (30-day tokens) | `req.user.shop_id` scopes ALL DB queries |
| SMS | Twilio | API Key + Secret auth (not just Auth Token) |
| Deploy | Railway | `railway.toml` at root |

---

## Auth Model — Critical

Every route that touches data **must** scope to `req.user.shop_id`. No exceptions.

```js
// CORRECT — ownership enforced in the query
await dbRun('DELETE FROM ros WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]);

// WRONG — auth bypass: checks ownership in SELECT but not in DELETE
const ro = await dbGet('SELECT * FROM ros WHERE id = $1 AND shop_id = $2', [id, req.user.shop_id]);
await dbRun('DELETE FROM ros WHERE id = $1', [id]); // ← SECURITY BUG
```

**This exact bug was found and fixed in runs.js and lifts.js. Don't reintroduce it.**

---

## Key Files

```
backend/src/
├── app.js                   ← Route registration, static file serving, DB init
├── middleware/auth.js        ← JWT verification, sets req.user
├── middleware/roles.js       ← requireAdmin check
├── routes/
│   ├── ros.js               ← Repair orders (largest file — 1200+ lines)
│   ├── sms.js               ← SMS send/receive/webhook/inbox
│   ├── market.js            ← Shop settings (saves Twilio creds to DB)
│   ├── auth.js              ← User auth + profile
│   └── settings.js          ← Shop-level settings (SMS notifications toggle)
├── services/
│   └── sms.js               ← Twilio client, getTwilioConfigForShop()
└── db/
    ├── index.js             ← dbGet, dbAll, dbRun exports
    └── migrate.js           ← Run on every startup (idempotent)

frontend/src/
├── lib/api.js               ← Axios instance, baseURL: '/api', JWT header auto-inject
└── pages/Settings.jsx       ← Large file (1000+ lines) — SMS config, shop settings
```

---

## Database Patterns

```js
// All helpers return null (not undefined) on no result
const row = await dbGet('SELECT * FROM table WHERE id = $1', [id]);
if (!row) return res.status(404).json({ error: 'Not found' });

// Arrays always return [], never null
const rows = await dbAll('SELECT * FROM table WHERE shop_id = $1', [shopId]);
```

---

## SMS Architecture

- Twilio config lookup order: **DB first** (shops table), then **env vars** fallback
- DB fields: `twilio_account_sid`, `twilio_auth_token`, `twilio_phone_number`
- Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_PHONE_NUMBER`
- API Key auth takes priority over Auth Token in env var path
- If DB has partial creds (e.g., sid + phone but no auth_token), falls back to env vars

```js
// sendSMS options signature
sendSMS(phone, message, { shopId, twilioConfig? })
```

---

## Env Vars (Railway)

| Var | Required | Notes |
|-----|----------|-------|
| `JWT_SECRET` | YES | App refuses to start without it |
| `DATABASE_URL` | YES | PostgreSQL connection string |
| `TWILIO_ACCOUNT_SID` | For SMS | |
| `TWILIO_API_KEY` | For SMS (preferred) | SK... prefix |
| `TWILIO_API_SECRET` | For SMS (preferred) | |
| `TWILIO_PHONE_NUMBER` | For SMS | E.164 format: +1XXXXXXXXXX |
| `PORT` | No | Defaults to 4000 |

---

## Deploy Process

```bash
git push origin main   # Railway auto-builds and deploys
# Health check: https://revv-production-ffa9.up.railway.app/api/health
# Returns: { ok: true, deployed: "ISO timestamp", commit: "sha" }
```

Build command (from railway.toml):
```
cd frontend && npm install && npm run build && cd ../backend && npm install
```
Start command: `cd backend && node src/db/seed.js; node src/app.js`

---

## Recently Fixed Bugs — Do NOT Reintroduce

| Bug | Where Fixed | Pattern |
|-----|------------|---------|
| Silent SMS failure | routes/ros.js `queueStatusSMS` | `catch (_) {}` swallowing all errors |
| Auth bypass in DELETE | Any route with DELETE | SELECT checks shop_id but DELETE doesn't |
| SMS test always returns 200 | routes/sms.js `/test` | Error path never returned HTTP 502 |
| Tracking token gate killing SMS | routes/ros.js | Hard bail if no tracking token |
| Twilio API Key not supported | services/sms.js | Only Auth Token was handled |

---

## QA Checklist — Check Every Diff

- [ ] Every DELETE/UPDATE includes `AND shop_id = $N` (not just the SELECT)
- [ ] No `catch (_) {}` or `catch (e) {}` with empty body
- [ ] No `catch` that only does `console.log` with no error return
- [ ] Input validation on all user-facing fields (phone numbers, amounts, text)
- [ ] SMS sends log their outcome (success SID or error reason)
- [ ] New routes have `auth` middleware
- [ ] Admin-only routes have `requireAdmin` middleware
- [ ] No hardcoded shop IDs or user IDs
- [ ] New DB queries parameterized (no string interpolation)

---

## Updates: 2026-03-22 to 2026-03-23

### Role/Access Behavior (Global, not sample-user specific)

- Access controls are role-based (`owner`, `admin`, `assistant`, `employee`, `staff`, `technician`) and apply to any shop/user created in production.
- Assistant restrictions were tightened in multiple views (cannot access owner-only settings/admin management paths).
- Technician/employee flows were updated to remove finance-sensitive actions from their RO experience.

### RO Detail / Header / Workflow

- RO header was redesigned into a cleaner card layout with better spacing and visual hierarchy.
- `Download Invoice` button was removed from RO header.
- Invoice open action remains via `Invoice` button (`/invoice/:id`) for shared viewing flow.
- Tech assignment behavior supports override warning when a tech is not currently assigned and proceeds with admin notification.
- Full vehicle editing support was expanded in RO edit mode (year/make/model/color/plate/mileage/VIN fields).
- RO progress strip now shows all stage labels under color segments (not only intake/delivery endpoints).

### Storage Hold

- Storage Hold page now supports edit-in-place flow for owner/admin/assistant roles.
- Non-admin financial totals in storage views were reduced for staff-facing access.

### ADAS / Operations Click-through

- ADAS queue cards are now clickable and route directly to the target RO.
- Technician-role nav handling includes `technician` in the restricted employee-role pathing logic where applicable.

### Language / Localization

- Language system now supports whole-app translation pass (not sidebar-only) by combining:
  - Key-based translations (`t('...')`) and
  - Literal UI text mapping pass for non-keyed strings.
- Global translation runs on render/mutation updates and applies to visible text and key attributes.
- Language toggle is explicitly excluded from auto-translation (`data-no-auto-i18n`) so it always shows the correct flag/code state.
- Language toggle rendering now uses emoji font fallbacks for reliable `US/MX` flag visibility across owner/assistant/tech views.

### Notes for Future Builders

- Do not reintroduce sample-account assumptions in frontend conditionals.
- Keep role gating centralized around role values from JWT payload, not user IDs or seeded demo emails.
- Any new user-facing literal text should either:
  - use `t('...')` keys, or
  - be added to the literal map if immediate full-page bilingual behavior is required.

---

## QA Report — 2026-03-23

**Commit:** 595b5bb — QuickBooks, SMS provisioning, dark/light theme, grouped nav, schedule overnight, RO detail enhancements
**Reviewer:** CW2 Claude Code | **Verdict: RELEASE READY** (3 MEDIUM items to track)

### Checklist Results

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Backend routes scoped to shop_id | PASS | All new routes (accounting.js, QB service, SMS provisioning) use req.user.shop_id throughout |
| 2 | bcryptjs only (no bcrypt) | PASS | timeclock.js and auth.js both use `require('bcryptjs')` |
| 3 | Missing error handling / server crash risk | PASS | All new routes have try/catch; setImmediate QB sync has console.error logging |
| 4 | QuickBooks OAuth state validated | PASS | HMAC-SHA256 signed state via JWT_SECRET + 10-min TTL; callback verifies before using shop_id |
| 4b | QB tokens stored securely / no leaks | PASS | Tokens stored only in shops table; connectionStatus() returns metadata only, never raw tokens |
| 4c | QB shop_id scoped | PASS | Every QB DB query uses shopId parameter |
| 5 | SMS provisioning scoped per shop | PASS | provisionSmsSenderForShop() queries and updates only the given shopId |
| 6 | ThemeContext null check | WARN | useTheme() returns null if called outside ThemeProvider; no guard in hook itself. Low risk: ThemeProvider wraps entire app in App.jsx |
| 7 | Route guards edge cases | WARN | See issues below |
| 8 | Schedule overnight shifts edge cases | PASS | addDaysIso uses UTC; midnight boundary handled; same-time validation added |
| 9 | console.log in production files | PASS | Only console.error calls present (error logging, acceptable) |
| 10 | Hardcoded URLs / test credentials | PASS | All credentials via env vars; DEFAULT_APP_URL is production URL, not a credential |
| 11 | DB schema backward compatible | WARN | See schema issue below |
| 12 | Frontend dist updated correctly | PASS | Old index-Cwv63eNs.js/css removed; new index-BFejelpL.js/css added |

### MEDIUM Findings

**M1 — Schema type mismatch: `unscheduled_approved_at`**
- `db/index.js:228` CREATE TABLE defines it as `TEXT`
- `db/index.js:379` and `schema.pg.sql:214` define it as `TIMESTAMPTZ`
- **Impact:** Fresh installs get wrong column type. Production (Railway) is unaffected — ALTER TABLE IF NOT EXISTS runs correctly on existing DB. Fix before next fresh-install or developer onboarding.

**M2 — ADAS Calibration lost AdminRoute guard (frontend only)**
- Old: `<AdminRoute><ADASCalibration /></AdminRoute>`
- New: `<ADASCalibration />` — accessible to all authenticated users including technicians/employees
- `App.jsx` line for `adas` route. Backend doesn't gate ADAS data, so technicians can now view the ADAS queue. Likely intentional per ADAS clickthrough update but worth confirming.

**M3 — `assistant` role promotion opens subscriptions/settings-reset backend routes**
- `roles.js`: assistant promoted from rank 1 → rank 3 (same as admin). `requireAdmin` middleware now passes for assistants.
- `subscriptions.js`: assistants can now hit `/status`, `/checkout`, `/portal` endpoints
- `settings.js`: assistants can now hit `/reset/:section` (bulk data reset)
- Frontend gatekeeps Settings behind `OwnerRoute`, so no UI exposure. But backend is permissive.
- If an assistant account were compromised or used with a custom client, they could initiate billing changes or reset shop data.
- **Recommendation:** Add `disallowAssistant` to subscriptions.js and settings.js reset endpoint, matching the pattern used in users.js.

### INFO

- `smsProvisioning.js` is a complete service but not wired to any route yet. It's dead code until a provisioning endpoint is added. No security risk, just incomplete feature.
- `createNotification` helper is duplicated locally in `timeclock.js` vs `services/notifications.js`. Minor code smell.
- `goals.js` local `requireAdmin` explicitly checks `['owner', 'admin']` only (assistant blocked). Good defensive pattern that others should follow.

### Recently Fixed in This Build (add to fixed bugs table)

| Date | Issue | Commit | Type |
|------|-------|--------|------|
| 2026-03-23 | Assistant role-rank raised to 3 (admin-level); users.js gates added via disallowAssistant | 595b5bb | Security/Access |
| 2026-03-23 | RO assign endpoint: tech override sends admin notification instead of silently proceeding | 595b5bb | Audit |
| 2026-03-23 | Schedule: time validation rejects same-start-as-end, invalid format; overnight shifts detected | 595b5bb | Validation |

---

## Dispatch Log — 2026-04-05 (America/New_York)

### DONE + VERIFIED

1. **RO Calendar month label stuck on April**
   - Scope: month label did not update when navigating months.
   - Files: `frontend/src/contexts/LanguageContext.jsx`, `frontend/src/pages/Dashboard.jsx`
   - Verification: live `revvshop.app` probe confirmed label moves (`April -> May`, `April -> March`).
   - Status: DONE + VERIFIED

2. **Dashboard Active/Completed parity**
   - Scope: dashboard totals must match open/closed RO counts.
   - Files: `frontend/src/pages/Dashboard.jsx`, `backend/src/routes/ros.js`
   - Verification: live dashboard checks + RO list logic validation.
   - Status: DONE + VERIFIED

3. **Dynamic UI shield from auto-i18n rewrites**
   - Scope: prevent auto-translation from freezing dynamic text.
   - Files: `frontend/src/pages/Dashboard.jsx`
   - Verification: month nav and dynamic counters remain stable after translation pass.
   - Status: DONE + VERIFIED

4. **Regression tests for calendar/count logic**
   - Scope: lock in month-nav and active/completed behavior.
   - Files: `frontend/vite.config.js`, `frontend/package.json`, `frontend/src/test/setupTests.js`, `frontend/src/pages/__tests__/Dashboard.regression.test.jsx`
   - Verification: `cd frontend && npm run test:run` (2 passing tests).
   - Status: DONE + VERIFIED

5. **Triage bundle command**
   - Scope: one-command diagnostics package to speed future issue reports.
   - Files: `scripts/triage-bundle.sh`, `package.json`, `scripts/README.md`
   - Verification: `npm run triage:bundle -- --no-network --issue "self-test triage"` generated bundle + tarball in `~/triage-bundles`.
   - Status: DONE + VERIFIED

---

## Dispatch Log — 2026-05-27 Approval Link Clipboard Fallback

**Status:** DONE + VERIFIED

**Scope:** Fix false "Could not generate approval link" failures when the backend generated the link successfully but browser clipboard access was denied/unavailable.

**Files changed**
- `frontend/src/pages/RODetail.jsx` — approval-link generation now keeps the generated link visible and only downgrades the success alert if clipboard copy fails.
- `frontend/src/lib/clipboard.js` — safe clipboard helper that returns false instead of throwing.
- `frontend/src/lib/__tests__/clipboard.test.js` — regression coverage for success, denied clipboard access, and unavailable Clipboard API.

**Verification**
```
cd frontend && npm run test:run  # 11/11 passed
cd frontend && npm run build     # clean production build
```

---

## Dispatch Log — 2026-05-27 Feedback b7f286d6 Assistant Access Required

**Status:** Shipped. Fixed the Parts On Order route returning `assistant access required` for technician/employee-level roles by using the existing technician access gate instead of the assistant/admin gate.

**Files changed**
- `backend/src/routes/parts.js` — changed `/api/parts/all-pending` authorization from `requireAssistant` to `requireTechnician`, matching the page's intended owner/admin/technician/employee/staff access.

**Verification**
```
node --check backend/src/routes/parts.js
cd frontend && npm run test:run   # 11/11 passed
cd frontend && npm run build      # clean production build
```

---

## Dispatch Log — 2026-05-31 Phase 31 User Feedback Fixes

**Status:** Shipped from clean `origin/main` worktree for Railway deployment.

**Scope**
- Total loss now moves into storage/pickup handling: `claim_status = total_loss` sets `status = total_loss`, enables `storage_hold`, and stamps `storage_start_date` only when empty.
- Total-loss UI now says `Total Loss — Storage + Pickup / Release`, explains that repair labor/deductible are not collected, and opens the Storage Hold tab.
- RO photos now resolve relative `/uploads/...` URLs against the app origin and show `Photo unavailable` on image load failure.
- Estimate AI import now sanitizes provider/auth errors at the backend and again in frontend display code. The raw provider 401/key-help text from the user screenshot is no longer rendered or returned.

**Files changed**
- `backend/src/routes/ros.js`
- `backend/src/routes/insuranceOcr.js`
- `frontend/src/components/ClaimStatusCard.jsx`
- `frontend/src/components/ROPhotos.jsx`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/pages/RODetail.jsx`
- `frontend/src/pages/EstimateBuilder.jsx`
- `frontend/src/lib/mediaUrls.js`
- `frontend/src/lib/safeErrors.js`
- Phase 31 regression tests under `frontend/src/**/__tests__`

**Verification**
```
node --check backend/src/routes/ros.js backend/src/routes/photos.js backend/src/routes/insuranceOcr.js backend/src/app.js  # PASS
cd frontend && npm run test:run  # 10 files, 18 tests passed
cd frontend && npm run build     # PASS
rg "sk-proj|platform.openai.com/account/api-keys|Incorrect API key provided" backend/src frontend/src  # zero matches
rm -rf frontend/dist && git diff --check && git ls-files frontend/dist  # clean, no tracked dist
```

**Data safety**
- No local backend boot against protected DB.
- No seed/reset/delete commands.
- Miles Automotive data untouched.

**Railway verification**
- Pushed commit `c1b2b5c` to `main`; Railway deployment `8490c6e5-0156-418d-ab16-26f9f3926aef` is SUCCESS for commit `c1b2b5cee823cc3e552bdbc6d7575b492d0da789`.
- `curl https://revv-production-ffa9.up.railway.app/api/health` → HTTP 200.
- `./scripts/smoke-test.sh https://revv-production-ffa9.up.railway.app` → 6 PASS + 1 WARN (`RESEND_API_KEY` not present in local shell env).
- Live OCR probe with demo auth + synthetic image upload returns `503 {"success":false,"error":"AI estimate extraction is not configured correctly. Please contact support."}`.
- Railway logs for the live probe show sanitized structured OCR logging only: `[InsuranceOCR] Error: { code: 'invalid_api_key' }`.

## Dispatch Log — 2026-05-31 Phase 32 Pre-Launch Hardening

**Status:** shipped; awaiting verification

**Time**
- 2026-05-31 20:59:13 EDT
- 2026-06-01 00:59:13 UTC

**Scope**
- Assistant-role backend bypass patched for subscription and settings reset gates.
- ADAS backend reads patched with admin authorization; frontend `/adas` route was already wrapped in `AdminRoute` at dispatch start.
- `unscheduled_approved_at` schema drift patched with an idempotent TIMESTAMPTZ migration guard; `db/index.js` and `schema.pg.sql` already matched.
- Claim-status banners patched to derive Total Loss and SIU warnings from either workflow status or claim status.
- ROPhotos load failures now render visibly, stale failed-photo state resets on RO changes, and backend-derived photo alerts use sanitized external error messaging.
- OCR provider failure monitoring shipped through `notifyOps`, with throttled Discord webhook delivery and sanitized context only.

**Files changed**
- `backend/src/middleware/roles.js`
- `backend/src/routes/subscriptions.js`
- `backend/src/routes/settings.js`
- `backend/src/routes/adas.js`
- `backend/src/db/migrate.js`
- `backend/src/routes/insuranceOcr.js`
- `backend/src/services/notifyOps.js`
- `frontend/src/components/ClaimStatusCard.jsx`
- `frontend/src/components/ROPhotos.jsx`
- Backend tests under `backend/src/__tests__`
- Frontend regression tests under `frontend/src/components/__tests__`

**Verification**
```
node --check backend/src/routes/subscriptions.js backend/src/routes/settings.js backend/src/routes/adas.js backend/src/middleware/roles.js backend/src/db/index.js backend/src/db/migrate.js backend/src/routes/insuranceOcr.js backend/src/services/notifyOps.js  # passed
node --test backend/src/__tests__/role-guards.test.js backend/src/__tests__/insuranceOcr.notifyOps.test.js  # 4 tests passed
cd frontend && npm run test:run  # 11 files, 20 tests passed
cd frontend && npm run build  # production build passed with existing chunk-size warnings
rg "sk-proj|platform.openai.com/account/api-keys|Incorrect API key provided" backend/src frontend/src  # zero matches
git diff --check  # passed
```

**Data safety**
- No production DB writes, seed/reset commands, or destructive SQL were run.
- Miles Automotive data untouched.
- No push performed from this branch.

## Dispatch Log — 2026-06-01 Feedback 6d314a80 OpenAI 401 Auto-Report Sanitization

**Status:** built + verified; ready to ship

**Time**
- 2026-06-01 12:43:16 EDT
- 2026-06-01 16:43:16 UTC

**Scope**
- Auto-feedback reporter now sanitizes provider credential errors before Sentry breadcrumbs, feedback payloads, and alert display.
- Feedback API now sanitizes inbound OpenAI/API-key failure text before inserting feedback rows, preventing raw provider key fragments from being stored if a caller misses frontend wrapping.
- Added frontend and backend regressions for the exact `[AUTO] 401 Incorrect API key provided: sk-proj-...` feedback shape.

**Files changed**
- `backend/src/routes/feedback.js`
- `backend/src/__tests__/feedback.sanitize.test.js`
- `frontend/src/lib/errorReporter.js`
- `frontend/src/lib/__tests__/errorReporter.test.js`
- `CLAUDE.md`

**Verification**
```
node --test src/__tests__/feedback.sanitize.test.js src/__tests__/insuranceOcr.notifyOps.test.js src/__tests__/role-guards.test.js  # 5 tests passed
cd frontend && npm run test:run -- src/lib/__tests__/errorReporter.test.js src/lib/__tests__/phase31Safety.test.js  # 2 files, 5 tests passed
npm run build  # production build passed with existing chunk-size warnings
node --check backend/src/routes/feedback.js && git diff --check  # passed
rg "Incorrect API key provided|platform\\.openai\\.com/account/api-keys|sk-proj" backend/src frontend/src -g '!**/__tests__/**'  # zero production-code matches
```

**Data safety**
- No production DB writes, seed/reset commands, or destructive SQL were run.
- No customer/shop production data was mutated.

## Dispatch Log — 2026-06-01 Dashboard Supplement Access + RO Resume Scoping

**Status:** built + verified; commit blocked by sandbox `.git` write restriction

**Time**
- 2026-06-01 12:54:21 EDT
- 2026-06-01 16:54:21 UTC

**Scope**
- Dashboard supplement monthly opportunity aggregate is restricted to `owner`, `admin`, and `superadmin`; authenticated non-admin roles receive 403.
- SIU/total-loss resume read-back now includes `AND shop_id = $2` with `req.user.shop_id` after the shop-scoped update.

**Files changed**
- `backend/src/routes/dashboard.js`
- `backend/src/routes/ros.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/dashboard.js backend/src/routes/ros.js
cd backend && node --test src/__tests__/feedback.sanitize.test.js src/__tests__/insuranceOcr.notifyOps.test.js src/__tests__/role-guards.test.js  # 5/5 passed
cd frontend && npm run test:run  # 11 files, 21/21 tests passed
git diff --check
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Phase 3 Floor Mode

**Status:** built + verified

**Time**
- 2026-06-01 13:05:22 EDT
- 2026-06-01 17:05:22 UTC

**Scope**
- Added `/floor` technician tablet route showing the logged-in tech's active assigned ROs grouped by parts, repair, paint, and QC.
- Added one-tap optimistic status advance through parts -> repair -> paint -> QC -> delivery using the existing status-update endpoint with rollback/error handling.
- Added floor clock in/out control via existing timeclock endpoints and quick photo access via `ROPhotos`.
- Added technician-only nav entry and aligned technician role access for the existing tech route guard.

**Files changed**
- `frontend/src/pages/FloorMode.jsx`
- `frontend/src/pages/__tests__/FloorMode.test.jsx`
- `frontend/src/App.jsx`
- `frontend/src/components/Layout.jsx`
- `frontend/src/pages/TechView.jsx`
- `CLAUDE.md`

**Verification**
```
cd frontend && npm run test:run  # 12 files, 23/23 tests passed
cd backend && node --test src/__tests__/*.test.js  # 5/5 tests passed
cd frontend && npm run build  # production build passed with existing chunk-size warnings
cd frontend && npm run test:run -- FloorMode.test.jsx  # 1 file, 2/2 tests passed after final text tweak
git diff --check  # passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Phase 4 Owner Truth / KPI Dashboard

**Status:** built + verified

**Time**
- 2026-06-01 15:29:29 EDT
- 2026-06-01 19:29:29 UTC

**Scope**
- Added owner/admin-gated `/api/dashboard/owner-kpis` aggregate for missing KPI data only: cycle time by stage from `job_status_log`, supplement captured/requested totals, and tech throughput.
- Added `/owner-kpis` frontend view that composes the new aggregate with existing supplement opportunity, job-costing, carryover, and turnaround-estimator APIs.
- Added owner/admin nav entry under Financial and route guard using existing `OwnerRoute`.

**Files changed**
- `backend/src/routes/dashboard.js`
- `frontend/src/pages/OwnerKpis.jsx`
- `frontend/src/App.jsx`
- `frontend/src/components/Layout.jsx`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/dashboard.js  # passed
cd backend && node --test src/__tests__/*.test.js  # 5/5 passed
cd frontend && npm run test:run  # 12 files, 23/23 passed
cd frontend && npm run build  # production build passed with existing chunk-size warnings
git diff --check  # passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- New backend queries are parameterized and scoped through `req.user.shop_id`.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Phase 4 Owner KPI QA Fixes

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 15:38:40 EDT
- 2026-06-01 19:38:40 UTC

**Scope**
- Fixed Owner KPIs supplement capture card to render backend `supplement_capture.capture_rate` directly.
- Allowed `superadmin` through the Owner KPI frontend route path to match the backend owner KPI guard.
- Added explicit KPI period labels for the backend query windows.
- Added frontend regression coverage for backend-provided supplement capture rate rendering.

**Files changed**
- `frontend/src/pages/OwnerKpis.jsx`
- `frontend/src/pages/__tests__/OwnerKpis.test.jsx`
- `frontend/src/App.jsx`
- `CLAUDE.md`

**Verification**
```
cd frontend && npm run test:run -- OwnerKpis.test.jsx  # 1 file, 1/1 passed
cd frontend && npm run test:run  # 13 files, 24/24 passed
cd backend && node --test src/__tests__/*.test.js  # 5/5 passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- No backend query changes were made.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Consolidated Hardening Backlog

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 22:34:58 EDT
- 2026-06-02 02:34:58 UTC

**Scope**
- Forced technician-rank `/ros` list callers to their own `assigned_to` filter while preserving owner/admin/manager/superadmin filtering within shop scope.
- Updated insurance OCR rate-limit IP fallback to use express-rate-limit `ipKeyGenerator`, preserving the primary `shop_id:user_id` key path and eliminating the IPv6 key-generator validation warning.
- Rewrote Owner KPI tech-efficiency join to cast guarded `job_status_log.changed_by` UUID values instead of casting `users.id`.
- Added FloorMode regression coverage for failed optimistic `qc -> delivery` advancement restoring the card and surfacing the API error.
- Skipped optional OwnerKpis dependency/i18n items to avoid behavior drift and broader string-scope changes.

**Files changed**
- `backend/src/routes/ros.js`
- `backend/src/routes/insuranceOcr.js`
- `backend/src/routes/dashboard.js`
- `backend/src/__tests__/insuranceOcr.notifyOps.test.js`
- `frontend/src/pages/__tests__/FloorMode.test.jsx`
- `CLAUDE.md`

**Verification**
```
cd backend && node --test src/__tests__/*.test.js  # 7/7 passed; no ERR_ERL_KEY_GEN_IPV6 output
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Backend query changes remain parameterized and scoped through `req.user.shop_id`.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 ROS Assigned-To Role-Rank QA Fix

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 22:41:43 EDT
- 2026-06-02 02:41:43 UTC

**Scope**
- Changed GET `/ros` assigned-to filtering permission from a hardcoded role list to role-rank based admin-tier access, preserving explicit `superadmin` filtering.
- Added regression coverage that assistant callers can filter arbitrary `assigned_to` values within shop scope while technician callers are forced to their own user id.

**Files changed**
- `backend/src/middleware/roles.js`
- `backend/src/routes/ros.js`
- `backend/src/__tests__/ros.assignedToScope.test.js`
- `CLAUDE.md`

**Verification**
```
node --check src/routes/ros.js src/middleware/roles.js src/__tests__/ros.assignedToScope.test.js  # passed
cd backend && node --test src/__tests__/*.test.js  # 9/9 passed
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- GET `/ros` query remains parameterized and scoped through `req.user.shop_id`.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Dashboard Live 500 Fixes

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 23:36:44 EDT
- 2026-06-02 03:36:44 UTC

**Scope**
- Fixed GET `/api/dashboard/weekly` top-tech query by casting legacy/text `actual_delivery` values to `timestamptz` before the fallback to `updated_at`.
- Cast weekly `assigned_to`/`users.id` comparison through text to avoid schema-history UUID/text join failures.
- Fixed GET `/api/dashboard/owner-kpis` cycle-time timestamp expressions by normalizing `job_status_log.created_at` and `repair_orders.updated_at` to `timestamptz`.
- Changed owner KPI tech-efficiency user join to compare text IDs after UUID-format validation instead of casting `job_status_log.changed_by` to UUID.
- Added backend dashboard smoke coverage for empty-shop JSON responses and Postgres-safe query shape.

**Files changed**
- `backend/src/routes/dashboard.js`
- `backend/src/__tests__/dashboard.postgresShape.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/dashboard.js backend/src/__tests__/dashboard.postgresShape.test.js  # passed
node --test backend/src/__tests__/*.test.js  # 11/11 passed
cd frontend && npm run test:run  # 14 files, 26/26 passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Dashboard queries remain parameterized and scoped through `req.user.shop_id`.
- Owner/admin and technician gating remain intact.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-01 Owner KPI Timestamp Cast QA Fix

**Status:** DONE + VERIFIED

**Time**
- 2026-06-01 23:44:07 EDT
- 2026-06-02 03:44:07 UTC

**Scope**
- Fixed GET `/api/dashboard/owner-kpis` tech-efficiency date window to cast `job_status_log.created_at` through `NULLIF(l.created_at::text, '')::timestamptz` before comparing to `DATE_TRUNC('month', NOW())`.
- Extended dashboard Postgres shape coverage to assert the tech-efficiency predicates are cast and that no raw `l.created_at` comparisons remain in the owner KPI SQL captured by the route.

**Files changed**
- `backend/src/routes/dashboard.js`
- `backend/src/__tests__/dashboard.postgresShape.test.js`
- `CLAUDE.md`

**Verification**
```
node --check backend/src/routes/dashboard.js backend/src/__tests__/dashboard.postgresShape.test.js  # passed
node --test backend/src/__tests__/dashboard.postgresShape.test.js  # 2/2 passed
node --test backend/src/__tests__/*.test.js  # 11/11 passed
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- Dashboard queries remain parameterized and scoped through `req.user.shop_id`.
- Owner/admin gating remains intact.
- No secrets were read, logged, or changed.

## Dispatch Log — 2026-06-02 SMS Compliance Footer + Consent Capture

**Status:** DONE + VERIFIED

**Time**
- 2026-06-02 12:11:19 EDT
- 2026-06-02 16:11:19 UTC

**Scope**
- Added centralized outbound customer-facing SMS opt-out footer handling in `sendSMS`, with dedupe-safe detection for existing STOP opt-out language.
- Marked the late clock-in admin SMS as internal so it does not receive customer compliance language.
- Added `customers.sms_consent BOOLEAN DEFAULT TRUE` through the idempotent PostgreSQL migration path and fresh schema.
- Added RO intake consent capture in `AddROModal` for new and existing customers, persisting the value without changing SMS send gating.
- Stored the final footer-appended outbound SMS body in SMS thread routes when messages are logged.

**Files changed**
- `backend/src/services/sms.js`
- `backend/src/routes/sms.js`
- `backend/src/routes/timeclock.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/ros.js`
- `backend/src/db/migrate.js`
- `backend/src/db/schema.pg.sql`
- `backend/src/__tests__/sms-compliance.test.js`
- `frontend/src/components/AddROModal.jsx`
- `CLAUDE.md`

**Verification**
```
cd backend && node --test src/__tests__/*.test.js  # 15/15 passed
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No seed, reset, or destructive scripts were run.
- Schema change is additive and idempotent: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT TRUE`.
- Customer consent updates remain parameterized and scoped through `req.user.shop_id`.
- Existing SMS send behavior is unchanged except for required compliance footer content.

## Dispatch Log — 2026-06-02 One-Time SMS Opt-In Confirmation

**Status:** DONE + VERIFIED

**Time**
- 2026-06-02 13:34:46 EDT
- 2026-06-02 17:34:46 UTC

**Scope**
- Added a reusable customer opt-in confirmation send helper using the existing SMS send path and shop-scoped Twilio lookup.
- Sent the confirmation only when a newly created customer is opted in and has a non-empty phone number.
- Routed estimate-import RO customer creation through the same helper after transaction commit.
- Verified the exact confirmation text does not receive a duplicate STOP/HELP footer.

**Files changed**
- `backend/src/services/customerOptInConfirmation.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/ros.js`
- `backend/src/__tests__/customerOptInConfirmation.test.js`
- `backend/src/__tests__/sms-compliance.test.js`
- `CLAUDE.md`

**Verification**
```
cd backend && node --test src/__tests__/*.test.js  # 20/20 passed
cd frontend && npm run test:run  # 14 files, 26/26 tests passed
```

**Data safety**
- No migrations, seed, reset, or destructive scripts were run.
- New calls reuse existing parameterized customer insert paths and `req.user.shop_id`.
- SMS send failures are logged with `[SMS Opt-In Confirmation]` and do not fail create requests.
