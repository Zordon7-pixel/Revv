# REVV Email Status Notifications — customer email opt-in alongside SMS

> Product + backend + frontend. Adds customer/RO email status updates as an explicit opt-in channel, parallel to existing SMS consent. Goal: let a shop owner send vehicle status updates by email from the shop identity, without weakening SMS compliance or silently dropping messages.

## Goal
Give customers the option to receive repair-order status notifications by email, in addition to the existing SMS updates. REVV should support:
- SMS only
- Email only
- SMS + Email
- Neither

The customer must provide an email address and opt in before REVV sends status-update emails.

## Current state to preserve
- Add RO already captures `customer_email` and `sms_consent`.
- Customer records already include email data.
- REVV already sends customer-facing emails through `backend/src/services/email.js` / mailer provider paths.
- SMS compliance already exists separately: STOP/HELP handling, opt-out table, SMS tier gate, and Miles grandfathering. Do NOT change SMS entitlement or STOP/HELP behavior for this feature.
- Email production mode must fail loud if no provider is configured. Do NOT reintroduce simulated success in production.

## Product behavior
### 1. Customer preference model
Each customer/RO should support:
- `sms_consent` existing boolean.
- `email_consent` new boolean.
- `preferred_contact_method` new optional string: `sms`, `email`, `both`, `none`.

Decision:
- If `preferred_contact_method` is missing, derive it from consent booleans:
  - SMS + email = `both`
  - SMS only = `sms`
  - Email only = `email`
  - neither = `none`
- Email notification sends only when `email_consent = true` AND customer email is present.

### 2. Add RO / Customer UI
Add RO customer step:
- Keep current SMS consent checkbox.
- Add checkbox: `Customer agrees to receive email status updates.`
- If the user enables email updates and the email field is empty, show inline validation: `Customer email is required for email updates.`
- Default behavior:
  - Existing customer: load their saved email preference.
  - New customer: unchecked by default unless the shop explicitly checks it.

Customer profile / Customer drawer:
- Show email notification consent next to SMS consent.
- Allow editing and saving the preference.

RO Detail:
- In customer/contact area, show compact notification chips:
  - SMS On / SMS Off
  - Email On / Email Off
- Allow owner/admin to update email consent if customer email exists.

### 3. Status-update email sending
When an RO status changes and REVV would send a customer status notification:
- Continue current SMS behavior unchanged.
- Also send an email if email is opted in.
- If both channels are enabled, send both.
- If email provider fails, do not block the status change. Log/audit the email failure and show staff a non-blocking warning/toast where applicable.

Email from identity:
- Use a verified REVV sender for deliverability.
- Use shop name in the display name:
  - `Miles Automotive via REVV <notifications@revvshop.app>`
- Reply-to may be the shop email if configured; otherwise no reply-to.
- Do not send directly from an unverified shop-domain address.

### 4. Email content
Use simple status-update templates:
- Subject: `{shopName}: Your {vehicle} status is now {statusLabel}`
- Body includes:
  - customer first/name if available
  - RO number
  - vehicle year/make/model
  - new status label
  - shop name + phone
  - tracking/customer portal link if available
  - preference footer: `You are receiving this because you agreed to email updates from {shopName}.`

Do not include:
- internal notes
- profit/margin
- supplement strategy
- staff-only fields
- any approval/share tokens unless the endpoint is explicitly intended for customer access.

### 5. Customer portal preference update
If a customer opens a tracking/portal page:
- Show current notification preferences when token allows customer self-service.
- Let customer add/update email and opt in/out of email status updates.
- Keep SMS opt-out tied to SMS compliance; do not replace STOP handling.

## Backend implementation
### Schema
Additive only:
- `customers.email_consent BOOLEAN DEFAULT FALSE`
- `customers.preferred_contact_method TEXT DEFAULT 'none'`

Optional RO-level snapshot if needed for audit:
- `repair_orders.email_consent BOOLEAN`
- `repair_orders.preferred_contact_method TEXT`

Recommendation:
- Store canonical preferences on `customers`.
- Snapshot on RO only if current code already snapshots contact consent per RO. If not, keep it customer-level for Phase 1.

