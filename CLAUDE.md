# CLAUDE.md — Revv Project Intelligence

> **Read by: CW3 Codex (before building) AND Claude Code (before QA review)**
> Updated after every build. If you're building or reviewing, read this first.

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
