# REVV Owner Activity Digest — daily shop activity email for account holders

> Product + backend + frontend. Gives shop owners a reliable daily email showing what administrators and staff changed while the owner was away. This is internal operational visibility, not customer communication.

## Goal
Owners should be able to receive a daily digest of important shop activity performed by admins, assistants, estimators, technicians, or staff, including:
- repair orders opened
- repair orders closed
- status changes
- assignment changes
- estimate/profit/payment changes
- supplements requested/updated
- customer or vehicle changes tied to an RO
- deleted records or other high-risk actions

The digest should help an owner answer: "What happened at my shop today while I was not there?"

## Product stance
I like this feature. It fits REVV's mission because owner visibility is one of the biggest gaps in small auto body shops. The key is to avoid noisy real-time spam. The default should be:
- **Daily digest** for normal activity.
- **Immediate alert** only for high-risk events such as RO deletion, payment change, reopened closed RO, supplement denial, or failed email/SMS provider.

## Current state to preserve
- Users already have roles: owner, admin, assistant, technician/staff.
- Shops already have `email_notifications_enabled` in schema.
- REVV already writes some activity/audit data:
  - `job_status_log`
  - `ro_comms`
  - notification rows
  - various route-level logs/side effects
- Email must fail loud in production if no provider is configured. Do not reintroduce simulated success in production.
- Do not expose customer PII beyond what the owner already has permission to see inside their own shop.

## Scope
### In scope
1. Owner/admin email preference for internal activity digest.
2. A normalized activity event table or service that records important staff actions.
3. Daily digest email grouped by shop and owner recipients.
4. Optional immediate email alerts for high-risk events.
5. Admin/settings UI for enabling/disabling digest and choosing digest time.
6. Tests and QA that use mocked email only.

### Out of scope
- Customer status email opt-in. That belongs in `docs/SPEC-email-status-notifications.md`.
- Marketing emails.
- Employee performance scoring.
- Payroll/timeclock discipline emails.
- Sending every low-level keystroke or field blur.
- Cross-shop master emails unless explicitly superadmin-scoped.

## Feature behavior
### 1. Owner notification preferences
In Settings > Notifications, owners can configure:
- `Owner activity digest`: on/off
- `Digest recipients`: owner accounts by default, plus optional extra emails
- `Digest time`: default 7:00 PM shop timezone
- `Immediate high-risk alerts`: on/off

Recommended defaults:
- Owner activity digest: ON for owners
- Immediate high-risk alerts: ON
- Admin recipients: OFF by default unless owner opts them in

Only owner/admin can change these settings. Assistant/staff cannot.

### 2. Activity events to capture
Create normalized owner-visible activity events for:

RO lifecycle:
- RO created
- RO status changed
- RO closed
- closed RO reopened
- total loss marked
- SIU hold marked/cleared

Money and insurance:
- deductible changed
- estimate imported
- estimate financials imported to RO
- payment marked received
- payment status changed
- supplement requested
- supplement status changed
- insurer owed / profit-impacting totals changed

People and ownership:
- technician assigned/reassigned
- customer changed
- vehicle changed
- customer contact email/phone changed

Risk/destructive:
- RO deleted
- customer deleted
- photo/evidence deleted
- proof packet share created/revoked
- user/admin created/deleted/password reset

Each event should record:
- `shop_id`
- `ro_id` when applicable
- `actor_user_id`
- `actor_name`
- `actor_role`
- `event_type`
- `severity`: info, important, critical
- `summary`
- `before_json` safe diff
- `after_json` safe diff
- `created_at`

Do not store secrets, tokens, raw email bodies, API keys, or large blobs.

### 3. Daily digest email
The daily digest email should be owner-friendly and scannable:

Subject:
`{Shop Name}: Daily REVV activity digest — {Month Day}`

Sections:
- Summary counts:
  - ROs opened
  - ROs closed
  - status changes
  - money changes
  - high-risk events
- High-risk events first
- RO activity grouped by RO number
- Staff activity grouped by actor
- Link to REVV activity log page

Example rows:
- `Bryan opened RO-2026-0057 for Jane Smith — 2021 Toyota Camry`
- `Maria moved RO-2026-0048 from Estimate to Approval`
- `Chris marked RO-2026-0031 closed after payment received`
- `Admin changed deductible on RO-2026-0054 from $500 to $1,000`

Avoid including:
- internal profit strategy notes
- raw customer notes
- customer portal tokens
- proof packet share tokens
- payment provider IDs unless masked

### 4. Immediate high-risk alerts
If enabled, send an immediate owner email for:
- RO deleted
- customer deleted
- closed RO reopened
- payment marked paid/unpaid manually
- supplement denied/withdrawn
- proof packet shared/revoked
- user/admin account created/deleted/password reset
- production email/SMS provider failure affecting customer communication

Subject:
`REVV alert: {event summary}`

These must be rate-limited or deduped to avoid alert storms.

### 5. In-app activity log
Add an owner/admin activity page or panel:
- route: `/activity` or Settings > Activity Log
- filters: date, actor, event type, RO number, severity
- export CSV for owner/accounting review

This page is useful because the daily email should link back to a full log.

## Backend implementation
### Schema
Additive only:

`owner_activity_events`
- `id UUID PRIMARY KEY`
- `shop_id TEXT NOT NULL`
- `ro_id TEXT`
- `actor_user_id TEXT`
- `actor_name TEXT`
- `actor_role TEXT`
- `event_type TEXT NOT NULL`
- `severity TEXT NOT NULL DEFAULT 'info'`
- `summary TEXT NOT NULL`
- `before_json JSONB DEFAULT '{}'::jsonb`
- `after_json JSONB DEFAULT '{}'::jsonb`
- `created_at TIMESTAMPTZ DEFAULT NOW()`