### Routes / services
Create or extend a notification service:
- `backend/src/services/roNotifications.js` or equivalent shared helper.
- Inputs: `{ ro, customer, shop, status, channels }`.
- Responsibilities:
  - decide channels from consent + available contact data
  - send SMS through existing SMS path
  - send email through existing email/mailer path
  - write outbound communication rows for audit
  - return per-channel result

Use explicit shop scoping everywhere:
- customer update routes must use `shop_id::text = $N::text`
- RO load/update routes must use joined/scoped RO queries
- no `SELECT *` in new queries

### Failure handling
- Missing customer email + email consent true: return validation error on preference save.
- Email provider not configured in production: no silent success; return/report `no_provider_configured`.
- Status change should still complete if email send fails.
- Audit row should capture failed email send with safe summary, no raw template body dump.

## Frontend implementation
Touched surfaces:
- `frontend/src/components/AddROModal.jsx`
- customer edit drawer/profile component
- `frontend/src/pages/RODetail.jsx`
- possibly customer portal/tracking page if self-service is included in the same phase.

UI rules:
- Inline `role="alert"` for validation, no browser `alert()`.
- Use existing REVV gold focus/primary treatment.
- Fit on phone/tablet/desktop.
- Do not add another modal if the preference fits inside the existing customer/contact section.

## Tests
### Backend mocked tests
Add focused tests for:
1. Add/update customer email consent requires email when `email_consent=true`.
2. Status change with email opt-in sends one email.
3. Status change with SMS+email opt-in sends both channels.
4. Status change with no email consent sends no email.
5. Production email provider missing returns failure and does not pretend success.
6. Email failure does not block status transition.
7. Shop scoping: owner/admin cannot update another shop customer preference.
8. Audit row is written for sent/failed email without storing secrets or full raw body.

### Frontend tests
Add focused tests for:
1. Add RO shows SMS and Email consent controls.
2. Email consent checked with blank email shows inline validation and blocks Next/Save.
3. Existing customer preference loads into Add RO.
4. Customer/RO detail preference toggle saves and shows status chip.

### Regression
- Existing SMS tests remain green.
- Existing Add RO keyboard/modal tests remain green.
- Existing customer and RO status tests remain green.

## QA gates
- `node --check` touched backend files.
- `node --test backend/src/__tests__/*.test.js backend/test/*.test.js`
- `cd frontend && npm run test:run` for touched frontend tests.
- `cd frontend && npm run build`
- `git diff --check && git ls-files frontend/dist` returns no tracked dist.
- Browser/tablet smoke:
  - Add RO customer step shows both consent options.
  - Email consent validation is visible and does not get hidden by iPad keyboard.
  - Status change sends/records email in mocked or staging-safe environment.

## Rollout / deploy safety
- No real customer emails during tests.
- Use mocked email provider in automated tests.
- Deploy only after Claude Code QA PASS.
- Post-deploy production smoke:
  - health endpoint OK
  - create/update a test customer or seeded demo customer only
  - verify email preference saves
  - verify status-update email path with a safe test recipient

## Out of scope for Phase 1
- Marketing emails.
- Bulk email blasts.
- Custom email template editor.
- Attachments/PDF invoices in every status email.
- Replacing SMS opt-out rules with email preferences.
- Sending from unverified shop-owned domains.

## Recommended phases
### Phase 1 — Data + Add RO preference
- Add customer email consent/preferred contact fields.
- Add Add RO email consent UI and validation.
- Save/load preference for customers.

### Phase 2 — Status email notification service
- Shared notification router for RO status changes.
- Email template + audit row.
- Email failures non-blocking.

### Phase 3 — Customer/RO preference management
- Customer drawer/profile preference editing.
- RO Detail chips and owner/admin controls.

### Phase 4 — Portal self-service
- Customer portal email add/update + opt-in/out.
- Preference footer and customer-safe unsubscribe/update link.

## Done definition
Customer can opt into email status updates, REVV sends customer-safe status emails from the shop-branded REVV sender when status changes, SMS still works exactly as before, and all behavior is tested without touching real customer data.
