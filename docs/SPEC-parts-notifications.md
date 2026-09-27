# Parts customer notifications — 2026-09-27

## Scope
An unchecked Notify customer control on the delivery editor explicitly requests an outbound update for that save only. Save-only remains default. Only changes to customer-visible status, ETA/source, checked quantities or customer note qualify; supplier and internal edits and carrier observations do not. Existing customer opt-ins, contact preferences, shop switches and SMS plan/STOP gates apply. No new AI/provider credentials. Provider acceptance is not confirmed delivery.

## Existing artifacts verified before edits
- backend/src/routes/parts.js: PUT /:id/delivery saves staff delivery revisions.
- backend/src/services/partsDelivery.js: event schema, snapshots, transactional revision checks.
- backend/src/services/sms.js: sendSMS enforces entitlement and STOP suppression.
- backend/src/services/mailer.js: sendMail uses existing Resend configuration, returns null when unconfigured.
- frontend/src/components/PartDeliveryEditor.jsx and its existing PartDelivery.test.jsx tests.
- New: backend/src/services/partsNotifications.js and backend/test/partsNotifications.test.js.

## Safety and completion gate
A unique shop/part/revision claim prevents concurrent/retried sends, including ambiguous provider failures. No background retry; unknown results require staff verification. Records store outcome codes without raw recipient/body. Save must survive notification failure and UI must show the outcome before closing. Claimed events are staff-created and still current. Safe content excludes supplier, shipment numbers, cost and private notes. Tests mock providers and exercise tenant scoping, no-op, concurrency, preference/consent and provider outcomes; frontend tests and production build. No real customer messages or production data changes. Root worker independently reviews and integrates the commit.

## Implemented evidence
- Explicit per-save checkbox defaults off. Provider result receipt remains on screen until Done, and delivery history retains each channel outcome plus provider reference if accepted.
- Eight-second provider wait per channel caps response delay. Timeouts are unknown (not failed delivery); durable unique claims prevent retries of ambiguous sends. No automated retries are added.
- Additive parts_delivery_notifications table stores shop/part/revision and safe result codes only; include in backup/retention. No customer phone, address, email or message body is duplicated into the audit table.
- Existing Resend and Twilio are used. Existing SMS service enforces plan entitlement and STOP handling. Missing consent/preference/contact/shop-enabled checks apply before provider calls. No provider or customer record was changed in production.
- Verification: 15 focused backend unit tests, 18 disposable PostgreSQL integration tests across TEXT/UUID IDs, 149 frontend tests, production build, syntax and diff checks passed. Provider calls were mocked. No standalone lint/typecheck scripts exist in package manifests.
- Independent root review requested bounded provider waits and durable history; both fixed and regression tested. Root owns final independent QA, PR and deployment. This branch is not independently deployed.
