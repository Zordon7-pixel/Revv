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