`shop_notification_preferences`
- `shop_id TEXT PRIMARY KEY`
- `owner_activity_digest_enabled BOOLEAN DEFAULT TRUE`
- `owner_activity_digest_time TEXT DEFAULT '19:00'`
- `owner_activity_immediate_alerts_enabled BOOLEAN DEFAULT TRUE`
- `digest_recipient_emails TEXT[] DEFAULT '{}'`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`

If the project avoids arrays for portability, use a child table:
`shop_notification_recipients (id, shop_id, email, role, enabled, created_at)`.

### Services
Create:
- `backend/src/services/ownerActivity.js`
- `backend/src/jobs/ownerActivityDigest.js`

`recordOwnerActivity({ shopId, roId, actor, eventType, severity, summary, before, after })`
- Safe, non-throwing from route perspective.
- If logging fails, write server error log but do not block the user action.
- Sanitizes values before storing.

`sendOwnerActivityDigest({ shopId, date })`
- Loads owner/admin recipients.
- Loads prior-day events scoped to shop.
- Builds digest email.
- Sends via existing email provider.
- Writes a safe activity event that digest was sent, or a safe failure event.

`sendImmediateOwnerAlert(event)`
- Only for severity `critical`.
- Requires preference enabled.
- Dedupes repeated same-event alerts.

### Routes
Add owner/admin-scoped routes:
- `GET /api/owner-activity`
- `GET /api/owner-activity/preferences`
- `PUT /api/owner-activity/preferences`
- optional `POST /api/owner-activity/digest/test` for owner/admin test-send to self

Security:
- All routes require auth.
- Activity routes require owner/admin.
- Every query must scope by `shop_id::text = $N::text`.
- No `SELECT *`.
- Superadmin can view all shops only through a separate explicit superadmin route if needed.

### Event capture strategy
Do not try to instrument every file at once. Start with high-value events:

Phase 1 capture:
- RO created
- status changed
- RO closed/reopened
- payment status/manual payment change
- supplement requested/status changed
- RO deleted
- user/admin created/deleted/reset

Phase 2 capture:
- customer/vehicle contact edits
- assignment changes
- proof packet share/revoke
- estimate import/financial import

Phase 3 capture:
- photo/evidence delete
- settings changes
- failed provider/customer communication events

## Frontend implementation
### Settings
Add section: `Owner Activity Emails`
- Daily digest toggle
- Digest time input
- Immediate high-risk alerts toggle
- Recipient list
- Test digest button

Use existing REVV UI patterns:
- gold primary buttons
- inline `role="alert"` errors
- no browser `alert()`
- tablet/phone responsive

### Activity page/panel
Add owner/admin page:
- activity feed grouped by day
- chips by severity
- RO links
- actor filter
- event type filter

This can ship after the email digest if time is tight, but the digest email should link somewhere useful eventually.

## Tests
### Backend tests
Mocked-only, no live DB/network:
1. `recordOwnerActivity` inserts shop-scoped safe event.
2. Dangerous fields are redacted from `before_json` / `after_json`.
3. Daily digest groups events by shop and sends only to that shop's owners/recipients.
4. Digest email excludes tokens/secrets/raw notes.
5. Immediate alerts send only for `high` severity and only when preference enabled.
6. Non-owner/admin cannot read activity feed or preferences.
7. Owner/admin cannot read another shop's activity.
8. Email provider failure returns safe failure and does not crash digest job.

### Frontend tests
1. Settings renders Owner Activity Emails section for owner/admin.
2. Assistant/staff cannot edit owner digest preferences.
3. Preference save posts correct payload.
4. Test digest failure shows inline error, no browser alert.
5. Activity page filters by event type and actor.

## QA gates
- `node --check` touched backend files.
- `node --test backend/src/__tests__/*.test.js backend/test/*.test.js`
- `cd frontend && npm run test:run` for touched tests.
- `cd frontend && npm run build`
- `git diff --check`
- `git ls-files frontend/dist` returns no tracked dist.
- Mocked email tests only; no real owner/customer emails during QA.

## Claude Code QA prompt
After implementation, Claude Code should verify:
- Owner activity events are shop-scoped.
- No cross-tenant activity leak.
- Digest does not include tokens, secrets, raw email bodies, or unsafe notes.
- Email failure does not block the original shop action.
- High-risk alerts are deduped/rate-limited.
- Settings UI is owner/admin only.
- Full test/build gates pass.

## Rollout plan
### Phase 1 — Activity foundation + high-value events
- Add schema.
- Add `recordOwnerActivity`.
- Instrument RO created/status/closed/reopened/deleted, payment manual change, supplement requested/status.
- Add backend tests.

### Phase 2 — Daily digest job
- Add digest generator.
- Add safe email template.
- Add daily worker/cron.
- Add mocked email tests.

### Phase 3 — Settings UI
- Add preferences UI.
- Add test-send button.
- Add frontend tests.

### Phase 4 — Activity log page
- Add `/activity` page.
- Add filters and RO links.
- Add export CSV later if useful.

### Phase 5 — Immediate high-risk alerts
- Add severity alert path.
- Add rate limit/dedupe.
- Add preference control.

## Done definition
Owners can enable daily shop activity emails, receive a clean daily digest of important admin/staff actions, optionally receive immediate high-risk alerts, and review the same activity in REVV. All events are shop-scoped, safe, tested, and do not expose cross-tenant data or secrets.
